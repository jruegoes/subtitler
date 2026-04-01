import { useState, useRef, useEffect, useCallback } from "react";

interface AudioPlayerProps {
  src: string;
  onTimeUpdate: (ms: number) => void;
  mediaRef: React.RefObject<HTMLAudioElement | HTMLVideoElement>;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({ src, onTimeUpdate, mediaRef }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Sync external ref
  useEffect(() => {
    if (mediaRef && audioRef.current) {
      (mediaRef as React.MutableRefObject<HTMLAudioElement>).current = audioRef.current;
    }
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || dragging) return;
    const ms = audio.currentTime * 1000;
    setCurrentTime(ms);
    onTimeUpdate(ms);
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (audio) setDuration(audio.duration * 1000);
  };

  const handleEnded = () => setPlaying(false);

  const seekTo = useCallback((clientX: number) => {
    const bar = progressRef.current;
    const audio = audioRef.current;
    if (!bar || !audio) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = pct * (audio.duration || 0);
    audio.currentTime = newTime;
    setCurrentTime(newTime * 1000);
    onTimeUpdate(newTime * 1000);
  }, [onTimeUpdate]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    seekTo(e.clientX);

    const handleMove = (ev: MouseEvent) => seekTo(ev.clientX);
    const handleUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const skip = (sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + sec));
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="custom-player">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <button className="cp-btn" onClick={() => skip(-10)} title="Back 10s">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>

      <button className="cp-btn cp-play" onClick={togglePlay} title={playing ? "Pause" : "Play"}>
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,3 20,12 6,21" />
          </svg>
        )}
      </button>

      <button className="cp-btn" onClick={() => skip(10)} title="Forward 10s">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>

      <span className="cp-time">{formatTime(currentTime)}</span>

      <div className="cp-progress" ref={progressRef} onMouseDown={handleMouseDown}>
        <div className="cp-progress-bg" />
        <div className="cp-progress-fill" style={{ width: `${progress}%` }} />
        <div className="cp-progress-thumb" style={{ left: `${progress}%` }} />
      </div>

      <span className="cp-time">{formatTime(duration)}</span>
    </div>
  );
}
