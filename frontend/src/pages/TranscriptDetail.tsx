import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import AudioPlayer from "../components/AudioPlayer";

interface Token {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
  confidence?: number;
  language?: string | null;
  is_audio_event?: boolean | null;
  translation_status?: string | null;
}

interface SpeakerBlock {
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
  tokenStart: number; // index into tokens array
  tokenEnd: number;
}

interface SrtSegment {
  index: number;
  timestamp: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

interface Transcript {
  id: number;
  filename: string;
  text: string;
  tokens: Token[] | string;
  audio_key: string | null;
  source_lang: string | null;
  content_type: string | null;
  content_description: string | null;
  original_srt: string | null;
  translated_srt: string | null;
  translated_lang: string | null;
  status: string | null;
  created_at: string;
}

const TRANSLATE_LANGS = [
  { code: "en", name: "English" },
  { code: "sl", name: "Slovenian" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "cs", name: "Czech" },
  { code: "hr", name: "Croatian" },
  { code: "sr", name: "Serbian" },
  { code: "bs", name: "Bosnian" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "tr", name: "Turkish" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "fi", name: "Finnish" },
  { code: "ro", name: "Romanian" },
  { code: "hu", name: "Hungarian" },
  { code: "bg", name: "Bulgarian" },
  { code: "sk", name: "Slovak" },
];

function groupBySpeaker(tokens: Token[]): SpeakerBlock[] {
  if (!tokens.length) return [];
  const blocks: SpeakerBlock[] = [];
  let cur: SpeakerBlock = {
    speaker: tokens[0].speaker ?? "?",
    text: tokens[0].text,
    start_ms: tokens[0].start_ms,
    end_ms: tokens[0].end_ms,
    tokenStart: 0,
    tokenEnd: 1,
  };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const sp = t.speaker ?? "?";
    if (sp === cur.speaker) {
      cur.text += t.text;
      cur.end_ms = t.end_ms;
      cur.tokenEnd = i + 1;
    } else {
      blocks.push(cur);
      cur = { speaker: sp, text: t.text, start_ms: t.start_ms, end_ms: t.end_ms, tokenStart: i, tokenEnd: i + 1 };
    }
  }
  blocks.push(cur);
  return blocks;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function EditableBlock({
  block,
  isEditing,
  isActive,
  onStartEdit,
  onSave,
  onCancel,
  onSeek,
}: {
  block: SpeakerBlock;
  isEditing: boolean;
  isActive: boolean;
  onStartEdit: () => void;
  onSave: (tokenStart: number, newText: string) => void;
  onCancel: () => void;
  onSeek: (ms: number) => void;
}) {
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditText(block.text.trim());
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }
      }, 0);
    }
  }, [isEditing]);

  const handleSave = () => {
    onSave(block.tokenStart, editText);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
  };

  return (
    <div className={`speaker-block s-${block.speaker} ${isEditing ? "editing" : ""} ${isActive ? "active" : ""}`}>
      <div className="speaker-header">
        <span className="speaker-name">Speaker {block.speaker}</span>
        <span className="speaker-time clickable" onClick={() => onSeek(block.start_ms)}>
          {fmt(block.start_ms)} – {fmt(block.end_ms)}
        </span>
      </div>
      {isEditing ? (
        <div className="edit-area">
          <textarea
            ref={textareaRef}
            className="edit-textarea"
            value={editText}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />
          <div className="edit-actions">
            <button className="edit-save" onClick={handleSave}>Save</button>
            <button className="edit-cancel" onClick={onCancel}>Cancel</button>
            <span className="edit-hint">Ctrl+Enter to save, Esc to cancel</span>
          </div>
        </div>
      ) : (
        <p className="speaker-text editable" onClick={onStartEdit}>{block.text.trim()}</p>
      )}
    </div>
  );
}

function DropdownMenu({ items }: { items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="dropdown-menu" ref={ref}>
      <button className="dropdown-trigger" onClick={() => setOpen(!open)} title="More options">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="dropdown-items">
          {items.map((item, i) => (
            <button
              key={i}
              className="dropdown-item"
              onClick={() => { item.onClick(); setOpen(false); }}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function parseSrt(srt: string): SrtSegment[] {
  return srt.split(/\n\n+/).filter(Boolean).map((block) => {
    const lines = block.trim().split("\n");
    if (lines.length < 3) return null;
    const index = parseInt(lines[0]);
    const timestamp = lines[1];
    const text = lines.slice(2).join("\n");
    const timeParts = timestamp.split(" --> ");
    if (timeParts.length !== 2) return null;
    const parseTs = (ts: string) => {
      const [h, m, rest] = ts.trim().split(":");
      const [s, ms] = rest.split(",");
      return (+h * 3600 + +m * 60 + +s) * 1000 + +ms;
    };
    return { index, timestamp, text, start_ms: parseTs(timeParts[0]), end_ms: parseTs(timeParts[1]) };
  }).filter(Boolean) as SrtSegment[];
}

function rebuildSrt(segments: SrtSegment[]): string {
  return segments.map((seg, i) =>
    `${i + 1}\n${seg.timestamp}\n${seg.text}`
  ).join("\n\n") + "\n";
}

function EditableSrtSegment({
  segment,
  isEditing,
  isActive,
  onStartEdit,
  onSave,
  onCancel,
  onSeek,
}: {
  segment: SrtSegment;
  isEditing: boolean;
  isActive: boolean;
  onStartEdit: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  onSeek: (ms: number) => void;
}) {
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditText(segment.text);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }
      }, 0);
    }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(editText);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
  };

  return (
    <div className={`srt-segment ${isEditing ? "editing" : ""} ${isActive ? "active" : ""}`}>
      <div className="srt-segment-header">
        <span className="srt-segment-idx">{segment.index}</span>
        <span className="srt-segment-ts clickable" onClick={() => onSeek(segment.start_ms)}>
          {segment.timestamp}
        </span>
      </div>
      {isEditing ? (
        <div className="edit-area">
          <textarea
            ref={textareaRef}
            className="edit-textarea"
            value={editText}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />
          <div className="edit-actions">
            <button className="edit-save" onClick={() => onSave(editText)}>Save</button>
            <button className="edit-cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="srt-segment-text editable" onClick={onStartEdit}>{segment.text}</p>
      )}
    </div>
  );
}

export default function TranscriptDetail() {
  const { id } = useParams();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);

  const [originalSrt, setOriginalSrt] = useState<string | null>(null);
  const [srtLoading, setSrtLoading] = useState(false);
  const [editingOrigIdx, setEditingOrigIdx] = useState<number | null>(null);
  const [editingTransIdx, setEditingTransIdx] = useState<number | null>(null);

  // Playback
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement>(null);

  // Translation - support multiple languages
  const [targetLang, setTargetLang] = useState("en");
  const [translations, setTranslations] = useState<Record<string, string>>({}); // lang -> srt
  const [selectedTransLang, setSelectedTransLang] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [subtitleSource, setSubtitleSource] = useState<"original" | "translated">("original");

  const translatedSrt = selectedTransLang ? translations[selectedTransLang] || null : null;

  const fetchSrt = useCallback(() => {
    setSrtLoading(true);
    fetch(`/api/transcripts/${id}/srt`)
      .then((res) => res.json())
      .then((data) => {
        setOriginalSrt(data.original_srt);
        if (data.translations && Object.keys(data.translations).length > 0) {
          setTranslations(data.translations);
          if (!selectedTransLang) {
            setSelectedTransLang(Object.keys(data.translations)[0]);
          }
        }
      })
      .finally(() => setSrtLoading(false));
  }, [id]);

  const loadTranscript = useCallback(() => {
    fetch(`/api/transcripts/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Transcript not found");
        return res.json();
      })
      .then((data: Transcript) => {
        setTranscript(data);

        if (data.status === "processing" || data.status === "queued") {
          setProcessingStatus(data.status);
          setLoading(false);
          return;
        }

        setProcessingStatus(null);
        const t: Token[] = typeof data.tokens === "string" ? JSON.parse(data.tokens) : data.tokens ?? [];
        setTokens(t);
        const trans = typeof data.translations === "string" ? JSON.parse(data.translations) : data.translations ?? {};
        if (data.translated_srt && data.translated_lang && !trans[data.translated_lang]) {
          trans[data.translated_lang] = data.translated_srt;
        }
        if (Object.keys(trans).length > 0) {
          setTranslations(trans);
          setSelectedTransLang(Object.keys(trans)[0]);
        }
        const ext = data.filename.split(".").pop()?.toLowerCase() || "";
        setIsVideo(["mp4", "webm", "mov", "avi", "mkv"].includes(ext));

        fetchSrt();
        fetch(`/api/transcripts/${id}/playback`)
          .then((res) => res.ok ? res.json() : null)
          .then((data) => { if (data?.url) setMediaUrl(data.url); });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, fetchSrt]);

  useEffect(() => {
    loadTranscript();
  }, [loadTranscript]);

  // Poll for processing status
  useEffect(() => {
    if (!processingStatus) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/transcripts/${id}/status`);
        const data = await res.json();

        if (data.status === "completed") {
          setProcessingStatus(null);
          loadTranscript();
          clearInterval(interval);
        } else if (data.status === "error") {
          setProcessingStatus(null);
          setError(data.error || "Transcription failed");
          clearInterval(interval);
        }
      } catch {}
    }, 4000);

    return () => clearInterval(interval);
  }, [processingStatus, id, loadTranscript]);

  const handleBlockEdit = async (tokenStart: number, newText: string) => {
    setEditingBlockIdx(null);
    const blocks = groupBySpeaker(tokens);
    const block = blocks.find((b) => b.tokenStart === tokenStart);
    if (!block) return;

    const newTokens = [...tokens];
    const firstToken = newTokens[block.tokenStart];
    const lastToken = newTokens[block.tokenEnd - 1];

    const replacementToken: Token = {
      text: " " + newText,
      start_ms: firstToken.start_ms,
      end_ms: lastToken.end_ms,
      speaker: firstToken.speaker,
    };

    newTokens.splice(block.tokenStart, block.tokenEnd - block.tokenStart, replacementToken);
    setTokens(newTokens);

    const fullText = newTokens.map((t) => t.text).join("").trim();

    await fetch(`/api/transcripts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: fullText, tokens: newTokens }),
    });

    fetchSrt();
  };

  const handleOriginalSrtEdit = async (segIdx: number, newText: string) => {
    setEditingOrigIdx(null);
    if (!originalSrt) return;
    const segments = parseSrt(originalSrt);
    segments[segIdx] = { ...segments[segIdx], text: newText };
    const newSrt = rebuildSrt(segments);
    setOriginalSrt(newSrt);

    await fetch(`/api/transcripts/${id}/original-srt`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ srt: newSrt }),
    });
  };

  const handleTranslatedSrtEdit = async (segIdx: number, newText: string) => {
    setEditingTransIdx(null);
    if (!selectedTransLang || !translatedSrt) return;
    const segments = parseSrt(translatedSrt);
    segments[segIdx] = { ...segments[segIdx], text: newText };
    const newSrt = rebuildSrt(segments);
    setTranslations((prev) => ({ ...prev, [selectedTransLang]: newSrt }));

    await fetch(`/api/transcripts/${id}/translated-srt`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ srt: newSrt, lang: selectedTransLang }),
    });
  };

  const handleExport = async (format: "srt" | "vtt") => {
    const res = await fetch(`/api/transcripts/${id}/export?format=${format}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1]
      || `transcript.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRegenerateSrt = async () => {
    const res = await fetch(`/api/transcripts/${id}/regenerate-srt`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    setOriginalSrt(data.original_srt);
  };

  const [translateProgress, setTranslateProgress] = useState<{ batch: number; total: number } | null>(null);

  const handleTranslate = async () => {
    setTranslating(true);
    setTranslateError(null);
    setTranslateProgress(null);
    setTranslations((prev) => ({ ...prev, [targetLang]: "" }));
    setSelectedTransLang(targetLang);

    try {
      const res = await fetch(`/api/transcripts/${id}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang, title: transcript?.filename }),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const err = JSON.parse(text);
          throw new Error(err.error || "Translation failed");
        } catch {
          throw new Error("Translation failed");
        }
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        let dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          } else if (line === "") {
            if (dataLines.length > 0) {
              const data = JSON.parse(dataLines.join("\n"));

              if (eventType === "batch") {
                setTranslateProgress({ batch: data.batchIndex + 1, total: data.totalBatches });
                setTranslations((prev) => {
                  const existing = prev[targetLang] || "";
                  const separator = existing ? "\n\n" : "";
                  return { ...prev, [targetLang]: existing + separator + data.srt };
                });
              } else if (eventType === "done") {
                setTranslations((prev) => ({ ...prev, [data.targetLang]: data.srt }));
                setSelectedTransLang(data.targetLang);
              } else if (eventType === "error") {
                throw new Error(data.error);
              }
            }
            eventType = "";
            dataLines = [];
          }
        }
      }
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setTranslating(false);
      setTranslateProgress(null);
    }
  };

  const handleDownloadTranslated = () => {
    if (!translatedSrt || !selectedTransLang) return;
    const blob = new Blob([translatedSrt], { type: "application/x-subrip; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const name = transcript?.filename.replace(/\.[^.]+$/, "") || "transcript";
    a.download = `${name}_${selectedTransLang}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="main-content">
        <div className="home-center">
          <div className="status-bar"><div className="spinner" /><span className="status-text">Loading...</span></div>
        </div>
      </div>
    );
  }

  if (error || !transcript) {
    return (
      <div className="main-content">
        <div className="home-center">
          <p className="error-msg">{error || "Transcript not found"}</p>
        </div>
      </div>
    );
  }

  if (processingStatus) {
    return (
      <div className="main-content">
        <div className="home-center">
          <div className="processing-card">
            <div className="spinner spinner-lg" />
            <h2 className="processing-title">Transcribing...</h2>
            <p className="processing-filename">{transcript.filename}</p>
            <p className="processing-status">
              {processingStatus === "queued" ? "Queued — waiting for Soniox..." : "Processing audio with Soniox..."}
            </p>
            <p className="processing-hint">This may take a few minutes for large files. You can leave this page and come back.</p>
          </div>
        </div>
      </div>
    );
  }

  const hasSpeakers = tokens.some((t) => t.speaker);
  const blocks = hasSpeakers ? groupBySpeaker(tokens) : [];
  const transLangName = TRANSLATE_LANGS.find((l) => l.code === selectedTransLang)?.name || selectedTransLang;
  const availableTransLangs = Object.keys(translations);

  // Find active block based on current playback time
  const activeBlockIdx = blocks.findIndex(
    (b) => currentTime >= b.start_ms && currentTime < b.end_ms
  );

  const seekTo = (ms: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = ms / 1000;
    }
  };

  // Parse SRTs for segments
  const originalSegments = originalSrt ? parseSrt(originalSrt) : [];
  const translatedSegments = translatedSrt ? parseSrt(translatedSrt) : [];

  // Active segment based on playback
  const activeOrigSegIdx = originalSegments.findIndex(
    (s) => currentTime >= s.start_ms && currentTime < s.end_ms
  );
  const activeTransSegIdx = translatedSegments.findIndex(
    (s) => currentTime >= s.start_ms && currentTime < s.end_ms
  );

  const displaySegments = subtitleSource === "translated" && translatedSegments.length > 0
    ? translatedSegments : originalSegments;
  const currentSub = displaySegments.find((s) => currentTime >= s.start_ms && currentTime < s.end_ms);

  return (
    <div className="main-content detail-page">
      <div className="detail-layout">
        {/* LEFT: video + player + transcript */}
        <div className="detail-left">
          {/* Black screen with subtitles */}
          <div className="subtitle-screen">
            {availableTransLangs.length > 0 && (
              <div className="subtitle-source-toggle">
                <button
                  className={`sub-src-btn ${subtitleSource === "original" ? "active" : ""}`}
                  onClick={() => setSubtitleSource("original")}
                >Original</button>
                <button
                  className={`sub-src-btn ${subtitleSource === "translated" ? "active" : ""}`}
                  onClick={() => setSubtitleSource("translated")}
                >{transLangName}</button>
              </div>
            )}
            <div className="subtitle-screen-text">
              {currentSub ? currentSub.text : ""}
            </div>
          </div>

          {/* Audio player */}
          {mediaUrl && (
            <div className="screen-audio">
              <AudioPlayer
                src={mediaUrl}
                onTimeUpdate={(ms) => setCurrentTime(ms)}
                mediaRef={mediaRef}
              />
            </div>
          )}

          {/* Info bar */}
          <div className="info-bar">
            <h1 className="info-title">{transcript.filename}</h1>
          </div>

          {/* Transcript */}
          <div className="transcript-scroll">
            {hasSpeakers ? (
              <div className="transcript-blocks">
                {blocks.map((block, i) => (
                  <EditableBlock
                    key={`${block.tokenStart}-${block.speaker}`}
                    block={block}
                    isEditing={editingBlockIdx === i}
                    isActive={activeBlockIdx === i}
                    onStartEdit={() => setEditingBlockIdx(i)}
                    onSave={handleBlockEdit}
                    onCancel={() => setEditingBlockIdx(null)}
                    onSeek={seekTo}
                  />
                ))}
              </div>
            ) : (
              <div className="transcript-text">{tokens.map((t) => t.text).join("").trim()}</div>
            )}
          </div>
        </div>

        {/* RIGHT: SRT panels side by side, synced rows */}
        <div className="detail-right">
          <div className="srt-header-row">
            <div className="srt-panel-header">
              <span>Original SRT</span>
              <DropdownMenu items={[
                { label: "Regenerate SRT", onClick: handleRegenerateSrt },
                { label: "Export SRT", onClick: () => handleExport("srt") },
                { label: "Export VTT", onClick: () => handleExport("vtt") },
              ]} />
            </div>
            <div className="srt-panel-header srt-panel-header--stacked">
              <div className="srt-header-top">
                <div className="srt-header-left">
                  <span>Translated</span>
                  {availableTransLangs.length > 0 && (
                    <select
                      className="srt-lang-select"
                      value={selectedTransLang || ""}
                      onChange={(e) => setSelectedTransLang(e.target.value)}
                    >
                      {availableTransLangs.map((lang) => {
                        const name = TRANSLATE_LANGS.find((l) => l.code === lang)?.name || lang;
                        return <option key={lang} value={lang}>{name}</option>;
                      })}
                    </select>
                  )}
                </div>
                <DropdownMenu items={[
                  { label: "Export SRT", onClick: handleDownloadTranslated, disabled: !translatedSrt },
                ]} />
              </div>
              <div className="srt-header-bottom">
                <span className="header-source-lang">
                  {TRANSLATE_LANGS.find((l) => l.code === transcript.source_lang)?.name || transcript.source_lang || "Auto"}
                </span>
                <span className="header-arrow">→</span>
                <select className="srt-lang-select" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                  {TRANSLATE_LANGS.filter((l) => l.code !== transcript.source_lang).map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
                <button className="header-translate-btn" onClick={handleTranslate} disabled={translating || targetLang === transcript.source_lang}>
                  {translating ? "..." : "Go"}
                </button>
              </div>
            </div>
          </div>
          {translateError && <p className="error-msg" style={{ margin: "0", padding: "4px 12px", fontSize: "12px" }}>{translateError}</p>}
          {translating && (
            <div style={{ padding: "4px 12px", borderBottom: "1px solid var(--border)" }}>
              <div className="status-bar"><div className="spinner" /><span className="status-text">{translateProgress ? `Translating ${translateProgress.batch}/${translateProgress.total}...` : "Preparing translation..."}</span></div>
            </div>
          )}
          <div className="srt-scroll">
            {srtLoading ? (
              <div style={{ padding: 12 }}>
                <div className="status-bar"><div className="spinner" /><span className="status-text">Generating...</span></div>
              </div>
            ) : (
              <div className="srt-paired-segments">
                {originalSegments.map((seg, i) => {
                  const transSeg = translatedSegments[i] || null;
                  const isActiveRow = activeOrigSegIdx === i;
                  return (
                    <div key={`row-${i}`} className={`srt-paired-row ${isActiveRow ? "active" : ""}`}>
                      <div className="srt-paired-cell">
                        <EditableSrtSegment
                          segment={seg}
                          isEditing={editingOrigIdx === i}
                          isActive={false}
                          onStartEdit={() => { setEditingOrigIdx(i); setEditingTransIdx(null); }}
                          onSave={(text) => handleOriginalSrtEdit(i, text)}
                          onCancel={() => setEditingOrigIdx(null)}
                          onSeek={seekTo}
                        />
                      </div>
                      <div className="srt-paired-cell">
                        {transSeg ? (
                          <EditableSrtSegment
                            segment={transSeg}
                            isEditing={editingTransIdx === i}
                            isActive={false}
                            onStartEdit={() => { setEditingTransIdx(i); setEditingOrigIdx(null); }}
                            onSave={(text) => handleTranslatedSrtEdit(i, text)}
                            onCancel={() => setEditingTransIdx(null)}
                            onSeek={seekTo}
                          />
                        ) : (
                          <div className="srt-segment-empty" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
