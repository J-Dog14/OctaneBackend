"use client";

import { useEffect, useRef, useState } from "react";
import css from "./videoHub.module.css";
import { fmtDay, fmtSize, mediaSrc, slotOrder, type Video } from "./api";

/** First-frame preview. Only asks for the file once the card scrolls into view. */
export function LazyPreview({ id }: { id: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return <video ref={ref} preload="metadata" muted playsInline src={visible ? `${mediaSrc(id)}#t=0.1` : undefined} aria-hidden="true" tabIndex={-1} />;
}

export function VideoCard({ video, showAthlete = true, onOpen }: { video: Video; showAthlete?: boolean; onOpen: (v: Video) => void }) {
  return (
    <button type="button" className={css.clip} onClick={() => onOpen(video)} aria-label={`Play ${video.title}${showAthlete ? `, ${video.athleteName}` : ""}`}>
      <div className={css.thumb}>
        <LazyPreview id={video.id} />
        <span className={css.play} aria-hidden="true">▶</span>
        <span className={css.badge}>{video.category}</span>
        {video.isBaseline && <span className={css.baseline} title="Oldest clip: kept as the reference">Baseline</span>}
      </div>
      <div className={css.clipbody}>
        <h3>{video.title}</h3>
        {showAthlete && <p>{video.athleteName}</p>}
        <footer style={showAthlete ? undefined : { marginTop: 14 }}>
          <span>{fmtDay(video.recordedDate)}</span>
          <span>{fmtSize(video.sizeBytes)}</span>
        </footer>
      </div>
    </button>
  );
}

/**
 * The cap, made visible: slot 1 is the baseline (oldest clip), slots 2..limit the most
 * recent. Empty slots say what the next upload will do.
 */
export function Slots({ videos, limit, onOpen, onAdd, large = false }: { videos: Video[]; limit: number; onOpen: (v: Video) => void; onAdd?: () => void; large?: boolean }) {
  const ordered = slotOrder(videos);
  const cells = Array.from({ length: Math.max(limit, ordered.length) }, (_, i) => ordered[i] ?? null);
  return (
    <div className={`${css.slots} ${large ? css.slotsLarge : ""}`}>
      {cells.map((v, i) =>
        v ? (
          <button type="button" key={v.id} className={css.slot} onClick={() => onOpen(v)} aria-label={`Play ${v.title}`}>
            <div className={css.thumb}>
              <LazyPreview id={v.id} />
              <span className={css.play} aria-hidden="true">▶</span>
              <span className={css.badge}>{v.category}</span>
            </div>
            <div className={css.slotBody}>
              <div className={`${css.slotLabel} ${v.isBaseline ? css.slotLabelBase : ""}`}>{v.isBaseline ? "Baseline" : `Recent ${i}`}</div>
              <strong>{v.title}</strong>
              <span>{fmtDay(v.recordedDate)}</span>
            </div>
          </button>
        ) : (
          <button type="button" key={`empty-${i}`} className={`${css.slot} ${css.slotEmpty}`} onClick={onAdd} disabled={!onAdd}>
            {i === 0 ? "Baseline: the first clip becomes the reference" : "Open slot"}
          </button>
        ),
      )}
    </div>
  );
}
