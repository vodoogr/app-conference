const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  SUPABASE_URL o SUPABASE_SERVICE_KEY no configuradas. Usando modo mock.');
}

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// ---- Users ----
async function findOrCreateUser({ email, name, googleRefreshToken }) {
  if (!supabase) return { id: 'mock_user', email, name };

  // Buscar usuario existente
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (existing) {
    // Actualizar refresh token si cambió
    if (googleRefreshToken && googleRefreshToken !== existing.google_refresh_token) {
      await supabase
        .from('users')
        .update({ google_refresh_token: googleRefreshToken, name })
        .eq('id', existing.id);
    }
    return existing;
  }

  // Crear nuevo usuario
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ email, name, google_refresh_token: googleRefreshToken })
    .select()
    .single();

  if (error) throw new Error(`Error creando usuario: ${error.message}`);
  return newUser;
}

async function updateUserDriveFolder(userId, driveFolderId) {
  if (!supabase) return;
  await supabase.from('users').update({ drive_folder_id: driveFolderId }).eq('id', userId);
}

async function getUserById(userId) {
  if (!supabase) return { id: userId, email: 'mock@test.com', name: 'Mock User' };
  const { data } = await supabase.from('users').select('*').eq('id', userId).single();
  return data;
}

// ---- Meetings ----
async function getMeetings(userId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from('meetings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function createMeeting(userId, title) {
  if (!supabase) return { id: `m_${Date.now()}`, title, status: 'DRAFT', created_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('meetings')
    .insert({ user_id: userId, title, status: 'DRAFT' })
    .select()
    .single();
  if (error) throw new Error(`Error creando reunión: ${error.message}`);
  return data;
}

async function getMeetingById(meetingId) {
  if (!supabase) return null;
  const { data } = await supabase.from('meetings').select('*').eq('id', meetingId).single();
  return data;
}

async function updateMeeting(meetingId, updates) {
  if (!supabase) return;
  await supabase.from('meetings').update(updates).eq('id', meetingId);
}

// ---- Transcripts ----
async function getTranscript(meetingId) {
  if (!supabase) return null;
  const { data } = await supabase.from('transcripts').select('*').eq('meeting_id', meetingId).single();
  return data;
}

async function upsertTranscript(meetingId, segments) {
  if (!supabase) return;
  const { data: existing } = await supabase.from('transcripts').select('id').eq('meeting_id', meetingId).single();

  if (existing) {
    await supabase.from('transcripts').update({ segments, status: 'READY' }).eq('id', existing.id);
  } else {
    await supabase.from('transcripts').insert({ meeting_id: meetingId, segments, status: 'READY' });
  }
}

// ---- Minutes ----
async function getMinutes(minutesId) {
  if (!supabase) return null;
  const { data } = await supabase.from('minutes').select('*').eq('id', minutesId).single();
  return data;
}

async function createMinutes(meetingId, contentMd) {
  if (!supabase) return { id: `min_${Date.now()}`, meeting_id: meetingId, status: 'DRAFT', content_md: contentMd, version: 1 };
  const { data, error } = await supabase
    .from('minutes')
    .insert({ meeting_id: meetingId, content_md: contentMd, status: 'DRAFT' })
    .select()
    .single();
  if (error) throw new Error(`Error creando acta: ${error.message}`);
  return data;
}

async function updateMinutes(minutesId, updates) {
  if (!supabase) return;
  await supabase.from('minutes').update(updates).eq('id', minutesId);
}

// ---- Exports ----
async function createExport(minutesId, format) {
  if (!supabase) return { id: `exp_${Date.now()}`, minutes_id: minutesId, format, status: 'PENDING' };
  const { data, error } = await supabase
    .from('exports')
    .insert({ minutes_id: minutesId, format, status: 'PENDING' })
    .select()
    .single();
  if (error) throw new Error(`Error creando export: ${error.message}`);
  return data;
}

async function getExport(exportId) {
  if (!supabase) return null;
  const { data } = await supabase.from('exports').select('*').eq('id', exportId).single();
  return data;
}

async function updateExport(exportId, updates) {
  if (!supabase) return;
  await supabase.from('exports').update(updates).eq('id', exportId);
}

module.exports = {
  supabase,
  findOrCreateUser,
  updateUserDriveFolder,
  getUserById,
  getMeetings,
  createMeeting,
  getMeetingById,
  updateMeeting,
  getTranscript,
  upsertTranscript,
  getMinutes,
  createMinutes,
  updateMinutes,
  createExport,
  getExport,
  updateExport,
};
