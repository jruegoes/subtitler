import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Home from "./pages/Home";
import TranscriptList from "./pages/TranscriptList";
import TranscriptDetail from "./pages/TranscriptDetail";
import "./App.css";

interface HistoryItem {
  id: number;
  filename: string;
  created_at: string;
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/transcripts");
      if (res.ok) setHistory(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchHistory(); }, [location.pathname]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">Subtitler</span>
        <button className="sidebar-new-btn" onClick={() => navigate("/")} title="New transcript">
          +
        </button>
      </div>

      <nav className="sidebar-nav">
        <Link
          to="/"
          className={`sidebar-nav-item ${location.pathname === "/" ? "active" : ""}`}
        >
          <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Transcript
        </Link>
        <Link
          to="/transcripts"
          className={`sidebar-nav-item ${location.pathname === "/transcripts" ? "active" : ""}`}
        >
          <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
          All Transcripts
        </Link>
      </nav>

      <div className="sidebar-history">
        {history.length > 0 && (
          <div className="sidebar-section-label">Recent</div>
        )}
        {history.slice(0, 20).map((item: any) => (
          <Link
            key={item.id}
            to={`/transcripts/${item.id}`}
            className={`sidebar-history-item ${location.pathname === `/transcripts/${item.id}` ? "active" : ""} ${item.status === "processing" ? "processing" : ""}`}
          >
            {item.status === "processing" && <span className="sidebar-spinner" />}
            {item.filename}
          </Link>
        ))}
      </div>
    </aside>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/transcripts" element={<TranscriptList />} />
            <Route path="/transcripts/:id" element={<TranscriptDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
