# Video Hub (coach suite)

The 8ctane Video Vault (Bobby's ChatGPT Site, handoff in `8ctane-employee-handoff/`) rebuilt inside the
coach suite on warehouse athletes. Two entry points:

- **Video Hub** (`/coach/videos`, third option in the coach header toggle): every athlete's clips.
  Library (search, Pitching/Hitting tabs, multi-athlete filter, export catalog) · Athletes (roster) ·
  **Side by side** (several athletes' baseline + recent clips stacked). `?clip=<id>` opens a clip;
  `?athletes=a,b` and `?view=board|athletes` are shareable.
- **Videos tab** on every athlete (`/coach/athletes/:uuid?tab=videos`, always shown so the first clip
  can be added there). With Compare active the tab shows the compared athletes' clips stacked.

## The cap

At most **5 ready clips per athlete** (`VIDEO_LIMIT` in `lib/videos/rules.ts`, `coach.athlete_video_limit()` in SQL).
The oldest clip (by recorded date, then upload time) is the **baseline** and is never rotated out. At 5,
saving a new clip rotates out the oldest non-baseline clip, so an athlete always has baseline + 4 most recent.

- The coach is told which clip leaves and must confirm (`409 REPLACE_REQUIRED` → resend with `confirmReplaceIds`).
- A clip older than every recent clip (but not the oldest) is refused (`409 TOO_OLD`): it would be rotated out immediately.
- A clip older than the baseline becomes the new baseline (the old baseline is then the one rotated out).
- Enforced three ways: the service under a per-athlete advisory lock, a re-check at completion (another
  coach may have saved meanwhile → asked again), and a trigger that refuses a 6th ready row.

## Permissions

Coaches and admins (`requireHubCoach` / `requireCoachForAthlete`) can list, upload, edit (title, notes,
date, discipline) and delete **videos**. Nothing in the Video Hub can delete an athlete: the FK to
`analytics.d_athletes` is `ON DELETE RESTRICT`, and a video delete is a soft delete of the row plus removal
of the R2 object. Writes require a same-origin `Origin` header.

## Storage

- Files: R2 (existing bucket/credentials) at `videos/<athlete_uuid>/<video_id>.<mov|mp4|webm>`, original
  bytes, no transcoding. Neon stores metadata only.
- Upload: `POST /api/coach/videos/uploads` makes a pending row and returns a 30-min presigned PUT → the
  browser PUTs the file to R2 with progress → `POST /api/coach/videos/:id/complete` checks the stored size
  equals the declared size and the first bytes are a MOV/MP4/WebM container, then rotates + publishes.
  `clientKey` (browser UUID) makes retries idempotent. Pending uploads older than 6 h are cleaned up.
- Playback/download: `GET /api/coach/videos/:id/media[?download=1]` checks the coach, then 302s to a
  1-hour presigned GET (R2 serves ranges/seeking; download keeps the original filename).
- Presigned URLs use `getR2PresignClient()` (checksums only when required); the SDK's default CRC32
  checksum would otherwise be baked into the URL and break browser PUTs.
- Limits: 100 MiB per clip (`MAX_VIDEO_BYTES`; the vault allowed 50), MP4/MOV/M4V/WebM, title ≤ 160,
  notes ≤ 2000, real calendar date not in the future.

## Data

`uais/sql/create_coach_videos.sql` (`npm run videos:setup`; idempotent, not a Prisma migration):
`coach.athlete_videos` (status pending/ready/deleted, who/when for upload/edit/delete, delete_reason
coach/rotated/abandoned) and `coach.athlete_video_events` (audit log). Athlete merges in
`athlete_manager._merge_athlete_into_canonical` move clips to the surviving athlete; other merge scripts
that delete athletes will fail on the FK for athletes with clips (same as pitch_intel tables).

## Setup

1. `npm run videos:setup` against the warehouse.
2. R2 CORS for the app origin(s): `npm run videos:cors -- https://<railway-app> http://localhost:3000`
   (needs an admin R2 token; otherwise paste the printed JSON into Cloudflare → R2 → bucket → Settings → CORS).
3. Deploy. Coaches see "Video Hub" in the header toggle and a Videos tab on each athlete.

## Files

`lib/videos/{rules,storage,service,http}.ts` · `app/api/coach/videos/**` · `app/api/coach/athletes/[uuid]/videos` ·
`app/coach/videos/page.tsx` · `app/coach/_components/videoHub/*` (CSS module = the vault's design tokens, scoped) ·
`scripts/videos/r2-cors.ts` · `tests/videos.test.ts` (`npm run test:videos`).

## Not carried over from the vault (deliberately)

Athlete trends / velocity readings (TrackMan and Savant already feed the Pitching tab), Slack webhook,
free-typed player names (clips attach to existing warehouse athletes by UUID), and the TrackMan PDF importer
(the handoff's next phase; we already ingest TrackMan from the portal).
