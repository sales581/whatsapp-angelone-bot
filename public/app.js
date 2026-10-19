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
        queries: 'New Queries',
        messaging: 'Send Messages',
        upload: 'Upload CSV',
        addclient: 'Add Client',
        bot: 'AI Bot Settings'
    };
    document.getElementById('page-title').textContent = titles[tab] || tab;

    // Load data for that tab
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'clients') loadClients();
    if (tab === 'queries') loadQueries();
    if (tab === 'messaging') loadMessagingCounts();
    if (tab === 'bot') loadBotSettings();

    return false;
}

// ==========================================
// AI BOT SETTINGS
// ==========================================

async function loadBotSettings() {
    try {
        const res = await fetch('/api/bot-settings');
        const data = await res.json();
        document.getElementById('bot-prompt').value = data.prompt || '';
    } catch (e) { console.error('Failed to load bot settings', e); }
}

async function saveBotSettings() {
    const prompt = document.getElementById('bot-prompt').value;
    try {
        const res = await fetch('/api/bot-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        const data = await res.json();
        const statusEl = document.getElementById('bot-settings-status');
        if (data.success) {
            statusEl.textContent = '✅ Settings saved successfully!';
            setTimeout(() => statusEl.textContent = '', 3000);
        }
    } catch (e) { console.error('Failed to save bot settings', e); }
}

async function toggleBotActive(active) {
    if (!currentChatPhone) return;
    try {
        await fetch('/api/bot-toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: currentChatPhone, active })
        });
        showToast(active ? 'Auto-Bot Activated' : 'Auto-Bot Paused');
    } catch (e) { console.error('Failed to toggle bot', e); }
}

// ============================================================
// QUERIES TABLE
// ============================================================
function formatMessagePreview(raw) {
    if (!raw || !raw.trim()) return '<em>[Media / Button reply]</em>';
    const mediaMatch = raw.match(/^\[MEDIA:(image|audio|video|sticker|document):([^:\]]+)(?::([^\]]+))?\](.*)$/s);
    if (mediaMatch) {
        const [, mType, , extra, caption] = mediaMatch;
        const icons = { image: '📷 Image', audio: '🎤 Voice Note', video: '🎥 Video', sticker: '🏷️ Sticker', document: `📄 ${extra || 'Document'}` };
        const label = icons[mType] || '📎 Media';
        return escapeHtml(caption && caption.trim() ? `${label}: ${caption.trim()}` : label);
    }
    const trimmed = raw.length > 60 ? raw.substring(0, 60) + '...' : raw;
    return escapeHtml(trimmed);
}

async function loadQueries() {
    try {
        const res = await fetch('/api/clients');
        allClients = await res.json();
        const tbody = document.getElementById('queries-tbody');
        // Show ANY client who has replied in the New Queries tab
        const queries = allClients.filter(c => c.message_status === 'replied');
        
        if (!queries.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No new queries or replies yet.</td></tr>';
            return;
        }
        
        tbody.innerHTML = queries.map(c => `
            <tr>
                <td><strong>${escapeHtml(c.name)}</strong><br>${c.phone}</td>
                <td><span class="badge badge-replied">New Reply 💬</span></td>
                <td style="white-space: normal; max-width: 320px;">
                    <div style="font-weight: 500; color: var(--text); margin-bottom: 2px;">${formatMessagePreview(c.last_incoming_content || c.last_message_content)}</div>
                    <div style="font-size: 11px; color: var(--text-dim);">${c.last_updated || '—'}</div>
                </td>
                <td>
                    <button class="btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openChatModal('${c.phone}', '${escapeHtml(c.name)}')">💬 View Chat</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load queries:', err);
    }
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
        lead: 'New / Unread Leads',
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

    const dateAfter = document.getElementById('bulk-date-after')?.value;

    try {
        const res = await fetch('/api/send-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: currentSendStage, message_type: currentSendMsgType, date_after: dateAfter }),
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
            loadDashboard();
            loadMessagingCounts();
        }
    } catch (err) {
        showToast('❌ Failed to clear data.');
    }
}

// ============================================================
// CHAT MODAL LOGIC
// ============================================================
let currentChatPhone = null;
let chatPollInterval = null;

async function openChatModal(phone, name) {
    currentChatPhone = phone;
    document.getElementById('chat-modal-title').textContent = `Chat with ${name}`;
    document.getElementById('chat-modal').classList.remove('hidden');
    const historyEl = document.getElementById('chat-history');
    delete historyEl.dataset.fingerprint;
    historyEl.innerHTML = '<div style="text-align:center; padding: 20px;">Loading history...</div>';
    document.getElementById('chat-reply-input').value = '';

    await fetchChatHistory(phone);
    
    // Auto-refresh chat every 5 seconds while modal is open
    if (chatPollInterval) clearInterval(chatPollInterval);
    chatPollInterval = setInterval(() => {
        if (currentChatPhone === phone) fetchChatHistory(phone, true);
    }, 5000);
}

function closeChatModal() {
    document.getElementById('chat-modal').classList.add('hidden');
    currentChatPhone = null;
    if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
    }
}

async function fetchChatHistory(phone, isSilentPolling = false) {
    try {
        const res = await fetch(`/api/chat/${phone}`);
        const data = await res.json();
        
        const toggle = document.getElementById('bot-active-toggle');
        if (toggle && !isSilentPolling) toggle.checked = !!data.botActive;

        const container = document.getElementById('chat-history');
        
        if (!data.history || data.history.length === 0) {
            if (!isSilentPolling) container.innerHTML = '<div style="text-align:center; padding: 20px; color: #666;">No conversation history yet.</div>';
            return;
        }

        const html = data.history.map(msg => {
            const isIncoming = msg.direction === 'incoming';
            const rawContent = msg.content || '';
            let bodyHtml = '';

            // Check for embedded [MEDIA:type:mediaId] tags
            const mediaMatch = rawContent.match(/^\[MEDIA:(image|audio|video|sticker|document):([^:\]]+)(?::([^\]]+))?\](.*)$/s);
            if (mediaMatch) {
                const [, mType, mediaId, extra, caption] = mediaMatch;
                const mediaUrl = `/api/media/${encodeURIComponent(mediaId)}`;
                const captionHtml = caption && caption.trim() ? `<div style="margin-top:6px;">${escapeHtml(caption.trim())}</div>` : '';

                if (mType === 'image' || mType === 'sticker') {
                    bodyHtml = `
                        <div>
                            <a href="${mediaUrl}" target="_blank" title="Click to open full image">
                                <img src="${mediaUrl}" alt="WhatsApp Image" style="max-width:220px; max-height:220px; border-radius:10px; display:block; cursor:pointer;" />
                            </a>
                            ${captionHtml}
                        </div>
                    `;
                } else if (mType === 'audio') {
                    bodyHtml = `
                        <div>
                            <div style="font-size:11px; margin-bottom:4px; opacity:0.8;">🎤 Voice Note / Audio</div>
                            <audio controls preload="metadata" src="${mediaUrl}" style="max-width:240px; height:36px;"></audio>
                        </div>
                    `;
                } else if (mType === 'video') {
                    bodyHtml = `
                        <div>
                            <video controls preload="metadata" src="${mediaUrl}" style="max-width:240px; max-height:220px; border-radius:10px; display:block;"></video>
                            ${captionHtml}
                        </div>
                    `;
                } else if (mType === 'document') {
                    const docName = extra || 'Document';
                    bodyHtml = `
                        <div>
                            <a href="${mediaUrl}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; text-decoration:underline; font-weight:600; color:inherit;">
                                📄 ${escapeHtml(docName)} (Open / Download)
                            </a>
                            ${captionHtml}
                        </div>
                    `;
                }
            } else if (!rawContent.trim()) {
                if (msg.message_type) {
                    bodyHtml = escapeHtml(`[Template Sent: ${msg.message_type}]`);
                } else {
                    bodyHtml = `<em style="opacity:0.75;">[Non-text message (Media / Button) sent before update]</em>`;
                }
            } else {
                bodyHtml = escapeHtml(rawContent).replace(/\n/g, '<br/>');
            }

            const timeDisplay = msg.timestamp
                ? (msg.timestamp.includes(',') ? msg.timestamp.split(',')[1].trim() : msg.timestamp)
                : '';

            return `
                <div class="chat-bubble ${isIncoming ? 'incoming' : 'outgoing'}">
                    ${bodyHtml}
                    <span class="chat-time">${escapeHtml(timeDisplay)}</span>
                </div>
            `;
        }).join('');
        
        // Only update DOM if messages changed to prevent resetting active audio/video players or scroll jumps
        const fingerprint = JSON.stringify(data.history.map(m => `${m.id}:${m.content}`));
        if (container.dataset.fingerprint !== fingerprint) {
            const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;
            container.innerHTML = html;
            container.dataset.fingerprint = fingerprint;
            if (isScrolledToBottom || !isSilentPolling) {
                container.scrollTop = container.scrollHeight;
            }
        }
    } catch (err) {
        if (!isSilentPolling) document.getElementById('chat-history').innerHTML = '<div style="text-align:center; color: red;">Failed to load history.</div>';
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
            document.getElementById('bot-active-toggle').checked = false;
            fetchChatHistory(currentChatPhone, true);
            showToast('Reply sent successfully!');
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

async function markAsResolved() {
    if (!currentChatPhone) return;
    try {
        const res = await fetch('/api/chat/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: currentChatPhone })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Query marked as resolved and removed from New Queries.');
            closeChatModal();
            loadQueries(); // Refresh the tab
            loadDashboard(); // Refresh stats
        } else {
            showToast('Failed to mark as resolved.', 'error');
        }
    } catch (err) {
        showToast('Network error.', 'error');
    }
}

loadDashboard();
