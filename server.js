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
                const contactName = changes.contacts?.[0]?.profile?.name || 'Unknown Sender';
                
                console.log(`Incoming from ${contactName} (${from}): ${text}`);
                db.logIncomingMessage(from, text, contactName);

                // Handle AI Auto-Reply
                (async () => {
                    try {
                        let botActive = await db.getClientBotStatus(from);
                        
                        // ==========================================
                        // AI CIRCUIT Breaker (Prevent Infinite Loops)
                        // ==========================================
                        const lowerText = text.toLowerCase();
                        const isAutoResponder = lowerText.includes('no-reply') || 
                                                lowerText.includes('no reply') || 
                                                lowerText.includes('do not reply') || 
                                                lowerText.includes('automated message') || 
                                                lowerText.includes('auto-reply') || 
                                                lowerText.includes('out of office');
                        
                        if (isAutoResponder && botActive) {
                            console.log(`[CIRCUIT BREAKER] Detected auto-responder from ${from}. Disabling AI.`);
                            await db.toggleAutoBot(from, false);
                            botActive = false;
                        }
                        
                        if (lowerText === 'stop') {
                            console.log(`[CIRCUIT BREAKER] User explicitly requested STOP. Opting out ${from}.`);
                            await db.setOptOut(from, true);
                            botActive = false;
                        }
                        
                        // Smart Loop Detection: Mute if the EXACT SAME message is sent 3 times in a row
                        if (!global.duplicateMap) global.duplicateMap = {};
                        
                        if (!global.duplicateMap[from]) {
                            global.duplicateMap[from] = { text: lowerText, count: 1 };
                        } else {
                            if (global.duplicateMap[from].text === lowerText) {
                                global.duplicateMap[from].count++;
                            } else {
                                global.duplicateMap[from] = { text: lowerText, count: 1 };
                            }
                        }
                        
                        if (global.duplicateMap[from].count >= 3 && botActive) {
                            console.log(`[CIRCUIT BREAKER] Infinite loop detected for ${from} (Same message 3 times). Disabling AI.`);
                            await db.toggleAutoBot(from, false);
                            botActive = false;
                        }
                        // ==========================================

                        if (botActive && text) {
                            const history = await new Promise(resolve => db.getChatHistory(from, resolve));
                            const prompt = await db.getSystemPrompt();
                            let aiResponse = await ai.generateReply(prompt, history.history, text);
                            
                            if (aiResponse) {
                                // Check if AI extracted an OPT_OUT
                                if (aiResponse.includes('[OPT_OUT]')) {
                                    console.log(`🤖 AI Extracted OPT_OUT for ${from}`);
                                    await db.setOptOut(from, true);
                                    aiResponse = aiResponse.replace(/\[OPT_OUT\]/g, '').trim();
                                    botActive = false; // Stop further messages
                                }
                                
                                // Check if AI extracted a name from the conversation
                                const nameMatch = aiResponse.match(/\[NAME:\s*(.+?)\]/);
                                if (nameMatch) {
                                    const extractedName = nameMatch[1].trim();
                                    console.log(`🤖 AI Extracted Name: ${extractedName}`);
                                    db.updateClientName(from, extractedName);
                                    // Remove the tag from the final message
                                    aiResponse = aiResponse.replace(/\[NAME:\s*(.+?)\]/, '').trim();
                                }
                                
                                if (aiResponse) {
                                    await sendMessage(from, aiResponse);
                                    db.logOutgoingMessage(from, aiResponse, 'ai_reply'); // Log outgoing bot message
                                }
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
// WEBHOOK - GOOGLE SHEETS / NEW LEADS
// ============================================================
app.post('/api/webhook/new-lead', (req, res) => {
    let { name, phone, source } = req.body;
    
    if (!phone) {
        return res.status(400).json({ success: false, error: "Phone number is required" });
    }
    
    // Add client to database
    db.addClient(name || 'Unknown Lead', phone, 'lead', async (client) => {
        try {
            // Send the initial welcome video template
            await sendWhatsAppMessage(client.phone, client.name, 'lead', 'lead');
            db.updateMessageStatus(client.phone, 'sent');
            db.logOutgoingMessage(client.phone, '[Auto Welcome Template Sent]', 'lead');
            console.log(`[Google Sheets Webhook] Successfully added and welcomed lead: ${client.name} (${client.phone})`);
            res.json({ success: true, message: "Lead added and welcome message sent!" });
        } catch(e) {
            console.error("[Google Sheets Webhook] Failed to send welcome message:", e.message);
            res.status(500).json({ success: false, error: "Lead added but message failed to send." });
        }
    });
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
                
                // Kick off the automated drip campaign!
                runDripCampaign();
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
    const { stage, message_type, date_after } = req.body;
    if (!stage) return res.status(400).json({ error: 'Stage is required' });

    db.getClientsByStage(stage, async (clients) => {
        // Apply date filter if requested
        if (date_after && clients.length > 0) {
            const filterDate = new Date(date_after);
            // created_at is stored as "DD/MM/YYYY, HH:MM:SS" from toLocaleString('en-IN')
            clients = clients.filter(c => {
                if (!c.created_at) return true;
                const datePart = c.created_at.split(',')[0];
                const parts = datePart.split('/');
                if (parts.length === 3) {
                    const clientDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
                    return clientDate >= filterDate;
                }
                return true; // fallback if parsing fails
            });
        }

        if (!clients.length) return res.json({ success: true, sent: 0, message: 'No clients found for this stage matching the date filter.' });

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

// ============================================================
// AUTO DRIP CAMPAIGN ENGINE
// ============================================================
async function runDripCampaign() {
    console.log('[DRIP CAMPAIGN] Starting daily IN Process campaign...');
    db.getClientsByStage('incomplete', async (clients) => {
        let sentCount = 0;
        
        for (const c of clients) {
            if (c.opt_out) continue; // Skip opted out
            
            // Auto-heal legacy leads: if they are incomplete but have no start date, start them TODAY!
            if (!c.in_process_start) {
                const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                c.in_process_start = nowStr;
                if (db.pool) {
                    db.pool.query('UPDATE clients SET in_process_start = $1 WHERE phone = $2', [nowStr, c.phone]).catch(console.error);
                }
            }
            
            // Calculate days since in_process_start
            const startDateStr = c.in_process_start.split(',')[0]; // "DD/MM/YYYY"
            const parts = startDateStr.split('/');
            if (parts.length !== 3) continue;
            
            const startDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
            const today = new Date();
            // Reset times to midnight for accurate day calculation
            startDate.setHours(0,0,0,0);
            today.setHours(0,0,0,0);
            
            const diffTime = today - startDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            // Drip logic: Day 0 (today), Day 1, Day 2, Day 6 (7th day), then every 7 days
            let shouldSend = false;
            if (diffDays === 0 || diffDays === 1 || diffDays === 2 || diffDays === 6) {
                shouldSend = true;
            } else if (diffDays > 6 && (diffDays - 6) % 7 === 0) {
                shouldSend = true;
            }
            
            if (shouldSend) {
                try {
                    await sendWhatsAppMessage(c.phone, c.name, 'incomplete', 'incomplete');
                    db.updateMessageStatus(c.phone, 'sent');
                    db.logOutgoingMessage(c.phone, '[Auto Drip Campaign]', 'incomplete');
                    sentCount++;
                    await sleep(300); // Rate limiting
                } catch (e) {
                    console.error(`Drip send failed for ${c.phone}:`, e.message);
                }
            }
        }
        console.log(`[DRIP CAMPAIGN] Finished. Sent ${sentCount} reminders.`);
    });
}

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
