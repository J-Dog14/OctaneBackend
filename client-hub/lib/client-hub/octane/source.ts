// The hub's only door into 8ctane. Everything else depends on the OctaneProgrammingSource interface,
// so tests pass a fake and the HTTP details stay here.
//
// ASSUMPTION — confirm with the Octane app's owner: Octane exposes these three reads over REST with
// the existing `octane_api_key`, returning the same JSON the 8ctane Database connector returns.
// If the real paths or params differ, change OCTANE_PATHS / the query builders below; nothing else moves.
import prisma from '@/lib/prisma';
import { COVERAGE_HORIZON_DAYS } from '../constants';
import type { CalendarDay, CoverageAlert, HubAthlete } from '../types';
import {
  AlertsPageSchema,
  AthletesPageSchema,
  CalendarPageSchema,
  toCalendarDays,
  toCoverageAlerts,
  toHubAthletes,
} from './payloads';

export interface OctaneProgrammingSource {
  /** Team athletes with their active programs and assigned coaches. */
  listAthletes(): Promise<HubAthlete[]>;
  /** Programming-coverage alerts as of `asOf`, keyed by program UUID. Missing key = covered past the horizon. */
  listProgrammingCoverage(asOf: string): Promise<Map<string, CoverageAlert>>;
  /** Scheduled days (with set completion) for one athlete, inclusive dates, max 93 days apart. */
  getTrainingCalendar(athleteUuid: string, startDate: string, endDate: string): Promise<CalendarDay[]>;
}

const OCTANE_PATHS = {
  athletes: '/api/external/athletes',
  programmingAlerts: '/api/external/alerts',
  trainingCalendar: '/api/external/training-calendar',
} as const;

const PAGE_SIZE = 100;
const MAX_PAGES = { athletes: 15, alerts: 10, calendar: 6 } as const;
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60_000; // same 5-minute freshness the artifact asked its connector for

export class OctaneRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'OctaneRequestError';
  }
}

// Config hierarchy: OrgSetting first, then env. Swap for the repo's existing settings helper if it has one.
async function readSetting(key: string, envVar: string): Promise<string | null> {
  const row = await prisma.orgSetting.findUnique({ where: { key } });
  return row?.value || process.env[envVar] || null;
}

async function octaneConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const [baseUrl, apiKey] = await Promise.all([
    readSetting('octane_app_url', 'OCTANE_APP_URL'),
    readSetting('octane_api_key', 'OCTANE_API_KEY'),
  ]);
  if (!baseUrl || !apiKey) throw new OctaneRequestError('Octane app URL or API key is not configured in Settings.', null);
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

async function getJson(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const { baseUrl, apiKey } = await octaneConfig();
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 1) throw new OctaneRequestError(`Octane ${path} returned ${res.status}`, res.status);
    const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 800;
    await new Promise((r) => setTimeout(r, retryAfter + Math.random() * 600));
  }
}

/** Follow nextCursor until it runs out or the page cap is hit. */
async function collectPages<T>(
  maxPages: number,
  readPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null | undefined }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await readPage(cursor);
    out.push(...items);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

type CacheEntry = { at: number; value: Promise<unknown> };
const cache = new Map<string, CacheEntry>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key)); // never cache a failure
  return value;
}

export const httpOctaneSource: OctaneProgrammingSource = {
  listAthletes() {
    return cached('athletes', () =>
      collectPages(MAX_PAGES.athletes, async (cursor) => {
        const page = AthletesPageSchema.parse(await getJson(OCTANE_PATHS.athletes, { limit: PAGE_SIZE, cursor }));
        return { items: toHubAthletes(page), nextCursor: page.nextCursor };
      }),
    );
  },

  listProgrammingCoverage(asOf) {
    return cached(`coverage:${asOf}`, async () => {
      const alerts = await collectPages(MAX_PAGES.alerts, async (cursor) => {
        const page = AlertsPageSchema.parse(
          await getJson(OCTANE_PATHS.programmingAlerts, {
            kind: 'programming',
            asOf,
            horizonDays: COVERAGE_HORIZON_DAYS,
            limit: PAGE_SIZE,
            cursor,
          }),
        );
        return { items: toCoverageAlerts(page), nextCursor: page.nextCursor };
      });
      return new Map(alerts.map((a) => [a.programUuid, a]));
    });
  },

  getTrainingCalendar(athleteUuid, startDate, endDate) {
    // Not cached: the profile view wants this week's ticks as they happen.
    return collectPages(MAX_PAGES.calendar, async (cursor) => {
      const page = CalendarPageSchema.parse(
        await getJson(OCTANE_PATHS.trainingCalendar, { athleteUuid, startDate, endDate, limit: PAGE_SIZE, cursor }),
      );
      return { items: toCalendarDays(page), nextCursor: page.nextCursor };
    });
  },
};
