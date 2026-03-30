require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { supabase } = require('./supabase');
const { generateMinutes, transcribeAudio, queryAboutMeeting } = require('./ai');
const { getAuthUrl, getTokens, uploadToDrive } = require('./drive');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const path = require('path');

// In-memory store for mocks during dev session
const mockStore = new Map();

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
  const isMock = req.params.id === 'mock-1' || req.params.id.startsWith('mock-meeting-');
  if (isMock) {
    const stored = mockStore.get(req.params.id);
    return res.json({ 
      id: req.params.id, 
      title: stored?.title || 'Reunión de Prueba Mock', 
      status: 'READY', 
      created_at: new Date().toISOString(),
      minutes: stored?.minutes || { content_md: '# Minuta de Prueba\n\n- Punto 1: Todo funciona\n- Punto 2: Mock exitoso' },
      transcript: stored?.transcript || { content_json: { segments: [{ speaker_name: 'Sistema', speaker_label: 'S1', text: 'Esta es la transcripción simulada de la reunión mock.' }] } }
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

// Helper routes for frontend compatibility
v1.get('/meetings/:id/transcript', verifyToken, async (req, res) => {
  const isMock = req.params.id === 'mock-1' || req.params.id.startsWith('mock-meeting-');
  if (isMock) {
    const stored = mockStore.get(req.params.id);
    return res.json(stored?.transcript?.content_json || { segments: [{ speaker_name: 'Sistema', speaker_label: 'S1', text: 'Esta es la transcripción simulada de la reunión mock.' }] });
  }
  const { data, error } = await supabase.from('transcripts').select('*').eq('meeting_id', req.params.id).single();
  if (error) return res.status(404).json({ error_code: 'NOT_FOUND', error_message: 'Transcripción no encontrada' });
  res.json(data.content_json);
});

v1.get('/minutes/:meeting_id', verifyToken, async (req, res) => {
  // Try to find by meeting_id first (frontend sometimes sends this)
  const { data, error } = await supabase.from('minutes').select('*').eq('meeting_id', req.params.meeting_id).single();
  if (error || !data) {
     // Fallback to checking if it's a direct minutes_id
     const { data: data2, error: error2 } = await supabase.from('minutes').select('*').eq('id', req.params.meeting_id).single();
     if (error2 || !data2) return res.status(404).json({ error_code: 'NOT_FOUND', error_message: 'Acta no encontrada' });
     return res.json(data2);
  }
  res.json(data);
});

// --- Audio (Ahora con soporte de Multer) ---
v1.post('/meetings/:id/audio:complete', verifyToken, upload.single('audio'), async (req, res) => {
  const isMock = req.params.id === 'mock-1' || req.params.id.startsWith('mock-meeting-');
  
  if (isMock) {
    console.log("Procesando audio MOCK con Gemini...");
    let transcriptText = "Transcripción no disponible (buffer vacío)";
    let minutesMd = "# Error en procesamiento de Audio";

    if (req.file) {
      try {
        transcriptText = await transcribeAudio(req.file.buffer, req.file.mimetype);
        minutesMd = await generateMinutes(transcriptText);
      } catch (err) {
        console.error("AI Error en audio:complete:", err);
      }
    }

    mockStore.set(req.params.id, {
      title: "Reunión Procesada (Mock AI)",
      transcript: { content_json: { segments: [{ speaker_name: "Asistente AI", speaker_label: "IA", text: transcriptText }] } },
      minutes: { content_md: minutesMd }
    });

    return res.json({ ok: true, meeting_status: 'READY' });
  }

  const storageKey = req.body.storage_key || (req.file ? `audios/${req.user.id}/${req.params.id}.webm` : null);
  const { error } = await supabase.from('meetings').update({ status: 'PROCESSING', storage_key: storageKey }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error_code: 'UPDATE_FAILED', error_message: error.message });
  res.json({ ok: true, meeting_status: 'PROCESSING' });
});

// --- Transcript e IA ---
v1.post('/meetings/:id/ai:generate', verifyToken, async (req, res) => {
  if (req.params.id === 'mock-1' || req.params.id.startsWith('mock-meeting-')) {
     return res.json({ minutes: { content_md: '# Minuta Generada (Mock)\n\n- Punto A: Resumen exitoso\n- Punto B: IA operativa' } });
  }
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

v1.post('/meetings/:id/ai:query', verifyToken, async (req, res) => {
  const isMock = req.params.id === 'mock-1' || req.params.id.startsWith('mock-meeting-');
  if (isMock) {
    const stored = mockStore.get(req.params.id);
    const transcript = stored?.transcript?.content_json?.segments?.map(s => s.text).join(' ') || "No hay trascripción disponible.";
    const answer = await queryAboutMeeting(req.body.prompt, transcript);
    return res.json({ result_md: answer });
  }
  // Logic for real DB would go here
  res.json({ result_md: "El asistente IA está activo, pero esta reunión no tiene datos en la base de datos real aún." });
});

v1.post('/meetings/:id/minutes:generate', verifyToken, async (req, res) => {
  // Alias for ai:generate
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
    const htmlAuth = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Autenticación Exitosa</title>
          <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f8fafc; margin: 0; }
              .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
              h1 { color: #0f172a; font-size: 1.5rem; margin-bottom: 0.5rem; }
              p { color: #64748b; font-size: 0.875rem; margin-bottom: 1.5rem; }
              .loader { border: 3px solid #f3f3f3; border-top: 3px solid #3b82f6; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 0 auto; }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
      </head>
      <body>
          <div class="card">
              <div style="width: 48px; height: 48px; background: #dcfce7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
                  <svg style="width: 24px; height: 24px; color: #16a34a;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
              </div>
              <h1>Conectado con Google Drive</h1>
              <p>Configurando integración...</p>
              <div class="loader"></div>
          </div>
          <script>
              // Send tokens back to main window if it's a popup
              if (window.opener) {
                  window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
                  setTimeout(() => window.close(), 1500);
              } else {
                  // Save to localStorage and redirect back to app
                  localStorage.setItem('google_drive_tokens', JSON.stringify(${JSON.stringify(tokens)}));
                  setTimeout(() => { window.location.href = '/?token=dev-mock-token'; }, 1500);
              }
          </script>
      </body>
      </html>
    `;
    res.send(htmlAuth);
  } catch (error) {
    res.status(500).send("Error Google Auth: " + error.message);
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
