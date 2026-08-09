const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DB_DIR, 'clients_db.json');
const USE_PG = !!process.env.DATABASE_URL;

let pool;
if (USE_PG) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    
    pool.query(`
        CREATE TABLE IF NOT EXISTS clients (
            id SERIAL PRIMARY KEY,
            name TEXT,
            phone TEXT UNIQUE,
            angel_stage TEXT,
            message_status TEXT,
            clicked_link BOOLEAN,
            messages_sent INTEGER,
            last_message_type TEXT,
            last_message_time TEXT,
            last_updated TEXT,
            created_at TEXT,
            auto_bot_active BOOLEAN DEFAULT TRUE
        );
        CREATE TABLE IF NOT EXISTS message_log (
            id SERIAL PRIMARY KEY,
            phone TEXT,
            direction TEXT,
            message_type TEXT,
            content TEXT,
            timestamp TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `).then(() => {
        // Run migrations if needed
        pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_bot_active BOOLEAN DEFAULT TRUE').catch(()=>console.log('Column already exists'));
        console.log('✅ PostgreSQL Database initialized');
        // Auto-sync any unknown senders from logs into the clients table
        pool.query(`
            INSERT INTO clients (name, phone, angel_stage, message_status, clicked_link, messages_sent, last_updated, created_at)
            SELECT DISTINCT 'Unknown Sender', phone, 'new_query', 'replied', false, 0, $1, $1
            FROM message_log
            WHERE phone NOT IN (SELECT phone FROM clients)
        `, [now()]).catch(console.error);
        
        // Auto-recover any lost 'replied' statuses from the previous bug
        pool.query(`
            UPDATE clients 
            SET message_status = 'replied' 
            WHERE phone IN (SELECT DISTINCT phone FROM message_log WHERE direction = 'incoming') 
            AND message_status NOT IN ('replied', 'read')
        `).catch(console.error);
    }).catch(console.error);
} else {
    console.log('✅ JSON Database initialized at:', DB_FILE);
}

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
function mapAngelOneStatus(status) {
    const s = (status || '').toLowerCase().trim();
    if (!s) return 'lead';
    if (s.includes('account open') || s.includes('opened') || s.includes('active')) return 'account_opened';
    if (s.includes('fund') || s.includes('deposit') || s.includes('trade')) return 'funded';
    if (s.includes('incomplete') || s.includes('pending') || s.includes('in progress')) return 'incomplete';
    if (s.includes('rejected') || s.includes('failed')) return 'rejected';
    if (s.includes('link') || s.includes('clicked')) return 'link_clicked';
    return 'lead';
}

// ----------------------------------------------------
function addClient(name, phone, stage = 'lead', callback) {
    phone = normalizePhone(phone);
    if (USE_PG) {
        pool.query('SELECT * FROM clients WHERE phone = $1', [phone]).then(res => {
            if (res.rows.length > 0) return callback({ ...res.rows[0], already_exists: true });
            const q = `INSERT INTO clients (name, phone, angel_stage, message_status, clicked_link, messages_sent, last_updated, created_at)
                       VALUES ($1, $2, $3, $4, false, 0, $5, $5) RETURNING *`;
            pool.query(q, [name, phone, stage, 'not_sent', now()])
                .then(ins => callback({ ...ins.rows[0], already_exists: false })).catch(err => { console.error(err); callback(null); });
        });
        return;
    }
    const db = loadDB();
    const existing = db.clients.find(c => c.phone === phone);
    if (existing) return callback({ ...existing, already_exists: true });
    const client = { id: db.next_id++, name, phone, angel_stage: stage, message_status: 'not_sent', clicked_link: false, messages_sent: 0, last_message_type: null, last_message_time: null, last_updated: now(), created_at: now() };
    db.clients.push(client);
    saveDB(db);
    callback({ ...client, already_exists: false });
}

function processCSV(rows, callback) {
    let added = 0, updated = 0, skipped = 0;
    
    if (USE_PG) {
        (async () => {
            for (const row of rows) {
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
                if (!phone) { skipped++; continue; }
                phone = phone.toString();
                if (phone.includes('E+') || phone.includes('e+')) phone = Math.round(Number(phone)).toString();
                if (phone.includes('.')) phone = phone.split('.')[0];
                phone = normalizePhone(phone);
                
                try {
                    const res = await pool.query('SELECT * FROM clients WHERE phone = $1', [phone]);
                    if (res.rows.length > 0) {
                        await pool.query('UPDATE clients SET angel_stage = $1, last_updated = $2 WHERE phone = $3', [stage, now(), phone]);
                        updated++;
                    } else {
                        await pool.query(`INSERT INTO clients (name, phone, angel_stage, message_status, clicked_link, messages_sent, last_updated, created_at)
                                          VALUES ($1, $2, $3, $4, false, 0, $5, $5)`, [name, phone, stage, 'not_sent', now()]);
                        added++;
                    }
                } catch (e) { console.error('CSV PG error:', e); }
            }
            callback({ added, updated, skipped, total: rows.length });
        })();
        return;
    }

    const db = loadDB();
    for (const row of rows) {
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
        if (!phone) { skipped++; continue; }
        phone = phone.toString();
        if (phone.includes('E+') || phone.includes('e+')) phone = Math.round(Number(phone)).toString();
        if (phone.includes('.')) phone = phone.split('.')[0];
        phone = normalizePhone(phone);
        const idx = db.clients.findIndex(c => c.phone === phone);
        if (idx >= 0) {
            db.clients[idx].angel_stage = stage;
            db.clients[idx].last_updated = now();
            updated++;
        } else {
            db.clients.push({ id: db.next_id++, name, phone, angel_stage: stage, message_status: 'not_sent', clicked_link: false, messages_sent: 0, last_message_type: null, last_message_time: null, last_updated: now(), created_at: now() });
            added++;
        }
    }
    saveDB(db);
    callback({ added, updated, skipped, total: rows.length });
}

function updateMessageStatus(phone, status) {
    if (USE_PG) {
        pool.query('SELECT message_status FROM clients WHERE phone = $1', [phone]).then(res => {
            if (res.rows.length > 0) {
                const order = ['not_sent', 'sent', 'delivered', 'read', 'replied'];
                const current = order.indexOf(res.rows[0].message_status || 'not_sent');
                const incoming = order.indexOf(status);
                if (incoming > current) {
                    pool.query('UPDATE clients SET message_status = $1, last_updated = $2 WHERE phone = $3', [status, now(), phone]).catch(console.error);
                }
            }
        }).catch(console.error);
        return;
    }
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        const order = ['not_sent', 'sent', 'delivered', 'read', 'replied'];
        const current = order.indexOf(db.clients[idx].message_status);
        const incoming = order.indexOf(status);
        if (incoming > current) {
            db.clients[idx].message_status = status;
            db.clients[idx].last_updated = now();
            saveDB(db);
        }
    }
}

function updateClientStage(phone, stage) {
    if (USE_PG) {
        pool.query('UPDATE clients SET angel_stage = $1, clicked_link = true, last_updated = $2 WHERE phone = $3', [stage, now(), phone]).catch(console.error);
        return;
    }
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        db.clients[idx].angel_stage = stage;
        db.clients[idx].clicked_link = true;
        db.clients[idx].last_updated = now();
        saveDB(db);
    }
}

function updateClientName(phone, name) {
    if (USE_PG) {
        pool.query('UPDATE clients SET name = $1, last_updated = $2 WHERE phone = $3', [name, now(), phone]).catch(console.error);
        return;
    }
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        db.clients[idx].name = name;
        db.clients[idx].last_updated = now();
        saveDB(db);
    }
}

function markAsResolved(phone) {
    if (USE_PG) {
        pool.query('UPDATE clients SET message_status = $1, last_updated = $2 WHERE phone = $3', ['read', now(), phone]).catch(console.error);
        return;
    }
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        db.clients[idx].message_status = 'read';
        db.clients[idx].last_updated = now();
        saveDB(db);
    }
}

function logIncomingMessage(phone, content, contactName = 'Unknown Sender') {
    if (USE_PG) {
        pool.query('INSERT INTO message_log (phone, direction, content, timestamp) VALUES ($1, $2, $3, $4)', [phone, 'incoming', content, now()]).catch(console.error);
        
        // Auto-create client if they don't exist, otherwise update status
        const upsertQuery = `
            INSERT INTO clients (name, phone, angel_stage, message_status, clicked_link, messages_sent, last_updated, created_at)
            VALUES ($1, $2, 'new_query', 'replied', false, 0, $3, $3)
            ON CONFLICT (phone) DO UPDATE 
            SET message_status = 'replied', last_updated = EXCLUDED.last_updated,
                name = CASE WHEN clients.name = 'Unknown Sender' THEN EXCLUDED.name ELSE clients.name END
        `;
        pool.query(upsertQuery, [contactName, phone, now()]).catch(console.error);
        return;
    }
    const db = loadDB();
    db.message_log.push({ phone, direction: 'incoming', content, timestamp: now() });
    
    let client = db.clients.find(c => c.phone === phone);
    if (!client) {
        db.clients.push({ name: contactName, phone, angel_stage: 'new_query', message_status: 'replied', clicked_link: false, messages_sent: 0, last_updated: now(), created_at: now() });
    } else {
        client.message_status = 'replied';
        client.last_updated = now();
        if (client.name === 'Unknown Sender') client.name = contactName;
    }
    saveDB(db);
}

function logOutgoingMessage(phone, content, message_type) {
    if (USE_PG) {
        pool.query('UPDATE clients SET messages_sent = COALESCE(messages_sent, 0) + 1, last_message_type = $1, last_message_time = $2, last_updated = $2 WHERE phone = $3', [message_type, now(), phone]).catch(console.error);
        pool.query('INSERT INTO message_log (phone, direction, message_type, content, timestamp) VALUES ($1, $2, $3, $4, $5)', [phone, 'outgoing', message_type, content, now()]).catch(console.error);
        return;
    }
    const db = loadDB();
    const idx = db.clients.findIndex(c => c.phone === phone);
    if (idx >= 0) {
        db.clients[idx].messages_sent = (db.clients[idx].messages_sent || 0) + 1;
        db.clients[idx].last_message_type = message_type;
        db.clients[idx].last_message_time = now();
        db.clients[idx].last_updated = now();
    }
    db.message_log.push({ phone, direction: 'outgoing', message_type, content, timestamp: now() });
    saveDB(db);
}

function getAllClients(callback) {
    if (USE_PG) {
        pool.query('SELECT * FROM clients ORDER BY last_updated DESC').then(res => callback(res.rows));
        return;
    }
    const db = loadDB();
    const sorted = [...db.clients].sort((a, b) => new Date(b.last_updated || 0) - new Date(a.last_updated || 0));
    callback(sorted);
}

function getClientsByStage(stage, callback) {
    if (USE_PG) {
        let q = 'SELECT * FROM clients';
        if (stage === 'lead') {
            q += " WHERE angel_stage = 'lead' AND message_status != 'read' AND message_status != 'replied'";
        } else if (stage === 'read') {
            q += " WHERE angel_stage = 'lead' AND message_status = 'read'";
        } else if (stage !== 'all') {
            q += ` WHERE angel_stage = '${stage}'`;
        }
        pool.query(q).then(res => callback(res.rows));
        return;
    }
    
    const db = loadDB();
    let clients = db.clients;
    if (stage === 'lead') {
        clients = clients.filter(c => c.angel_stage === 'lead' && c.message_status !== 'read' && c.message_status !== 'replied');
    } else if (stage === 'read') {
        clients = clients.filter(c => c.angel_stage === 'lead' && c.message_status === 'read');
    } else if (stage !== 'all') {
        clients = clients.filter(c => c.angel_stage === stage);
    }
    callback(clients);
}

function getStats(callback) {
    if (USE_PG) {
        pool.query('SELECT message_status, angel_stage, clicked_link FROM clients').then(res => {
            const c = res.rows;
            callback({
                total: c.length,
                sent: c.filter(x => ['sent','delivered','read','replied'].includes(x.message_status)).length,
                delivered: c.filter(x => ['delivered','read','replied'].includes(x.message_status)).length,
                read: c.filter(x => x.angel_stage === 'lead' && x.message_status === 'read').length,
                clicked: c.filter(x => x.clicked_link).length,
                account_opened: c.filter(x => x.angel_stage === 'account_opened').length,
                funded: c.filter(x => x.angel_stage === 'funded').length,
                incomplete: c.filter(x => x.angel_stage === 'incomplete').length,
                leads: c.filter(x => x.angel_stage === 'lead' && x.message_status !== 'read' && x.message_status !== 'replied').length,
            });
        });
        return;
    }
    const db = loadDB();
    const c = db.clients;
    callback({
        total: c.length,
        sent: c.filter(x => ['sent','delivered','read','replied'].includes(x.message_status)).length,
        delivered: c.filter(x => ['delivered','read','replied'].includes(x.message_status)).length,
        read: c.filter(x => x.angel_stage === 'lead' && x.message_status === 'read').length,
        clicked: c.filter(x => x.clicked_link).length,
        account_opened: c.filter(x => x.angel_stage === 'account_opened').length,
        funded: c.filter(x => x.angel_stage === 'funded').length,
        incomplete: c.filter(x => x.angel_stage === 'incomplete').length,
        leads: c.filter(x => x.angel_stage === 'lead' && x.message_status !== 'read' && x.message_status !== 'replied').length,
    });
}

function clearAllClients(callback) {
    if (USE_PG) {
        pool.query('TRUNCATE TABLE clients RESTART IDENTITY').then(() => {
            pool.query('TRUNCATE TABLE message_log RESTART IDENTITY').then(() => {
                callback({ success: true });
            });
        });
        return;
    }
    const empty = { clients: [], message_log: [], next_id: 1 };
    saveDB(empty);
    callback({ success: true });
}

function getChatHistory(phone, callback) {
    if (USE_PG) {
        pool.query('SELECT * FROM message_log WHERE phone = $1 ORDER BY id ASC', [phone]).then(res => callback({ history: res.rows }));
        return;
    }
    const db = loadDB();
    const history = db.message_log.filter(m => m.phone === phone);
    callback({ history });
}

// ================= AI FUNCTIONS =================

async function getSystemPrompt() {
    if (USE_PG) {
        try {
            const res = await pool.query("SELECT value FROM settings WHERE key = 'bot_system_prompt'");
            return res.rows[0]?.value || 'You are a helpful assistant for Trilok Singh, an Angel One partner. Answer questions politely and encourage users to open a free Demat account.';
        } catch (e) { return ''; }
    }
    const db = loadDB();
    return db.settings?.bot_system_prompt || 'You are a helpful assistant for Trilok Singh, an Angel One partner. Answer questions politely and encourage users to open a free Demat account.';
}

async function saveSystemPrompt(prompt) {
    if (USE_PG) {
        await pool.query("INSERT INTO settings (key, value) VALUES ('bot_system_prompt', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [prompt]);
        return;
    }
    const db = loadDB();
    if (!db.settings) db.settings = {};
    db.settings.bot_system_prompt = prompt;
    saveDB(db);
}

async function toggleAutoBot(phone, active) {
    if (USE_PG) {
        await pool.query("UPDATE clients SET auto_bot_active = $1 WHERE phone = $2", [active, phone]);
        return;
    }
    const db = loadDB();
    const client = db.clients.find(c => c.phone === phone);
    if (client) {
        client.auto_bot_active = active;
        saveDB(db);
    }
}

async function getClientBotStatus(phone) {
    if (USE_PG) {
        const res = await pool.query("SELECT auto_bot_active FROM clients WHERE phone = $1", [phone]);
        return res.rows[0] ? (res.rows[0].auto_bot_active !== false) : true;
    }
    const db = loadDB();
    const client = db.clients.find(c => c.phone === phone);
    return client ? (client.auto_bot_active !== false) : true;
}

module.exports = {
    addClient,
    processCSV,
    updateMessageStatus,
    updateClientStage,
    logIncomingMessage,
    logOutgoingMessage,
    getAllClients,
    getClientsByStage,
    getStats,
    clearAllClients,
    getChatHistory,
    getSystemPrompt,
    saveSystemPrompt,
    toggleAutoBot,
    getClientBotStatus,
    markAsResolved,
    updateClientName
};
