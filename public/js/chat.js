// One21 Chat Client
(function () {
  if (!Auth.requireAuth()) return;

  const user = Auth.getUser();
  let socket = null;
  let currentRoomId = null;
  let rooms = [];
  let currentMembers = [];
  let lastTypingEmit = 0;
  let typingEl = null;
  let typingTimer = null;
  let onlineUsers = new Set();
  let loadingOlder = false;
  let hasMore = false;
  let oldestMsgId = null;
  let editingMsgId = null;

  // --- DOM refs ---
  const sidebarList      = document.getElementById('sidebarList');
  const messagesArea     = document.getElementById('messagesArea');
  const composeInput     = document.getElementById('composeInput');
  const sendBtn          = document.getElementById('sendBtn');
  const panelTitle       = document.getElementById('panelTitle');
  const panelSubtitle    = document.getElementById('panelSubtitle');
  const panelAvatar      = document.getElementById('panelAvatar');
  const infoPanelMembers = document.getElementById('infoPanelMembers');
  const infoPanelName    = document.getElementById('infoPanelName');
  const infoPanelDesc    = document.getElementById('infoPanelDesc');

  // --- Init ---
  async function init() {
    connectSocket();
    await loadRooms();
    buildSearchUI();
    initFileUpload();
    initMobileLayout();
    initPushNotifications();
  }

  // ═══════════════════════════════════════
  // SOCKET.IO
  // ═══════════════════════════════════════
  function connectSocket() {
    socket = io({ auth: { token: Auth.getToken() } });

    socket.on('connect', () => console.log('[WS] Connected'));
    socket.on('connect_error', (err) => {
      if (err.message === 'Invalid token' || err.message === 'Authentication required') Auth.logout();
    });

    socket.on('message', (msg) => {
      if (msg.room_id === currentRoomId) {
        appendMessage(msg);
        scrollToBottom();
        if (document.hasFocus()) socket.emit('mark_read', { message_id: msg.id });
      }
      updateRoomPreview(msg);
    });

    socket.on('typing', (data) => {
      if (data.room_id === currentRoomId && data.user_id !== user.id) {
        showTyping(data.display_name || data.username);
      }
    });

    socket.on('message_read', ({ message_id, user_id }) => {
      if (user_id !== user.id) markMessageRead(message_id);
    });

    socket.on('user_online',  ({ user_id }) => { onlineUsers.add(user_id);    updateMemberStatus(user_id, true);  });
    socket.on('user_offline', ({ user_id }) => { onlineUsers.delete(user_id); updateMemberStatus(user_id, false); });

    socket.on('message_edited', ({ message_id, text }) => {
      const el = messagesArea.querySelector(`[data-msg-id="${message_id}"] .msg__text`);
      if (el) {
        el.textContent = text;
        const meta = messagesArea.querySelector(`[data-msg-id="${message_id}"] .msg__edited`);
        if (!meta) {
          const time = messagesArea.querySelector(`[data-msg-id="${message_id}"] .msg__meta`);
          if (time) time.insertAdjacentHTML('afterbegin', '<span class="msg__edited">editit</span>');
        }
      }
    });

    socket.on('message_deleted', ({ message_id }) => {
      const el = messagesArea.querySelector(`[data-msg-id="${message_id}"]`);
      if (el) el.remove();
    });
  }

  // ═══════════════════════════════════════
  // ROOMS
  // ═══════════════════════════════════════
  async function loadRooms() {
    const data = await Auth.api('/api/rooms');
    if (!data) return;
    rooms = data.rooms;
    renderSidebar();
    if (rooms.length > 0 && !currentRoomId) selectRoom(rooms[0].id);
  }

  function renderSidebar() {
    const recent   = rooms.filter(r => r.type !== 'channel');
    const channels = rooms.filter(r => r.type === 'channel');
    let html = '';
    if (recent.length)   { html += '<span class="sidebar__section-label">Recente</span>';   html += recent.map(roomItemHtml).join(''); }
    if (channels.length) { html += '<span class="sidebar__section-label">Canale</span>'; html += channels.map(roomItemHtml).join(''); }
    sidebarList.innerHTML = html;
    sidebarList.querySelectorAll('.chat-item').forEach(el => {
      el.addEventListener('click', () => selectRoom(parseInt(el.dataset.roomId)));
    });
    updateDocTitle();
  }

  function roomItemHtml(room) {
    const isActive = room.id === currentRoomId;
    const preview = room.last_message
      ? `${room.last_message_sender ? room.last_message_sender + ': ' : ''}${truncate(room.last_message, 35)}`
      : 'Niciun mesaj';
    const unread = (room.unread_count > 0 && !isActive)
      ? `<span class="badge badge--accent">${room.unread_count > 99 ? '99+' : room.unread_count}</span>`
      : '';
    return `
      <div class="chat-item ${isActive ? 'chat-item--active' : ''}" data-room-id="${room.id}">
        <div class="avatar avatar--md">${room.name.charAt(0).toUpperCase()}</div>
        <div class="chat-item__body">
          <div class="chat-item__header">
            <span class="chat-item__name">${esc(room.name)}</span>
            <span class="chat-item__time">${room.last_message_at ? formatTime(room.last_message_at) : ''}</span>
          </div>
          <div class="chat-item__preview">
            <span class="chat-item__text">${esc(preview)}</span>
            ${unread}
          </div>
        </div>
      </div>`;
  }

  async function selectRoom(roomId) {
    currentRoomId = roomId;
    editingMsgId = null;
    cancelEdit();
    // Reset unread badge for selected room
    const selectedRoom = rooms.find(r => r.id === roomId);
    if (selectedRoom) selectedRoom.unread_count = 0;
    renderSidebar();
    messagesArea.innerHTML = '';

    const [roomData, msgData] = await Promise.all([
      Auth.api(`/api/rooms/${roomId}`),
      Auth.api(`/api/rooms/${roomId}/messages?limit=50`)
    ]);
    if (!roomData || !msgData) return;

    currentMembers = roomData.members;
    hasMore = msgData.has_more;
    oldestMsgId = msgData.messages.length > 0 ? msgData.messages[0].id : null;

    panelTitle.textContent = roomData.room.name;
    const onlineCount = roomData.members.filter(m => m.is_online || onlineUsers.has(m.id)).length;
    panelSubtitle.textContent = `${roomData.members.length} membri${onlineCount > 0 ? ` — ${onlineCount} online` : ''}`;
    panelAvatar.textContent = roomData.room.name.charAt(0).toUpperCase();
    infoPanelName.textContent = roomData.room.name;
    infoPanelDesc.textContent = roomData.room.description || '';
    renderMembers(roomData.members);

    for (const msg of msgData.messages) appendMessage(msg);
    scrollToBottom(false);

    if (msgData.messages.length > 0) {
      socket.emit('mark_read', { message_id: msgData.messages[msgData.messages.length - 1].id });
    }
    socket.emit('join_room', roomId);
  }

  // ═══════════════════════════════════════
  // INFINITE SCROLL (load older messages)
  // ═══════════════════════════════════════
  messagesArea.addEventListener('scroll', async () => {
    // Load older on scroll to top
    if (messagesArea.scrollTop < 80 && hasMore && !loadingOlder && oldestMsgId) {
      loadingOlder = true;
      const prevHeight = messagesArea.scrollHeight;

      const data = await Auth.api(`/api/rooms/${currentRoomId}/messages?before=${oldestMsgId}&limit=50`);
      if (data && data.messages.length > 0) {
        hasMore = data.has_more;
        oldestMsgId = data.messages[0].id;
        // Prepend messages
        const frag = document.createDocumentFragment();
        data.messages.forEach(msg => {
          const el = buildMessageEl(msg);
          frag.appendChild(el);
        });
        messagesArea.insertBefore(frag, messagesArea.firstChild);
        // Keep scroll position stable
        messagesArea.scrollTop = messagesArea.scrollHeight - prevHeight;
      } else {
        hasMore = false;
      }
      loadingOlder = false;
    }

    // Mark as read at bottom
    const atBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 60;
    if (atBottom && currentRoomId) {
      const checks = messagesArea.querySelectorAll('[data-check]');
      if (checks.length > 0) {
        socket.emit('mark_read', { message_id: parseInt(checks[checks.length - 1].dataset.check) });
      }
    }
  });

  // ═══════════════════════════════════════
  // MESSAGES — Build + Append
  // ═══════════════════════════════════════
  function buildMessageEl(msg) {
    const el = document.createElement('div');
    const isMine = msg.sender_id === user.id;
    const isSystem = msg.type === 'system';

    if (isSystem) {
      el.className = 'msg msg--system';
      el.innerHTML = `<p class="msg__text">${esc(msg.text)}</p>`;
      return el;
    }

    el.dataset.msgId = msg.id;

    const contentHtml = buildContentHtml(msg);

    if (isMine) {
      el.className = 'msg msg--sent';
      el.innerHTML = `
        ${contentHtml}
        <div class="msg__meta">
          ${msg.is_edited ? '<span class="msg__edited">editit</span>' : ''}
          <span class="msg__time">${formatTime(msg.created_at)}</span>
          <span class="msg__check" data-check="${msg.id}">✓</span>
        </div>
        <div class="msg__actions">
          ${msg.type !== 'file' ? `<button class="msg__action-btn" data-action="edit" data-id="${msg.id}" title="Editează">✏️</button>` : ''}
          <button class="msg__action-btn" data-action="delete" data-id="${msg.id}" title="Șterge">🗑️</button>
        </div>`;
    } else {
      el.className = 'msg msg--received';
      el.innerHTML = `
        <span class="msg__sender">${esc(msg.sender_name || msg.sender_username)}</span>
        ${contentHtml}
        <div class="msg__meta">
          ${msg.is_edited ? '<span class="msg__edited">editit</span>' : ''}
          <span class="msg__time">${formatTime(msg.created_at)}</span>
        </div>
        ${user.role === 'admin' ? `<div class="msg__actions"><button class="msg__action-btn" data-action="delete" data-id="${msg.id}" title="Șterge">🗑️</button></div>` : ''}`;
    }

    // Bind action buttons
    el.querySelectorAll('.msg__action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id);
        if (action === 'edit') startEdit(id, el.querySelector('.msg__text').textContent);
        if (action === 'delete') deleteMessage(id);
      });
    });

    return el;
  }

  function linkify(escaped) {
    // escaped is already HTML-escaped; convert http(s) URLs to clickable links
    return escaped.replace(/https?:\/\/[^\s<>"&]+/g, url =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg__link">${url}</a>`
    );
  }

  function buildContentHtml(msg) {
    if (msg.type === 'file' && msg.file_url) {
      const name = msg.file_name || msg.text;
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
      if (isImage) {
        return `<a href="${msg.file_url}" target="_blank" class="msg__image-link">
          <img src="${msg.file_url}" class="msg__image" alt="${esc(name)}" loading="lazy"/>
        </a>`;
      }
      const ext = name.split('.').pop().toUpperCase();
      return `<a href="${msg.file_url}" download="${esc(name)}" class="msg__file-card">
        <span class="msg__file-icon">${fileIcon(ext)}</span>
        <span class="msg__file-name">${esc(name)}</span>
        <span class="msg__file-dl">↓</span>
      </a>`;
    }
    return `<p class="msg__text">${linkify(esc(msg.text))}</p>`;
  }

  function fileIcon(ext) {
    const icons = { PDF: '📄', DOC: '📝', DOCX: '📝', XLS: '📊', XLSX: '📊', TXT: '📃' };
    return icons[ext] || '📎';
  }

  function appendMessage(msg) {
    removeTyping();
    messagesArea.appendChild(buildMessageEl(msg));
  }

  function markMessageRead(messageId) {
    const check = messagesArea.querySelector(`[data-check="${messageId}"]`);
    if (check) { check.textContent = '✓✓'; check.style.color = '#10b981'; }
  }

  function scrollToBottom(smooth = true) {
    messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  // ═══════════════════════════════════════
  // EDIT MESSAGE
  // ═══════════════════════════════════════
  function startEdit(msgId, currentText) {
    editingMsgId = msgId;
    composeInput.value = currentText;
    composeInput.focus();
    composeInput.dataset.editing = msgId;

    // Show cancel bar
    let bar = document.getElementById('editBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'editBar';
      bar.className = 'edit-bar';
      bar.innerHTML = `<span>✏️ Editezi mesaj</span><button id="cancelEdit">Anulează</button>`;
      composeInput.parentElement.insertBefore(bar, composeInput);
      document.getElementById('cancelEdit').addEventListener('click', cancelEdit);
    }
  }

  function cancelEdit() {
    editingMsgId = null;
    delete composeInput.dataset.editing;
    composeInput.value = '';
    const bar = document.getElementById('editBar');
    if (bar) bar.remove();
  }

  // ═══════════════════════════════════════
  // DELETE MESSAGE
  // ═══════════════════════════════════════
  function deleteMessage(msgId) {
    if (!confirm('Ștergi acest mesaj?')) return;
    socket.emit('message_delete', { message_id: msgId });
  }

  // ═══════════════════════════════════════
  // FILE UPLOAD
  // ═══════════════════════════════════════
  function initFileUpload() {
    const attachBtn = document.querySelector('.compose [title="Atasament"]');
    if (!attachBtn) return;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    attachBtn.addEventListener('click', () => { if (currentRoomId) fileInput.click(); });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file || !currentRoomId) return;
      fileInput.value = '';
      await uploadFile(file);
    });

    // Drag & drop on messages area
    messagesArea.addEventListener('dragover', (e) => { e.preventDefault(); messagesArea.classList.add('drag-over'); });
    messagesArea.addEventListener('dragleave', () => messagesArea.classList.remove('drag-over'));
    messagesArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      messagesArea.classList.remove('drag-over');
      if (!currentRoomId) return;
      const file = e.dataTransfer.files[0];
      if (file) await uploadFile(file);
    });
  }

  async function uploadFile(file) {
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) { alert('Fișierul depășește 10MB.'); return; }

    // Show uploading indicator
    const indicator = document.createElement('div');
    indicator.className = 'msg msg--system';
    indicator.innerHTML = `<p class="msg__text">⏳ Se încarcă ${esc(file.name)}...</p>`;
    messagesArea.appendChild(indicator);
    scrollToBottom();

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`/api/rooms/${currentRoomId}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${Auth.getToken()}` },
        body: formData,
      });
      const data = await res.json();
      indicator.remove();
      if (data.error) { alert(data.error); return; }
      // Message will arrive via socket broadcast
    } catch {
      indicator.remove();
      alert('Eroare la upload.');
    }
  }

  // ═══════════════════════════════════════
  // SEND / EDIT SUBMIT
  // ═══════════════════════════════════════
  function sendMessage() {
    const text = composeInput.value.trim();
    if (!text || !currentRoomId) return;

    if (editingMsgId) {
      socket.emit('message_edit', { message_id: editingMsgId, text });
      cancelEdit();
    } else {
      socket.emit('message', { room_id: currentRoomId, text });
    }

    composeInput.value = '';
    composeInput.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  composeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape' && editingMsgId) cancelEdit();
  });

  composeInput.addEventListener('input', () => {
    if (!currentRoomId) return;
    const now = Date.now();
    if (now - lastTypingEmit > 2000) {
      socket.emit('typing', { room_id: currentRoomId });
      lastTypingEmit = now;
    }
  });

  // ═══════════════════════════════════════
  // TYPING
  // ═══════════════════════════════════════
  function showTyping(displayName) {
    if (!typingEl) {
      typingEl = document.createElement('div');
      typingEl.className = 'typing-wrapper';
      typingEl.innerHTML = `<span class="typing-who">${esc(displayName)} scrie</span><div class="typing"><span></span><span></span><span></span></div>`;
      messagesArea.appendChild(typingEl);
      scrollToBottom();
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(removeTyping, 3000);
  }

  function removeTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  // ═══════════════════════════════════════
  // SEARCH UI
  // ═══════════════════════════════════════
  function buildSearchUI() {
    // Inject search button in nav/header if not present
    const header = document.querySelector('.panel-header__actions') || document.querySelector('.panel-header');
    if (!header) return;

    let searchBtn = document.getElementById('searchToggleBtn');
    if (!searchBtn) {
      searchBtn = document.createElement('button');
      searchBtn.id = 'searchToggleBtn';
      searchBtn.className = 'btn btn--icon';
      searchBtn.title = 'Căutare';
      searchBtn.textContent = '🔍';
      header.appendChild(searchBtn);
    }

    // Search overlay
    let searchOverlay = document.getElementById('searchOverlay');
    if (!searchOverlay) {
      searchOverlay = document.createElement('div');
      searchOverlay.id = 'searchOverlay';
      searchOverlay.className = 'search-overlay hidden';
      searchOverlay.innerHTML = `
        <div class="search-box">
          <input type="text" id="searchInput" placeholder="Caută în conversație..." autocomplete="off"/>
          <button id="searchCloseBtn" class="btn btn--icon">✕</button>
        </div>
        <div id="searchResults" class="search-results"></div>`;
      document.querySelector('.main-area') && document.querySelector('.main-area').prepend(searchOverlay);
    }

    searchBtn.addEventListener('click', () => searchOverlay.classList.toggle('hidden'));
    document.getElementById('searchCloseBtn').addEventListener('click', () => {
      searchOverlay.classList.add('hidden');
      document.getElementById('searchInput').value = '';
      document.getElementById('searchResults').innerHTML = '';
    });

    let searchDebounce;
    document.getElementById('searchInput').addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      const q = e.target.value.trim();
      if (q.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
      searchDebounce = setTimeout(() => runSearch(q), 300);
    });
  }

  async function runSearch(q) {
    if (!currentRoomId) return;
    const data = await Auth.api(`/api/rooms/${currentRoomId}/search?q=${encodeURIComponent(q)}`);
    const resultsEl = document.getElementById('searchResults');
    if (!data || !data.messages.length) {
      resultsEl.innerHTML = '<p class="search-empty">Niciun rezultat.</p>';
      return;
    }
    resultsEl.innerHTML = data.messages.map(msg => `
      <div class="search-result-item" data-msg-id="${msg.id}">
        <span class="search-result-sender">${esc(msg.sender_name || msg.sender_username)}</span>
        <p class="search-result-text">${esc(msg.text)}</p>
        <span class="search-result-time">${formatTime(msg.created_at)}</span>
      </div>`).join('');

    resultsEl.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const msgEl = messagesArea.querySelector(`[data-msg-id="${el.dataset.msgId}"]`);
        if (msgEl) {
          msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          msgEl.classList.add('msg--highlight');
          setTimeout(() => msgEl.classList.remove('msg--highlight'), 2000);
        }
        document.getElementById('searchOverlay').classList.add('hidden');
      });
    });
  }

  // ═══════════════════════════════════════
  // MEMBERS & PRESENCE
  // ═══════════════════════════════════════
  function renderMembers(members) {
    infoPanelMembers.innerHTML = members.map(m => {
      const isOnline = m.is_online || onlineUsers.has(m.id);
      const roleLabel = m.room_role === 'owner' ? 'Owner' : (m.role === 'agent' ? 'Agent' : 'Member');
      return `
        <div class="member-row" data-user-id="${m.id}">
          <div class="avatar avatar--sm">${m.display_name.charAt(0).toUpperCase()}
            <span class="avatar__status ${isOnline ? 'avatar__status--online' : ''}" data-status="${m.id}"></span>
          </div>
          <span class="member-row__name">${esc(m.display_name)}</span>
          <span class="member-row__role">${roleLabel}</span>
        </div>`;
    }).join('');
  }

  function updateMemberStatus(userId, isOnline) {
    const dot = infoPanelMembers.querySelector(`[data-status="${userId}"]`);
    if (dot) dot.className = `avatar__status ${isOnline ? 'avatar__status--online' : ''}`;
  }

  function updateRoomPreview(msg) {
    const room = rooms.find(r => r.id === msg.room_id);
    if (room) {
      room.last_message = msg.text || (msg.file_name ? `📎 ${msg.file_name}` : '');
      room.last_message_at = msg.created_at;
      room.last_message_sender = msg.sender_name || msg.sender_username;
      if (msg.room_id !== currentRoomId && msg.sender_id !== user.id) {
        room.unread_count = (room.unread_count || 0) + 1;
        playNotificationSound();
      }
      rooms.sort((a, b) => (!a.last_message_at ? 1 : !b.last_message_at ? -1 : b.last_message_at.localeCompare(a.last_message_at)));
      renderSidebar();
    }
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════
  // ═══════════════════════════════════════
  // MOBILE LAYOUT
  // ═══════════════════════════════════════
  const sidebar = document.querySelector('.sidebar');

  function initMobileLayout() {
    // Inject back button into panel header (hidden on desktop via CSS)
    const panelHeader = document.querySelector('.panel-header');
    if (!panelHeader) return;

    const backBtn = document.createElement('button');
    backBtn.className = 'mobile-back-btn';
    backBtn.title = 'Înapoi';
    backBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    panelHeader.insertBefore(backBtn, panelHeader.firstChild);

    backBtn.addEventListener('click', () => {
      sidebar && sidebar.classList.add('sidebar--open');
    });

    // On sidebar item click → close sidebar (mobile)
    sidebarList.addEventListener('click', () => {
      if (window.innerWidth <= 640) {
        setTimeout(() => sidebar && sidebar.classList.remove('sidebar--open'), 150);
      }
    });

    // Show sidebar on initial load (mobile)
    if (window.innerWidth <= 640) {
      sidebar && sidebar.classList.add('sidebar--open');
    }
  }

  // Update document title with total unread
  function updateDocTitle() {
    const total = rooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
    document.title = total > 0 ? `(${total}) One21` : 'One21 — by ONE AI/gency';
  }

  // ═══════════════════════════════════════
  // PUSH NOTIFICATIONS (Service Worker)
  // ═══════════════════════════════════════
  async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');

      // Don't ask immediately — wait for user gesture
      const askPush = async () => {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const { publicKey } = await Auth.api('/api/push/vapid-public-key');
        if (!publicKey) return;

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        await Auth.api('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription }),
        });
      };

      // Ask once after first interaction
      if (Notification.permission === 'default') {
        document.addEventListener('click', askPush, { once: true });
      } else if (Notification.permission === 'granted') {
        askPush();
      }
    } catch { /* SW not supported or blocked */ }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  // ═══════════════════════════════════════
  // NOTIFICATION SOUND
  // ═══════════════════════════════════════
  let audioCtx = null;
  function playNotificationSound() {
    if (document.hasFocus()) return; // only beep when tab is not focused
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.35);
    } catch { /* AudioContext not supported */ }
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    let d = new Date(isoStr);
    if (isNaN(d.getTime())) d = new Date(isoStr.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  }

  function truncate(str, len) { return str && str.length > len ? str.slice(0, len) + '...' : str; }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ═══════════════════════════════════════
  // PUBLIC API (used by rooms.js)
  // ═══════════════════════════════════════
  window.ChatModule = {
    reloadRooms: async (selectId) => {
      await loadRooms();
      if (selectId) selectRoom(selectId);
    },
    reloadCurrentRoom: () => {
      if (currentRoomId) selectRoom(currentRoomId);
    },
    getCurrentRoomId: () => currentRoomId,
    getCurrentRoomData: () => {
      const room = rooms.find(r => r.id === currentRoomId);
      return room ? { ...room, memberIds: currentMembers.map(m => m.id) } : null;
    },
    getCurrentRoom: () => currentRoomId
      ? { memberIds: currentMembers.map(m => m.id) }
      : null,
  };

  init();
})();
