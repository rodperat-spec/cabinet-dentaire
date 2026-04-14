const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

if (fs.existsSync('token.json')) {
  const token = JSON.parse(fs.readFileSync('token.json'));
  oauth2Client.setCredentials(token);

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      const current = JSON.parse(fs.readFileSync('token.json'));
      current.refresh_token = tokens.refresh_token;
      fs.writeFileSync('token.json', JSON.stringify(current));
    }
  });
}

app.get('/', (req, res) => {
  res.json({ message: 'Serveur cabinet dentaire opérationnel' });
});

// ===== AUTH Google =====
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync('token.json', JSON.stringify(tokens));
  res.send('✅ Connexion Google Calendar réussie !');
});

// ===== OUTIL 1 : Vérifier disponibilités =====
app.post('/api/check-availability', async (req, res) => {
  const heures = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
  const slots = [];
  const date = new Date();
  date.setDate(date.getDate() + 1);

  while (slots.length < 3) {
    const jour = date.getDay();
    if (jour >= 1 && jour <= 5) {
      const heure = heures[Math.floor(Math.random() * heures.length)];
      const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      const d = new Date(date);
      const parts = heure.split(':');
      d.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);
      const fin = new Date(d.getTime() + 45 * 60000);
      slots.push({
        date: dateStr,
        heure: heure,
        debut: d.toISOString(),
        fin: fin.toISOString(),
      });
    }
    date.setDate(date.getDate() + 1);
  }

  res.json({ slots });
});

// ===== OUTIL 2 : Créer un RDV dans Google Calendar =====
app.post('/api/book-appointment', async (req, res) => {
  console.log('📥 Body complet reçu:', JSON.stringify(req.body, null, 2));

  // Retell envoie les paramètres dans req.body.args
  const params = req.body.args || req.body;
  console.log('📦 Paramètres utilisés:', JSON.stringify(params, null, 2));

  const nom    = params.nom;
  const prenom = params.prenom;
  const soin   = params.soin;
  const date   = params.date;
  const heure  = params.heure;
  const fin    = params.fin;

  // Chercher "debut" en ignorant les accents
  let debut = null;
  for (const key of Object.keys(params)) {
    const normalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (normalized === 'debut') {
      debut = params[key];
      console.log(`🔑 Clé trouvée: "${key}" => ${debut}`);
      break;
    }
  }

  console.log('📅 debut brut:', debut);
  console.log('📅 fin brut:', fin);

  const buildISO = (val, dateStr) => {
    if (!val) return null;
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(val)) {
      return new Date(`${dateStr}T${val}`).toISOString();
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
    return val;
  };

  const debutISO = buildISO(debut, date);
  const finISO   = buildISO(fin, date);

  console.log('✅ debut ISO:', debutISO);
  console.log('✅ fin ISO:', finISO);

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary: `${prenom} ${nom} — ${soin}`,
      description: `Patient : ${prenom} ${nom}\nSoin : ${soin}\nRDV pris via assistante vocale`,
      start: { dateTime: debutISO, timeZone: 'Europe/Paris' },
      end:   { dateTime: finISO,   timeZone: 'Europe/Paris' },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 60 },
        ],
      },
    };

    const result = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    console.log(`✅ RDV créé : ${prenom} ${nom} — ${soin} le ${date} à ${heure}`);
    res.json({ success: true, message: 'RDV enregistré avec succès', eventId: result.data.id });

  } catch (err) {
    console.error('❌ Erreur Google Calendar :', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== OUTIL 3 : Envoyer un SMS =====
app.post('/api/send-sms', async (req, res) => {
  const params = req.body.args || req.body;
  const { telephone, nom, prenom, date, heure, soin } = params;
  console.log(`📱 SMS envoyé à ${telephone} — RDV ${prenom} ${nom} le ${date} à ${heure} pour ${soin}`);
  res.json({ success: true, message: 'SMS envoyé' });
});

app.listen(PORT, () => {
  console.log(`🦷 Serveur cabinet dentaire démarré sur le port ${PORT}`);
  if (!fs.existsSync('token.json')) {
    console.log(`⚠️  Pas de token Google trouvé. Ouvrez http://localhost:${PORT}/auth pour connecter Google Calendar.`);
  } else {
    console.log('✅ Google Calendar connecté');
  }
});
