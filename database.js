const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'clients_db.json');

// ============================================================
// LOAD & SAVE DATABASE (JSON file)
// ============================================================
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const empty = { clients: [], message_log: [], next_id: 1 };
        fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
        return empty;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function now() {
    return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function normalizePhone(phone) {
    phone = phone.toString().replace(/[\s\-\(\)\.]/g, '');
    if (phone.startsWith('0')) phone = '91' + phone.slice(1);
    if (!phone.startsWith('91') && phone.length === 10) phone = '91' + phone;
    return phone;
}

console.log('JSON Database initialized at:', DB_FILE);

// ============================================================
// ADD A SINGLE CLIENT
// ============================================================
function addClient(name, phone, stage = 'lead', callback) {
    phone = normalizePhone(phone);
    const db = loadDB();
    const existing = db.clients.find(c => c.phone === phone);
    if (existing) return callback({ ...existing, already_exists: true });

    const client = {
        id: db.next_id++,
        name,
        phone,
        angel_stage: stage,
        message_status: 'not_sent',
        clicked_link: false,
        messages_sent: 0,
        last_message_type: null,
        last_message_time: null,
        last_updated: now(),
        created_at: now(),
    };
    db.clients.push(client);
    saveDB(db);
    callback({ ...client, already_exists: false });
}

// ============================================================
// PROCESS ANGEL ONE CSV
// ============================================================
function processCSV(rows, callback) {
    const db = loadDB();
    let added = 0, updated = 0, skipped = 0;

    for (const row of rows) {
        // Smart column detection — find columns by keyword matching
        const keys = Object.keys(row);
        const findCol = (...keywords) => {
            for (const key of keys) {
                const k = key.toLowerCase().trim();
                if (keywords.some(kw => k.includes(kw))) return row[key];
            }
            return '';
        };

        const name = findCol('name', 'client', 'customer') || 'Unknown';
        let phone = findCol('mobile', 'phone', 'contact', 'number', 'whatsapp') || '';
        const status = findCol('status', 'stage', 'state') || '';
        const stage = mapAngelOneStatus(status);

        // Debug: log column names on first row
        if (added === 0 && updated === 0 && skipped === 0) {
            console.log('CSV Columns detected:', keys);
            console.log('Mapped → Name:', name, '| Phone:', phone, '| Status:', status);
        }

        if (!phone) { skipped++; continue; }

        // Fix Excel scientific notation (9.02E+09 → 9020000000)
        phone = phone.toString();
        if (phone.includes('E+') || phone.includes('e+')) {
            phone = Math.round(Number(phone)).toString();
        }
        // Remove any decimals that Excel may have added
        if (phone.includes('.')) {
            phone = phone.split('.')[0];
        }
        phone = normalizePhone(phone);

        const idx = db.clients.findIndex(c => c.phone === phone);
        if (idx >= 0) {
            db.clients[idx].angel_stage = stage;
            db.clients[idx].last_updated = now();
            updated++;
        } else {
            db.clients.push({
                id: db.next_id++,
                name,
                phone,
                angel_stage: stage,
                message_status: 'not_sent',
                clicked_link: false,
                messages_sent: 0,
                last_message_type: null,
                last_message_time: null,
                last_updated: now(),
                created_at: now(),
            });
            added++;
        }
    }
    saveDB(db);
    callback({ added, updated, skipped, total: rows.length });
}

function mapAngelOneStatus(status) {
    const s = (status || '').toLowerCase().trim();
    if (!s) return 'lead'; // Blank status = New Lead
    if (s.includes('account open') || s.includes('opened') || s.includes('active')) return 'account_opened';
    if (s.includes('fund') || s.includes('deposit') || s.includes('trade')) return 'funded';
    if (s.includes('incomplete') || s.includes('pending') || s.includes('in progress')) return 'incomplete';
    if (s.includes('rejected') || s.includes('failed')) return 'rejected';
    if (s.includes('link') || s.includes('clicked')) return 'link_clicked';
    return 'lead'; // Default fallback
}

// ============================================================
// UPDATE MESSAGE STATUS FROM WEBHOOK
// ============================================================
function updateMessageStatus(phone, status) {
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        // Only upgrade status, never downgrade (read > delivered > sent)
        const order = ['not_sent', 'sent', 'delivered', 'read'];
        const current = order.indexOf(db.clients[idx].message_status);
        const incoming = order.indexOf(status);
        if (incoming > current) {
            db.clients[idx].message_status = status;
            db.clients[idx].last_updated = now();
            saveDB(db);
        }
    }
}

// ============================================================
// UPDATE CLIENT STAGE (link clicked)
// ============================================================
function updateClientStage(phone, stage) {
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        db.clients[idx].angel_stage = stage;
        db.clients[idx].clicked_link = true;
        db.clients[idx].last_updated = now();
        saveDB(db);
    }
}

// ============================================================
// LOG INCOMING MESSAGE
// ============================================================
function logIncomingMessage(phone, content) {
    const db = loadDB();
    db.message_log.push({ phone, direction: 'incoming', content, timestamp: now() });
    saveDB(db);
}

// ============================================================
// LOG OUTGOING MESSAGE SENT
// ============================================================
function logMessageSent(phone, message_type) {
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        db.clients[idx].messages_sent = (db.clients[idx].messages_sent || 0) + 1;
        db.clients[idx].last_message_type = message_type;
        db.clients[idx].last_message_time = now();
        db.clients[idx].last_updated = now();
    }
    db.message_log.push({ phone, direction: 'outgoing', message_type, timestamp: now() });
    saveDB(db);
}

// ============================================================
// GET ALL CLIENTS
// ============================================================
function getAllClients(callback) {
    const db = loadDB();
    const sorted = [...db.clients].sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));
    callback(sorted);
}

// ============================================================
// GET CLIENTS BY STAGE
// ============================================================
function getClientsByStage(stage, callback) {
    const db = loadDB();
    const clients = stage === 'all' ? db.clients : db.clients.filter(c => c.angel_stage === stage);
    callback(clients);
}

// ============================================================
// GET STATS
// ============================================================
function getStats(callback) {
    const db = loadDB();
    const c = db.clients;
    callback({
        total: c.length,
        sent: c.filter(x => ['sent','delivered','read'].includes(x.message_status)).length,
        delivered: c.filter(x => ['delivered','read'].includes(x.message_status)).length,
        read: c.filter(x => x.message_status === 'read').length,
        clicked: c.filter(x => x.clicked_link).length,
        account_opened: c.filter(x => x.angel_stage === 'account_opened').length,
        funded: c.filter(x => x.angel_stage === 'funded').length,
        incomplete: c.filter(x => x.angel_stage === 'incomplete').length,
        leads: c.filter(x => x.angel_stage === 'lead').length,
    });
}

// ============================================================
// CLEAR ALL DATA
// ============================================================
function clearAllClients(callback) {
    const empty = { clients: [], message_log: [], next_id: 1 };
    saveDB(empty);
    callback({ success: true });
}

module.exports = {
    addClient,
    processCSV,
    updateMessageStatus,
    updateClientStage,
    logIncomingMessage,
    logMessageSent,
    getAllClients,
    getClientsByStage,
    getStats,
    clearAllClients,
};
