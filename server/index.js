const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const { register, login, verifyToken, authMiddleware } = require('./auth');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

function genCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// --- Auth ---
app.post('/api/register', (req, res) => {
  try {
    const result = register(req.body.nickname, req.body.password);
    res.status(201).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const result = login(req.body.nickname, req.body.password);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// --- Friends ---
app.post('/api/friends/request', authMiddleware, (req, res) => {
  const nick = String(req.body.nickname || '').trim();
  const target = db.prepare('SELECT id, nickname FROM users WHERE nickname = ? COLLATE NOCASE').get(nick);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя добавить себя' });

  const existing = db.prepare(`
    SELECT * FROM friendships
    WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
  `).get(req.user.id, target.id, target.id, req.user.id);

  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Уже в друзьях' });
    if (existing.status === 'pending') return res.status(409).json({ error: 'Заявка уже отправлена' });
    db.prepare('UPDATE friendships SET status = ?, from_user_id = ?, to_user_id = ?, created_at = datetime(\'now\') WHERE id = ?')
      .run('pending', req.user.id, target.id, existing.id);
  } else {
    db.prepare('INSERT INTO friendships (from_user_id, to_user_id, status) VALUES (?, ?, ?)').run(req.user.id, target.id, 'pending');
  }

  const friendSocket = onlineUsers.get(target.id);
  if (friendSocket) {
    io.to(friendSocket).emit('friend:request', { from: { id: req.user.id, nickname: req.user.nickname } });
  }
  res.json({ ok: true, to: target.nickname });
});

app.post('/api/friends/respond', authMiddleware, (req, res) => {
  const { requestId, accept } = req.body;
  const fr = db.prepare('SELECT * FROM friendships WHERE id = ? AND to_user_id = ? AND status = ?')
    .get(requestId, req.user.id, 'pending');
  if (!fr) return res.status(404).json({ error: 'Заявка не найдена' });

  const status = accept ? 'accepted' : 'declined';
  db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run(status, fr.id);

  if (accept) {
    const fromUser = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(fr.from_user_id);
    const sock = onlineUsers.get(fr.from_user_id);
    if (sock) io.to(sock).emit('friend:accepted', { friend: { id: req.user.id, nickname: req.user.nickname } });
    res.json({ ok: true, friend: fromUser });
  } else {
    res.json({ ok: true });
  }
});

app.get('/api/friends', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const friends = db.prepare(`
    SELECT u.id, u.nickname,
      CASE WHEN f.from_user_id = ? THEN f.to_user_id ELSE f.from_user_id END AS friend_id
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.from_user_id = ? THEN f.to_user_id ELSE f.from_user_id END
    WHERE (f.from_user_id = ? OR f.to_user_id = ?) AND f.status = 'accepted'
  `).all(uid, uid, uid, uid);

  const incoming = db.prepare(`
    SELECT f.id AS requestId, u.id, u.nickname
    FROM friendships f JOIN users u ON u.id = f.from_user_id
    WHERE f.to_user_id = ? AND f.status = 'pending'
  `).all(uid);

  const outgoing = db.prepare(`
    SELECT f.id AS requestId, u.id, u.nickname
    FROM friendships f JOIN users u ON u.id = f.to_user_id
    WHERE f.from_user_id = ? AND f.status = 'pending'
  `).all(uid);

  res.json({
    friends: friends.map(f => ({ id: f.id, nickname: f.nickname, online: onlineUsers.has(f.id) })),
    incoming,
    outgoing
  });
});

// --- Rooms ---
app.post('/api/rooms', authMiddleware, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 1 || name.length > 48) {
    return res.status(400).json({ error: 'Название комнаты: 1–48 символов' });
  }
  let code, tries = 0;
  do {
    code = genCode(6);
    tries++;
  } while (db.prepare('SELECT id FROM rooms WHERE code = ?').get(code) && tries < 20);

  const info = db.prepare('INSERT INTO rooms (name, code, owner_id) VALUES (?, ?, ?)').run(name, code, req.user.id);
  db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid, name, code });
});

app.post('/api/rooms/join', authMiddleware, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });
  const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(room.id, req.user.id);
  if (!member) {
    db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)').run(room.id, req.user.id);
  }
  res.json({ id: room.id, name: room.name, code: room.code });
});

app.get('/api/rooms', authMiddleware, (req, res) => {
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.code, r.owner_id
    FROM rooms r
    JOIN room_members m ON m.room_id = r.id
    WHERE m.user_id = ?
    ORDER BY r.id DESC
  `).all(req.user.id);
  res.json({ rooms });
});

// --- Messages history ---
app.get('/api/messages/room/:roomId', authMiddleware, (req, res) => {
  const roomId = Number(req.params.roomId);
  const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Нет доступа к комнате' });
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT m.id, m.content, m.created_at, m.sender_id, u.nickname AS sender_nickname, m.room_id
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.room_id = ?
    ORDER BY m.id DESC LIMIT ?
  `).all(roomId, limit);
  res.json({ messages: rows.reverse() });
});

app.get('/api/messages/dm/:friendId', authMiddleware, (req, res) => {
  const friendId = Number(req.params.friendId);
  const fr = db.prepare(`
    SELECT 1 FROM friendships
    WHERE status = 'accepted' AND
      ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
  `).get(req.user.id, friendId, friendId, req.user.id);
  if (!fr) return res.status(403).json({ error: 'Нет дружбы' });
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT m.id, m.content, m.created_at, m.sender_id, u.nickname AS sender_nickname,
           m.recipient_id
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
    ORDER BY m.id DESC LIMIT ?
  `).all(req.user.id, friendId, friendId, req.user.id, limit);
  res.json({ messages: rows.reverse() });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Overlay Chat' }));

// --- Socket.IO ---
const onlineUsers = new Map(); // userId -> socketId

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  const payload = verifyToken(token);
  if (!payload) return next(new Error('unauthorized'));
  socket.user = payload;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  onlineUsers.set(uid, socket.id);
  socket.join(`user:${uid}`);

  // join all rooms
  const rooms = db.prepare('SELECT room_id FROM room_members WHERE user_id = ?').all(uid);
  for (const r of rooms) socket.join(`room:${r.room_id}`);

  // notify friends online
  broadcastPresence(uid, true);

  socket.on('message:room', (data, cb) => {
    try {
      const roomId = Number(data?.roomId);
      const content = String(data?.content || '').trim();
      if (!content || content.length > 2000) throw new Error('Пустое или слишком длинное сообщение');
      const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, uid);
      if (!member) throw new Error('Нет доступа');
      const info = db.prepare('INSERT INTO messages (sender_id, room_id, content) VALUES (?, ?, ?)').run(uid, roomId, content);
      const msg = {
        id: info.lastInsertRowid,
        content,
        created_at: new Date().toISOString(),
        sender_id: uid,
        sender_nickname: socket.user.nickname,
        room_id: roomId
      };
      io.to(`room:${roomId}`).emit('message:new', msg);
      if (cb) cb({ ok: true, message: msg });
    } catch (e) {
      if (cb) cb({ ok: false, error: e.message });
    }
  });

  socket.on('message:dm', (data, cb) => {
    try {
      const recipientId = Number(data?.recipientId);
      const content = String(data?.content || '').trim();
      if (!content || content.length > 2000) throw new Error('Пустое или слишком длинное сообщение');
      const fr = db.prepare(`
        SELECT 1 FROM friendships WHERE status = 'accepted' AND
          ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
      `).get(uid, recipientId, recipientId, uid);
      if (!fr) throw new Error('Нет дружбы');
      const info = db.prepare('INSERT INTO messages (sender_id, recipient_id, content) VALUES (?, ?, ?)').run(uid, recipientId, content);
      const msg = {
        id: info.lastInsertRowid,
        content,
        created_at: new Date().toISOString(),
        sender_id: uid,
        sender_nickname: socket.user.nickname,
        recipient_id: recipientId
      };
      io.to(`user:${uid}`).emit('message:new', msg);
      io.to(`user:${recipientId}`).emit('message:new', msg);
      if (cb) cb({ ok: true, message: msg });
    } catch (e) {
      if (cb) cb({ ok: false, error: e.message });
    }
  });

  socket.on('room:join-socket', (data) => {
    const roomId = Number(data?.roomId);
    const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, uid);
    if (member) socket.join(`room:${roomId}`);
  });

  socket.on('disconnect', () => {
    if (onlineUsers.get(uid) === socket.id) {
      onlineUsers.delete(uid);
      broadcastPresence(uid, false);
    }
  });
});

function broadcastPresence(userId, online) {
  const friends = db.prepare(`
    SELECT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END AS fid
    FROM friendships WHERE status = 'accepted' AND (from_user_id = ? OR to_user_id = ?)
  `).all(userId, userId, userId);
  for (const f of friends) {
    const sock = onlineUsers.get(f.fid);
    if (sock) io.to(sock).emit('friend:presence', { userId, online });
  }
}

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Overlay Chat server listening on http://${HOST}:${PORT}`);
});

module.exports = { app, server, io };
