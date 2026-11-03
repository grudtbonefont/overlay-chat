const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'overlay-chat-dev-secret-change-me';
const JWT_EXPIRES = '7d';

function register(nickname, password) {
  const nick = String(nickname || '').trim();
  if (nick.length < 3 || nick.length > 24) {
    throw Object.assign(new Error('Никнейм должен быть от 3 до 24 символов'), { status: 400 });
  }
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\-]+$/.test(nick)) {
    throw Object.assign(new Error('Никнейм: только буквы, цифры, _ и -'), { status: 400 });
  }
  if (!password || String(password).length < 4) {
    throw Object.assign(new Error('Пароль должен быть не короче 4 символов'), { status: 400 });
  }
  const existing = db.prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE').get(nick);
  if (existing) {
    throw Object.assign(new Error('Никнейм уже занят'), { status: 409 });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (nickname, password_hash) VALUES (?, ?)').run(nick, hash);
  const user = { id: info.lastInsertRowid, nickname: nick };
  const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { user, token };
}

function login(nickname, password) {
  const nick = String(nickname || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE nickname = ? COLLATE NOCASE').get(nick);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    throw Object.assign(new Error('Неверный никнейм или пароль'), { status: 401 });
  }
  const payload = { id: user.id, nickname: user.nickname };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { user: payload, token };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Недействительный токен' });
  req.user = payload;
  next();
}

module.exports = { register, login, verifyToken, authMiddleware, JWT_SECRET };
