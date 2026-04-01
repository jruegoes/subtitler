import postgres from "postgres";

const sql = postgres(process.env.DB_LINK!);

export async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS transcripts (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      text TEXT NOT NULL,
      tokens JSONB,
      audio_key TEXT,
      translated_srt TEXT,
      translated_lang TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Add columns if they don't exist (for existing tables)
  await sql`
    DO $$ BEGIN
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS translated_srt TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS translated_lang TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS audio_key TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS original_srt TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS translations JSONB DEFAULT '{}';
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS source_lang TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS content_type TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS content_description TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS glossary TEXT;
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
      ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS soniox_id TEXT;
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `;
}

export async function saveTranscript(
  filename: string,
  text: string,
  tokens: unknown[],
  audioKey?: string,
  sourceLang?: string,
  contentType?: string,
  contentDescription?: string,
) {
  const [row] = await sql`
    INSERT INTO transcripts (filename, text, tokens, audio_key, source_lang, content_type, content_description)
    VALUES (${filename}, ${text}, ${JSON.stringify(tokens)}, ${audioKey ?? null}, ${sourceLang ?? null}, ${contentType ?? null}, ${contentDescription ?? null})
    RETURNING *
  `;
  return row;
}

export async function createProcessingTranscript(
  filename: string,
  sonioxId: string,
  audioKey?: string,
  sourceLang?: string,
  contentType?: string,
  contentDescription?: string,
) {
  const [row] = await sql`
    INSERT INTO transcripts (filename, text, tokens, audio_key, source_lang, content_type, content_description, status, soniox_id)
    VALUES (${filename}, '', '[]', ${audioKey ?? null}, ${sourceLang ?? null}, ${contentType ?? null}, ${contentDescription ?? null}, 'processing', ${sonioxId})
    RETURNING *
  `;
  return row;
}

export async function updateTranscriptComplete(id: number, text: string, tokens: unknown[], audioKey?: string) {
  const [row] = await sql`
    UPDATE transcripts
    SET text = ${text}, tokens = ${JSON.stringify(tokens)}, status = 'completed',
        audio_key = COALESCE(${audioKey ?? null}, audio_key)
    WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

export async function updateTranscriptStatus(id: number, status: string, errorMsg?: string) {
  const [row] = await sql`
    UPDATE transcripts
    SET status = ${status}, text = COALESCE(${errorMsg ?? null}, text)
    WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

export async function saveGlossary(id: number, glossary: string) {
  const [row] = await sql`
    UPDATE transcripts SET glossary = ${glossary} WHERE id = ${id} RETURNING *
  `;
  return row;
}

export async function updateAudioKey(id: number, audioKey: string) {
  const [row] = await sql`
    UPDATE transcripts SET audio_key = ${audioKey} WHERE id = ${id} RETURNING *
  `;
  return row;
}

export async function updateTranscript(id: number, text: string, tokens: unknown[]) {
  const [row] = await sql`
    UPDATE transcripts
    SET text = ${text}, tokens = ${JSON.stringify(tokens)}
    WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

export async function saveOriginalSrt(id: number, srt: string) {
  const [row] = await sql`
    UPDATE transcripts SET original_srt = ${srt} WHERE id = ${id} RETURNING *
  `;
  return row;
}

export async function updateOriginalSrt(id: number, srt: string) {
  const [row] = await sql`
    UPDATE transcripts SET original_srt = ${srt} WHERE id = ${id} RETURNING *
  `;
  return row;
}

export async function updateTranslatedSrt(id: number, srt: string) {
  const [row] = await sql`
    UPDATE transcripts SET translated_srt = ${srt} WHERE id = ${id} RETURNING *
  `;
  return row;
}

export async function saveTranslation(id: number, srt: string, lang: string) {
  // Save to both legacy columns and translations JSONB
  const [row] = await sql`
    UPDATE transcripts
    SET translated_srt = ${srt},
        translated_lang = ${lang},
        translations = COALESCE(translations, '{}'::jsonb) || jsonb_build_object(${lang}::text, ${srt}::text)
    WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

export async function updateTranslationLang(id: number, lang: string, srt: string) {
  const [row] = await sql`
    UPDATE transcripts
    SET translations = COALESCE(translations, '{}'::jsonb) || jsonb_build_object(${lang}::text, ${srt}::text)
    WHERE id = ${id}
    RETURNING *
  `;
  return row;
}

export async function getTranscripts() {
  return sql`SELECT id, filename, text, tokens, audio_key, source_lang, content_type, content_description, glossary, original_srt, translated_srt, translated_lang, translations, status, soniox_id, created_at FROM transcripts ORDER BY created_at DESC`;
}

export async function getTranscriptById(id: number) {
  const [row] = await sql`SELECT id, filename, text, tokens, audio_key, source_lang, content_type, content_description, glossary, original_srt, translated_srt, translated_lang, translations, status, soniox_id, created_at FROM transcripts WHERE id = ${id}`;
  return row ?? null;
}

export default sql;
