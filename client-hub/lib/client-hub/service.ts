// Client Hub use cases. HTTP-agnostic: routes authenticate, validate, then call these.
import prisma from '@/lib/prisma';
import { SYNC_CONCURRENCY, UPDATE_FIELDS } from './constants';
import { coverageFor, pickProgram } from './coverage';
import { todayIso } from './dates';
import { buildRow, filterAndSort, headlineStats } from './flags';
import { chooseAutoLink, planSeed, suggestAthletes } from './linking';
import type { OctaneProgrammingSource } from './octane/source';
import { buildAppCard } from './profile';
import { toFacts, toUpdateData, type ClientPatch } from './repository';
import type { CreateClientInput, CreateNoteInput, ListQuery, SetMyCoachInput, UpdateClientInput } from './schemas';
import { buildSyncPatch, calendarWindow, needsSync, runPool } from './sync';
import type { ClientFacts, CoverageAlert, HubAthlete, StaffUser } from './types';

export class HubNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'HubNotFoundError';
  }
}

// ---------- Staff identity ----------

export async function resolveStaffUser(clerkUserId: string, name: string): Promise<StaffUser> {
  const coach = await prisma.hubCoach.findUnique({ where: { clerkUserId } });
  return { clerkUserId, name, octaneUserUuid: coach?.octaneUserUuid ?? null };
}

export async function setMyCoach(me: StaffUser, input: SetMyCoachInput) {
  return prisma.hubCoach.upsert({
    where: { clerkUserId: me.clerkUserId },
    create: { clerkUserId: me.clerkUserId, octaneUserUuid: input.octaneUserUuid, name: input.name },
    update: { octaneUserUuid: input.octaneUserUuid, name: input.name },
  });
}

/** clerkUserId → octaneUserUuid for every coach who has linked themselves. */
async function coachMap(): Promise<Map<string, string>> {
  const coaches = await prisma.hubCoach.findMany({ select: { clerkUserId: true, octaneUserUuid: true } });
  return new Map(coaches.map((c) => [c.clerkUserId, c.octaneUserUuid]));
}

// ---------- 8ctane snapshot ----------

interface OctaneSnapshot {
  athletes: HubAthlete[] | null;
  coverage: Map<string, CoverageAlert> | null;
  errors: string[]; // shown as banners; the hub still works on its own data
}

async function loadSnapshot(source: OctaneProgrammingSource, today: string): Promise<OctaneSnapshot> {
  const [athletes, coverage] = await Promise.allSettled([source.listAthletes(), source.listProgrammingCoverage(today)]);
  const errors: string[] = [];
  if (athletes.status === 'rejected') errors.push(`8ctane athletes: ${String(athletes.reason)}`);
  if (coverage.status === 'rejected') errors.push(`Programming dates: ${String(coverage.reason)}`);
  return {
    athletes: athletes.status === 'fulfilled' ? athletes.value : null,
    coverage: coverage.status === 'fulfilled' ? coverage.value : null,
    errors,
  };
}

const athleteIndex = (athletes: HubAthlete[] | null) => new Map((athletes ?? []).map((a) => [a.uuid, a]));

// ---------- List ----------

export async function listClients(me: StaffUser, query: ListQuery, source: OctaneProgrammingSource, now = new Date()) {
  const today = todayIso(now);
  const [rows, snapshot] = await Promise.all([prisma.hubClient.findMany(), loadSnapshot(source, today)]);
  const clients = rows.map(toFacts);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const athletes = athleteIndex(snapshot.athletes);

  const scoped = clients
    .filter((c) => query.scope === 'all' || c.ownerClerkUserId === me.clerkUserId)
    .map((c) => {
      const program = c.octaneAthleteUuid ? pickProgram(athletes.get(c.octaneAthleteUuid) ?? null, me.octaneUserUuid) : null;
      const coverage = coverageFor(c, program, snapshot.coverage, snapshot.athletes !== null, today);
      return buildRow(c, coverage, c.ownerClerkUserId === me.clerkUserId, today);
    });

  return {
    today,
    stats: headlineStats(scoped),
    rows: filterAndSort(scoped, byId, { status: query.status, focus: query.focus, query: query.q }),
    totalClients: clients.length,
    staleCount: clients.filter((c) => needsSync(c, now)).length, // UI can POST /sync when > 0
    errors: snapshot.errors,
  };
}

// ---------- Sync ----------

async function syncOne(
  c: ClientFacts,
  athletes: Map<string, HubAthlete>,
  ownerOctaneUuid: string | null,
  source: OctaneProgrammingSource,
  now: Date,
) {
  if (!c.octaneAthleteUuid) return null;
  const today = todayIso(now);
  const { startDate, endDate } = calendarWindow(today);
  const days = await source.getTrainingCalendar(c.octaneAthleteUuid, startDate, endDate);
  const program = pickProgram(athletes.get(c.octaneAthleteUuid) ?? null, ownerOctaneUuid);
  const patch = buildSyncPatch(c, program, days, today, now);
  await prisma.hubClient.update({ where: { id: c.id }, data: toUpdateData(patch) });
  return { days, program, synced: { ...c, ...patch } };
}

/**
 * Auto-link unlinked clients with one clear exact-name match, then re-read every stale active client
 * (2 at a time). Safe to call repeatedly — fresh clients are skipped. Good fit for a Railway cron too.
 */
export async function syncClients(source: OctaneProgrammingSource, now = new Date()) {
  const [rows, athletesList, coaches] = await Promise.all([prisma.hubClient.findMany(), source.listAthletes(), coachMap()]);
  const athletes = athleteIndex(athletesList);
  let clients = rows.map(toFacts);

  let linked = 0;
  for (const c of clients) {
    const owner = c.ownerClerkUserId ? (coaches.get(c.ownerClerkUserId) ?? null) : null;
    const best = chooseAutoLink(c, athletesList, owner);
    if (!best) continue;
    await prisma.hubClient.update({
      where: { id: c.id },
      data: { octaneAthleteUuid: best.uuid, octaneName: best.name, linkSource: 'AUTO' },
    });
    c.octaneAthleteUuid = best.uuid;
    c.octaneName = best.name;
    c.linkSource = 'AUTO';
    linked++;
  }

  clients = clients.filter((c) => needsSync(c, now));
  const result = await runPool(clients, SYNC_CONCURRENCY, async (c) => {
    const owner = c.ownerClerkUserId ? (coaches.get(c.ownerClerkUserId) ?? null) : null;
    await syncOne(c, athletes, owner, source, now);
  });
  for (const f of result.failed) console.error(`[client-hub] sync failed for client ${f.item.id}:`, f.error);
  return { linked, synced: result.ok, failed: result.failed.length };
}

// ---------- Profile ----------

export async function getClientDetail(id: string, me: StaffUser, source: OctaneProgrammingSource, now = new Date()) {
  const row = await prisma.hubClient.findUnique({
    where: { id },
    include: { notes: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (!row) throw new HubNotFoundError('Client');
  const { notes, ...clientRow } = row;
  let client = toFacts(clientRow);
  const today = todayIso(now);

  let appCard = null;
  let appError: string | null = null;
  if (client.octaneAthleteUuid) {
    try {
      const snapshot = await loadSnapshot(source, today);
      const fresh = await syncOne(client, athleteIndex(snapshot.athletes), me.octaneUserUuid, source, now);
      if (fresh) {
        client = fresh.synced;
        const coverage = coverageFor(client, fresh.program, snapshot.coverage, snapshot.athletes !== null, today);
        appCard = buildAppCard(client, fresh.program, coverage, fresh.days, today);
      }
      if (snapshot.errors.length) appError = snapshot.errors.join(' ');
    } catch (error) {
      console.error(`[client-hub] couldn't load 8ctane data for client ${id}:`, error);
      appError = 'Couldn’t reach 8ctane just now.';
    }
  }

  return {
    today,
    client,
    isMine: client.ownerClerkUserId === me.clerkUserId,
    notes: notes.map((n) => ({ ...n, date: n.date.toISOString().slice(0, 10) })),
    appCard,
    appError,
  };
}

// ---------- Create / update / delete ----------

export async function createClient(me: StaffUser, input: CreateClientInput, source: OctaneProgrammingSource) {
  const created = await prisma.hubClient.create({
    data: {
      name: input.name,
      programType: input.programType,
      phase: 'Onboarding',
      coachName: me.name,
      ownerClerkUserId: me.clerkUserId,
    },
  });
  // Link straight away if one athlete clearly matches; otherwise the profile offers suggestions.
  const athletes = await source.listAthletes().catch(() => null);
  const best = athletes ? chooseAutoLink(toFacts(created), athletes, me.octaneUserUuid) : null;
  if (!best) return created;
  return prisma.hubClient.update({
    where: { id: created.id },
    data: { octaneAthleteUuid: best.uuid, octaneName: best.name, linkSource: 'AUTO' },
  });
}

export async function updateClient(id: string, me: StaffUser, input: UpdateClientInput) {
  const { isMine, ...fields } = input;
  const patch: ClientPatch = { ...fields };
  if (isMine !== undefined) patch.ownerClerkUserId = isMine ? me.clerkUserId : null;
  // A coach typing an "updated" date marks it manual, so the UI stops saying "picked up from 8ctane".
  for (const f of UPDATE_FIELDS) if (input[f] !== undefined) patch[`${f}Source`] = 'MANUAL';
  return prisma.hubClient.update({ where: { id }, data: toUpdateData(patch) });
}

/** Hard delete; notes go with it (onDelete: Cascade). */
export async function deleteClient(id: string) {
  await prisma.hubClient.delete({ where: { id } });
}

// ---------- Linking ----------

export async function listAthletesForPicker(me: StaffUser, source: OctaneProgrammingSource, forName?: string) {
  const athletes = await source.listAthletes();
  const coaches = new Map<string, string>();
  for (const a of athletes) for (const p of a.programs) for (const c of p.coaches) if (c.userUuid) coaches.set(c.userUuid, c.name);
  return {
    athletes: athletes.map((a) => ({ uuid: a.uuid, name: a.name, programs: a.programs.map((p) => p.name) })),
    suggestions: forName ? suggestAthletes(forName, athletes, me.octaneUserUuid).map((a) => a.uuid) : [],
    coaches: [...coaches].map(([userUuid, name]) => ({ userUuid, name })),
  };
}

export async function linkClient(id: string, octaneAthleteUuid: string, source: OctaneProgrammingSource) {
  const athlete = (await source.listAthletes()).find((a) => a.uuid === octaneAthleteUuid);
  if (!athlete) throw new HubNotFoundError('8ctane athlete');
  return prisma.hubClient.update({
    where: { id },
    data: { octaneAthleteUuid: athlete.uuid, octaneName: athlete.name, linkSource: 'MANUAL', syncedAt: null },
  });
}

/** DISMISSED keeps auto-link from re-linking the same athlete. */
export async function unlinkClient(id: string) {
  return prisma.hubClient.update({
    where: { id },
    data: { octaneAthleteUuid: null, octaneName: null, linkSource: 'DISMISSED', weekDone: null, weekTrackable: null, syncedAt: null },
  });
}

// ---------- Notes ----------

export async function addNote(clientId: string, me: StaffUser, input: CreateNoteInput, now = new Date()) {
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const isToday = input.date === todayIso(now);
  const [note] = await prisma.$transaction([
    prisma.hubClientNote.create({
      data: {
        clientId,
        date,
        body: input.body,
        goals: input.goals || null,
        link: input.link || null,
        authorClerkUserId: me.clerkUserId,
        authorName: me.name,
      },
    }),
    // A note dated today counts as contact.
    ...(isToday ? [prisma.hubClient.update({ where: { id: clientId }, data: { lastContacted: date } })] : []),
  ]);
  return note;
}

export async function deleteNote(clientId: string, noteId: string) {
  const { count } = await prisma.hubClientNote.deleteMany({ where: { id: noteId, clientId } });
  if (!count) throw new HubNotFoundError('Note');
}

// ---------- Seed (replaces the sheet import) ----------

export async function seedFromOctane(source: OctaneProgrammingSource) {
  const [rows, athletes, coaches] = await Promise.all([
    prisma.hubClient.findMany(),
    source.listAthletes(),
    prisma.hubCoach.findMany({ select: { clerkUserId: true, octaneUserUuid: true } }),
  ]);
  const plan = planSeed(athletes, rows.map(toFacts), coaches);
  if (plan.length) {
    await prisma.hubClient.createMany({ data: plan.map((p) => ({ ...p, linkSource: 'AUTO' as const })) });
  }
  return { added: plan.length };
}
