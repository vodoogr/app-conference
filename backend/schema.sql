-- Tabla de Reuniones
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT CHECK (status IN ('DRAFT', 'PROCESSING', 'READY', 'ERROR')) DEFAULT 'DRAFT',
  storage_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla de Transcripciones
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  content_json JSONB,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla de Actas (Minutes)
CREATE TABLE IF NOT EXISTS minutes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  content_md TEXT,
  status TEXT DEFAULT 'DRAFT',
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE minutes ENABLE ROW LEVEL SECURITY;

-- Políticas para Meetings
CREATE POLICY "Usuarios pueden ver sus propias reuniones" ON meetings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Usuarios pueden insertar sus propias reuniones" ON meetings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Usuarios pueden actualizar sus propias reuniones" ON meetings FOR UPDATE USING (auth.uid() = user_id);

-- Políticas para Transcripts
CREATE POLICY "Usuarios pueden ver transcripciones de sus reuniones" ON transcripts FOR SELECT USING (
  EXISTS (SELECT 1 FROM meetings WHERE meetings.id = transcripts.meeting_id AND meetings.user_id = auth.uid())
);
CREATE POLICY "Usuarios pueden insertar transcripciones" ON transcripts FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM meetings WHERE meetings.id = transcripts.meeting_id AND meetings.user_id = auth.uid())
);

-- Políticas para Minutes
CREATE POLICY "Usuarios pueden ver actas de sus reuniones" ON minutes FOR SELECT USING (
  EXISTS (SELECT 1 FROM meetings WHERE meetings.id = minutes.meeting_id AND meetings.user_id = auth.uid())
);
CREATE POLICY "Usuarios pueden insertar/editar actas" ON minutes FOR ALL USING (
  EXISTS (SELECT 1 FROM meetings WHERE meetings.id = minutes.meeting_id AND meetings.user_id = auth.uid())
);
