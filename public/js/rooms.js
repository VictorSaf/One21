// One21 — Room Management Module
// Handles: create room, add member, edit room, archive
(function () {
  if (!Auth.requireAuth()) return;

  const $ = (id) => document.getElementById(id);

  // ── Helpers ──────────────────────────────────────
  function showModal(id)  { $(id).classList.remove('hidden'); }
  function hideModal(id)  { $(id).classList.add('hidden'); }
  function showError(id, msg) {
    const el = $(id);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }
  function hideError(id) {
    const el = $(id);
    if (el) el.classList.add('hidden');
  }

  // ── Create Room Modal ────────────────────────────
  async function openCreateRoom() {
    hideError('createRoomError');
    $('newRoomName').value = '';
    $('newRoomDesc').value = '';
    $('newRoomType').value = 'group';

    const data = await Auth.api('/api/rooms/users/list');
    const list = $('userPickerList');
    list.innerHTML = '';

    if (data && data.users) {
      const me = Auth.getUser();
      data.users.filter(u => u.id !== me.id).forEach(u => {
        const item = document.createElement('div');
        item.className = 'user-picker-item';
        item.innerHTML = `
          <input type="checkbox" id="up_${u.id}" value="${u.id}">
          <label for="up_${u.id}">${esc(u.display_name)}</label>
          <span class="u-role">${u.role}</span>`;
        item.addEventListener('click', (e) => {
          if (e.target.tagName !== 'INPUT') {
            const cb = item.querySelector('input');
            cb.checked = !cb.checked;
          }
          item.classList.toggle('selected', item.querySelector('input').checked);
        });
        list.appendChild(item);
      });
    }

    // Show/hide name field for direct messages
    $('newRoomType').addEventListener('change', () => {
      const isDirect = $('newRoomType').value === 'direct';
      $('roomNameField').style.display = isDirect ? 'none' : '';
      $('roomDescField').style.display = isDirect ? 'none' : '';
    });

    showModal('modalCreateRoom');
    $('newRoomName').focus();
  }

  async function submitCreateRoom() {
    hideError('createRoomError');
    const type = $('newRoomType').value;
    const name = $('newRoomName').value.trim();
    const description = $('newRoomDesc').value.trim();

    const checkedIds = [...$('userPickerList').querySelectorAll('input:checked')].map(cb => parseInt(cb.value));

    if (type !== 'direct' && !name) return showError('createRoomError', 'Introduceți un nume.');
    if (type === 'direct' && checkedIds.length !== 1) return showError('createRoomError', 'Selectați exact un utilizator pentru mesaj direct.');

    // For direct, generate a name from participants
    const payload = {
      name: type === 'direct' ? 'direct' : name,
      description: description || undefined,
      type,
      member_ids: checkedIds,
    };

    const data = await Auth.api('/api/rooms', { method: 'POST', body: JSON.stringify(payload) });
    if (!data) return showError('createRoomError', 'Eroare la creare.');
    if (data.error) return showError('createRoomError', data.error);

    hideModal('modalCreateRoom');
    // Reload rooms and navigate to new room
    window.ChatModule && window.ChatModule.reloadRooms(data.room.id);
  }

  // ── Add Member Modal ─────────────────────────────
  async function openAddMember() {
    hideError('addMemberError');
    const data = await Auth.api('/api/rooms/users/list');
    const list = $('addMemberList');
    list.innerHTML = '';

    if (data && data.users) {
      const currentRoom = window.ChatModule && window.ChatModule.getCurrentRoom();
      const currentMemberIds = currentRoom ? currentRoom.memberIds : [];

      data.users.filter(u => !currentMemberIds.includes(u.id)).forEach(u => {
        const item = document.createElement('div');
        item.className = 'user-picker-item';
        item.innerHTML = `
          <input type="radio" name="addMemberRadio" id="am_${u.id}" value="${u.id}">
          <label for="am_${u.id}">${esc(u.display_name)}</label>
          <span class="u-role">${u.role}</span>`;
        item.addEventListener('click', () => {
          list.querySelectorAll('.user-picker-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          item.querySelector('input').checked = true;
        });
        list.appendChild(item);
      });
    }
    showModal('modalAddMember');
  }

  async function submitAddMember() {
    hideError('addMemberError');
    const checked = $('addMemberList').querySelector('input:checked');
    if (!checked) return showError('addMemberError', 'Selectați un utilizator.');

    const roomId = window.ChatModule && window.ChatModule.getCurrentRoomId();
    if (!roomId) return;

    const data = await Auth.api(`/api/rooms/${roomId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: parseInt(checked.value) }),
    });

    if (!data || data.error) return showError('addMemberError', data?.error || 'Eroare.');
    hideModal('modalAddMember');
    window.ChatModule && window.ChatModule.reloadCurrentRoom();
  }

  // ── Edit Room Modal ──────────────────────────────
  function openEditRoom() {
    hideError('editRoomError');
    const roomId = window.ChatModule && window.ChatModule.getCurrentRoomId();
    if (!roomId) return;
    const room = window.ChatModule.getCurrentRoomData();
    if (room) {
      $('editRoomName').value = room.name || '';
      $('editRoomDesc').value = room.description || '';
    }
    showModal('modalEditRoom');
    $('editRoomName').focus();
  }

  async function submitEditRoom() {
    hideError('editRoomError');
    const roomId = window.ChatModule && window.ChatModule.getCurrentRoomId();
    if (!roomId) return;

    const name = $('editRoomName').value.trim();
    const description = $('editRoomDesc').value.trim();
    if (!name) return showError('editRoomError', 'Numele nu poate fi gol.');

    const data = await Auth.api(`/api/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description }),
    });

    if (!data || data.error) return showError('editRoomError', data?.error || 'Eroare.');
    hideModal('modalEditRoom');
    window.ChatModule && window.ChatModule.reloadCurrentRoom();
  }

  // ── Room Request Modal ────────────────────────────
  function openRoomRequestModal() {
    hideError('roomRequestError');
    $('reqRoomName').value = '';
    $('reqRoomDesc').value = '';
    showModal('modalRoomRequest');
    $('reqRoomName').focus();
  }

  async function submitRoomRequest() {
    hideError('roomRequestError');
    const name = $('reqRoomName').value.trim();
    const desc = $('reqRoomDesc').value.trim();
    if (!name) {
      showError('roomRequestError', 'Introduceți un nume pentru cameră.');
      $('reqRoomName').focus();
      return;
    }

    const data = await Auth.api('/api/room-requests', {
      method: 'POST',
      body: JSON.stringify({ name, description: desc || undefined }),
    });

    if (!data) return showError('roomRequestError', 'Eroare la trimiterea cererii.');
    if (data.error) return showError('roomRequestError', data.error);

    hideModal('modalRoomRequest');
  }

  // ── Archive Room ─────────────────────────────────
  async function archiveRoom() {
    const roomId = window.ChatModule && window.ChatModule.getCurrentRoomId();
    if (!roomId) return;
    if (!confirm('Arhivezi această cameră? Nu va mai apărea în lista ta.')) return;

    await Auth.api(`/api/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify({ is_archived: true }),
    });

    window.ChatModule && window.ChatModule.reloadRooms();
  }

  // ── Event Binding ────────────────────────────────
  function bindEvents() {
    // Room request (newRoomBtn now opens request flow for regular users)
    $('newRoomBtn')           && $('newRoomBtn').addEventListener('click', openRoomRequestModal);
    $('closeRoomRequest')     && $('closeRoomRequest').addEventListener('click', () => hideModal('modalRoomRequest'));
    $('cancelRoomRequest')    && $('cancelRoomRequest').addEventListener('click', () => hideModal('modalRoomRequest'));
    $('submitRoomRequest')    && $('submitRoomRequest').addEventListener('click', submitRoomRequest);

    // Create room (kept for DM creation — admin path)
    $('closeCreateRoom')  && $('closeCreateRoom').addEventListener('click', () => hideModal('modalCreateRoom'));
    $('cancelCreateRoom') && $('cancelCreateRoom').addEventListener('click', () => hideModal('modalCreateRoom'));
    $('submitCreateRoom') && $('submitCreateRoom').addEventListener('click', submitCreateRoom);

    // Add member
    $('addMemberBtn')     && $('addMemberBtn').addEventListener('click', openAddMember);
    $('closeAddMember')   && $('closeAddMember').addEventListener('click', () => hideModal('modalAddMember'));
    $('cancelAddMember')  && $('cancelAddMember').addEventListener('click', () => hideModal('modalAddMember'));
    $('submitAddMember')  && $('submitAddMember').addEventListener('click', submitAddMember);

    // Edit room
    $('editRoomBtn')      && $('editRoomBtn').addEventListener('click', openEditRoom);
    $('closeEditRoom')    && $('closeEditRoom').addEventListener('click', () => hideModal('modalEditRoom'));
    $('cancelEditRoom')   && $('cancelEditRoom').addEventListener('click', () => hideModal('modalEditRoom'));
    $('submitEditRoom')   && $('submitEditRoom').addEventListener('click', submitEditRoom);

    // Archive
    $('archiveRoomBtn')   && $('archiveRoomBtn').addEventListener('click', archiveRoom);

    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    });
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
