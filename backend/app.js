const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro';

// 1. Configuración de CORS
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? ['https://stitch.withgoogle.com', 'https://tu-dominio-ui.com'] 
  : '*';

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id']
}));

app.use(express.json());

// 2. Middleware de Autenticación JWT
const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers['authorization'];
  if (!bearerHeader) {
    return res.status(401).json({ error_code: 'AUTH_REQUIRED', error_message: 'Token no proporcionado', request_id: req.headers['x-request-id'] });
  }
  
  const token = bearerHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error_code: 'FORBIDDEN', error_message: 'Token inválido o expirado', request_id: req.headers['x-request-id'] });
  }
};

// ==========================================
// RUTAS V1
// ==========================================
const v1 = express.Router();

// --- Auth ---
v1.post('/auth/login', (req, res) => {
  const { email } = req.body;
  // Mock login logic
  const user = { id: 'u_123', email, name: 'Usuario Stitch' };
  const access_token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
  res.json({ access_token, user });
});

v1.get('/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// --- Reuniones (Meetings) ---
v1.get('/meetings', verifyToken, (req, res) => {
  res.json({
    items: [
      { id: 'm_1', title: 'Reunión Q1', status: 'READY', created_at: new Date().toISOString(), minutes_id: 'min_1' },
      { id: 'm_2', title: 'Sync Semanal', status: 'PROCESSING', created_at: new Date().toISOString() } // Sin minutes_id dispara navegación a "Procesando Reunión"
    ]
  });
});

v1.post('/meetings', verifyToken, (req, res) => {
  const { title } = req.body;
  res.json({ id: `m_${Date.now()}`, title, status: 'DRAFT', created_at: new Date().toISOString() });
});

v1.get('/meetings/:id', verifyToken, (req, res) => {
  res.json({
    id: req.params.id, title: 'Reunión Actual', status: 'PROCESSING', created_at: new Date().toISOString(),
    audio: { status: 'READY' },
    transcript: { status: 'READY', id: 't_1' },
    minutes: { status: 'READY', id: 'min_1', version: 1 } // Su existencia disparará navegación a "Detalle del Acta"
  });
});

// --- Audio ---
v1.post('/meetings/:id/audio:prepare-upload', verifyToken, (req, res) => {
  res.json({
    upload_url: 'https://storage.proveedor.com/upload?token=xyz...123',
    storage_key: `audio_${req.params.id}.webm`
  });
});

v1.post('/meetings/:id/audio:complete', verifyToken, (req, res) => {
  res.json({ ok: true, meeting_status: 'PROCESSING' });
});

v1.delete('/meetings/:id/audio', verifyToken, (req, res) => {
  res.json({ ok: true });
});

// --- Transcript e IA ---
v1.get('/meetings/:id/transcript', verifyToken, (req, res) => {
  res.json({
    transcript: { id: `t_${req.params.id}`, status: 'READY', version: 1 },
    segments: [
      { id: 'seg_1', start_ms: 0, end_ms: 3000, speaker_label: 'speaker_1', speaker_name: 'Alice', text: 'Hola a todos.' }
    ]
  });
});

v1.patch('/meetings/:id/speakers/:speaker_label', verifyToken, (req, res) => {
  res.json({ ok: true });
});

v1.post('/meetings/:id/minutes:generate', verifyToken, (req, res) => {
  res.json({
    minutes: { id: `min_nuevo_${Date.now()}`, version: 1, status: 'DRAFT', content_md: '# Acta Generada' }
  });
});

v1.post('/meetings/:id/ai:query', verifyToken, (req, res) => {
  res.json({ result_md: '- Punto 1\n- Punto 2\n- Decisión clave tomada.' });
});

// --- Actas (Minutes) ---
// NOTA CRÍTICA: minutes_id es la clave para la navegación entre las vistas de detalles.
v1.get('/minutes/:minutes_id', verifyToken, (req, res) => {
  res.json({
    id: req.params.minutes_id,
    meeting_id: 'm_1', // Requerido para navegar de vuelta a Transcripción o IA
    version: 1,
    status: 'DRAFT',
    content_md: '# Acta de Reunión\n\nTodo lo discutido hoy...'
  });
});

v1.patch('/minutes/:minutes_id', verifyToken, (req, res) => {
  res.json({ ok: true });
});

v1.post('/minutes/:minutes_id/finalize', verifyToken, (req, res) => {
  res.json({ ok: true, status: 'FINAL' });
});

// --- Exportación ---
v1.post('/minutes/:minutes_id/export', verifyToken, (req, res) => {
  res.json({ export_id: `exp_${Date.now()}` });
});

v1.get('/exports/:id', verifyToken, (req, res) => {
  res.json({ id: req.params.id, status: 'READY', download_url: 'https://storage.proveedor.com/files/acta.pdf', expires_at: '2026-12-31T00:00:00Z' });
});

app.use('/v1', v1);

// Manejo centralizado de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error_code: 'INTERNAL_ERROR', error_message: err.message, request_id: req.headers['x-request-id'] });
});

app.listen(PORT, () => {
  console.log(`Backend de ConferenceApp corriendo en puerto ${PORT}`);
});
