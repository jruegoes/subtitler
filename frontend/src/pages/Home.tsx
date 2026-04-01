import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

const LANGUAGES = [
  { code: "", name: "Auto-detect" },
  { code: "sl", name: "Slovenian" },
  { code: "en", name: "English" },
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
  { code: "bg", name: "Bulgarian" },
  { code: "mk", name: "Macedonian" },
  { code: "ro", name: "Romanian" },
  { code: "hu", name: "Hungarian" },
  { code: "sk", name: "Slovak" },
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
  { code: "el", name: "Greek" },
  { code: "sq", name: "Albanian" },
  { code: "af", name: "Afrikaans" },
  { code: "az", name: "Azerbaijani" },
  { code: "eu", name: "Basque" },
  { code: "be", name: "Belarusian" },
  { code: "bn", name: "Bengali" },
  { code: "ca", name: "Catalan" },
  { code: "et", name: "Estonian" },
  { code: "gl", name: "Galician" },
  { code: "gu", name: "Gujarati" },
  { code: "he", name: "Hebrew" },
  { code: "id", name: "Indonesian" },
  { code: "kn", name: "Kannada" },
  { code: "kk", name: "Kazakh" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "ms", name: "Malay" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "fa", name: "Persian" },
  { code: "pa", name: "Punjabi" },
  { code: "sw", name: "Swahili" },
  { code: "tl", name: "Tagalog" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "th", name: "Thai" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" },
  { code: "cy", name: "Welsh" },
];

const CONTENT_TYPES = [
  { value: "", label: "Not specified" },
  { value: "podcast", label: "Podcast" },
  { value: "podcast_clip", label: "Podcast Clip" },
  { value: "movie", label: "Movie" },
  { value: "documentary", label: "Documentary" },
  { value: "short_form", label: "Short Form Video" },
  { value: "interview", label: "Interview" },
  { value: "news", label: "News" },
  { value: "lecture", label: "Lecture / Talk" },
  { value: "music_video", label: "Music Video" },
];

export default function Home() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceLang, setSourceLang] = useState("sl");
  const [contentType, setContentType] = useState("");
  const [description, setDescription] = useState("");

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("options", JSON.stringify({
        source_lang: sourceLang,
        content_type: contentType,
        description: description,
      }));

      const res = await fetch("/api/transcribe", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Transcription failed");
      }
      const data = await res.json();
      navigate(`/transcripts/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="main-content">
      <div className="home-center">
        <h1 className="home-heading">What would you like to transcribe?</h1>

        {/* Options row */}
        <div className="home-options-row">
          <div className="home-option">
            <label className="home-lang-label">Audio language</label>
            <select
              className="home-lang-select"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="home-option">
            <label className="home-lang-label">Content type</label>
            <select
              className="home-lang-select"
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Description */}
        <textarea
          className="home-description"
          placeholder="Describe the content to help with translation (names, topics, context)..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />

        {/* Upload bar */}
        <div className="upload-bar">
          <button
            className="upload-bar-attach"
            onClick={() => fileRef.current?.click()}
            title="Attach audio file"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="upload-bar-file">
            <span className={`upload-bar-label ${file ? "has-file" : ""}`}>
              {file ? file.name : "Attach an audio or video file..."}
            </span>
          </div>
          <button
            className="upload-bar-submit"
            disabled={!file || loading}
            onClick={handleUpload}
            title="Transcribe"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94l18.04-8.01a.75.75 0 000-1.36L3.478 2.405z" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="status-bar">
            <div className="spinner" />
            <span className="status-text">Transcribing with Soniox...</span>
          </div>
        )}

        {error && <p className="error-msg">{error}</p>}
      </div>
    </div>
  );
}
