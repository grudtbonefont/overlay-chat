/**
 * Автотесты Overlay Chat: register/login/friends/rooms/messages (HTTP + Socket.IO)
 */
const { io } = require('socket.io-client');

const BASE = process.env.SERVER_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg); }
  else { failed++; console.error('  ✗', msg); throw new Error(msg); }
}

async function json(path, opts = {}) {
  const { headers: optHeaders, ...rest } = opts;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(optHeaders || {}) }
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    const t = setTimeout(() => reject(new Error('socket timeout')), 5000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

async function main() {
  console.log('Сервер:', BASE);
  const health = await json('/api/health');
  assert(health.status === 200 && health.data.ok, 'health');

  const suffix = Date.now().toString(36);
  const nickA = 'testA_' + suffix;
  const nickB = 'testB_' + suffix;

  console.log('\n[Auth]');
  const regA = await json('/api/register', { method: 'POST', body: JSON.stringify({ nickname: nickA, password: 'pass1234' }) });
  assert(regA.status === 201 && regA.data.token, 'register A');
  const regB = await json('/api/register', { method: 'POST', body: JSON.stringify({ nickname: nickB, password: 'pass1234' }) });
  assert(regB.status === 201 && regB.data.token, 'register B');

  const bad = await json('/api/login', { method: 'POST', body: JSON.stringify({ nickname: nickA, password: 'wrong' }) });
  assert(bad.status === 401, 'login wrong password');

  const loginA = await json('/api/login', { method: 'POST', body: JSON.stringify({ nickname: nickA, password: 'pass1234' }) });
  assert(loginA.status === 200 && loginA.data.token, 'login A');
  const tokenA = loginA.data.token;
  const tokenB = regB.data.token;
  const idA = loginA.data.user.id;
  const idB = regB.data.user.id;

  const me = await json('/api/me', { headers: { Authorization: 'Bearer ' + tokenA } });
  assert(me.status === 200 && me.data.user.nickname === nickA, 'me');

  console.log('\n[Friends]');
  const req = await json('/api/friends/request', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tokenA },
    body: JSON.stringify({ nickname: nickB })
  });
  assert(req.status === 200, 'friend request');

  const friendsB = await json('/api/friends', { headers: { Authorization: 'Bearer ' + tokenB } });
  assert(friendsB.data.incoming.length >= 1, 'incoming request visible');
  const requestId = friendsB.data.incoming.find(x => x.nickname === nickA).requestId;

  const accept = await json('/api/friends/respond', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tokenB },
    body: JSON.stringify({ requestId, accept: true })
  });
  assert(accept.status === 200, 'accept friend');

  const friendsA = await json('/api/friends', { headers: { Authorization: 'Bearer ' + tokenA } });
  assert(friendsA.data.friends.some(f => f.nickname === nickB), 'A sees B as friend');

  console.log('\n[Rooms]');
  const room = await json('/api/rooms', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tokenA },
    body: JSON.stringify({ name: 'Тестовая' })
  });
  assert(room.status === 201 && room.data.code, 'create room');
  const code = room.data.code;
  const roomId = room.data.id;

  const join = await json('/api/rooms/join', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tokenB },
    body: JSON.stringify({ code })
  });
  assert(join.status === 200 && join.data.id === roomId, 'join by code');

  const list = await json('/api/rooms', { headers: { Authorization: 'Bearer ' + tokenB } });
  assert(list.data.rooms.some(r => r.id === roomId), 'list rooms');

  console.log('\n[Messages / Socket.IO]');
  const sockA = await connectSocket(tokenA);
  const sockB = await connectSocket(tokenB);
  sockA.emit('room:join-socket', { roomId });
  sockB.emit('room:join-socket', { roomId });
  await sleep(200);

  const gotRoom = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('room msg timeout')), 5000);
    sockB.on('message:new', (msg) => {
      if (msg.room_id === roomId && msg.content === 'привет комната') {
        clearTimeout(t);
        resolve(msg);
      }
    });
  });
  sockA.emit('message:room', { roomId, content: 'привет комната' }, (res) => {
    assert(res && res.ok, 'message:room ack');
  });
  const roomMsg = await gotRoom;
  assert(roomMsg.sender_nickname === nickA, 'room message received by B');

  const gotDm = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dm timeout')), 5000);
    sockB.on('message:new', (msg) => {
      if (msg.recipient_id === idB && msg.content === 'личное') {
        clearTimeout(t);
        resolve(msg);
      }
    });
  });
  sockA.emit('message:dm', { recipientId: idB, content: 'личное' }, (res) => {
    assert(res && res.ok, 'message:dm ack');
  });
  await gotDm;
  assert(true, 'DM received by B');

  const hist = await json('/api/messages/room/' + roomId, { headers: { Authorization: 'Bearer ' + tokenA } });
  assert(hist.data.messages.some(m => m.content === 'привет комната'), 'room history');

  const dmHist = await json('/api/messages/dm/' + idB, { headers: { Authorization: 'Bearer ' + tokenA } });
  assert(dmHist.data.messages.some(m => m.content === 'личное'), 'dm history');

  sockA.disconnect();
  sockB.disconnect();

  console.log(`\nИтого: ${passed} ok, ${failed} fail`);
  if (failed) process.exit(1);
}

main().catch(e => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
