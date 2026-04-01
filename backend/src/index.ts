import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { SonioxNodeClient, FetchHttpClient } from "@soniox/node";
import { initDb, saveTranscript, createProcessingTranscript, updateTranscriptComplete, updateTranscriptStatus, saveTranslation, saveOriginalSrt, saveGlossary, updateTranscript, updateAudioKey, updateOriginalSrt, updateTranslatedSrt, updateTranslationLang, getTranscripts, getTranscriptById } from "./db.js";
import { defaultProfile } from "./subtitle-guidelines.js";
import { generateSRT, generateVTT } from "./srt-generator.js";
import { translateSRT } from "./translator.js";
import { uploadAudio, getPlaybackUrl } from "./storage.js";

const app = new Hono();
const soniox = new SonioxNodeClient({
  api_key: process.env.SONIOX_KEY,
  http_client: new FetchHttpClient({
    base_url: "https://api.soniox.com",
    default_timeout_ms: 600000,
    default_headers: { Authorization: `Bearer ${process.env.SONIOX_KEY}` },
  }),
});

app.use("/*", cors({ origin: "http://localhost:5173" }));

// Request logging middleware
app.use("/*", async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  console.log(`--> ${method} ${path}`);
  await next();
  const ms = Date.now() - start;
  console.log(`<-- ${method} ${path} ${c.res.status} (${ms}ms)`);
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.post("/api/transcribe", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const optionsRaw = formData.get("options") as string | null;

  if (!file) {
    console.log("[transcribe] No file provided");
    return c.json({ error: "No file provided" }, 400);
  }

  const opts = optionsRaw ? JSON.parse(optionsRaw) : {};
  const buffer = Buffer.from(await file.arrayBuffer());

  console.log(`[transcribe] File: ${file.name} (${(buffer.length / 1024).toFixed(1)} KB)`);
  console.log(`[transcribe] Options:`, JSON.stringify(opts, null, 2));

  const sourceLang: string = opts.source_lang || "";
  const contentType: string = opts.content_type || "";
  const contentDescription: string = opts.description || "";

  // Step 1: Upload to R2 and Soniox in parallel
  const r2Promise = uploadAudio(buffer, file.name, file.type || "audio/mpeg");
  const sonioxUploadPromise = soniox.files.upload(buffer, { filename: file.name });

  const [r2Result, sonioxResult] = await Promise.allSettled([r2Promise, sonioxUploadPromise]);

  // Check R2
  let audioKey: string | undefined;
  if (r2Result.status === "fulfilled") {
    audioKey = r2Result.value;
    console.log(`[transcribe] R2 upload complete: ${audioKey}`);
  } else {
    console.error(`[transcribe] R2 upload failed:`, r2Result.reason?.message);
  }

  // Check Soniox file upload
  if (sonioxResult.status === "rejected") {
    console.error(`[transcribe] Soniox file upload failed:`, sonioxResult.reason?.message);
    return c.json({ error: `File upload failed: ${sonioxResult.reason?.message}` }, 400);
  }

  const sonioxFileId = sonioxResult.value.id;
  console.log(`[transcribe] Soniox file uploaded: ${sonioxFileId}`);

  // Step 2: Start transcription with wait: false (returns immediately)
  const transcribeParams: Record<string, unknown> = {
    model: "stt-async-v4",
    file_id: sonioxFileId,
    wait: false,
    enable_speaker_diarization: true,
    language_hints_strict: true,
  };

  if (sourceLang) {
    transcribeParams.language_hints = [sourceLang];
  }

  console.log(`[transcribe] Starting async transcription:`, JSON.stringify(transcribeParams));

  let sonioxTranscriptionId: string;
  try {
    const result = await soniox.stt.transcribe(transcribeParams as any);
    sonioxTranscriptionId = result.id;
    console.log(`[transcribe] Soniox transcription started: ${sonioxTranscriptionId}, status: ${result.status}`);
  } catch (err: any) {
    const body = err.bodyText ? JSON.parse(err.bodyText) : null;
    const message = body?.message || err.message || "Soniox transcription failed";
    console.error(`[transcribe] Soniox error:`, body || err.message);
    return c.json({ error: message }, 400);
  }

  // Step 3: Create DB record with processing status
  const saved = await createProcessingTranscript(
    file.name,
    sonioxTranscriptionId,
    audioKey,
    sourceLang || undefined,
    contentType || undefined,
    contentDescription || undefined,
  );

  console.log(`[transcribe] Created DB record id=${saved.id}, status=processing, soniox_id=${sonioxTranscriptionId}`);

  return c.json({
    id: saved.id,
    status: "processing",
    filename: file.name,
  });
});

// Poll transcription status — frontend calls this every few seconds
app.get("/api/transcripts/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getTranscriptById(id);
  if (!row) return c.json({ error: "Not found" }, 404);

  // Already completed or errored — return immediately
  if (row.status !== "processing" || !row.soniox_id) {
    return c.json({ status: row.status, id });
  }

  // Check Soniox for current status
  try {
    const transcription = await soniox.stt.get(row.soniox_id);
    if (!transcription) {
      return c.json({ status: "processing", id });
    }

    console.log(`[status] id=${id}, soniox status: ${transcription.status}`);

    if (transcription.status === "completed") {
      // Fetch the actual transcript data (not included in get() by default)
      const transcript = await transcription.getTranscript();
      const text = transcript?.text ?? "";
      const tokens = transcript?.tokens ?? [];

      console.log(`[status] Transcription complete: ${tokens.length} tokens, ${text.length} chars`);

      await updateTranscriptComplete(id, text, tokens, row.audio_key);

      return c.json({ status: "completed", id });
    }

    if (transcription.status === "error") {
      console.error(`[status] Transcription error for id=${id}`);
      await updateTranscriptStatus(id, "error", "Transcription failed on Soniox");
      return c.json({ status: "error", id, error: "Transcription failed" });
    }

    // Still queued or processing
    return c.json({ status: transcription.status, id });
  } catch (err: any) {
    console.error(`[status] Error checking Soniox:`, err.message);
    return c.json({ status: "processing", id });
  }
});

app.put("/api/transcripts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const { text, tokens } = body;

  const row = await getTranscriptById(id);
  if (!row) return c.json({ error: "Not found" }, 404);

  const updated = await updateTranscript(id, text, tokens);

  // Regenerate original SRT from new tokens
  const newSrt = generateSRT(tokens, defaultProfile);
  await saveOriginalSrt(id, newSrt);

  console.log(`[update] Transcript id=${id} updated, ${tokens.length} tokens, SRT regenerated`);
  return c.json(updated);
});

app.post("/api/transcripts/:id/attach-audio", async (c) => {
  const id = Number(c.req.param("id"));
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return c.json({ error: "No file provided" }, 400);

  const row = await getTranscriptById(id);
  if (!row) return c.json({ error: "Not found" }, 404);

  const buffer = Buffer.from(await file.arrayBuffer());
  const audioKey = await uploadAudio(buffer, file.name, file.type || "audio/mpeg");
  await updateAudioKey(id, audioKey);

  console.log(`[attach-audio] Attached ${file.name} to transcript id=${id}, key=${audioKey}`);
  return c.json({ audioKey });
});

app.get("/api/transcripts/:id/playback", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getTranscriptById(id);
  if (!row || !row.audio_key) {
    return c.json({ error: "No audio found" }, 404);
  }
  const url = await getPlaybackUrl(row.audio_key);
  return c.json({ url });
});

app.get("/api/transcripts", async (c) => {
  const rows = await getTranscripts();
  console.log(`[transcripts] Returning ${rows.length} rows`);
  return c.json(rows);
});

app.get("/api/transcripts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getTranscriptById(id);
  if (!row) {
    console.log(`[transcript] Not found: id=${id}`);
    return c.json({ error: "Not found" }, 404);
  }
  console.log(`[transcript] Returning id=${id}`);
  return c.json(row);
});

app.get("/api/transcripts/:id/export", async (c) => {
  const id = Number(c.req.param("id"));
  const format = c.req.query("format") || "srt";

  const row = await getTranscriptById(id);
  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  const tokens = typeof row.tokens === "string" ? JSON.parse(row.tokens) : row.tokens ?? [];

  console.log(`[export] id=${id}, format=${format}, tokens=${tokens.length}`);

  let content: string;
  let contentType: string;
  let ext: string;

  if (format === "vtt") {
    content = generateVTT(tokens, defaultProfile);
    contentType = "text/vtt; charset=utf-8";
    ext = "vtt";
  } else {
    // Use saved original_srt if available, otherwise generate and save
    if (row.original_srt) {
      content = row.original_srt;
    } else {
      content = generateSRT(tokens, defaultProfile);
      await saveOriginalSrt(id, content);
      console.log(`[export] Saved original SRT to DB for id=${id}`);
    }
    contentType = "application/x-subrip; charset=utf-8";
    ext = "srt";
  }

  const filename = row.filename.replace(/\.[^.]+$/, "") + `.${ext}`;

  console.log(`[export] Generated ${format.toUpperCase()}: ${content.split("\n\n").length} segments`);

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

// Regenerate SRT from tokens (e.g. after generator logic changes)
app.post("/api/transcripts/:id/regenerate-srt", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getTranscriptById(id);
  if (!row) return c.json({ error: "Not found" }, 404);

  const tokens = typeof row.tokens === "string" ? JSON.parse(row.tokens) : row.tokens ?? [];
  const newSrt = generateSRT(tokens, defaultProfile);
  await saveOriginalSrt(id, newSrt);

  console.log(`[regenerate] Transcript id=${id} SRT regenerated, ${newSrt.split("\n\n").length} segments`);
  return c.json({ original_srt: newSrt });
});

// Get SRT content (for frontend display, not as file download)
app.get("/api/transcripts/:id/srt", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getTranscriptById(id);
  if (!row) return c.json({ error: "Not found" }, 404);

  const tokens = typeof row.tokens === "string" ? JSON.parse(row.tokens) : row.tokens ?? [];

  let originalSrt = row.original_srt;
  if (!originalSrt) {
    originalSrt = generateSRT(tokens, defaultProfile);
    await saveOriginalSrt(id, originalSrt);
  }

  // Merge legacy translated_srt into translations map
  let translations = typeof row.translations === "string" ? JSON.parse(row.translations) : row.translations ?? {};
  if (row.translated_srt && row.translated_lang && !translations[row.translated_lang]) {
    translations[row.translated_lang] = row.translated_srt;
  }

  return c.json({
    original_srt: originalSrt,
    translations,
  });
});

// Update original SRT (full text)
app.put("/api/transcripts/:id/original-srt", async (c) => {
  const id = Number(c.req.param("id"));
  const { srt } = await c.req.json();
  const row = await getTranscriptById(id);
  if (!row) return c.json({ error: "Not found" }, 404);

  await updateOriginalSrt(id, srt);
  console.log(`[srt-edit] Original SRT updated for id=${id}`);
  return c.json({ ok: true });
});

// Update translated SRT (full text)
app.put("/api/transcripts/:id/translated-srt", async (c) => {
  const id = Number(c.req.param("id"));
  const { srt, lang } = await c.req.json();
  const row = await getTranscriptById(id);
  if (!row) return c.json({ error: "Not found" }, 404);

  await updateTranslationLang(id, lang, srt);
  console.log(`[srt-edit] Translated SRT (${lang}) updated for id=${id}`);
  return c.json({ ok: true });
});

app.post("/api/transcripts/:id/translate", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const { targetLang, title } = body;

  if (!targetLang) {
    return c.json({ error: "targetLang is required" }, 400);
  }

  const row = await getTranscriptById(id);
  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  const tokens = typeof row.tokens === "string" ? JSON.parse(row.tokens) : row.tokens ?? [];
  const originalSRT = generateSRT(tokens, defaultProfile);

  console.log(`[translate] id=${id}, target=${targetLang}, subtitles=${originalSRT.split("\n\n").length}`);

  return streamSSE(c, async (stream) => {
    try {
      const result = await translateSRT(originalSRT, {
        sourceLang: row.source_lang || body.sourceLang || "auto-detect",
        targetLang,
        title: title || row.filename,
        contentType: row.content_type || "",
        description: row.content_description || "",
        maxCharsPerLine: defaultProfile.maxCharsPerLine,
        cachedGlossary: row.glossary || undefined,
        onBatch: async ({ batchIndex, totalBatches, translatedBlocks, startIndex }) => {
          const batchSrt = translatedBlocks
            .map((b, i) => `${startIndex + i + 1}\n${b.start} --> ${b.end}\n${b.text}`)
            .join("\n\n");

          await stream.writeSSE({
            event: "batch",
            data: JSON.stringify({ batchIndex, totalBatches, srt: batchSrt }),
          });
        },
      });

      // Save translation and glossary to DB
      await saveTranslation(id, result.srt, targetLang);
      if (result.glossary && !row.glossary) {
        await saveGlossary(id, result.glossary);
      }
      console.log(`[translate] Saved translation to DB for id=${id}, lang=${targetLang}`);

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ srt: result.srt, targetLang }),
      });
    } catch (err: any) {
      console.error(`[translate] Error:`, err.message);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: err.message || "Translation failed" }),
      });
    }
  });
});


const port = 3000;

initDb().then(() => {
  console.log("Database initialized");
  const server = serve({ fetch: app.fetch, port });
  server.setTimeout(600000); // 10 min for large file uploads
  console.log(`Server running on http://localhost:${port}`);
});
