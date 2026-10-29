"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import type { CoachAthleteSummary } from "@/lib/coach/summary";
import { summaryKey, swrOpts } from "../fetcher";
import css from "./videoHub.module.css";
import { athleteVideosKey, LIBRARY_KEY, videoGet, videoSwr, type Video, type VideoList } from "./api";
import { Slots } from "./parts";
import { PlaybackModal } from "./PlaybackModal";
import { UploadModal } from "./UploadModal";

function NotInstalled({ error }: { error: Error }) {
  return <p className={css.error} role="alert">{error.message}</p>;
}

/** Athlete page → Videos tab: their clips as baseline + recent slots, upload locked to them. */
export function VideosTab({ athleteUuid, athleteName }: { athleteUuid: string; athleteName: string }) {
  const { mutate } = useSWRConfig();
  const { data, error, isLoading, mutate: reload } = useSWR<VideoList>(athleteVideosKey(athleteUuid), videoGet, videoSwr);
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState<Video | null>(null);
  const [notice, setNotice] = useState("");
  const limit = data?.limit ?? 5;
  const n = data?.videos.length ?? 0;

  const changed = (message: string) => {
    setNotice(message);
    void reload();
    void mutate(LIBRARY_KEY);
  };

  return (
    <div className={`${css.vault} ${css.embed}`}>
      <div className={css.heading} style={{ marginBottom: 22 }}>
        <div>
          <div className={css.eyebrow}>The 8ctane film room</div>
          <h2 style={{ marginTop: 8 }}>
            Videos <span className={css.muted}>({n} of {limit})</span>
          </h2>
          <p style={{ margin: "6px 0 0" }}>
            The oldest clip is {athleteName}&apos;s baseline and is always kept. The newest {limit - 1} rotate: at {limit}, a new clip replaces the oldest recent one.
          </p>
        </div>
        <button type="button" className={css.primary} onClick={() => setUploading(true)} disabled={!!error}>＋ Upload video</button>
      </div>
      {notice && <p className={css.notice} role="status">{notice}</p>}
      {error ? (
        <NotInstalled error={error} />
      ) : isLoading || !data ? (
        <p>Loading videos…</p>
      ) : (
        <Slots videos={data.videos} limit={limit} onOpen={setActive} onAdd={() => setUploading(true)} large />
      )}
      <div className={css.bottomnote}>
        <span>● Originals stored online, never re-encoded.</span>
        <Link href="/coach/videos" className={css.textbutton}>Open the Video Hub →</Link>
      </div>
      {uploading && data && (
        <UploadModal
          opened
          onClose={() => setUploading(false)}
          lockedAthlete={{ uuid: athleteUuid, name: athleteName }}
          limit={data.limit}
          maxBytes={data.maxBytes}
          onSaved={changed}
        />
      )}
      {active && <PlaybackModal video={active} onClose={() => setActive(null)} showAthleteLink={false} onChanged={changed} />}
    </div>
  );
}

function CompareRow({ uuid, onOpen }: { uuid: string; onOpen: (v: Video) => void }) {
  const { data, error } = useSWR<VideoList>(athleteVideosKey(uuid), videoGet, videoSwr);
  const { data: summary } = useSWR<CoachAthleteSummary>(summaryKey(uuid), swrOpts);
  const name = summary?.athlete.name ?? data?.videos[0]?.athleteName ?? "Loading…";
  return (
    <div className={css.boardRow}>
      <div className={css.boardHead}>
        <h3>{name}</h3>
        <Link className={css.textbutton} href={`/coach/athletes/${encodeURIComponent(uuid)}?tab=videos`}>
          {data ? `${data.videos.length} of ${data.limit} videos` : ""} →
        </Link>
      </div>
      {error ? <NotInstalled error={error} /> : data ? <Slots videos={data.videos} limit={data.limit} onOpen={onOpen} /> : <p>Loading…</p>}
    </div>
  );
}

/** Videos tab while comparing: each athlete's baseline + recent clips stacked to look across. */
export function VideoCompare({ ids }: { ids: string[] }) {
  const { mutate } = useSWRConfig();
  const [active, setActive] = useState<Video | null>(null);
  return (
    <div className={`${css.vault} ${css.embed}`}>
      <div className={css.board}>
        {ids.map((id) => (
          <CompareRow key={id} uuid={id} onOpen={setActive} />
        ))}
      </div>
      {active && (
        <PlaybackModal
          video={active}
          onClose={() => setActive(null)}
          onChanged={() => {
            void mutate(athleteVideosKey(active.athleteUuid));
            void mutate(LIBRARY_KEY);
          }}
        />
      )}
    </div>
  );
}
