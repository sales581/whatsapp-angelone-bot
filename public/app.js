// ============================================================
// STATE
// ============================================================
let allClients = [];
let currentSendStage = null;
let currentSendMsgType = null;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    loadClients();
});

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tab, el) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Show selected tab
    document.getElementById('tab-' + tab).classList.add('active');
    el.classList.add('active');

    // Update header title
    const titles = {
        dashboard: 'Dashboard',
        clients: 'Clients',
        messaging: 'Send Messages',
        upload: 'Upload CSV',
        addclient: 'Add Client',
    };
    document.getElementById('page-title').textContent = titles[tab] || tab;

    // Load data for that tab
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'clients') loadClients();
    if (tab === 'messaging') loadMessagingCounts();

    return false;
}

// ============================================================
// DASHBOARD STATS
// ============================================================
async function loadDashboard() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();

        document.getElementById('stat-total').textContent = stats.total;
        document.getElementById('stat-sent').textContent = stats.sent;
        document.getElementById('stat-delivered').textContent = stats.delivered;
        document.getElementById('stat-read').textContent = stats.read;
        document.getElementById('stat-clicked').textContent = stats.clicked;
        document.getElementById('stat-opened').textContent = stats.account_opened;
        document.getElementById('stat-funded').textContent = stats.funded;
        document.getElementById('stat-incomplete').textContent = stats.incomplete;

        // Funnel
        document.getElementById('f-total').textContent = stats.total;
        document.getElementById('f-sent').textContent = stats.sent;
        document.getElementById('f-delivered').textContent = stats.delivered;
        document.getElementById('f-read').textContent = stats.read;
        document.getElementById('f-clicked').textContent = stats.clicked;
        document.getElementById('f-opened').textContent = stats.account_opened;
        document.getElementById('f-funded').textContent = stats.funded;
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

// ============================================================
// CLIENTS TABLE
// ============================================================
async function loadClients() {
    try {
        const res = await fetch('/api/clients');
        allClients = await res.json();
        renderClients(allClients);
    } catch (err) {
        console.error('Failed to load clients:', err);
    }
}

function renderClients(clients) {
    const tbody = document.getElementById('clients-tbody');
    if (!clients.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No clients found. Add a client or upload a CSV to get started!</td></tr>';
        return;
    }
    tbody.innerHTML = clients.map((c, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td>${c.phone}</td>
            <td><span class="badge badge-${c.angel_stage}">${formatStage(c.angel_stage)}</span></td>
            <td><span class="badge badge-${c.message_status}">${c.message_status}</span></td>
            <td>${c.clicked_link ? '✅ Yes' : '❌ No'}</td>
            <td>${c.messages_sent || 0}</td>
            <td>${c.last_updated ? c.last_updated.substring(0, 16) : '—'}</td>
            <td>
                <button class="btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openChatModal('${c.phone}', '${escapeHtml(c.name)}')">💬 Chat</button>
            </td>
        </tr>
    `).join('');
}

function filterClients() {
    const stage = document.getElementById('filter-stage').value;
    const status = document.getElementById('filter-status').value;
    const search = document.getElementById('filter-search').value.toLowerCase();

    const filtered = allClients.filter(c => {
        const matchStage = stage === 'all' || c.angel_stage === stage;
        const matchStatus = status === 'all' || c.message_status === status;
        const matchSearch = !search || c.name.toLowerCase().includes(search) || c.phone.includes(search);
        return matchStage && matchStatus && matchSearch;
    });
    renderClients(filtered);
}

// ============================================================
// MESSAGING COUNTS
// ============================================================
async function loadMessagingCounts() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        document.getElementById('mc-lead').textContent = `${stats.leads} clients`;
        document.getElementById('mc-read').textContent = `${stats.read} clients`;
        document.getElementById('mc-clicked').textContent = `${stats.clicked} clients`;
        document.getElementById('mc-incomplete').textContent = `${stats.incomplete} clients`;
        document.getElementById('mc-opened').textContent = `${stats.account_opened} clients`;
        document.getElementById('mc-funded').textContent = `${stats.funded} clients`;
    } catch (err) {
        console.error(err);
    }
}

// ============================================================
// SEND MODAL
// ============================================================
function openSendModal(stage, msgType) {
    currentSendStage = stage;
    currentSendMsgType = msgType;

    const labels = {
        lead: 'New Leads',
        link_clicked: 'Link Clicked (No Action)',
        incomplete: 'Incomplete Applications',
        account_opened: 'Account Opened',
        funded: 'Not Yet Funded',
        read: 'Read But No Action',
    };

    document.getElementById('modal-title').textContent = `Send to ${labels[stage] || stage}`;
    document.getElementById('modal-desc').textContent = `You are about to send a WhatsApp message to all clients in the "${labels[stage] || stage}" group. The messages will be personalized with each client's name and a custom tracking link.`;
    document.getElementById('send-modal').classList.remove('hidden');
}

function closeSendModal() {
    document.getElementById('send-modal').classList.add('hidden');
    currentSendStage = null;
    currentSendMsgType = null;
}

async function confirmSend() {
    const btn = document.getElementById('confirm-send-btn');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/send-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: currentSendStage, message_type: currentSendMsgType }),
        });
        const data = await res.json();

        closeSendModal();
        showToast(`✅ Sent ${data.sent} messages! (${data.failed || 0} failed)`);
        loadDashboard();
        loadMessagingCounts();
    } catch (err) {
        showToast('❌ Failed to send messages. Check server logs.');
    } finally {
        btn.textContent = 'Send Messages';
        btn.disabled = false;
    }
}

// ============================================================
// CSV UPLOAD
// ============================================================
async function uploadCSV(input) {
    const file = input.files[0];
    if (!file) return;

    const resultEl = document.getElementById('upload-result');
    resultEl.className = 'upload-result';
    resultEl.textContent = '⏳ Uploading and processing...';
    resultEl.classList.remove('hidden');

    const formData = new FormData();
    formData.append('csv', file);

    try {
        const res = await fetch('/api/upload-csv', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            resultEl.classList.add('success');
            resultEl.innerHTML = `
                ✅ <strong>CSV Processed Successfully!</strong><br/>
                📥 New clients added: <strong>${data.summary.added}</strong><br/>
                🔄 Existing clients updated: <strong>${data.summary.updated}</strong><br/>
                ⏩ Rows skipped (no phone): <strong>${data.summary.skipped}</strong><br/>
                📊 Total rows processed: <strong>${data.summary.total}</strong>
            `;
            loadDashboard();
        } else {
            resultEl.classList.add('error');
            resultEl.textContent = '❌ Error: ' + (data.error || 'Unknown error');
        }
    } catch (err) {
        resultEl.classList.add('error');
        resultEl.textContent = '❌ Upload failed. Make sure the server is running.';
    }

    // Reset file input
    input.value = '';
}

// Drag and Drop
const uploadZone = document.getElementById('upload-zone');
if (uploadZone) {
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = 'var(--purple)';
        uploadZone.style.background = 'rgba(108,99,255,0.08)';
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.style.borderColor = '';
        uploadZone.style.background = '';
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '';
        uploadZone.style.background = '';
        const file = e.dataTransfer.files[0];
        if (file) {
            const input = document.getElementById('csv-input');
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            uploadCSV(input);
        }
    });
}

// ============================================================
// ADD SINGLE CLIENT
// ============================================================
async function addClient(event) {
    event.preventDefault();
    const name = document.getElementById('add-name').value.trim();
    const phone = document.getElementById('add-phone').value.trim();
    const resultEl = document.getElementById('add-result');

    try {
        const res = await fetch('/api/add-client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone }),
        });
        const data = await res.json();
        resultEl.classList.remove('hidden', 'error');
        resultEl.classList.add('success');
        if (data.client?.already_exists) {
            resultEl.textContent = `⚠️ Client with phone ${data.client.phone} already exists in the database.`;
        } else {
            resultEl.textContent = `✅ Client "${name}" added successfully with phone ${data.client?.phone}!`;
            document.getElementById('add-name').value = '';
            document.getElementById('add-phone').value = '';
        }
        loadDashboard();
    } catch (err) {
        resultEl.classList.remove('hidden', 'success');
        resultEl.classList.add('error');
        resultEl.textContent = '❌ Failed to add client. Check that the server is running.';
    }
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================
function showToast(message, duration = 4000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
}

// ============================================================
// HELPERS
// ============================================================
function formatStage(stage) {
    const labels = {
        lead: 'Lead',
        link_clicked: 'Link Clicked',
        incomplete: 'Incomplete',
        account_opened: 'Account Opened',
        funded: 'Funded',
        rejected: 'Rejected',
    };
    return labels[stage] || stage;
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// CLEAR DATA
// ============================================================
async function clearData() {
    if (!confirm("⚠️ Are you sure you want to permanently delete ALL client records? This cannot be undone!")) {
        return;
    }
    
    try {
        const res = await fetch('/api/clear', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('🗑️ All data has been cleared!');
// ============================================================
// CHAT MODAL LOGIC
// ============================================================
let currentChatPhone = null;

async function openChatModal(phone, name) {
    currentChatPhone = phone;
    document.getElementById('chat-modal-title').textContent = `Chat with ${name}`;
    document.getElementById('chat-modal').classList.remove('hidden');
    document.getElementById('chat-history').innerHTML = '<div style="text-align:center; padding: 20px;">Loading history...</div>';
    document.getElementById('chat-reply-input').value = '';

    await fetchChatHistory(phone);
}

function closeChatModal() {
    document.getElementById('chat-modal').classList.add('hidden');
    currentChatPhone = null;
}

async function fetchChatHistory(phone) {
    try {
        const res = await fetch(`/api/chat/${phone}`);
        const data = await res.json();
        const container = document.getElementById('chat-history');
        
        if (!data.history || data.history.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 20px; color: #666;">No conversation history yet.</div>';
            return;
        }

        container.innerHTML = data.history.map(msg => {
            const isIncoming = msg.direction === 'incoming';
            return `
                <div class="chat-bubble ${isIncoming ? 'incoming' : 'outgoing'}">
                    ${escapeHtml(msg.content || (msg.message_type ? `[Template Sent: ${msg.message_type}]` : ''))}
                    <span class="chat-time">${msg.timestamp ? msg.timestamp.substring(11, 16) : ''}</span>
                </div>
            `;
        }).join('');
        
        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
    } catch (err) {
        document.getElementById('chat-history').innerHTML = '<div style="text-align:center; color: red;">Failed to load history.</div>';
    }
}

async function sendManualReply() {
    if (!currentChatPhone) return;
    const input = document.getElementById('chat-reply-input');
    const text = input.value.trim();
    if (!text) return;

    const btn = document.getElementById('send-reply-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
        const res = await fetch('/api/chat/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: currentChatPhone, text })
        });
        const data = await res.json();
        
        if (data.success) {
            input.value = '';
            showToast('Reply sent successfully!');
            await fetchChatHistory(currentChatPhone); // Refresh chat
        } else {
            showToast(data.error || 'Failed to send reply', 'error');
        }
    } catch (err) {
        showToast('Network error while sending reply', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send';
    }
}

loadDashboard();
