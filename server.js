require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'angelone_secure_token_123';

// 1. Webhook Verification (Meta requires this to connect)
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK VERIFIED SUCCESSFULLY!');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// 2. Receive Incoming WhatsApp Messages
app.post('/webhook', (req, res) => {
    let body = req.body;

    if (body.object) {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
            let from = body.entry[0].changes[0].value.messages[0].from;
            let msg_body = body.entry[0].changes[0].value.messages[0].text.body;

            console.log(`\nNew WhatsApp Message from ${from}: ${msg_body}`);
        }
        res.sendStatus(200); // Always return 200 to Meta so they know we received it
    } else {
        res.sendStatus(404);
    }
});

app.listen(PORT, () => {
    console.log(`\n======================================`);
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Your Verify Token for Meta is: ${VERIFY_TOKEN}`);
    console.log(`======================================\n`);
});
