const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { verifyToken, signToken } = require('./lib/middleware');
const { getAuthUrl, getTokensFromCode, getGoogleUserInfo } = require('./lib/google-auth');
const { initDriveFolders, uploadAudio, uploadMinutes, getDownloadUrl, deleteFile } = require('./lib/drive');
const db = require('./lib/supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──
const rawOrigins = process.env.ALLOWED_ORIGINS || '*';
const allowedOrigins = rawOrigins === '*' ? true : rawOrigins.split(',').map(o => o.trim());

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
}));

app.use(express.json());

// ══════════════════════════════════════
// RUTAS V1
// ══════════════════════════════════════
const v1 = express.Router();

// ── Auth: Iniciar login con Google ──
v1.get('/auth/login', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// ── Auth: Callback de Google (recibe código) ──
v1.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error_code: 'BAD_REQUEST', error_message: 'Código de autorización requerido' });

    // 1. Intercambiar código por tokens
    const tokens = await getTokensFromCode(code);

    // 2. Obtener info del usuario
    const googleUser = await getGoogleUserInfo(tokens.access_token);

    // 3. Crear o encontrar usuario en Supabase
    const user = await db.findOrCreateUser({
      email: googleUser.email,
      name: googleUser.name,
      googleRefreshToken: tokens.refresh_token,
    });

    // 4. Inicializar carpetas en Drive (primera vez)
    if (!user.drive_folder_id && tokens.refresh_token) {
      try {
        const folders = await initDriveFolders(tokens.refresh_token);
        await db.updateUserDriveFolder(user.id, folders.rootFolderId);
        user.drive_folder_id = folders.rootFolderId;
      } catch (driveError) {
        console.error('Error inicializando Drive:', driveError.message);
      }
    }

    // 5. Generar JWT propio de la app
    const access_token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name || googleUser.name,
    });

    // 6. Redirigir al frontend con el token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}?token=${access_token}`);

  } catch (error) {
    console.error('Error en auth callback:', error);
    res.status(500).json({ error_code: 'AUTH_ERROR', error_message: error.message });
  }
});

// ── Auth: Login simple (para desarrollo/mock) ──
v1.post('/auth/login', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error_code: 'BAD_REQUEST', error_message: 'Email requerido' });

  const user = await db.findOrCreateUser({ email, name: email.split('@')[0] });
  const access_token = signToken({ userId: user.id, email: user.email, name: user.name });
  res.json({ access_token, user });
});

// ── Me ──
v1.get('/me', verifyToken, async (req, res) => {
  const user = await db.getUserById(req.user.userId);
  res.json({ user: user || req.user });
});

// ── Meetings ──
v1.get('/meetings', verifyToken, async (req, res) => {
  const meetings = await db.getMeetings(req.user.userId);
  res.json({ items: meetings });
});

v1.post('/meetings', verifyToken, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error_code: 'BAD_REQUEST', error_message: 'Título requerido' });

  const meeting = await db.createMeeting(req.user.userId, title);
  res.json(meeting);
});

v1.get('/meetings/:id', verifyToken, async (req, res) => {
  const meeting = await db.getMeetingById(req.params.id);
  if (!meeting) return res.status(404).json({ error_code: 'NOT_FOUND', error_message: 'Reunión no encontrada' });

  // Incluir info de transcript y minutes si existen
  const transcript = await db.getTranscript(req.params.id);
  res.json({
    ...meeting,
    audio: { status: meeting.audio_drive_file_id ? 'READY' : 'NONE' },
    transcript: transcript ? { status: transcript.status, id: transcript.id } : null,
  });
});

// ── Audio ──
v1.post('/meetings/:id/audio:prepare-upload', verifyToken, async (req, res) => {
  // En la versión real, el audio se sube directamente a Drive
  // Retornamos la info de la API para que el frontend sepa qué hacer
  res.json({
    upload_url: `/v1/meetings/${req.params.id}/audio:complete`,
    method: 'POST',
    note: 'Envía el audio directamente al endpoint audio:complete como multipart/form-data',
  });
});

v1.post('/meetings/:id/audio:complete', verifyToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.userId);
    if (!user || !user.google_refresh_token) {
      return res.status(400).json({ error_code: 'DRIVE_NOT_CONFIGURED', error_message: 'Reconecta tu cuenta de Google' });
    }

    const meeting = await db.getMeetingById(req.params.id);
    if (!meeting) return res.status(404).json({ error_code: 'NOT_FOUND', error_message: 'Reunión no encontrada' });

    // Asegurar que las carpetas existan
    const folders = await initDriveFolders(user.google_refresh_token);
    const fileName = `${meeting.title.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '_')}.webm`;

    // Si hay un buffer de audio en el body (simplificado para demo)
    // En producción se usaría multer para manejar multipart upload
    const audioBuffer = req.body.audio ? Buffer.from(req.body.audio, 'base64') : Buffer.from('audio-placeholder');

    const result = await uploadAudio(user.google_refresh_token, audioBuffer, fileName, 'audio/webm', folders.audiosFolderId);

    await db.updateMeeting(req.params.id, {
      audio_drive_file_id: result.fileId,
      status: 'PROCESSING',
    });

    res.json({ ok: true, meeting_status: 'PROCESSING', drive_file_id: result.fileId });
  } catch (error) {
    console.error('Error subiendo audio:', error);
    res.status(500).json({ error_code: 'UPLOAD_ERROR', error_message: error.message });
  }
});

v1.delete('/meetings/:id/audio', verifyToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.userId);
    const meeting = await db.getMeetingById(req.params.id);

    if (meeting && meeting.audio_drive_file_id && user && user.google_refresh_token) {
      await deleteFile(user.google_refresh_token, meeting.audio_drive_file_id);
      await db.updateMeeting(req.params.id, { audio_drive_file_id: null });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error borrando audio:', error);
    res.status(500).json({ error_code: 'DELETE_ERROR', error_message: error.message });
  }
});

// ── Transcript ──
v1.get('/meetings/:id/transcript', verifyToken, async (req, res) => {
  const transcript = await db.getTranscript(req.params.id);

  // Fallback a datos de ejemplo si no hay transcripción real
  if (!transcript) {
    return res.json({
      transcript: { id: `t_${req.params.id}`, status: 'READY', version: 1 },
      segments: [
        { id: 'seg_1', start_ms: 0, end_ms: 3000, speaker_label: 'speaker_1', speaker_name: 'Participante 1', text: 'Transcripción pendiente de procesamiento.' }
      ]
    });
  }

  res.json({
    transcript: { id: transcript.id, status: transcript.status, version: transcript.version },
    segments: transcript.segments || [],
  });
});

v1.patch('/meetings/:id/speakers/:speaker_label', verifyToken, async (req, res) => {
  // Actualizar nombre de speaker en la transcripción
  const transcript = await db.getTranscript(req.params.id);
  if (transcript && transcript.segments) {
    const updatedSegments = transcript.segments.map(seg =>
      seg.speaker_label === req.params.speaker_label
        ? { ...seg, speaker_name: req.body.display_name }
        : seg
    );
    await db.upsertTranscript(req.params.id, updatedSegments);
  }
  res.json({ ok: true });
});

// ── Minutes (Actas) ──
v1.post('/meetings/:id/minutes:generate', verifyToken, async (req, res) => {
  const meeting = await db.getMeetingById(req.params.id);
  const title = meeting ? meeting.title : 'Reunión';

  const minutes = await db.createMinutes(req.params.id, `# Acta: ${title}\n\nContenido generado automáticamente.\n\n*Pendiente de revisión.*`);
  res.json({ minutes });
});

v1.post('/meetings/:id/ai:query', verifyToken, (req, res) => {
  // Placeholder para integración con IA
  const { intent } = req.body;
  const responses = {
    bullets: '- Punto principal discutido\n- Siguiente paso definido\n- Responsables asignados',
    decisions: '- Decisión 1: Aprobado el presupuesto Q1\n- Decisión 2: Lanzamiento v2 para marzo',
    tasks: '- [ ] María: Preparar informe KPIs\n- [ ] Juan: Configurar entorno staging',
    rewrite_minutes: '# Acta Reescrita\n\nContenido optimizado por IA.',
  };
  res.json({ result_md: responses[intent] || '- Sin resultados' });
});

// ── Minutes CRUD ──
v1.get('/minutes/:minutes_id', verifyToken, async (req, res) => {
  const minutes = await db.getMinutes(req.params.minutes_id);
  if (!minutes) return res.status(404).json({ error_code: 'NOT_FOUND', error_message: 'Acta no encontrada' });
  res.json(minutes);
});

v1.patch('/minutes/:minutes_id', verifyToken, async (req, res) => {
  await db.updateMinutes(req.params.minutes_id, { content_md: req.body.content_md });
  res.json({ ok: true });
});

v1.post('/minutes/:minutes_id/finalize', verifyToken, async (req, res) => {
  await db.updateMinutes(req.params.minutes_id, { status: 'FINAL' });

  // Subir a Drive automáticamente al finalizar
  try {
    const minutes = await db.getMinutes(req.params.minutes_id);
    if (minutes && minutes.meeting_id) {
      const meeting = await db.getMeetingById(minutes.meeting_id);
      if (meeting) {
        const user = await db.getUserById(meeting.user_id);
        if (user && user.google_refresh_token) {
          const folders = await initDriveFolders(user.google_refresh_token);
          const fileName = `Acta_${meeting.title.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '_')}.md`;
          const result = await uploadMinutes(user.google_refresh_token, minutes.content_md, fileName, folders.actasFolderId);
          await db.updateMinutes(req.params.minutes_id, { drive_file_id: result.fileId });
        }
      }
    }
  } catch (error) {
    console.error('Error subiendo acta a Drive:', error);
  }

  res.json({ ok: true, status: 'FINAL' });
});

// ── Export ──
v1.post('/minutes/:minutes_id/export', verifyToken, async (req, res) => {
  const format = req.query.format || 'pdf';
  const exportRecord = await db.createExport(req.params.minutes_id, format);
  res.json({ export_id: exportRecord.id });
});

v1.get('/exports/:id', verifyToken, async (req, res) => {
  const exportRecord = await db.getExport(req.params.id);
  if (!exportRecord) {
    return res.json({ id: req.params.id, status: 'READY', download_url: '#', expires_at: new Date(Date.now() + 86400000).toISOString() });
  }
  res.json(exportRecord);
});

// ── Mount v1 ──
app.use('/v1', v1);

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error_code: 'INTERNAL_ERROR',
    error_message: err.message,
    request_id: req.headers['x-request-id'],
  });
});

// Solo iniciar servidor si NO estamos en Vercel (serverless)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`✅ Backend de ConferenceApp corriendo en puerto ${PORT}`);
  });
}

module.exports = app;
