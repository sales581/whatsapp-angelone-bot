require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./database');

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
            }
            // Status update (sent, delivered, read)
            if (changes.statuses?.[0]) {
                const status = changes.statuses[0];
                const phone = status.recipient_id;
                const msgStatus = status.status; // sent, delivered, read
                console.log(`Status update for ${phone}: ${msgStatus}`);
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
                db.logMessageSent(client.phone, message_type);
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
// WHATSAPP MESSAGING FUNCTION
// ============================================================
async function sendWhatsAppMessage(phone, name, message_type, stage) {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    // Build tracking link for this specific client
    const serverUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `http://localhost:${PORT}`;
    const trackingLink = `${serverUrl}/link/${phone}`;

    // Message templates based on stage
    const messages = {
        lead: `Hi ${name}! 👋\n\nI'm reaching out from *Angel One - TPF*. We help you open a free Demat account and start investing in stocks.\n\n📈 *Benefits:*\n• Zero brokerage on delivery trades\n• Easy mobile app\n• Expert support\n\n👉 Open your account now: ${trackingLink}\n\nReply *YES* if you're interested!`,
        link_clicked: `Hi ${name}! 😊\n\nWe noticed you visited our account opening page but haven't completed it yet.\n\nNeed any help? Just reply to this message and our team will guide you step by step! 🙌`,
        incomplete: `Hi ${name}! 👋\n\nYour Angel One account application is *almost done*! Just a few more steps to complete.\n\n👉 Complete here: ${trackingLink}\n\nOur team is ready to help if you face any issues. Just reply to this message!`,
        account_opened: `🎉 Congratulations ${name}!\n\nYour *Angel One Demat Account* is now active!\n\nTo start trading:\n1️⃣ Download Angel One App\n2️⃣ Add funds to your account\n3️⃣ Place your first trade!\n\nNeed help? Just reply and we'll guide you! 📈`,
        not_funded: `Hi ${name}! 💰\n\nYour Angel One account is ready but you haven't added funds yet.\n\n*Why add funds now?*\n• Markets are full of opportunities\n• Even ₹500 is enough to start\n• Zero brokerage on delivery!\n\nAdd funds today and place your first trade! Reply *HELP* if you need guidance.`,
        follow_up: `Hi ${name}! 👋\n\nJust checking in from *Angel One - TPF*. Have you had a chance to look at the account opening details I shared?\n\nFeel free to reply with any questions. We are here to help! 😊`,
    };

    const messageText = messages[message_type] || messages[stage] || messages['follow_up'];

    const response = await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: messageText },
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data;
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
