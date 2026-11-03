/* Overlay Chat — клиентский UI (русский). Socket.IO подключается с локального бандла. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let settings = {};
  let token = null;
  let me = null;
  let socket = null;
  let locked = false;
  let currentTab = 'chats';
  let currentChat = null; // { type: 'dm'|'room', id, title }
  let friendsData = { friends: [], incoming: [], outgoing: [] };
  let roomsData = [];
  let ioLib = null;

  // Socket.IO только локально (vendor / node_modules) — без CDN (важно для РФ без VPN)
  function loadSocketIo() {
    return new Promise((resolve, reject) => {
      if (window.io) {
        ioLib = window.io;
        return resolve(ioLib);
      }
      const trySrc = (src, next) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => { ioLib = window.io; resolve(ioLib); };
        s.onerror = () => (next ? next() : reject(new Error('Не удалось загрузить socket.io')));
        document.head.appendChild(s);
      };
      // Сначала vendor (упакованный клиент), потом node_modules (dev)
      trySrc('vendor/socket.io.min.js', () =>
        trySrc('../node_modules/socket.io-client/dist/socket.io.min.js', null)
      );
    });
  }

  async function api(path, opts = {}) {
    const base = (settings.serverUrl || 'https://overlay-chat-server-4wmq.onrender.com').replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(base + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Ошибка ' + res.status));
    return data;
  }

  function setConn(online) {
    const el = $('#conn-status');
    el.classList.toggle('online', online);
    el.classList.toggle('offline', !online);
    el.title = online ? 'Подключено' : 'Нет соединения';
  }

  function connectSocket() {
    if (socket) { try { socket.disconnect(); } catch (_) {} socket = null; }
    if (!token || !ioLib) return;
    const base = (settings.serverUrl || 'https://overlay-chat-server-4wmq.onrender.com').replace(/\/$/, '');
    socket = ioLib(base, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true
    });
    socket.on('connect', () => setConn(true));
    socket.on('disconnect', () => setConn(false));
    socket.on('connect_error', () => setConn(false));
    socket.on('message:new', onMessageNew);
    socket.on('friend:request', () => refreshFriends());
    socket.on('friend:accepted', () => refreshFriends());
    socket.on('friend:presence', ({ userId, online }) => {
      const f = friendsData.friends.find(x => x.id === userId);
      if (f) { f.online = online; if (currentTab === 'friends' || currentTab === 'chats') renderSidebar(); }
    });
  }

  function onMessageNew(msg) {
    if (!currentChat) return;
    const mine = msg.sender_id === me.id;
    if (currentChat.type === 'room' && msg.room_id === currentChat.id) {
      appendMessage(msg, mine);
    } else if (currentChat.type === 'dm') {
      const other = mine ? msg.recipient_id : msg.sender_id;
      if (other === currentChat.id || msg.sender_id === currentChat.id || msg.recipient_id === currentChat.id) {
        // Match DM with this friend
        if (
          (msg.sender_id === me.id && msg.recipient_id === currentChat.id) ||
          (msg.sender_id === currentChat.id && msg.recipient_id === me.id)
        ) {
          appendMessage(msg, mine);
        }
      }
    }
  }

  function appendMessage(msg, mine) {
    const box = $('#messages');
    const div = document.createElement('div');
    div.className = 'msg' + (mine ? ' mine' : '');
    const time = formatTime(msg.created_at);
    div.innerHTML = `<div class="meta">${escapeHtml(msg.sender_nickname || '')} · ${time}</div><div class="body">${escapeHtml(msg.content)}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function showMain() {
    $('#screen-auth').hidden = true;
    $('#screen-main').hidden = false;
    await Promise.all([refreshFriends(), refreshRooms()]);
    renderSidebar();
  }

  function showAuth() {
    $('#screen-auth').hidden = false;
    $('#screen-main').hidden = true;
    setConn(false);
  }

  async function refreshFriends() {
    try {
      friendsData = await api('/api/friends');
      if (currentTab === 'friends' || currentTab === 'chats') renderSidebar();
    } catch (e) { console.warn(e); }
  }

  async function refreshRooms() {
    try {
      const data = await api('/api/rooms');
      roomsData = data.rooms || [];
      if (currentTab === 'rooms' || currentTab === 'chats') renderSidebar();
    } catch (e) { console.warn(e); }
  }

  function renderSidebar() {
    const sb = $('#sidebar');
    sb.innerHTML = '';

    if (currentTab === 'chats') {
      friendsData.friends.forEach(f => {
        sb.appendChild(makeItem(f.nickname, () => openDm(f), currentChat?.type === 'dm' && currentChat.id === f.id, f.online));
      });
      roomsData.forEach(r => {
        sb.appendChild(makeItem('#' + r.name, () => openRoom(r), currentChat?.type === 'room' && currentChat.id === r.id));
      });
      if (!friendsData.friends.length && !roomsData.length) {
        sb.innerHTML = '<p class="hint" style="padding:6px">Нет чатов. Добавьте друзей или войдите в комнату.</p>';
      }
    }

    if (currentTab === 'friends') {
      friendsData.incoming.forEach(r => {
        const card = document.createElement('div');
        card.className = 'request-card';
        card.innerHTML = `<div>Заявка от <b>${escapeHtml(r.nickname)}</b></div>`;
        const row = document.createElement('div');
        row.className = 'row';
        const a = document.createElement('button');
        a.className = 'btn primary'; a.textContent = 'Принять';
        a.onclick = async () => { await api('/api/friends/respond', { method: 'POST', body: JSON.stringify({ requestId: r.requestId, accept: true }) }); refreshFriends(); };
        const d = document.createElement('button');
        d.className = 'btn'; d.textContent = 'Отклонить';
        d.onclick = async () => { await api('/api/friends/respond', { method: 'POST', body: JSON.stringify({ requestId: r.requestId, accept: false }) }); refreshFriends(); };
        row.append(a, d);
        card.appendChild(row);
        sb.appendChild(card);
      });
      friendsData.friends.forEach(f => {
        sb.appendChild(makeItem(f.nickname, () => openDm(f), false, f.online));
      });
      friendsData.outgoing.forEach(o => {
        const el = makeItem(o.nickname + ' (ожидание)', null);
        el.style.opacity = '0.6';
        sb.appendChild(el);
      });
      const actions = document.createElement('div');
      actions.className = 'sidebar-actions';
      const add = document.createElement('button');
      add.className = 'btn'; add.textContent = '+ Добавить';
      add.onclick = () => promptModal('Добавить друга', 'Никнейм', async (nick) => {
        await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ nickname: nick }) });
        await refreshFriends();
      });
      actions.appendChild(add);
      sb.appendChild(actions);
    }

    if (currentTab === 'rooms') {
      roomsData.forEach(r => {
        const item = makeItem(r.name + ' [' + r.code + ']', () => openRoom(r), currentChat?.type === 'room' && currentChat.id === r.id);
        sb.appendChild(item);
      });
      const actions = document.createElement('div');
      actions.className = 'sidebar-actions';
      const create = document.createElement('button');
      create.className = 'btn'; create.textContent = '+ Создать';
      create.onclick = () => promptModal('Создать комнату', 'Название', async (name) => {
        const room = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) });
        await refreshRooms();
        if (socket) socket.emit('room:join-socket', { roomId: room.id });
        openRoom(room);
      });
      const join = document.createElement('button');
      join.className = 'btn'; join.textContent = 'Войти по коду';
      join.onclick = () => promptModal('Войти в комнату', 'Код комнаты', async (code) => {
        const room = await api('/api/rooms/join', { method: 'POST', body: JSON.stringify({ code }) });
        await refreshRooms();
        if (socket) socket.emit('room:join-socket', { roomId: room.id });
        openRoom(room);
      });
      actions.append(create, join);
      sb.appendChild(actions);
    }
  }

  function makeItem(text, onClick, active, online) {
    const b = document.createElement('button');
    b.className = 'sidebar-item' + (active ? ' active' : '');
    if (online !== undefined) {
      b.innerHTML = `<span class="dot ${online ? 'on' : ''}"></span>${escapeHtml(text)}`;
    } else {
      b.textContent = text;
    }
    if (onClick) b.onclick = onClick;
    return b;
  }

  async function openDm(friend) {
    currentChat = { type: 'dm', id: friend.id, title: friend.nickname };
    $('#chat-header').textContent = 'ЛС: ' + friend.nickname;
    $('#msg-input').disabled = false;
    $('#btn-send').disabled = false;
    await loadHistory();
    renderSidebar();
  }

  async function openRoom(room) {
    currentChat = { type: 'room', id: room.id, title: room.name, code: room.code };
    $('#chat-header').textContent = room.name + ' · код ' + room.code;
    $('#msg-input').disabled = false;
    $('#btn-send').disabled = false;
    if (socket) socket.emit('room:join-socket', { roomId: room.id });
    await loadHistory();
    renderSidebar();
  }

  async function loadHistory() {
    const box = $('#messages');
    box.innerHTML = '';
    if (!currentChat) return;
    try {
      let data;
      if (currentChat.type === 'room') {
        data = await api('/api/messages/room/' + currentChat.id);
      } else {
        data = await api('/api/messages/dm/' + currentChat.id);
      }
      (data.messages || []).forEach(m => appendMessage(m, m.sender_id === me.id));
    } catch (e) {
      box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function promptModal(title, placeholder, onOk) {
    const modal = $('#modal-prompt');
    $('#prompt-title').textContent = title;
    const input = $('#prompt-input');
    input.value = '';
    input.placeholder = placeholder;
    $('#prompt-error').hidden = true;
    modal.hidden = false;
    input.focus();

    const cleanup = () => {
      modal.hidden = true;
      $('#prompt-ok').onclick = null;
      $('#prompt-cancel').onclick = null;
    };
    $('#prompt-cancel').onclick = cleanup;
    $('#prompt-ok').onclick = async () => {
      try {
        await onOk(input.value.trim());
        cleanup();
      } catch (e) {
        const err = $('#prompt-error');
        err.textContent = e.message;
        err.hidden = false;
      }
    };
  }

  // --- Lock / click-through ---
  function setupInteractiveIgnore() {
    const els = $$('.interactive, #btn-lock, #msg-input, #btn-send');
    els.forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (locked && window.overlayAPI) window.overlayAPI.setIgnoreMouse(false);
      });
      el.addEventListener('mouseleave', () => {
        if (locked && window.overlayAPI) window.overlayAPI.setIgnoreMouse(true);
      });
    });
  }

  async function toggleLock() {
    locked = !locked;
    document.body.classList.toggle('locked', locked);
    const btn = $('#btn-lock');
    btn.textContent = locked ? '🔒' : '🔓';
    btn.classList.toggle('locked', locked);
    btn.title = locked
      ? 'Разблокировать (сейчас клики проходят в игру, кроме поля ввода и замка)'
      : 'Заблокировать оверлей (клики проходят в игру)';
    if (window.overlayAPI) await window.overlayAPI.setLocked(locked);
  }

  function releaseFocus() {
    const input = $('#msg-input');
    input.blur();
    if (window.overlayAPI) window.overlayAPI.blurWindow();
  }

  // --- Events ---
  async function init() {
    if (!window.overlayAPI) {
      // Browser fallback for testing without Electron
      window.overlayAPI = {
        getSettings: async () => ({ serverUrl: 'https://overlay-chat-server-4wmq.onrender.com', hotkey: 'CommandOrControl+Enter', token: null, nickname: null, opacity: 0.85, locked: false }),
        setSettings: async (p) => p,
        setLocked: async () => ({}),
        setIgnoreMouse: async () => {},
        blurWindow: async () => {},
        minimize: async () => {},
        close: async () => {},
        onFocusInput: (cb) => { window.__focusInput = cb; return () => {}; }
      };
    }

    settings = await window.overlayAPI.getSettings();
    token = settings.token;
    locked = !!settings.locked;

    try {
      await loadSocketIo();
    } catch (e) {
      console.error(e);
    }

    $('#btn-lock').onclick = toggleLock;
    $('#btn-min').onclick = () => window.overlayAPI.minimize();
    $('#btn-close').onclick = () => window.overlayAPI.close();
    $('#btn-settings').onclick = openSettings;
    $('#btn-close-settings').onclick = () => { $('#modal-settings').hidden = true; };
    $('#btn-save-settings').onclick = saveSettings;
    $('#btn-logout').onclick = logout;

    $$('.tab').forEach(t => {
      t.onclick = () => {
        $$('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        currentTab = t.dataset.tab;
        renderSidebar();
      };
    });

    $('#form-auth').onsubmit = async (e) => {
      e.preventDefault();
      await doAuth(false);
    };
    $('#btn-register').onclick = async () => { await doAuth(true); };

    $('#form-send').onsubmit = async (e) => {
      e.preventDefault();
      await sendMessage();
    };

    $('#msg-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        releaseFocus();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.activeElement === $('#msg-input')) {
        releaseFocus();
      }
    });

    window.overlayAPI.onFocusInput(() => {
      const input = $('#msg-input');
      if (!input.disabled) {
        input.focus();
        input.select();
      }
    });

    setupInteractiveIgnore();

    $('#set-opacity').oninput = (e) => {
      $('#opacity-val').textContent = e.target.value + '%';
    };

    if (token) {
      try {
        const data = await api('/api/me');
        me = data.user;
        connectSocket();
        await showMain();
      } catch {
        token = null;
        await window.overlayAPI.setSettings({ token: null, nickname: null });
        showAuth();
      }
    } else {
      showAuth();
    }
  }

  async function doAuth(isRegister) {
    const nick = $('#auth-nick').value.trim();
    const pass = $('#auth-pass').value;
    const err = $('#auth-error');
    err.hidden = true;
    try {
      const path = isRegister ? '/api/register' : '/api/login';
      const data = await api(path, { method: 'POST', body: JSON.stringify({ nickname: nick, password: pass }) });
      token = data.token;
      me = data.user;
      settings = await window.overlayAPI.setSettings({ token, nickname: me.nickname });
      connectSocket();
      await showMain();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  }

  async function sendMessage() {
    const input = $('#msg-input');
    const content = input.value.trim();
    if (!content || !currentChat || !socket) return;
    input.value = '';
    const payload = currentChat.type === 'room'
      ? { roomId: currentChat.id, content }
      : { recipientId: currentChat.id, content };
    const event = currentChat.type === 'room' ? 'message:room' : 'message:dm';
    socket.emit(event, payload, (res) => {
      if (res && !res.ok) {
        input.value = content;
        alert(res.error || 'Ошибка отправки');
      }
    });
    releaseFocus();
  }

  function openSettings() {
    $('#set-server').value = settings.serverUrl || 'https://overlay-chat-server-4wmq.onrender.com';
    $('#set-hotkey').value = settings.hotkey || 'CommandOrControl+Enter';
    const op = Math.round((settings.opacity || 0.85) * 100);
    $('#set-opacity').value = op;
    $('#opacity-val').textContent = op + '%';
    $('#modal-settings').hidden = false;
  }

  async function saveSettings() {
    settings = await window.overlayAPI.setSettings({
      serverUrl: $('#set-server').value.trim(),
      hotkey: $('#set-hotkey').value.trim() || 'CommandOrControl+Enter',
      opacity: Number($('#set-opacity').value) / 100
    });
    $('#modal-settings').hidden = true;
    if (token) connectSocket();
  }

  async function logout() {
    token = null;
    me = null;
    currentChat = null;
    if (socket) { socket.disconnect(); socket = null; }
    await window.overlayAPI.setSettings({ token: null, nickname: null });
    $('#modal-settings').hidden = true;
    showAuth();
  }

  init().catch(console.error);
})();
