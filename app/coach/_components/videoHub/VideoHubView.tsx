"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { Loader, MultiSelect } from "@mantine/core";
import css from "./videoHub.module.css";
import { athleteVideosKey, initials, LIBRARY_KEY, videoGet, videoSwr, type Video, type VideoList } from "./api";
import { Slots, VideoCard } from "./parts";
import { PlaybackModal } from "./PlaybackModal";
import { UploadModal } from "./UploadModal";

type View = "library" | "athletes" | "board";
const CATEGORY_TABS = ["All videos", "Pitching", "Hitting"] as const;
const pad = (n: number) => n.toString().padStart(2, "0");

/**
 * /coach/videos: the 8ctane film room across every athlete (the Video Vault, rebuilt on
 * warehouse athletes). Library = every clip; Athletes = roster of athletes with clips;
 * Side by side = several athletes' baseline + recent clips stacked. ?clip=<id> opens a clip.
 */
function VideoHubInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR<VideoList>(LIBRARY_KEY, videoGet, videoSwr);
  const view: View = params.get("view") === "athletes" ? "athletes" : params.get("view") === "board" ? "board" : "library";
  const selected = useMemo(() => (params.get("athletes") ?? "").split(",").filter(Boolean), [params]);
  const clipId = params.get("clip");

  const [category, setCategory] = useState<(typeof CATEGORY_TABS)[number]>("All videos");
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");

  const videos = useMemo(() => data?.videos ?? [], [data]);
  const limit = data?.limit ?? 5;

  // Athletes with at least one clip, by name. Stable ids, so two people with one name never merge.
  const athletes = useMemo(() => {
    const map = new Map<string, { uuid: string; name: string; videos: Video[] }>();
    for (const v of videos) {
      const a = map.get(v.athleteUuid) ?? { uuid: v.athleteUuid, name: v.athleteName, videos: [] };
      a.videos.push(v);
      map.set(v.athleteUuid, a);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [videos]);
  const nameCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of athletes) c.set(a.name.toLowerCase(), (c.get(a.name.toLowerCase()) ?? 0) + 1);
    return c;
  }, [athletes]);
  const athleteLabel = (a: { uuid: string; name: string }) => ((nameCounts.get(a.name.toLowerCase()) ?? 0) > 1 ? `${a.name} (${a.uuid.slice(0, 6)})` : a.name);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos.filter(
      (v) =>
        (category === "All videos" || v.category === category) &&
        (!selected.length || selected.includes(v.athleteUuid)) &&
        (!q || `${v.title} ${v.athleteName} ${v.notes}`.toLowerCase().includes(q)),
    );
  }, [videos, category, selected, query]);

  const setParam = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const setView = (v: View) => setParam({ view: v === "library" ? null : v });
  const setSelected = (ids: string[]) => setParam({ athletes: ids.length ? ids.join(",") : null });

  // Deep link: the clip may not be in the list (deleted, or the list is still loading).
  const linked = clipId ? videos.find((v) => v.id === clipId) : undefined;
  const { data: linkedFetched, error: linkedError } = useSWR<Video>(clipId && data && !linked ? `/api/coach/videos/${encodeURIComponent(clipId)}` : null, videoGet, videoSwr);
  const active = linked ?? linkedFetched ?? null;

  const changed = (message: string, athleteUuid?: string) => {
    setNotice(message);
    void mutate(LIBRARY_KEY);
    if (athleteUuid) void mutate(athleteVideosKey(athleteUuid));
  };

  async function copyLibraryLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/coach/videos`);
      setNotice("Library link copied. Only coaches signed in to 8ctane Coach can open it.");
    } catch {
      setNotice("Could not copy automatically. Copy the address from your browser.");
    }
  }

  function exportCatalog() {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), videos }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "8ctane-video-catalog.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const boardAthletes = selected.length ? athletes.filter((a) => selected.includes(a.uuid)) : athletes;
  const crumb = view === "athletes" ? "Athletes" : view === "board" ? "Side by side" : "Video library";

  return (
    <div className={`${css.vault} ${css.page}`}>
      <aside className={css.aside}>
        <Link className={css.brand} href="/coach/videos">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/coach/8ctane-baseball-logo.png" alt="8ctane Baseball" width={600} height={241} />
        </Link>
        <div className={css.navtitle}>TEAM WORKSPACE</div>
        <button type="button" aria-label="Video library" className={`${css.nav} ${view === "library" ? css.navSelected : ""}`} onClick={() => setView("library")}>
          ▣ <span>Video library</span>
          <em>{videos.length}</em>
        </button>
        <button type="button" aria-label="Athletes" className={`${css.nav} ${view === "athletes" ? css.navSelected : ""}`} onClick={() => setView("athletes")}>
          ♙ <span>Athletes</span>
          <em>{athletes.length}</em>
        </button>
        <button type="button" aria-label="Side by side" className={`${css.nav} ${view === "board" ? css.navSelected : ""}`} onClick={() => setView("board")}>
          ▤ <span>Side by side</span>
        </button>
        <div className={css.sidebarbottom}>
          <span className={css.lock}>●</span> Private team library
          <p>
            Built for the work.
            <br />
            Saved for the future.
          </p>
          <small>8CTANE BASEBALL</small>
          <button type="button" className={css.linkbutton} onClick={() => void copyLibraryLink()}>↗ Copy library link</button>
        </div>
      </aside>

      <main className={css.main}>
        <div className={css.topbar}>
          <span>
            8ctane Baseball <i>/</i> {crumb}
          </span>
          <div className={css.access}>● &nbsp; Coaches only</div>
        </div>
        <section className={css.content}>
          <div className={css.heading}>
            <div>
              <div className={css.eyebrow}>The 8ctane film room</div>
              <h1 className={css.h1}>{view === "library" ? "Every rep. A record." : view === "board" ? "See them side by side." : "Know every player."}</h1>
              <p>Your pitchers. Your hitters. One place to track the work.</p>
            </div>
            <button type="button" className={css.primary} onClick={() => setUploading(true)} disabled={!data}>＋ Upload video</button>
          </div>

          <div className={css.stats}>
            <div><span>Total videos</span><strong>{pad(videos.length)}</strong><small>Your growing film library</small></div>
            <div><span>Pitching clips</span><strong>{pad(videos.filter((v) => v.category === "Pitching").length)}</strong><small>From the mound</small></div>
            <div><span>Hitting clips</span><strong>{pad(videos.filter((v) => v.category === "Hitting").length)}</strong><small>Inside the batter&apos;s box</small></div>
            <div><span>Athletes</span><strong>{pad(athletes.length)}</strong><small>Baseline + {limit - 1} most recent each</small></div>
          </div>

          {notice && <p className={css.notice} role="status">{notice}</p>}
          {error && <p className={css.error} role="alert">{error.message}</p>}
          {linkedError && clipId && <p className={css.error} role="alert">That clip link no longer opens: the clip was deleted or rotated out.</p>}

          {view === "athletes" ? (
            <div className={css.playergrid}>
              {athletes.map((a) => (
                <Link key={a.uuid} className={css.playercard} href={`/coach/athletes/${encodeURIComponent(a.uuid)}?tab=videos`}>
                  <span className={css.avatar}>{initials(a.name)}</span>
                  <h3>{athleteLabel(a)}</h3>
                  <p>{a.videos.length} of {limit} videos · Videos &amp; profile →</p>
                </Link>
              ))}
              {!isLoading && !athletes.length && (
                <div className={css.empty}>
                  <h2>Your roster starts with a rep.</h2>
                  <p>Upload a clip to an athlete to start their film history.</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className={css.librarytop}>
                <h2>{view === "board" ? "Athletes side by side" : "Video library"}</h2>
                {view === "library" && <button type="button" className={css.textbutton} onClick={exportCatalog} disabled={!videos.length}>↓ Export catalog</button>}
              </div>
              <div className={css.toolbar}>
                {view === "library" ? (
                  <div className={css.tabs}>
                    {CATEGORY_TABS.map((t) => (
                      <button type="button" key={t} className={category === t ? css.chosen : ""} onClick={() => setCategory(t)}>{t}</button>
                    ))}
                  </div>
                ) : <span />}
                <div className={css.searchgroup}>
                  {view === "library" && <input aria-label="Search videos" placeholder="Search players, clips, notes…" value={query} onChange={(e) => setQuery(e.target.value)} />}
                  <MultiSelect
                    aria-label="Filter by athlete"
                    placeholder={selected.length ? "Add athlete…" : "All athletes"}
                    data={athletes.map((a) => ({ value: a.uuid, label: athleteLabel(a) }))}
                    value={selected}
                    onChange={setSelected}
                    searchable
                    clearable
                    maxDropdownHeight={280}
                    className={css.athleteFilter}
                    nothingFoundMessage="No athletes with videos"
                  />
                </div>
              </div>

              {view === "board" ? (
                <div className={css.board} style={{ marginTop: 20 }}>
                  {boardAthletes.map((a) => (
                    <div key={a.uuid} className={css.boardRow}>
                      <div className={css.boardHead}>
                        <h3>{athleteLabel(a)}</h3>
                        <Link className={css.textbutton} href={`/coach/athletes/${encodeURIComponent(a.uuid)}?tab=videos`}>
                          {a.videos.length} of {limit} videos →
                        </Link>
                      </div>
                      <Slots videos={a.videos} limit={limit} onOpen={(v) => setParam({ clip: v.id })} />
                    </div>
                  ))}
                  {!isLoading && !boardAthletes.length && <div className={css.empty}><h2>No athletes yet.</h2><p>Upload a clip to start.</p></div>}
                </div>
              ) : (
                <>
                  <div className={css.resultline}>
                    <span>{isLoading ? "Loading library…" : `${filtered.length} videos`}</span>
                    <span>Newest recorded first</span>
                  </div>
                  {isLoading ? (
                    <Loader size="sm" />
                  ) : !filtered.length ? (
                    <div className={css.empty}>
                      <div className={css.diamond}><span>▷</span></div>
                      <div className={css.eyebrow}>Make the first rep count</div>
                      <h2>{videos.length ? "No matching clips." : "Your film room starts here."}</h2>
                      <p>{videos.length ? "Try a different search or athlete filter." : "Build a lasting record of every player’s progress.\nAdd your first pitching or hitting clip."}</p>
                      {!videos.length && <button type="button" className={css.primary} onClick={() => setUploading(true)}>＋ Upload your first video</button>}
                      <small>MP4, MOV, M4V, or WebM · Up to {Math.round((data?.maxBytes ?? 0) / 1024 / 1024)} MB per clip · {limit} clips per athlete</small>
                    </div>
                  ) : (
                    <div className={css.grid}>
                      {filtered.map((v) => (
                        <VideoCard key={v.id} video={v} onOpen={(c) => setParam({ clip: c.id })} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className={css.bottomnote}>
            <span>● Originals stored online, never re-encoded. No automatic expiration.</span>
            <span>Each athlete keeps {limit} clips: the oldest is the baseline; at {limit}, a new clip replaces the oldest recent one.</span>
          </div>
        </section>
      </main>

      {uploading && data && (
        <UploadModal
          opened
          onClose={() => setUploading(false)}
          limit={data.limit}
          maxBytes={data.maxBytes}
          onSaved={changed}
        />
      )}
      {active && <PlaybackModal video={active} onClose={() => setParam({ clip: null })} onChanged={(m) => changed(m, active.athleteUuid)} />}
    </div>
  );
}

export function VideoHubView() {
  return (
    <Suspense fallback={<Loader />}>
      <VideoHubInner />
    </Suspense>
  );
}
