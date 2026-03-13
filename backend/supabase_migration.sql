-- ============================================
-- ConferenceApp — Supabase Migration
-- ============================================

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  google_refresh_token TEXT,
  drive_folder_id      TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Meetings
CREATE TABLE IF NOT EXISTS meetings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  status        TEXT DEFAULT 'DRAFT',
  audio_drive_file_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings(user_id);

-- 3. Transcripts
CREATE TABLE IF NOT EXISTS transcripts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id    UUID REFERENCES meetings(id) ON DELETE CASCADE UNIQUE,
  segments      JSONB DEFAULT '[]',
  status        TEXT DEFAULT 'PENDING',
  version       INTEGER DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 4. Minutes (Actas)
CREATE TABLE IF NOT EXISTS minutes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id    UUID REFERENCES meetings(id) ON DELETE CASCADE,
  content_md    TEXT,
  status        TEXT DEFAULT 'DRAFT',
  drive_file_id TEXT,
  version       INTEGER DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 5. Exports
CREATE TABLE IF NOT EXISTS exports (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  minutes_id    UUID REFERENCES minutes(id) ON DELETE CASCADE,
  format        TEXT DEFAULT 'pdf',
  status        TEXT DEFAULT 'PENDING',
  download_url  TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
