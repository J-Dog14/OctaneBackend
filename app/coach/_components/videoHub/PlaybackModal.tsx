"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@mantine/core";
import css from "./videoHub.module.css";
import { clipLink, fmtDay, localToday, mediaSrc, VideoApiError, videoSend, type Video } from "./api";

type Props = {
  video: Video;
  onClose: () => void;
  /** Hide "View athlete videos" when already on that athlete's page. */
  showAthleteLink?: boolean;
  onChanged: (message: string) => void;
};

/** Play a clip; copy its link, download the original, edit its details or delete it. */
export function PlaybackModal({ video, onClose, showAthleteLink = true, onChanged }: Props) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: video.title, notes: video.notes, recordedDate: video.recordedDate, category: video.category });

  async function copy() {
    try {
      await navigator.clipboard.writeText(clipLink(video.id));
      setNotice("Clip link copied. Only coaches signed in to 8ctane Coach can open it.");
    } catch {
      setNotice("Could not copy automatically. Copy the address from your browser.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await videoSend("PATCH", `/api/coach/videos/${video.id}`, form);
      onChanged("Clip details saved.");
      onClose();
    } catch (err) {
      setError((err as VideoApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await videoSend("DELETE", `/api/coach/videos/${video.id}`);
      onChanged(`"${video.title}" was deleted. ${video.athleteName}'s profile and other clips are unchanged.`);
      onClose();
    } catch (err) {
      setError((err as VideoApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      opened
      onClose={() => !busy && onClose()}
      withCloseButton={false}
      centered
      size={820}
      classNames={{ content: `${css.vault} ${css.modal} ${css.modalContent}`, body: css.modalBody, overlay: css.modalOverlay }}
      aria-labelledby="video-clip-title"
    >
      <button type="button" className={css.close} aria-label="Close video" disabled={busy} onClick={onClose}>×</button>
      <div className={css.eyebrow}>
        {video.category} / {fmtDay(video.recordedDate)}
        {video.isBaseline && <span style={{ color: "#ef8b00" }}> · Baseline clip</span>}
      </div>
      <h2 id="video-clip-title">{video.title}</h2>
      <p style={{ margin: "6px 0 0" }}>
        {/* Athlete name → that athlete's Athlete Data page (Overview). */}
        <Link
          href={`/coach/athletes/${encodeURIComponent(video.athleteUuid)}`}
          className={css.athleteLink}
          title={`Open ${video.athleteName}'s athlete data`}
        >
          {video.athleteName} →
        </Link>
      </p>
      <video className={css.playbackVideo} controls autoPlay playsInline src={mediaSrc(video.id)} />

      {mode === "edit" ? (
        <form onSubmit={save}>
          <div className={css.formgrid}>
            <label>
              Clip title
              <input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>
              Date recorded
              <input required type="date" max={localToday()} value={form.recordedDate} onChange={(e) => setForm({ ...form, recordedDate: e.target.value })} />
            </label>
            <label>
              Discipline
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Video["category"] })}>
                <option>Pitching</option>
                <option>Hitting</option>
              </select>
            </label>
          </div>
          <label>
            Coaching notes
            <textarea maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          {form.recordedDate !== video.recordedDate && <p className={css.hint}>Changing the date can change which clip is the athlete&apos;s baseline (always the oldest).</p>}
          {error && <p className={css.error} role="alert">{error}</p>}
          <div className={css.shareactions}>
            <button className={css.primary} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" className={css.secondary} onClick={() => setMode("view")} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : mode === "delete" ? (
        <div>
          <div className={css.replaceBox} role="alert">
            <strong>Delete &ldquo;{video.title}&rdquo;?</strong> The file is removed for good. {video.athleteName} and their other clips are not affected.
            {video.isBaseline && <> This is the baseline clip, so the next-oldest clip becomes the baseline.</>}
          </div>
          {error && <p className={css.error} role="alert">{error}</p>}
          <div className={css.shareactions}>
            <button type="button" className={css.danger} onClick={() => void remove()} disabled={busy}>{busy ? "Deleting…" : "Delete clip"}</button>
            <button type="button" className={css.secondary} onClick={() => setMode("view")} disabled={busy}>Keep it</button>
          </div>
        </div>
      ) : (
        <>
          <p className={css.notes}>{video.notes || "No coaching notes for this clip."}</p>
          <div className={css.shareactions}>
            {showAthleteLink && (
              <Link className={css.secondary} href={`/coach/athletes/${encodeURIComponent(video.athleteUuid)}?tab=videos`}>
                View athlete videos
              </Link>
            )}
            <button type="button" className={css.secondary} onClick={() => void copy()}>↗ Copy clip link</button>
            <a className={css.primary} href={mediaSrc(video.id, true)}>↓ Download original</a>
            <button type="button" className={css.textbutton} onClick={() => setMode("edit")}>Edit details</button>
            <button type="button" className={css.textbutton} style={{ color: "#ffb4a7" }} onClick={() => setMode("delete")}>Delete clip</button>
          </div>
          {notice && <p className={css.notice} role="status" style={{ marginTop: 14 }}>{notice}</p>}
          <small className={css.hint}>
            If this format won&apos;t play in your browser, download the original to watch it. Uploaded by {video.uploadedByName ?? "a coach"}.
          </small>
        </>
      )}
    </Modal>
  );
}
