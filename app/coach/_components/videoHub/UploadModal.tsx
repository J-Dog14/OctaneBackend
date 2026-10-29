"use client";

import { useRef, useState } from "react";
import { Modal } from "@mantine/core";
import { videoMime } from "@/lib/videos/rules";
import { AthleteSearchSelect } from "../AthleteSearchSelect";
import css from "./videoHub.module.css";
import { fmtDay, fmtSize, localToday, putToStorage, VideoApiError, videoSend, type ReplaceInfo, type StartResponse } from "./api";

type Athlete = { uuid: string; name: string };
type Phase = { kind: "form" } | { kind: "confirm"; replaces: ReplaceInfo[]; stage: "start" | "complete" } | { kind: "uploading"; pct: number } | { kind: "saving" };

type Props = {
  opened: boolean;
  onClose: () => void;
  /** Uploading from an athlete's page: athlete is fixed. */
  lockedAthlete?: Athlete | null;
  limit: number;
  maxBytes: number;
  onSaved: (message: string, athleteUuid: string) => void;
};

/**
 * Upload a clip: Photos or Files on iPhone (plain <input type="file" accept="video/*">), then
 * athlete, discipline, title, date, notes. At the cap the coach is shown which clip rotates
 * out and confirms before anything is saved. Mount it only while open (fresh state each time).
 */
export function UploadModal({ opened, onClose, lockedAthlete, limit, maxBytes, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [athlete, setAthlete] = useState<Athlete | null>(lockedAthlete ?? null);
  const [category, setCategory] = useState("Pitching");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  // Idempotency key: one per file + athlete, reused by retries so a lost response never duplicates a clip.
  const clientKey = useRef<string | null>(null);
  const keyFor = () => (clientKey.current ??= crypto.randomUUID());
  const pendingId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = phase.kind === "uploading" || phase.kind === "saving";
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  // A different file or athlete is a different upload.
  const newKey = () => {
    clientKey.current = null;
    pendingId.current = null;
  };

  function close() {
    if (busy) return;
    if (pendingId.current) void videoSend("POST", `/api/coach/videos/${pendingId.current}/cancel`).catch(() => {});
    abort.current?.abort();
    onClose();
  }

  async function finish(id: string, confirmIds: string[]) {
    setPhase({ kind: "saving" });
    try {
      const done = await videoSend<{ id: string; rotated: ReplaceInfo[] }>("POST", `/api/coach/videos/${id}/complete`, { confirmReplaceIds: confirmIds });
      pendingId.current = null;
      const rotated = done.rotated.map((r) => `"${r.title}"`).join(", ");
      onSaved(rotated ? `Video saved. ${rotated} was rotated out (the baseline is kept).` : "Video saved to the library.", athlete!.uuid);
      onClose();
    } catch (e) {
      const err = e as VideoApiError;
      if (err.code === "REPLACE_REQUIRED") {
        setPhase({ kind: "confirm", replaces: (err.data.replaces as ReplaceInfo[]) ?? [], stage: "complete" });
        return;
      }
      setPhase({ kind: "form" });
      setError(err.message);
    }
  }

  async function start(confirmIds: string[]) {
    if (!file || !athlete) return;
    const mime = videoMime(file.type, file.name);
    if (!mime) return setError("Choose a MOV, MP4, M4V, or WebM video.");
    if (!file.size || file.size > maxBytes) return setError(`Choose a video under ${maxMb} MB. Trim it in Photos first.`);
    setError("");
    setPhase({ kind: "uploading", pct: 0 });
    try {
      const res = await videoSend<StartResponse>("POST", "/api/coach/videos/uploads", {
        clientKey: keyFor(), athleteUuid: athlete.uuid, category, title, notes, recordedDate: date,
        filename: file.name, mime, size: file.size, confirmReplaceIds: confirmIds,
      });
      if (res.status === "ready") {
        onSaved("Video saved to the library.", athlete.uuid);
        onClose();
        return;
      }
      pendingId.current = res.id;
      abort.current = new AbortController();
      await putToStorage(res.uploadUrl, file, res.contentType, (pct) => setPhase({ kind: "uploading", pct }), abort.current.signal);
      await finish(res.id, confirmIds);
    } catch (e) {
      const err = e as VideoApiError;
      if (err.code === "REPLACE_REQUIRED") {
        setPhase({ kind: "confirm", replaces: (err.data.replaces as ReplaceInfo[]) ?? [], stage: "start" });
        return;
      }
      setPhase({ kind: "form" });
      setError(err.code === "STORAGE" ? `${err.message} If this keeps happening, the bucket's CORS rule may be missing (npm run videos:cors).` : err.message);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!athlete) return setError("Choose an athlete.");
    if (!file) return setError("Choose a video.");
    void start([]);
  }

  const confirmIds = phase.kind === "confirm" ? phase.replaces.map((r) => r.id) : [];

  return (
    <Modal
      opened={opened}
      onClose={close}
      withCloseButton={false}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      centered
      size={600}
      classNames={{ content: `${css.vault} ${css.modal} ${css.modalContent}`, body: css.modalBody, overlay: css.modalOverlay }}
      aria-labelledby="video-upload-title"
    >
      <button type="button" aria-label="Close upload" className={css.close} disabled={busy} onClick={close}>×</button>
      <div className={css.eyebrow}>Add to the archive</div>
      <h2 id="video-upload-title">Upload a video</h2>
      <p>Give this rep a place in your player&apos;s history. Each athlete keeps {limit} clips: the oldest stays as the baseline, the newest {limit - 1} rotate.</p>

      {phase.kind === "confirm" ? (
        <div>
          <div className={css.replaceBox} role="alert">
            <strong>{athlete?.name} already has {limit} videos.</strong>
            <br />
            Saving this clip removes {phase.replaces.map((r) => <span key={r.id}><strong>&ldquo;{r.title}&rdquo;</strong> ({r.category}, {fmtDay(r.recordedDate)})</span>)}, the oldest of the recent clips. The baseline clip is kept. This can&apos;t be undone.
          </div>
          <div className={css.shareactions}>
            <button type="button" className={css.primary} onClick={() => (phase.stage === "complete" && pendingId.current ? void finish(pendingId.current, confirmIds) : void start(confirmIds))}>
              Replace and save
            </button>
            <button type="button" className={css.secondary} onClick={close}>Cancel</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label className={css.file}>
            <span className={css.photoChoice}>Choose from Photos or files</span>
            <input
              required
              name="file"
              type="file"
              accept="video/*"
              aria-describedby="video-photo-help"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                newKey();
                setError(f && f.size > maxBytes ? `This clip is over ${maxMb} MB. Trim it in Photos or choose a smaller video.` : "");
              }}
            />
            <small id="video-photo-help">On iPhone, tap Choose File, then Photo Library to select a video from Photos. You can also use Browse for a video in Files.</small>
            <small>MP4, MOV, M4V, or WebM · Maximum {maxMb} MB per clip</small>
            {file && <span className={css.selectedVideo} role="status">Selected: {file.name} · {fmtSize(file.size)}</span>}
          </label>
          <div className={css.formgrid}>
            <label>
              Athlete
              {lockedAthlete ? (
                <div className={css.lockedField} aria-readonly="true">{lockedAthlete.name}</div>
              ) : (
                <AthleteSearchSelect
                  value={athlete?.uuid ?? null}
                  valueLabel={athlete?.name ?? null}
                  placeholder="Search athletes…"
                  w="100%"
                  onChange={(uuid, name) => {
                    setAthlete(uuid ? { uuid, name: name ?? "" } : null);
                    newKey();
                  }}
                />
              )}
            </label>
            <label>
              Discipline
              <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
                <option>Pitching</option>
                <option>Hitting</option>
              </select>
            </label>
            <label>
              Clip title
              <input required name="title" maxLength={160} placeholder="e.g. Bullpen • fastball, side view" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </label>
            <label>
              Date recorded
              <input required name="date" type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </label>
          </div>
          <label>
            <span>Coaching notes <small>(optional)</small></span>
            <textarea name="notes" maxLength={2000} placeholder="What should we look for in this rep?" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </label>
          {error && <p className={css.error} role="alert">{error}</p>}
          {phase.kind === "uploading" && (
            <div role="status">
              <div className={css.progress}><div style={{ width: `${phase.pct}%` }} /></div>
              <p style={{ margin: 0 }}>{phase.pct === 100 ? "Saving your clip…" : `Uploading ${phase.pct}% — keep this window open.`}</p>
            </div>
          )}
          {phase.kind === "saving" && <p role="status">Saving your clip…</p>}
          <button className={`${css.primary} ${css.full}`} disabled={busy}>{busy ? "Saving…" : error && pendingId.current ? "Retry upload" : "Upload to library"}</button>
        </form>
      )}
    </Modal>
  );
}
