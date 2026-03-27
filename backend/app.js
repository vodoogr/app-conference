require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { supabase } = require('./supabase');
const { generateMinutes } = require('./ai');
const { getAuthUrl, getTokens, uploadToDrive } = require('./drive');

const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro';

// Serve frontend during local development
app.use(express.static(path.join(__dirname, '../public')));

// 1. Configuración de CORS con soporte para Redes Privadas (PNA)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Access-Control-Allow-Private-Network']
}));

// Middleware específico para el error de "Red Local" de Chrome (PNA)
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(express.json());

// 2. Middleware de Autenticación JWT (Usando Supabase para verificar)
const verifyToken = async (req, res, next) => {
  const bearerHeader = req.headers['authorization'];
  if (!bearerHeader) {
    return res.status(401).json({ error_code: 'AUTH_REQUIRED', error_message: 'Token no proporcionado' });
  }
  
  const token = bearerHeader.split(' ')[1];

  // Bypass for local development testing
  if (token === 'dev-mock-token' || process.env.NODE_ENV === 'test') {
    req.user = { id: '00000000-0000-0000-0000-000000000000', email: 'test@example.com', name: 'Test User' };
    return next();
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return res.status(403).json({ error_code: 'FORBIDDEN', error_message: 'Token inválido o expirado' });
  }

  req.user = data.user;
  next();
};

// ==========================================
// RUTAS V1
// ==========================================
const v1 = express.Router();

// --- Auth ---
v1.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error_code: 'AUTH_FAILED', error_message: error.message });
  res.json({ access_token: data.session.access_token, user: data.user });
});

v1.get('/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// --- Reuniones (Meetings) ---
v1.get('/meetings', verifyToken, async (req, res) => {
  if (req.user.id === '00000000-0000-0000-0000-000000000000') {
    return res.json([
      { id: 'mock-1', title: 'Reunión de Bienvenida (Mock)', created_at: new Date().toISOString(), status: 'READY' }
    ]);
  }
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('user_id', req.user.id) // Supabase Auth usa 'id' para el ID del usuario
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error_code: 'FETCH_FAILED', error_message: error.message });
  res.json(data);
});

v1.post('/meetings', verifyToken, async (req, res) => {
  const { title } = req.body;

  // Mock for development
  if (req.user.id === '00000000-0000-0000-0000-000000000000') {
    return res.json({ id: 'mock-meeting-' + Date.now(), title: title || 'Mock Meeting', status: 'DRAFT' });
  }

  const { data, error } = await supabase
    .from('meetings')
    .insert([{ title, user_id: req.user.id, status: 'DRAFT' }])
    .select().single();
  if (error) return res.status(500).json({ error_code: 'CREATE_FAILED', error_message: error.message });
  res.json(data);
});

v1.get('/meetings/:id', verifyToken, async (req, res) => {
  if (req.params.id.startsWith('mock-meeting-')) {
    return res.json({ 
      id: req.params.id, 
      title: 'Reunión de Prueba Mock', 
      status: 'READY', 
      created_at: new Date().toISOString(),
      minutes: { content_md: '# Minuta de Prueba\n\n- Punto 1: Todo funciona\n- Punto 2: Mock exitoso' },
      transcript: { content_json: { text: 'Esta es la transcripción simulada de la reunión mock.' } }
    });
  }
  const { data, error } = await supabase
    .from('meetings')
    .select('*, transcript:transcripts(*), minutes:minutes(*)')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error_code: 'NOT_FOUND', error_message: 'Reunión no encontrada' });
  res.json(data);
});

// --- Audio ---
v1.post('/meetings/:id/audio:prepare-upload', verifyToken, async (req, res) => {
  const storagePath = `audios/${req.user.id}/${req.params.id}.webm`;
  const { data, error } = await supabase.storage.from('meeting-audios').createSignedUploadUrl(storagePath);
  if (error) return res.status(500).json({ error_code: 'STORAGE_ERROR', error_message: error.message });
  res.json({ upload_url: data.signedUrl, storage_key: storagePath });
});

v1.post('/meetings/:id/audio:complete', verifyToken, async (req, res) => {
  if (req.params.id.startsWith('mock-meeting-')) {
    return res.json({ ok: true, meeting_status: 'PROCESSING (MOCK)' });
  }
  const { error } = await supabase.from('meetings').update({ status: 'PROCESSING', storage_key: req.body.storage_key }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error_code: 'UPDATE_FAILED', error_message: error.message });
  res.json({ ok: true, meeting_status: 'PROCESSING' });
});

// --- Transcript e IA ---
v1.post('/meetings/:id/minutes:generate', verifyToken, async (req, res) => {
  const { data: transcriptData } = await supabase.from('transcripts').select('content_json').eq('meeting_id', req.params.id).single();
  const text = transcriptData?.content_json?.text || "Transcripción por defecto";
  try {
    const minutesMd = await generateMinutes(text, req.body.style);
    const { data: minute, error } = await supabase.from('minutes').insert([{ meeting_id: req.params.id, content_md: minutesMd, status: 'DRAFT' }]).select().single();
    if (error) throw error;
    res.json({ minutes: minute });
  } catch (error) {
    res.status(500).json({ error_code: 'AI_ERROR', error_message: error.message });
  }
});

// --- Actas (Minutes) ---
v1.get('/minutes/:minutes_id', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('minutes').select('*').eq('id', req.params.minutes_id).single();
  if (error || !data) return res.status(404).send("Acta no encontrada");
  res.json(data);
});

v1.patch('/minutes/:minutes_id', verifyToken, async (req, res) => {
  const { error } = await supabase.from('minutes').update({ content_md: req.body.content_md }).eq('id', req.params.minutes_id);
  if (error) return res.status(500).send("Error al actualizar");
  res.json({ ok: true });
});

v1.post('/minutes/:minutes_id/finalize', verifyToken, async (req, res) => {
  const { error } = await supabase.from('minutes').update({ status: 'FINAL' }).eq('id', req.params.minutes_id);
  if (error) return res.status(500).send("Error al finalizar");
  res.json({ ok: true, status: 'FINAL' });
});

// --- Google Drive ---
v1.get('/auth/google', (req, res) => res.redirect(getAuthUrl()));

v1.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokens = await getTokens(code);
    res.json({ message: "Autorizado", tokens });
  } catch (error) {
    res.status(500).send("Error Google Auth");
  }
});

v1.post('/minutes/:minutes_id/export', verifyToken, async (req, res) => {
  const { data: minute } = await supabase.from('minutes').select('*, meetings(title)').eq('id', req.params.minutes_id).single();
  if (!minute) return res.status(404).send("Acta no encontrada");
  try {
    const file = await uploadToDrive(minute.meetings.title, minute.content_md, req.body.tokens);
    res.json({ ok: true, drive_link: file.webViewLink });
  } catch (error) {
    res.status(500).json({ error_code: 'EXPORT_FAILED', error_message: error.message });
  }
});

app.use('/v1', v1);

if (require.main === module) {
  app.listen(PORT, () => console.log(`Backend en puerto ${PORT}`));
}

module.exports = app;
