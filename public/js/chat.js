// One21 Chat Client
(function () {
  if (!Auth.requireAuth()) return;

  const user = Auth.getUser();
  let socket = null;
  let currentRoomId = null;
  let currentRoomType = 'direct';
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
  let replyingToId = null;
  let mentionQuery = '';
  let mentionStart = -1;

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

  // --- Dropdown close (document-level, registered once) ---
  document.addEventListener('click', () => {
    document.querySelectorAll('.msg--menu-open').forEach(m => m.classList.remove('msg--menu-open'));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.msg--menu-open').forEach(m => m.classList.remove('msg--menu-open'));
    }
  });

  // --- Init ---
  async function init() {
    connectSocket();
    await loadRooms();
    loadPendingPrivateRequests();
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
    socket.on('error', (data) => {
      if (typeof showAlert === 'function' && data && data.message) showAlert(data.message);
    });

    socket.on('message', (msg) => {
      if (msg.room_id === currentRoomId) {
        const nearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 150;
        appendMessage(msg);
        if (nearBottom) scrollToBottom();
        if (document.hasFocus()) socket.emit('mark_read', { message_id: msg.id });
      }
      updateRoomPreview(msg);
      // Auto-navigate to room if we receive a whisper directed at us
      if (msg.room_id !== currentRoomId && msg.recipient_id === user.id) {
        selectRoom(msg.room_id);
      }
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
          if (time) time.insertAdjacentHTML('afterbegin', '<span class="msg__edited">editat</span>');
        }
      }
    });

    socket.on('message_deleted', ({ message_id }) => {
      const el = messagesArea.querySelector(`[data-msg-id="${message_id}"]`);
      if (el) el.remove();
    });

    socket.on('reaction_update', ({ message_id, reactions }) => {
      const bar = document.getElementById(`reactions-${message_id}`);
      if (!bar) return;
      bar.innerHTML = buildReactionChips(reactions);
    });

    socket.on('upload_progress', (data) => {
      if (data.room_id !== currentRoomId) return;
      showUploadProgress(data.username, data.filename, data.percent);
    });

    // Private room created (accepted request) — add to sidebar without full reload
    socket.on('room_added', ({ room }) => {
      if (!rooms.find(r => r.id === room.id)) {
        rooms.unshift(room);
        renderSidebar();
      }
      selectRoom(room.id);
    });

    // Private request declined — show alert to sender
    socket.on('private_declined', ({ from_display_name }) => {
      if (typeof showAlert === 'function') {
        showAlert(`${esc(from_display_name)} a refuzat conversația privată.`);
      }
    });

    socket.on('private_request', (req) => {
      showPrivateRequestToast(req);
    });

    socket.on('room_cleared', ({ room_id }) => {
      if (room_id !== currentRoomId) return;
      document.getElementById('msgList').innerHTML = '';
    });
  }

  // ═══════════════════════════════════════
  // ROOMS
  // ═══════════════════════════════════════
  async function loadRooms() {
    // Render immediately from localStorage cache — eliminates home-screen flash on refresh
    const cached = localStorage.getItem('one21_rooms');
    if (cached) {
      try {
        rooms = JSON.parse(cached);
        renderSidebar();
        const lastId = parseInt(localStorage.getItem('one21_last_room'));
        const target = (lastId && rooms.find(r => r.id === lastId)) ? lastId : (rooms[0] && rooms[0].id);
        if (target) selectRoom(target);
      } catch (_) { /* corrupt cache — fall through to network */ }
    }

    // Fetch fresh data; update sidebar silently in background
    const data = await Auth.api('/api/rooms');
    if (!data) return;
    rooms = data.rooms;
    localStorage.setItem('one21_rooms', JSON.stringify(rooms));
    renderSidebar();
    if (rooms.length > 0 && !currentRoomId) {
      selectRoom(rooms[0].id);
    } else if (rooms.length === 0 && !currentRoomId) {
      if (window.showHomeScreen) window.showHomeScreen(true);
    }
  }

  function renderSidebar() {
    // All rooms in one flat list — section labels are in the HTML, not dynamically injected
    const html = rooms.map(roomItemHtml).join('');
    sidebarList.innerHTML = html;
    sidebarList.querySelectorAll('.chat-item').forEach(el => {
      el.addEventListener('click', () => selectRoom(parseInt(el.dataset.roomId)));
    });
    updateDocTitle();
  }

  function roomItemHtml(room) {
    const isActive = room.id === currentRoomId;
    const label = room.display_name || room.name;
    const preview = room.last_message
      ? `${room.last_message_sender ? room.last_message_sender + ': ' : ''}${truncate(room.last_message, 35)}`
      : '> no_transmissions';
    const unread = (room.unread_count > 0 && !isActive)
      ? `<span class="badge badge--accent">${room.unread_count > 99 ? '99+' : room.unread_count}</span>`
      : '';

    // Icon and modifier class per Live_Node type
    const typeConfig = {
      channel: { icon: '\u25A0', mod: 'chat-item--channel' },
      group:   { icon: '#', mod: 'chat-item--group'   },
      cult:    { icon: '\u2B21', mod: 'chat-item--cult'    },
      private: { icon: '@', mod: 'chat-item--private'  },
      direct:  { icon: '@', mod: ''                   },
    };
    const { icon, mod } = typeConfig[room.type] || { icon: '#', mod: '' };

    return `
      <div class="chat-item ${mod} ${isActive ? 'chat-item--active' : ''}" data-room-id="${room.id}" data-room-type="${room.type}">
        <span class="chat-item__prefix">${icon}</span>
        <div class="chat-item__body">
          <div class="chat-item__header">
            <span class="chat-item__name">${esc(label)}</span>
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
    localStorage.setItem('one21_last_room', roomId);
    editingMsgId = null;
    cancelEdit();
    // Show chat, hide home dashboard
    if (window.showHomeScreen) window.showHomeScreen(false);
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

    currentRoomType = (roomData.room && roomData.room.type) || 'direct';
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

    const myMember = roomData.members.find(m => m.id === user.id);
    const accessLevel = (myMember && myMember.access_level) || 'readandwrite';

    // Apply per-member access levels from Node Map in all rooms/channels.
    let canSendText = true;
    let canUploadFiles = true;
    let placeholder = 'INPUT_TRANSMISSION...';

    if (user.role !== 'admin') {
      if (accessLevel === 'readonly') {
        canSendText = false;
        canUploadFiles = false;
        placeholder = 'Ai acces readonly în acest canal.';
      } else if (accessLevel === 'post_docs') {
        canSendText = false;
        canUploadFiles = true;
        placeholder = 'Poți posta doar documente în acest canal.';
      }
    }

    updateComposeChannelMode(canSendText, canUploadFiles, placeholder);

    for (const msg of msgData.messages) appendMessage(msg);
    scrollToBottom(false);

    if (msgData.messages.length > 0) {
      socket.emit('mark_read', { message_id: msgData.messages[msgData.messages.length - 1].id });
    }
    socket.emit('join_room', roomId);
  }

  function updateComposeChannelMode(canSendText, canUploadFiles, placeholderText) {
    const attachBtn = document.getElementById('attachBtn');
    composeInput.disabled = !canSendText;
    sendBtn.disabled = !canSendText;
    if (attachBtn) attachBtn.disabled = !canUploadFiles;
    composeInput.placeholder = placeholderText || 'INPUT_TRANSMISSION...';
  }

  // ═══════════════════════════════════════
  // INFINITE SCROLL (load older messages)
  // ═══════════════════════════════════════
  messagesArea.addEventListener('scroll', async () => {
    // Load older on scroll to top
    if (messagesArea.scrollTop < 80 && hasMore && !loadingOlder && oldestMsgId) {
      loadingOlder = true;
      const prevHeight = messagesArea.scrollHeight;
      try {
        const data = await Auth.api(`/api/rooms/${currentRoomId}/messages?before=${oldestMsgId}&limit=50`);
        if (data && data.messages.length > 0) {
          hasMore = data.has_more;
          oldestMsgId = data.messages[0].id;
          const frag = document.createDocumentFragment();
          data.messages.forEach(msg => {
            const el = buildMessageEl(msg);
            frag.appendChild(el);
          });
          messagesArea.insertBefore(frag, messagesArea.firstChild);
          messagesArea.scrollTop = messagesArea.scrollHeight - prevHeight;
        } else {
          hasMore = false;
        }
      } finally {
        loadingOlder = false;
      }
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
  function buildReplyQuoteHtml(msg) {
    if (!msg.reply_to) return '';
    const sender = esc(msg.reply_to_sender || 'utilizator');
    const text = esc((msg.reply_to_text || 'mesaj șters').substring(0, 80));
    return `<div class="msg__reply-quote" data-ref-id="${msg.reply_to}">
      <span class="msg__reply-quote__sender">${sender}</span>
      <span class="msg__reply-quote__text">${text}</span>
    </div>`;
  }

  function buildReactionChips(reactions) {
    return reactions.map(r =>
      `<span class="msg__reaction-chip">${esc(String(r.emoji))} <span class="msg__reaction-count">${esc(String(r.count))}</span></span>`
    ).join('');
  }

  function buildMessageEl(msg) {
    const el = document.createElement('div');
    const isMine = msg.sender_id === user.id;
    const isSystem = msg.type === 'system';
    const isGroup = ['group', 'cult', 'private', 'channel'].includes(currentRoomType);

    if (isSystem) {
      el.className = 'msg msg--system';
      el.innerHTML = `<p class="msg__text">${esc(msg.text)}</p>`;
      return el;
    }

    el.dataset.msgId = msg.id;

    const contentHtml = buildContentHtml(msg);
    const senderName = msg.sender_username || (currentMembers.find(m => m.id === msg.sender_id)?.username) || (isMine ? user.username : '');
    const useColor = isGroup && msg.sender_color_index != null;
    const colorIdx = useColor ? (msg.sender_color_index % 8) : 0;
    const colorClass = useColor ? ' msg--color-' + colorIdx : '';
    const showSender = isGroup || !isMine;
    const senderHtml = showSender
      ? `<span class="msg__sender">${esc(senderName)}</span>`
      : '';

    const isWhisper = !!msg.recipient_id;
    const whisperLabelHtml = isWhisper
      ? `<span class="msg__whisper-label">🔒 ${isMine ? `→ @${esc(msg.recipient_username || '')}` : 'privat'}</span>`
      : '';

    const EMOJIS = ['\u{1F44D}','\u2764\uFE0F','\u{1F602}','\u{1F62E}','\u{1F622}','\u{1F525}'];
    const dropdownHtml = `
      <button class="msg__menu-btn" title="Acțiuni">▾</button>
      <div class="msg__dropdown"
        data-msg-id="${msg.id}"
        data-sender-id="${msg.sender_id}"
        data-sender-name="${esc(senderName)}"
        data-text="${esc(msg.text || '')}"
        data-file-url="${esc(msg.file_url || '')}"
        data-file-name="${esc(msg.file_name || '')}">
        <div class="msg__dropdown-emojis">
          ${EMOJIS.map(e => `<button class="msg__react-btn" data-emoji="${e}" data-msg-id="${msg.id}">${e}</button>`).join('')}
        </div>
        <hr class="msg__dropdown-divider">
        <button class="msg__dropdown-item msg__dropdown-reply">↩ Reply</button>
        ${!isMine ? `<button class="msg__dropdown-item msg__dropdown-whisper">🔒 Whisper</button>` : ''}
      </div>`;
    const reactionBarHtml = `<div class="msg__reactions" id="reactions-${msg.id}"></div>`;

    if (isMine) {
      el.className = 'msg msg--sent' + colorClass + (isWhisper ? ' msg--whisper' : '');
      el.innerHTML = `
        ${senderHtml}
        ${whisperLabelHtml}
        ${buildReplyQuoteHtml(msg)}
        ${contentHtml}
        <div class="msg__meta">
          ${msg.is_edited ? '<span class="msg__edited">editat</span>' : ''}
          <span class="msg__time">${formatTime(msg.created_at)}</span>
          <span class="msg__check" data-check="${msg.id}">✓</span>
        </div>
        <div class="msg__actions">
          ${msg.type !== 'file' ? `<button class="msg__action-btn" data-action="edit" data-id="${msg.id}" title="Editează">✏️</button>` : ''}
          <button class="msg__action-btn" data-action="delete" data-id="${msg.id}" title="Șterge">🗑️</button>
        </div>
        ${reactionBarHtml}`;
    } else {
      el.className = 'msg msg--received' + colorClass + (isWhisper ? ' msg--whisper' : '');
      el.innerHTML = `
        ${dropdownHtml}
        ${senderHtml}
        ${whisperLabelHtml}
        ${buildReplyQuoteHtml(msg)}
        ${contentHtml}
        <div class="msg__meta">
          ${msg.is_edited ? '<span class="msg__edited">editat</span>' : ''}
          <span class="msg__time">${formatTime(msg.created_at)}</span>
        </div>
        ${user.role === 'admin' ? `<div class="msg__actions"><button class="msg__action-btn" data-action="delete" data-id="${msg.id}" title="Șterge">🗑️</button></div>` : ''}
        ${reactionBarHtml}`;
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

    // ── Dropdown (received messages only)
    const menuBtn = el.querySelector('.msg__menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = el.classList.contains('msg--menu-open');
        document.querySelectorAll('.msg--menu-open').forEach(m => m.classList.remove('msg--menu-open'));
        if (!isOpen) el.classList.add('msg--menu-open');
      });

      // Prevent dropdown clicks from bubbling to document (which would close it)
      el.querySelector('.msg__dropdown').addEventListener('click', e => e.stopPropagation());
    }

    // ── Emoji reactions
    el.querySelectorAll('.msg__react-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        el.classList.remove('msg--menu-open');
        socket.emit('react', {
          message_id: parseInt(btn.dataset.msgId),
          emoji: btn.dataset.emoji,
        });
      });
    });

    // ── Reply
    const replyBtn = el.querySelector('.msg__dropdown-reply');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        el.classList.remove('msg--menu-open');
        const dd = el.querySelector('.msg__dropdown');
        startReply(
          parseInt(dd.dataset.msgId),
          dd.dataset.senderName,
          dd.dataset.text,
          dd.dataset.fileUrl,
          dd.dataset.fileName
        );
      });
    }

    // ── Whisper: inject @username into compose and focus
    const whisperBtn = el.querySelector('.msg__dropdown-whisper');
    if (whisperBtn) {
      whisperBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        el.classList.remove('msg--menu-open');
        const dd = el.querySelector('.msg__dropdown');
        composeInput.value = `@${dd.dataset.senderName} `;
        composeInput.focus();
      });
    }

    const quoteEl = el.querySelector('.msg__reply-quote');
    if (quoteEl) {
      quoteEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const refId = quoteEl.dataset.refId;
        const target = document.querySelector(`[data-msg-id="${refId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('msg--highlight');
          target.addEventListener('animationend', () => target.classList.remove('msg--highlight'), { once: true });
        }
      });
    }

    if (msg.reactions && msg.reactions.length) {
      const rbar = el.querySelector('.msg__reactions');
      if (rbar) {
        rbar.innerHTML = buildReactionChips(msg.reactions);
      }
    }

    return el;
  }

  function linkify(escaped) {
    // escaped is already HTML-escaped; convert http(s) URLs to clickable links
    return escaped.replace(/https?:\/\/[^\s<>"&]+/g, url =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg__link">${url}</a>`
    );
  }

  function highlightMentions(text) {
    return text.replace(/@(\w+)/g, (match, uname) => {
      const isSelf = uname.toLowerCase() === user.username.toLowerCase();
      return `<span class="msg__mention${isSelf ? ' msg__mention--self' : ''}">${match}</span>`;
    });
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
    return `<p class="msg__text">${highlightMentions(linkify(esc(msg.text)))}</p>`;
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
    if (check) { check.textContent = '✓✓'; check.classList.add('msg__check--read'); }
  }

  function scrollToBottom(smooth = true) {
    messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  // ═══════════════════════════════════════
  // EDIT MESSAGE
  // ═══════════════════════════════════════
  function startEdit(msgId, currentText) {
    editingMsgId = msgId;
    cancelReply();
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
  // REPLY MESSAGE
  // ═══════════════════════════════════════
  function startReply(msgId, senderName, text, fileUrl, fileName) {
    replyingToId = msgId;
    if (editingMsgId) cancelEdit();

    let bar = document.getElementById('replyBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'replyBar';
      bar.className = 'reply-bar';
      const composeRow = composeInput.parentElement;
      composeRow.parentElement.insertBefore(bar, composeRow);
      bar.addEventListener('click', e => {
        if (e.target.closest('.reply-bar__cancel')) cancelReply();
      });
    }

    const isImage = fileName && /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
    const previewContent = fileUrl && isImage
      ? `<img src="${esc(fileUrl)}" class="reply-bar__thumb" alt="${esc(fileName)}">`
      : `<span class="reply-bar__preview">${esc(text.substring(0, 80))}${text.length > 80 ? '\u2026' : ''}</span>`;

    bar.innerHTML = `
      <div class="reply-bar__accent"></div>
      <div class="reply-bar__body">
        <span class="reply-bar__sender">\u21A9 ${esc(senderName)}</span>
        ${previewContent}
      </div>
      <button class="reply-bar__cancel" title="Anuleaz\u0103">\u2715</button>`;

    composeInput.focus();
  }

  function cancelReply() {
    replyingToId = null;
    const bar = document.getElementById('replyBar');
    if (bar) bar.remove();
  }

  // ═══════════════════════════════════════
  // @MENTION PICKER
  // ═══════════════════════════════════════
  function showMentionPicker(query) {
    const picker = document.getElementById('mentionPicker');
    if (!picker || !currentMembers.length) return;

    const matches = currentMembers
      .filter(m => m.username.toLowerCase().includes(query) && m.id !== user.id)
      .slice(0, 5);

    if (!matches.length) { hideMentionPicker(); return; }

    picker.innerHTML = matches.map(m => `
      <div class="mention-option" data-username="${esc(m.username)}">
        <span class="mention-option__name">${esc(m.display_name || m.username)}</span>
        <span class="mention-option__user">@${esc(m.username)}</span>
      </div>`).join('');

    picker.querySelectorAll('.mention-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertMention(opt.dataset.username);
      });
    });

    picker.classList.add('mention-picker--visible');
  }

  function hideMentionPicker() {
    const picker = document.getElementById('mentionPicker');
    if (picker) picker.classList.remove('mention-picker--visible');
    mentionStart = -1;
  }

  function insertMention(username) {
    const val = composeInput.value;
    const pos = composeInput.selectionStart;
    const before = val.slice(0, mentionStart);
    const after = val.slice(pos);
    composeInput.value = before + '@' + username + ' ' + after;
    composeInput.focus();
    hideMentionPicker();
  }

  // ═══════════════════════════════════════
  // WHISPER (private message via @username in General)
  // ═══════════════════════════════════════
  // Whispers are handled server-side: send @username text in a channel room.
  // This function is no longer needed — whisperBtn injects @username directly.

  // ═══════════════════════════════════════
  // DELETE MESSAGE
  // ═══════════════════════════════════════
  async function deleteMessage(msgId) {
    if (!(await showConfirm('Ștergi acest mesaj?', { okLabel: 'Șterge', cancelLabel: 'Anulare' }))) return;
    socket.emit('message_delete', { message_id: msgId });
  }

  async function clearRoomMessages() {
    if (!currentRoomId) return;
    if (!(await showConfirm('Ștergi TOATE mesajele din acest node? Acțiunea este ireversibilă.', { okLabel: 'Șterge tot', cancelLabel: 'Anulare' }))) return;
    await Auth.api(`/api/rooms/${currentRoomId}/messages`, { method: 'DELETE' });
  }

  (function initHeaderMoreMenu() {
    if (user.role !== 'admin') return;
    const btn = document.getElementById('headerMoreBtn');
    if (!btn) return;

    const menu = document.createElement('div');
    menu.className = 'header-more-menu';
    menu.innerHTML = `<button class="header-more-menu__item header-more-menu__item--danger" id="clearRoomBtn">⊗ Șterge toate mesajele</button>`;
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(menu);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('header-more-menu--open');
    });
    document.addEventListener('click', () => menu.classList.remove('header-more-menu--open'));
    menu.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('clearRoomBtn').addEventListener('click', () => {
      menu.classList.remove('header-more-menu--open');
      clearRoomMessages();
    });
  })();

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

  async function compressImage(file, maxDimension = 1280, quality = 0.82) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxDimension && height <= maxDimension) {
          URL.revokeObjectURL(img.src);
          resolve(file); // No compression needed
          return;
        }
        if (width > height) {
          height = Math.round(height * (maxDimension / width));
          width = maxDimension;
        } else {
          width = Math.round(width * (maxDimension / height));
          height = maxDimension;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(img.src);
          console.log(`[Compress] ${file.name}: ${(file.size/1024).toFixed(0)}KB → ${(blob.size/1024).toFixed(0)}KB`);
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); resolve(file); };
      img.src = URL.createObjectURL(file);
    });
  }

  function showUploadProgress(username, filename, percent) {
    let el = document.getElementById('uploadStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'uploadStatus';
      el.className = 'upload-status';
      const compose = document.querySelector('.compose');
      const composeRow = compose.querySelector('.compose__row');
      compose.insertBefore(el, composeRow);
    }
    el.innerHTML = `<span>${esc(username)} uploading ${esc(filename)}... ${percent}%</span>` +
      `<div class="upload-status__bar"><div class="upload-status__fill" style="width:${Math.min(100, percent)}%"></div></div>`;
    if (percent >= 100) {
      setTimeout(() => { if (el.parentNode) el.remove(); }, 1000);
    }
  }

  async function uploadFile(file) {
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) { showAlert('Fișierul depășește 10MB.'); return; }

    // Client-side image compression (skip GIFs to preserve animation)
    const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
    const isGif = /\.gif$/i.test(file.name);
    let fileToUpload = file;
    if (isImage && !isGif) {
      fileToUpload = await compressImage(file);
    }

    // Show uploading indicator
    const indicator = document.createElement('div');
    indicator.className = 'msg msg--system';
    indicator.innerHTML = `<p class="msg__text">⏳ Se încarcă ${esc(file.name)}...</p>`;
    messagesArea.appendChild(indicator);
    scrollToBottom();

    const formData = new FormData();
    formData.append('file', fileToUpload);

    const roomId = currentRoomId;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/rooms/${roomId}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        showUploadProgress(user.display_name || user.username, file.name, percent);
        socket.emit('upload_progress', { room_id: roomId, filename: file.name, percent });
      }
    });

    xhr.onload = () => {
      indicator.remove();
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.error) { showAlert(data.error); return; }
        // Message will arrive via socket broadcast
      } catch {
        showAlert('Eroare la upload.');
      }
      // Send final 100% progress to clear remote indicators
      socket.emit('upload_progress', { room_id: roomId, filename: file.name, percent: 100 });
    };

    xhr.onerror = () => {
      indicator.remove();
      showAlert('Eroare la upload.');
      socket.emit('upload_progress', { room_id: roomId, filename: file.name, percent: 100 });
    };

    xhr.send(formData);
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
      socket.emit('message', { room_id: currentRoomId, text, reply_to: replyingToId || undefined });
      if (replyingToId) cancelReply();
    }

    composeInput.value = '';
    composeInput.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  composeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape') { hideMentionPicker(); if (editingMsgId) cancelEdit(); else if (replyingToId) cancelReply(); }
  });

  // ═══════════════════════════════════════
  // COMPOSE INPUT — typing indicator + @mention autocomplete
  // ═══════════════════════════════════════
  composeInput.addEventListener('input', () => {
    // Typing indicator
    if (currentRoomId) {
      const now = Date.now();
      if (now - lastTypingEmit > 2000) {
        socket.emit('typing', { room_id: currentRoomId });
        lastTypingEmit = now;
      }
    }

    // @mention detection
    const val = composeInput.value;
    const pos = composeInput.selectionStart;
    const before = val.slice(0, pos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx !== -1 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
      const query = before.slice(atIdx + 1).toLowerCase();
      if (!/\s/.test(query)) {
        mentionStart = atIdx;
        mentionQuery = query;
        showMentionPicker(query);
        return;
      }
    }
    hideMentionPicker();
  });

  composeInput.addEventListener('blur', () => setTimeout(hideMentionPicker, 150));

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
      const privateBtn = m.id !== user.id
        ? `<button class="btn btn--ghost btn--sm member-private-btn" data-user-id="${m.id}" data-display-name="${esc(m.display_name || m.username)}" title="Start private chat">🔒</button>`
        : '';
      return `
        <div class="member-row" data-user-id="${m.id}">
          <div class="avatar avatar--sm">${(m.display_name || m.username || '?').charAt(0).toUpperCase()}
            <span class="avatar__status ${isOnline ? 'avatar__status--online' : ''}" data-status="${m.id}"></span>
          </div>
          <span class="member-row__name">${esc(m.display_name || m.username)}</span>
          <span class="member-row__role">${roleLabel}</span>
          ${privateBtn}
        </div>`;
    }).join('');

    infoPanelMembers.querySelectorAll('.member-private-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showPrivateRequestDialog(parseInt(btn.dataset.userId), btn.dataset.displayName);
      });
    });
  }

  function updateMemberStatus(userId, isOnline) {
    const dot = infoPanelMembers.querySelector(`[data-status="${userId}"]`);
    if (dot) dot.className = `avatar__status ${isOnline ? 'avatar__status--online' : ''}`;
  }

  function updateRoomPreview(msg) {
    const room = rooms.find(r => r.id === msg.room_id);
    if (room) {
      room.last_message = msg.text || (msg.file_name ? `[FILE] ${msg.file_name}` : '');
      room.last_message_at = msg.created_at;
      room.last_message_sender = msg.sender_name || msg.sender_username;
      if (msg.room_id !== currentRoomId && msg.sender_id !== user.id) {
        room.unread_count = (room.unread_count || 0) + 1;
        playNotificationSound();
      }
      rooms.sort((a, b) => (!a.last_message_at ? 1 : !b.last_message_at ? -1 : b.last_message_at.localeCompare(a.last_message_at)));
      renderSidebar();
      // Flash activity animation on the sidebar item
      if (msg.room_id !== currentRoomId) {
        const itemEl = sidebarList.querySelector(`[data-room-id="${msg.room_id}"]`);
        if (itemEl) {
          itemEl.classList.add('chat-item--new-msg');
          setTimeout(() => itemEl.classList.remove('chat-item--new-msg'), 1000);
        }
      }
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

    // Resize: pe mobile fără room selectat → sidebar deschis
    let resizeTicking = false;
    window.addEventListener('resize', () => {
      if (resizeTicking) return;
      resizeTicking = true;
      requestAnimationFrame(() => {
        if (window.innerWidth <= 640 && !currentRoomId && sidebar) {
          sidebar.classList.add('sidebar--open');
        }
        resizeTicking = false;
      });
    });
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
  // PRIVATE REQUESTS
  // ═══════════════════════════════════════
  async function loadPendingPrivateRequests() {
    const data = await Auth.api('/api/private/requests/pending');
    if (!data || !data.requests) return;
    for (const req of data.requests) {
      showPrivateRequestToast(req);
    }
  }

  function showPrivateRequestDialog(toUserId, toDisplayName) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal__header">
          <span class="modal__title">Private chat cu ${esc(toDisplayName)}</span>
          <button class="btn btn--ghost btn--icon modal__close" id="privReqClose">\u2715</button>
        </div>
        <div class="modal__body">
          <div class="modal__field">
            <label class="modal__label">Mesaj initial</label>
            <textarea id="privReqMsg" class="input" rows="3" maxlength="500" placeholder="Scrie primul mesaj..."></textarea>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--secondary" id="privReqCancel">Anulare</button>
          <button class="btn btn--primary" id="privReqSend">Trimite cerere</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#privReqClose').addEventListener('click', close);
    overlay.querySelector('#privReqCancel').addEventListener('click', close);
    overlay.querySelector('#privReqSend').addEventListener('click', async () => {
      const msg = overlay.querySelector('#privReqMsg').value.trim();
      if (!msg) return;
      const data = await Auth.api('/api/private/request', {
        method: 'POST',
        body: JSON.stringify({ to_user_id: toUserId, initial_message: msg }),
      });
      close();
      if (data?.exists) {
        selectRoom(data.room.id);
      } else if (data?.ok) {
        if (typeof showAlert === 'function') showAlert(`Cerere trimisa catre ${esc(toDisplayName)}.`);
      }
    });
  }

  function showPrivateRequestToast(req) {
    const toastId = `priv-req-${req.id || req.request_id}`;
    if (document.getElementById(toastId)) return;

    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'private-req-toast';
    toast.innerHTML = `
      <div class="private-req-toast__header">🔒 Chat privat — <strong>${esc(req.from_display_name || req.from_username || '')}</strong></div>
      <div class="private-req-toast__preview">${esc((req.initial_message || '').slice(0, 80))}</div>
      <div class="private-req-toast__actions">
        <button class="btn btn--primary btn--sm" id="${toastId}-accept">Accepta</button>
        <button class="btn btn--secondary btn--sm" id="${toastId}-decline">Refuza</button>
      </div>`;
    document.body.appendChild(toast);

    const reqId = req.id || req.request_id;

    document.getElementById(`${toastId}-accept`).addEventListener('click', async () => {
      toast.remove();
      const data = await Auth.api(`/api/private/request/${reqId}/accept`, { method: 'POST' });
      if (data?.room) {
        if (!rooms.find(r => r.id === data.room.id)) {
          rooms.unshift(data.room);
          renderSidebar();
        }
        selectRoom(data.room.id);
      }
    });

    document.getElementById(`${toastId}-decline`).addEventListener('click', async () => {
      toast.remove();
      await Auth.api(`/api/private/request/${reqId}/decline`, { method: 'POST' });
    });

    // Auto-dismiss after 30s
    setTimeout(() => { if (document.getElementById(toastId)) toast.remove(); }, 30000);
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
