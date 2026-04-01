import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

interface SavedTranscript {
  id: number;
  filename: string;
  text: string;
  created_at: string;
}

export default function TranscriptList() {
  const [transcripts, setTranscripts] = useState<SavedTranscript[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/transcripts")
      .then((res) => res.json())
      .then((data) => setTranscripts(data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="main-content">
      <div className="list-scroll">
        <div className="list-inner">
          <h1 className="list-heading">All Transcripts</h1>

          {loading && (
            <div className="status-bar">
              <div className="spinner" />
              <span className="status-text">Loading...</span>
            </div>
          )}

          {!loading && transcripts.length === 0 && (
            <p className="list-empty">No transcripts yet. Upload an audio file to get started.</p>
          )}

          {transcripts.map((item) => (
            <Link key={item.id} to={`/transcripts/${item.id}`} className="list-card">
              <div className="list-card-top">
                <span className="list-card-name">{item.filename}</span>
                <span className="list-card-date">
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="list-card-preview">
                {item.text.slice(0, 150)}{item.text.length > 150 ? "..." : ""}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
