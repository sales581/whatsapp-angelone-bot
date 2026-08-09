require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./database');
const ai = require('./ai_chat');

// Initialize AI if API key is provided
ai.initAI(process.env.GEMINI_API_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'angelone_secure_token_123';

// Multer for CSV upload (store in memory)
const upload = multer({ dest: 'uploads/' });

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 1. SERVE DASHBOARD
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// 2. WEBHOOK - META VERIFICATION
// ============================================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK VERIFIED!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// ============================================================
// 3. WEBHOOK - RECEIVE MESSAGE STATUS UPDATES
// ============================================================
app.post('/webhook', (req, res) => {
    const body = req.body;
    if (body.object) {
        const changes = body.entry?.[0]?.changes?.[0]?.value;
        if (changes) {
            // Incoming message from client
            if (changes.messages?.[0]) {
                const msg = changes.messages[0];
                const from = msg.from;
                const text = msg.text?.body || '';
                console.log(`Incoming from ${from}: ${text}`);
                db.logIncomingMessage(from, text);

                // Handle AI Auto-Reply
                (async () => {
                    try {
                        const botActive = await db.getClientBotStatus(from);
                        if (botActive && text) {
                            const history = await new Promise(resolve => db.getChatHistory(from, resolve));
                            const prompt = await db.getSystemPrompt();
                            const aiResponse = await ai.generateReply(prompt, history.history, text);
                            
                            if (aiResponse) {
                                await sendMessage(from, aiResponse);
                                db.logOutgoingMessage(from, aiResponse, 'ai_reply'); // Log outgoing bot message
                            }
                        }
                    } catch (err) {
                        console.error('Error in Auto-Reply:', err.message);
                    }
                })();
            }
            // Status update (sent, delivered, read)
            if (changes.statuses?.[0]) {
                const status = changes.statuses[0];
                const phone = status.recipient_id;
                const msgStatus = status.status; // sent, delivered, read
                console.log(`Status update for ${phone}: ${msgStatus}`);
                if (msgStatus === 'failed') {
                    console.log(`[META RAW ERROR] Failure details for ${phone}:`, JSON.stringify(status, null, 2));
                }
                db.updateMessageStatus(phone, msgStatus);
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// ============================================================
// 4. TRACKING LINK (Who clicked the Angel One link)
// ============================================================
app.get('/link/:phone', (req, res) => {
    const phone = req.params.phone;
    db.updateClientStage(phone, 'link_clicked');
    console.log(`Link clicked by: ${phone}`);
    // Redirect to Angel One partner referral link (accounts credited to TPF)
    res.redirect('https://a.aonelink.in/ANGOne/FZrz2vo');
});

// ============================================================
// 5. API - GET ALL CLIENTS
// ============================================================
app.get('/api/clients', (req, res) => {
    db.getAllClients((clients) => {
        res.json(clients);
    });
});

// ============================================================
// 6. API - GET DASHBOARD STATS
// ============================================================
app.get('/api/stats', (req, res) => {
    db.getStats((stats) => {
        res.json(stats);
    });
});

// ============================================================
// 7. API - UPLOAD ANGEL ONE CSV
// ============================================================
app.post('/api/upload-csv', upload.single('csv'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const results = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            db.processCSV(results, (summary) => {
                fs.unlinkSync(req.file.path); // Delete temp file
                res.json({ success: true, summary });
            });
        })
        .on('error', (err) => {
            res.status(500).json({ error: 'Failed to parse CSV: ' + err.message });
        });
});

// ============================================================
// API - CLEAR DATABASE
// ============================================================
app.delete('/api/clear', (req, res) => {
    db.clearAllClients(() => {
        res.json({ success: true, message: 'All records deleted.' });
    });
});

// ============================================================
// API - GET CHAT HISTORY
// ============================================================
app.get('/api/chat/:phone', async (req, res) => {
    const phone = req.params.phone;
    const botActive = await db.getClientBotStatus(phone);
    db.getChatHistory(phone, (data) => {
        res.json({ success: true, history: data.history, botActive });
    });
});

// ============================================================
// API - SEND MANUAL REPLY
// ============================================================
app.post('/api/chat/reply', async (req, res) => {
    const { phone, text, message } = req.body;
    const msgContent = text || message; // Handle both variable names just in case
    
    if (!msgContent) {
        return res.status(400).json({ success: false, error: 'Message content is empty' });
    }

    try {
        const result = await sendMessage(phone, msgContent);
        db.logOutgoingMessage(phone, msgContent, 'manual_reply');
        
        // Turn off AI if a human manually replies
        await db.toggleAutoBot(phone, false);
        
        // Mark as 'read' so it leaves the New Queries tab
        db.markAsResolved(phone);
        
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================
// API - MARK AS RESOLVED
// ============================================================
app.post('/api/chat/resolve', async (req, res) => {
    const { phone } = req.body;
    try {
        db.markAsResolved(phone);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================= AI SETTINGS ROUTES =================

app.get('/api/bot-settings', async (req, res) => {
    const prompt = await db.getSystemPrompt();
    res.json({ prompt });
});

app.post('/api/bot-settings', async (req, res) => {
    await db.saveSystemPrompt(req.body.prompt);
    res.json({ success: true });
});

app.post('/api/bot-toggle', async (req, res) => {
    await db.toggleAutoBot(req.body.phone, req.body.active);
    res.json({ success: true });
});

// ============================================================
// 8. API - SEND BULK WHATSAPP MESSAGE BY STAGE
// ============================================================
app.post('/api/send-bulk', async (req, res) => {
    const { stage, message_type } = req.body;
    if (!stage) return res.status(400).json({ error: 'Stage is required' });

    db.getClientsByStage(stage, async (clients) => {
        if (!clients.length) return res.json({ success: true, sent: 0, message: 'No clients found for this stage.' });

        let sent = 0;
        let failed = 0;

        for (const client of clients) {
            try {
                await sendWhatsAppMessage(client.phone, client.name, message_type, stage);
                db.updateMessageStatus(client.phone, 'sent');
                db.logOutgoingMessage(client.phone, '[Template Sent]', message_type);
                sent++;
                await sleep(300); // Avoid rate limiting
            } catch (err) {
                console.error(`Failed to send to ${client.phone}:`, err.message);
                failed++;
            }
        }
        res.json({ success: true, sent, failed });
    });
});

// ============================================================
// 9. API - ADD SINGLE CLIENT MANUALLY
// ============================================================
app.post('/api/add-client', (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
    db.addClient(name, phone, 'lead', (result) => {
        res.json({ success: true, client: result });
    });
});

// ============================================================
// WHATSAPP MESSAGING FUNCTION (Using Approved Templates)
// ============================================================
async function sendMessage(phone, text) {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { preview_url: false, body: text }
    };
    const response = await axios.post(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, payload, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    return response.data;
}

async function sendWhatsAppMessage(phone, name, message_type, stage) {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    // Build tracking link and public server URL
    const serverUrl = 'https://whatsapp-angelone-bot-production.up.railway.app';

    // Map each stage/message_type to an approved Meta template
    const templateMap = {
        lead: 'tpf_initial_lead',
        follow_up: 'followup1',
        link_clicked: 'followup1',
        incomplete: 'kyc_folloup',
        account_opened: 'followup1',
        not_funded: 'followup1',
    };

    const templateName = templateMap[message_type] || templateMap[stage] || 'followup1';

    // Build the base template message payload
    const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
            name: templateName,
            language: { code: 'en' },
            components: [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: name || 'Client' }
                    ]
                }
            ]
        }
    };

    // Add Video header ONLY for tpf_initial_lead
    if (templateName === 'tpf_initial_lead') {
        payload.template.components.push({
            type: 'header',
            parameters: [
                {
                    type: 'video',
                    video: {
                        id: '1815950206443779'
                    }
                }
            ]
        });
    }

    console.log(`Sending template "${templateName}" to ${phone} (${name})`);

    const response = await axios.post(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        }
    );
    console.log(`Message sent successfully to ${phone}:`, response.data);
    return response.data;
}

// ============================================================
// 10. API - TEST SEND SINGLE MESSAGE
// ============================================================
app.post('/api/test-send', async (req, res) => {
    const { phone, name, template } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    try {
        const result = await sendWhatsAppMessage(phone, name || 'Test User', template || 'lead', 'lead');
        res.json({ success: true, result });
    } catch (err) {
        console.error('Test send failed:', err.response?.data || err.message);
        res.status(500).json({ success: false, error: err.response?.data || err.message });
    }
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(` Dashboard: http://localhost:${PORT}`);
    console.log(`========================================\n`);
});
