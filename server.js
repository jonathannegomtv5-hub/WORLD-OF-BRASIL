'use strict';
/* World of Pixalia - servidor beta
   Contas (scrypt), saves em JSON, multiplayer por mapa (Socket.io), chat, troca e cura/bênção em grupo. */
const express = require('express'), http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const { Server } = require('socket.io');
const PORT = process.env.PORT || 3000;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data'), FILE = path.join(DIR, 'users.json');
fs.mkdirSync(DIR, { recursive: true });
let DB = { users: {} };
try { DB = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
const TOK = {}; for (const k in DB.users) if (DB.users[k].tok) TOK[DB.users[k].tok] = k;
let dirty = false;
function flush() { if (!dirty) return; dirty = false; try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('Falha ao salvar:', e.message); dirty = true; } }
setInterval(flush, 3000);
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { dirty = true; flush(); process.exit(0); });

const app = express(), server = http.createServer(app), io = new Server(server, { maxHttpBufferSize: 1e5 });
app.set('trust proxy', 1);
app.use(express.json({ limit: '40kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const hits = new Map();
const limited = (ip, max) => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000); a.push(n); hits.set(ip, a); return a.length > max; };
setInterval(() => { const n = Date.now(); for (const [k, a] of hits) if (!a.some(t => n - t < 60000)) hits.delete(k); }, 60000);
const hashPw = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
const okUser = u => typeof u === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(u);
const okPass = p => typeof p === 'string' && p.length >= 4 && p.length <= 64;
function newTok(k) { const a = DB.users[k]; if (a.tok) delete TOK[a.tok]; a.tok = crypto.randomBytes(24).toString('hex'); TOK[a.tok] = k; dirty = true; return a.tok; }

const players = {};
app.get('/api/ping', (q, r) => r.json({ ok: 1, online: Object.keys(players).length }));
app.post('/api/register', (q, r) => {
  if (limited(q.ip, 8)) return r.json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  const { user, pass } = q.body || {};
  if (!okUser(user)) return r.json({ error: 'Usuário inválido (3-16: letras, números, _).' });
  if (!okPass(pass)) return r.json({ error: 'Senha inválida (mín. 4 caracteres).' });
  const k = user.toLowerCase(); if (DB.users[k]) return r.json({ error: 'Esse usuário já existe.' });
  const salt = crypto.randomBytes(16).toString('hex');
  DB.users[k] = { name: user, salt, hash: hashPw(pass, salt), created: Date.now(), save: null, tok: null };
  r.json({ ok: 1, user, token: newTok(k), save: null });
});
app.post('/api/login', (q, r) => {
  if (limited(q.ip, 15)) return r.json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  const { user, pass } = q.body || {};
  if (!okUser(user) || !okPass(pass)) return r.json({ error: 'Usuário ou senha incorretos.' });
  const k = user.toLowerCase(), a = DB.users[k];
  if (!a) return r.json({ error: 'Usuário ou senha incorretos.' });
  const h = Buffer.from(hashPw(pass, a.salt)), s = Buffer.from(a.hash);
  if (h.length !== s.length || !crypto.timingSafeEqual(h, s)) return r.json({ error: 'Usuário ou senha incorretos.' });
  r.json({ ok: 1, user: a.name, token: newTok(k), save: a.save });
});
app.post('/api/session', (q, r) => {
  const k = TOK[(q.body || {}).token]; if (!k) return r.json({ error: 'Sessão expirada.' });
  r.json({ ok: 1, user: DB.users[k].name, token: DB.users[k].tok, save: DB.users[k].save });
});
app.post('/api/save', (q, r) => {
  const { token, data } = q.body || {}, k = TOK[token];
  if (!k || !data || typeof data !== 'object' || !data.S || typeof data.S.lv !== 'number') return r.json({ error: 'invalid' });
  if (JSON.stringify(data).length > 20000) return r.json({ error: 'too big' });
  const prev = DB.users[k].save;
  if (prev && prev.S && data.S.lv > prev.S.lv + 5) return r.json({ error: 'rejected' }); // anti-cheat básico
  DB.users[k].save = data; DB.users[k].updated = Date.now(); dirty = true; r.json({ ok: 1 });
});

/* ---------- Multiplayer ---------- */
const CLASSES = ['warrior', 'mage', 'archer', 'priest'];
const num = (v, a, b, d) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
const cleanItems = it => { const o = {}; if (it && typeof it === 'object') for (const k of Object.keys(it).slice(0, 12)) if (/^[a-z_]{2,12}$/.test(k)) { const n = Math.floor(+it[k]); if (n > 0 && n <= 99) o[k] = n; } return o; };
const room = m => 'm:' + m;
const pub = p => ({ id: p.id, name: p.name, cls: p.cls, lv: p.lv, x: p.x, y: p.y, map: p.map, direction: p.dir });
const near = (a, b, r) => a && b && a.map === b.map && Math.hypot(a.x - b.x, a.y - b.y) <= r;

io.use((s, next) => { const k = TOK[s.handshake.auth && s.handshake.auth.token]; if (!k) return next(new Error('auth')); s.uk = k; next(); });
io.on('connection', s => {
  for (const [id, p] of Object.entries(players)) if (p.uk === s.uk) { io.to(id).emit('kicked'); const o = io.sockets.sockets.get(id); if (o) o.disconnect(true); }
  const me = { id: s.id, uk: s.uk, name: DB.users[s.uk].name, cls: 'warrior', lv: 1, x: 640, y: 512, map: 'city', dir: 'd', last: 0 };
  players[s.id] = me; s.join(room(me.map));
  const pending = {};
  const others = () => Object.values(players).filter(p => p.map === me.map && p.id !== s.id).map(pub);
  const switchMap = m => { s.to(room(me.map)).emit('playerDisconnected', s.id); s.leave(room(me.map)); me.map = m; s.join(room(m)); s.emit('currentPlayers', others()); s.to(room(m)).emit('newPlayer', pub(me)); };

  s.on('playerJoin', d => {
    d = d || {};
    me.cls = CLASSES.includes(d.cls) ? d.cls : 'warrior'; me.lv = num(d.lv, 1, 999, 1); me.x = num(d.x, 0, 1300, 640); me.y = num(d.y, 0, 1000, 512);
    const m = /^[a-z]{3,10}$/.test(d.map || '') ? d.map : 'city';
    if (m !== me.map) { s.leave(room(me.map)); me.map = m; s.join(room(m)); }
    s.emit('currentPlayers', others()); s.to(room(me.map)).emit('newPlayer', pub(me));
  });
  s.on('playerMovement', d => {
    d = d || {}; me.x = num(d.x, 0, 1300, me.x); me.y = num(d.y, 0, 1000, me.y); me.dir = ['u', 'd', 'l', 'r'].includes(d.direction) ? d.direction : me.dir; me.lv = num(d.lv, 1, 999, me.lv);
    if (CLASSES.includes(d.cls)) me.cls = d.cls;
    const m = /^[a-z]{3,10}$/.test(d.map || '') ? d.map : me.map;
    if (m !== me.map) return switchMap(m);
    s.to(room(me.map)).emit('playerMoved', { ...pub(me), moving: !!d.moving });
  });
  s.on('sendMessage', d => {
    const now = Date.now(); if (now - me.last < 500) return; me.last = now;
    const t = String((d && d.text) || '').trim().slice(0, 80); if (!t) return;
    if (t.startsWith('/g ')) s.broadcast.emit('newMessage', { id: s.id, name: me.name + ' [G]', text: t.slice(3) });
    else s.to(room(me.map)).emit('newMessage', { id: s.id, name: me.name, text: t });
  });
  // Troca: ambos precisam confirmar; o servidor repassa as ofertas (inventário ainda é confiado ao cliente no beta)
  s.on('tradeOffer', d => {
    const o = players[d && d.to]; if (!o || !near(me, o, 320)) return;
    pending[d.to] = { to: d.to, items: cleanItems(d.items), gold: Math.max(0, Math.floor(+d.gold || 0)), ok: false };
    io.to(d.to).emit('tradeOffer', { from: s.id, items: pending[d.to].items, gold: pending[d.to].gold });
  });
  s.on('tradeConfirm', d => {
    const o = players[d && d.to]; if (!o || !near(me, o, 320)) return;
    const a = pending[d.to] || (pending[d.to] = { to: d.to, items: cleanItems(d.items), gold: Math.max(0, Math.floor(+d.gold || 0)), ok: false });
    a.ok = true;
    const other = io.sockets.sockets.get(d.to), b = other && other.pendingTrade && other.pendingTrade[s.id];
    s.pendingTrade = pending;
    if (b && b.ok && b.to === s.id) {
      io.to(s.id).emit('tradeDone', { from: d.to, items: b.items, gold: b.gold });
      io.to(d.to).emit('tradeDone', { from: s.id, items: a.items, gold: a.gold });
      delete pending[d.to]; delete other.pendingTrade[s.id];
    }
  });
  s.on('tradeCancel', d => { if (!d) return; delete pending[d.to]; io.to(d.to).emit('tradeCancelled', { from: s.id }); });
  // Habilidades de grupo do Sacerdote
  s.on('castHeal', d => {
    const amount = num(d && d.amount, 1, 300, 20);
    for (const p of Object.values(players)) if (p.id !== s.id && near(me, p, 150)) io.to(p.id).emit('playerHealed', { amount, from: s.id });
  });
  s.on('castBuff', d => {
    const v = num(d && d.v, 0, 0.5, .25), t = num(d && d.t, 1, 15, 10);
    for (const p of Object.values(players)) if (p.id !== s.id && near(me, p, 150)) io.to(p.id).emit('playerBuffed', { v, t, from: s.id });
  });
  s.on('disconnect', () => { delete players[s.id]; s.to(room(me.map)).emit('playerDisconnected', s.id); });
});
server.listen(PORT, () => console.log('World of Pixalia beta em http://localhost:' + PORT));
