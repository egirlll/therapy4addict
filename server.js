const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '9088145103:AAELJPuzEIHBC62jXdWKoMxvcTrKVwvbaW0';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6148174309';

function sendTelegram(text) {
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
    res.on('end', () => console.log('TG:', res.statusCode));
  });
  req.on('error', e => console.error('TG error:', e.message));
  req.write(payload);
  req.end();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/quiz-result', (req, res) => {
  const { username, score, level, answers } = req.body;
  const msg = `🧠 <b>New Therapy Session Complete</b>\n\n` +
    `👤 <b>${username || 'anonymous'}</b>\n` +
    `📊 Score: <b>${score}</b>\n` +
    `💊 Diagnosis: <b>${level}</b>\n` +
    (answers ? `\n📝 Responses:\n${answers}` : '');
  sendTelegram(msg);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`therapy4addict running on :${PORT}`));
