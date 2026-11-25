const express = require('express');
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

function hashPw(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_AUTH = process.env.ADMIN_AUTH || 'therapy4444';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '9088145103:AAELJPuzEIHBC62jXdWKoMxvcTrKVwvbaW0';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6148174309';

function sendTelegram(text) {
  if (!TG_BOT_TOKEN) { console.log('No TG_BOT_TOKEN set'); return; }
  const payload = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
  const opts = {
    hostname: 'api.telegram.org',
    path: `/bot${TG_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };
  const req = https.request(opts, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => console.log('TG send:', body));
  });
  req.on('error', e => console.error('TG error:', e.message));
  req.write(payload);
  req.end();
}
const DB_PATH = process.env.DB_PATH || 'therapy4addict.db';

let db;

async function initDB() {
  const SQL = await initSqlJs();
  try {
    if (fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
  } catch(e) {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT DEFAULT 'unknown',
      score INTEGER DEFAULT 0,
      username TEXT DEFAULT '',
      password TEXT DEFAULT '',
      balance REAL DEFAULT 0,
      sessions INTEGER DEFAULT 0,
      relapses INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      last_clean_date TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  persist();
}

function persist() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch(e) { console.error('DB persist error:', e); }
}

function getOne(sql, params=[]) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function getAll(sql, params=[]) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params=[]) {
  db.run(sql, params);
  persist();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ──

app.post('/api/account', (req, res) => {
  const { name, username, password, level, score } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!password) return res.status(400).json({ error: 'Password required' });
  const existing = getOne('SELECT id FROM accounts WHERE username = ?', [username || '']);
  if (existing && username) return res.status(400).json({ error: 'username already taken ~ 🤭' });
  run('INSERT INTO accounts (name, username, password, level, score) VALUES (?, ?, ?, ?, ?)', [name, username || '', hashPw(password), level || 'unknown', score || 0]);
  const account = getOne('SELECT * FROM accounts ORDER BY id DESC LIMIT 1');
  sendTelegram(`🧠 <b>New Patient Registered</b>\n\n👤 <b>${username || name}</b>\n💊 Diagnosis: <b>${level}</b>\n📊 Score: <b>${score}</b>`);
  res.json(account);
});

app.post('/api/quiz-result', (req, res) => {
  const { username, score, level, answers } = req.body;
  const msg = `🧠 <b>New Assessment Result</b>\n\n` +
    `👤 <b>${username || 'anonymous'}</b>\n` +
    `📊 Score: <b>${score}/10</b>\n` +
    `💊 Diagnosis: <b>${level}</b>\n` +
    (answers ? `\n📝 Answers:\n${answers}` : '');
  sendTelegram(msg);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'fill in both fields ~ 🤭' });
  const account = getOne('SELECT * FROM accounts WHERE username = ?', [username]);
  if (!account) return res.json({ error: 'no patient found ~ 🤭' });
  if (account.password !== hashPw(password)) return res.json({ error: 'wrong password ~ 🤭' });
  const now = new Date();
  const last = new Date(account.last_clean_date + 'Z');
  account.streak_days = Math.max(0, Math.floor((now - last) / (1000 * 60 * 60 * 24)));
  account.transactions = getAll('SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 30', [account.id]);
  account.relapse_dates = getAll("SELECT date(created_at) as d FROM transactions WHERE account_id = ? AND type = 'relapse' ORDER BY created_at DESC LIMIT 60", [account.id]).map(r => r.d);
  delete account.password;
  res.json(account);
});

app.get('/api/account/:id', (req, res) => {
  const account = getOne('SELECT * FROM accounts WHERE id = ?', [+req.params.id]);
  if (!account) return res.status(404).json({ error: 'Not found' });
  const now = new Date();
  const last = new Date(account.last_clean_date + 'Z');
  account.streak_days = Math.max(0, Math.floor((now - last) / (1000 * 60 * 60 * 24)));
  account.transactions = getAll('SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 30', [+req.params.id]);
  account.relapse_dates = getAll("SELECT date(created_at) as d FROM transactions WHERE account_id = ? AND type = 'relapse' ORDER BY created_at DESC LIMIT 60", [+req.params.id]).map(r => r.d);
  res.json(account);
});

app.post('/api/account/:id/session', (req, res) => {
  const { amount, note } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  run('UPDATE accounts SET balance = balance + ?, sessions = sessions + 1 WHERE id = ?', [amt, +req.params.id]);
  run('INSERT INTO transactions (account_id, type, amount, note) VALUES (?, ?, ?, ?)', [+req.params.id, 'session', amt, note || '']);
  const account = getOne('SELECT * FROM accounts WHERE id = ?', [+req.params.id]);
  res.json(account);
});

app.post('/api/account/:id/relapse', (req, res) => {
  const account = getOne('SELECT * FROM accounts WHERE id = ?', [+req.params.id]);
  if (!account) return res.status(404).json({ error: 'Not found' });
  const now = new Date();
  const last = new Date(account.last_clean_date + 'Z');
  const streak = Math.max(0, Math.floor((now - last) / (1000 * 60 * 60 * 24)));
  const newBest = Math.max(account.best_streak, streak);
  run("UPDATE accounts SET relapses = relapses + 1, best_streak = ?, last_clean_date = datetime('now') WHERE id = ?", [newBest, +req.params.id]);
  run('INSERT INTO transactions (account_id, type, amount, note) VALUES (?, ?, ?, ?)', [+req.params.id, 'relapse', 0, '']);
  res.json({ ok: true, streak_was: streak });
});

app.delete('/api/account/:id', (req, res) => {
  run('DELETE FROM transactions WHERE account_id = ?', [+req.params.id]);
  run('DELETE FROM accounts WHERE id = ?', [+req.params.id]);
  res.json({ ok: true });
});

// ── ADMIN ──

app.get('/admin', (req, res) => {
  if (req.query.auth !== ADMIN_AUTH) return res.send(adminLoginHTML());
  const accounts = getAll('SELECT * FROM accounts ORDER BY created_at DESC');
  const sess = getOne("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type = 'session'");
  const rel = getOne("SELECT COUNT(*) as total FROM transactions WHERE type = 'relapse'");
  res.send(adminHTML(accounts, sess ? sess.total : 0, rel ? rel.total : 0));
});

app.post('/admin/add-balance', (req, res) => {
  if (req.query.auth !== ADMIN_AUTH) return res.status(403).json({ error: 'Forbidden' });
  const { accountId, amount, note } = req.body;
  const amt = parseFloat(amount);
  if (!accountId || isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid' });
  run('UPDATE accounts SET balance = balance + ?, sessions = sessions + 1 WHERE id = ?', [amt, +accountId]);
  run('INSERT INTO transactions (account_id, type, amount, note) VALUES (?, ?, ?, ?)', [+accountId, 'session', amt, note || 'admin session']);
  res.json({ ok: true });
});

function adminLoginHTML() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title>
<style>
  body{font-family:system-ui;background:#0a0a0f;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:rgba(255,20,147,0.04);border:1px solid rgba(255,20,147,0.12);border-radius:16px;padding:32px;max-width:360px;width:90%;text-align:center}
  h2{color:#ff1493;margin-bottom:16px}
  input{width:100%;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,20,147,0.2);border-radius:10px;color:#fff;font-size:15px;outline:none;margin:8px 0;text-align:center;box-sizing:border-box}
  button{width:100%;padding:12px;background:linear-gradient(135deg,#ff1493,#ff69b4);border:none;border-radius:10px;color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px}
</style></head><body>
<div class="box"><h2>🧠 admin</h2>
<input id="pin" type="password" placeholder="pin ~" onkeydown="if(event.key==='Enter')go()">
<button onclick="go()">login</button>
</div>
<script>function go(){window.location='/admin?auth='+document.getElementById('pin').value}</script>
</body></html>`;
}

function adminHTML(accounts, totalSessions, totalRelapses) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — therapy4addict</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#e0e0e0;padding:20px;max-width:800px;margin:0 auto}
  h1{color:#ff1493;text-align:center;font-size:22px;margin-bottom:4px}
  .subtitle{text-align:center;font-size:11px;color:rgba(255,255,255,0.25);letter-spacing:2px;text-transform:uppercase;margin-bottom:20px}
  .card{background:#111118;border:1px solid rgba(255,20,147,0.1);border-radius:14px;padding:20px;margin:14px 0}
  .card h2{color:#ff69b4;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;font-weight:600}
  .stats{display:flex;justify-content:space-around;text-align:center;padding:10px 0}
  .stat-num{font-size:26px;font-weight:700;color:#ff1493}
  .stat-label{font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:2px;margin-top:6px}
  select,input,button{padding:10px 14px;border-radius:10px;border:1px solid rgba(255,20,147,0.15);background:#1a1a24;color:#e0e0e0;font-size:14px;margin:4px;outline:none;-webkit-appearance:none;appearance:none}
  select{width:100%;margin-bottom:8px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ff1493' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px}
  select option{background:#1a1a24;color:#e0e0e0;padding:8px}
  input:focus,select:focus{border-color:rgba(255,20,147,0.4)}
  button{background:linear-gradient(135deg,#ff1493,#ff69b4);border:none;cursor:pointer;font-weight:600;color:#fff;transition:opacity 0.2s}
  button:hover{opacity:0.9}
  .search-box{width:100%;padding:10px 14px 10px 36px;border-radius:10px;border:1px solid rgba(255,20,147,0.15);background:#1a1a24 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") no-repeat 12px center;color:#e0e0e0;font-size:14px;outline:none;margin-bottom:14px}
  .search-box:focus{border-color:rgba(255,20,147,0.4)}
  .acct-list{max-height:500px;overflow-y:auto}
  .acct-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#13131d;border:1px solid rgba(255,255,255,0.04);border-radius:10px;margin:6px 0;transition:border-color 0.2s}
  .acct-row:hover{border-color:rgba(255,20,147,0.2)}
  .acct-info{flex:1}
  .acct-name{font-size:15px;font-weight:600;color:#fff}
  .acct-username{font-size:12px;color:#ff1493;margin-top:2px}
  .acct-meta{font-size:11px;color:rgba(255,255,255,0.3);margin-top:4px}
  .acct-stats{display:flex;gap:16px;text-align:center}
  .acct-stat-val{font-size:16px;font-weight:700}
  .acct-stat-label{font-size:8px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1px;margin-top:2px}
  .bal{color:#ff1493}
  .rel{color:#ff4444}
  .toast{position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-100px);background:rgba(255,20,147,0.9);color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:500;z-index:999;transition:transform 0.4s;backdrop-filter:blur(10px)}
  .toast.show{transform:translateX(-50%) translateY(0)}
</style></head><body>
<div class="toast" id="toast"></div>
<h1>🧠 therapy4addict</h1>
<p class="subtitle">admin panel</p>
<div class="card">
  <div class="stats">
    <div><div class="stat-num">${accounts.length}</div><div class="stat-label">patients</div></div>
    <div><div class="stat-num">$${(totalSessions||0).toFixed(2)}</div><div class="stat-label">session fees</div></div>
    <div><div class="stat-num">${totalRelapses||0}</div><div class="stat-label">relapses</div></div>
  </div>
</div>
<div class="card">
  <h2>credit session</h2>
  <select id="acct">
    ${accounts.map(a => `<option value="${a.id}">${a.username||a.name} — $${(a.balance||0).toFixed(2)}</option>`).join('')}
  </select>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <input id="amt" type="number" step="0.01" placeholder="$0" style="flex:1;min-width:80px">
    <input id="note" type="text" placeholder="note (optional)" style="flex:2;min-width:120px">
    <button onclick="addBal()">credit $</button>
  </div>
</div>
<div class="card">
  <h2>patients (${accounts.length})</h2>
  <input type="text" class="search-box" id="search" placeholder="search patients..." oninput="filterAccounts()">
  <div class="acct-list" id="acct-list">
    ${accounts.map(a => `
    <div class="acct-row" data-search="${(a.name||'').toLowerCase()} ${(a.username||'').toLowerCase()}">
      <div class="acct-info">
        <div class="acct-name">${a.username||a.name}</div>
        ${a.username && a.name !== a.username ? `<div class="acct-username">${a.name}</div>` : ''}
        <div class="acct-meta">${a.level} · joined ${a.created_at}</div>
      </div>
      <div class="acct-stats">
        <div><div class="acct-stat-val bal">$${(a.balance||0).toFixed(2)}</div><div class="acct-stat-label">spent</div></div>
        <div><div class="acct-stat-val">${a.sessions||0}</div><div class="acct-stat-label">sessions</div></div>
        <div><div class="acct-stat-val rel">${a.relapses||0}</div><div class="acct-stat-label">relapses</div></div>
      </div>
    </div>`).join('')}
  </div>
</div>
<script>
const auth='${ADMIN_AUTH}';
function showToast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}
function addBal(){
  const accountId=+document.getElementById('acct').value;
  const amount=document.getElementById('amt').value;
  const note=document.getElementById('note').value;
  if(!amount||parseFloat(amount)<=0){showToast('enter an amount ~');return}
  fetch('/admin/add-balance?auth='+auth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,amount,note})})
  .then(r=>r.json()).then(d=>{if(d.ok){showToast('$'+amount+' credited');setTimeout(()=>location.reload(),800)}else showToast('error: '+d.error)});
}
function filterAccounts(){
  const q=document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('.acct-row').forEach(r=>{
    r.style.display=r.dataset.search.includes(q)?'flex':'none';
  });
}
</script>
</body></html>`;
}

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`therapy4addict running on :${PORT}`));
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
