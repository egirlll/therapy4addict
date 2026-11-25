export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '9088145103:AAELJPuzEIHBC62jXdWKoMxvcTrKVwvbaW0';
  const TG_CHAT_ID = process.env.TG_CHAT_ID || '6148174309';

  const { username, score, level, answers } = req.body;

  const msg = `🧠 <b>New Therapy Session Complete</b>\n\n` +
    `👤 <b>${username || 'anonymous'}</b>\n` +
    `📊 Score: <b>${score}</b>\n` +
    `💊 Diagnosis: <b>${level}</b>\n` +
    (answers ? `\n📝 Responses:\n${answers}` : '');

  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('TG error:', e);
  }

  res.status(200).json({ ok: true });
}
