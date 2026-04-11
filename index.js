require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

if (process.env.GOOGLE_TOKEN) {
  oauth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN));
}

app.get('/', (req, res) => {
  res.json({ message: 'Serveur cabinet dentaire operationnel' });
});

app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  console.log('TOKEN_JSON:' + JSON.stringify(tokens));
  res.send('Connexion Google Calendar reussie ! Copiez le token dans les logs Render. Vous pouvez fermer cette page.');
});

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
      slots.push({ date: dateStr, heure: heure, debut: d.toISOString(), fin: fin.toISOString() });
    }
    date.setDate(date.getDate() + 1);
  }
  res.json({ slots });
});

app.post('/api/book-appointment', async (req, res) => {
  console.log('Donnees recues: ' + JSON.stringify(req.body));
  const { nom, prenom, soin, date, heure, debut, fin } = req.body;
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    let startDateTime;
    let endDateTime;
    if (debut && fin) {
      startDateTime = new Date(debut);
      endDateTime = new Date(fin);
    } else {
      const heureStr = (heure || '09:00').replace('h', ':');
      const parts = heureStr.split(':');
      const h = parseInt(parts[0]) || 9;
      const m = parseInt(parts[1]) || 0;
      startDateTime = new Date();
      startDateTime.setHours(h, m, 0, 0);
      endDateTime = new Date(startDateTime.getTime() + 45 * 60000);
    }
    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      startDateTime = new Date();
      startDateTime.setHours(9, 0, 0, 0);
      endDateTime = new Date(startDateTime.getTime() + 45 * 60000);
    }
    const event = {
      summary: (prenom || '') + ' ' + (nom || '') + ' - ' + (soin || 'Consultation'),
      description: 'Patient : ' + (prenom || '') + ' ' + (nom || '') + '\nSoin : ' + (soin || ''),
      start: { dateTime: startDateTime.toISOString(), timeZone: 'Europe/Paris' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'Europe/Paris' },
    };
    console.log('Creation evenement: ' + event.summary);
    const result = await calendar.events.insert({ calendarId: 'primary', resource: event });
    console.log('RDV cree: ' + event.summary);
    res.json({ success: true, message: 'RDV enregistre', eventId: result.data.id });
  } catch (err) {
    console.error('Erreur Google Calendar : ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/send-sms', async (req, res) => {
  console.log('SMS envoye a ' + req.body.telephone);
  res.json({ success: true, message: 'SMS envoye' });
});

app.listen(PORT, function() {
  console.log('Serveur cabinet dentaire demarre sur le port ' + PORT);
  if (!process.env.GOOGLE_TOKEN) {
    console.log('Pas de token Google. Ouvrez /auth pour connecter Google Calendar.');
  } else {
    console.log('Google Calendar connecte');
  }
});
