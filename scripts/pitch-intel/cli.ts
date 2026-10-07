/**
 * Pitch Intelligence command line. Run from the repo root:
 *
 *   npm run pi:setup    (creates the pitch_intel tables; safe to re-run)
 *   npm run pi:link     -- [--name "Jacob Webb"] [--from-season 2024] [--no-backfill]
 *   npm run pi:pull     -- --athlete <name|uuid|MLB ID> [--season 2026 | --from YYYY-MM-DD --to YYYY-MM-DD] [--dry-run]
 *   npm run pi:backfill -- --athlete <...> --from-season 2021 [--dry-run]
 *   npm run pi:import   -- --athlete <...> --file path/to/savant.csv [--dry-run]
 *   npm run pi:check    -- --athlete <...> [--season 2026]
 *   npm run pi:nightly  -- [--dry-run]
 *   npm run pi:unlink   -- --athlete <...>
 *   npm run pi:list
 *   npm run pi:runs     -- [--limit 20]
 */

import "./env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createLink, findSavantPlayers, LinkError, suggestAthletes } from "../../lib/pitch-intel/links";
import { backfill, defaultBackfillFrom, importCsv, pullRange, runNightly, type PullResult } from "../../lib/pitch-intel/pull";
import { findLinks, getLink, listLinks, recentRuns, setPullEnabled, type Link } from "../../lib/pitch-intel/db";
import { fetchSavantCsv } from "../../lib/pitch-intel/savant/client";
import { parseCsv } from "../../lib/pitch-intel/csv";
import { runChecks } from "../../lib/pitch-intel/checks";
import { isIsoDate, minDate, todayET } from "../../lib/pitch-intel/dates";

type Args = { _: string[]; [flag: string]: string | boolean | string[] };

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const log = (line: string) => console.log(line);

let rl: ReturnType<typeof createInterface> | null = null;
async function ask(question: string): Promise<string> {
  rl ??= createInterface({ input: stdin, output: stdout });
  return (await rl.question(question)).trim();
}

async function pickNumber(max: number, prompt: string): Promise<number | null> {
  while (true) {
    const answer = await ask(prompt);
    if (answer === "" || answer.toLowerCase() === "q") return null;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= max) return n - 1;
    console.log(`  Enter a number from 1 to ${max}, or q to cancel.`);
  }
}

async function resolveLink(query: string | undefined): Promise<Link> {
  if (!query) throw new Error("--athlete is required (name, athlete uuid, or MLB ID)");
  const matches = await findLinks(query);
  if (matches.length === 0) throw new Error(`No linked athlete matches "${query}". Link them first with pi:link.`);
  if (matches.length === 1) return matches[0];
  console.log(`"${query}" matches ${matches.length} linked athletes:`);
  matches.forEach((m, i) => console.log(`  ${i + 1}. ${m.athlete_name}  (Savant: ${m.source_player_name}, ${m.source_player_id})`));
  const idx = await pickNumber(matches.length, "Which one? ");
  if (idx == null) throw new Error("Cancelled");
  return matches[idx];
}

function printResult(r: PullResult): void {
  const range = r.from && r.to ? `${r.from}..${r.to}` : "";
  console.log(`  ${r.status.toUpperCase()} ${range}  fetched ${r.fetched}, new ${r.inserted}, updated ${r.updated}${r.runId ? `  (run #${r.runId})` : ""}`);
  for (const f of r.fatal) console.log(`    x ${f}`);
  for (const f of r.flags) console.log(`    ! ${f.message}`);
  if (r.error && !r.fatal.length) console.log(`    x ${r.error}`);
}

function seasonRange(season: string): [string, string] {
  const y = Number(season);
  if (!Number.isInteger(y) || y < 2008) throw new Error(`Bad --season "${season}"`);
  return [`${y}-01-01`, minDate(`${y}-12-31`, todayET())];
}

// ---------------------------------------------------------------------------

/** Splits the schema file into single statements (Prisma runs one per call). */
export function sqlStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

async function cmdSetup(): Promise<void> {
  const file = resolve(process.cwd(), "uais/sql/create_pitch_intel_schema.sql");
  const statements = sqlStatements(readFileSync(file, "utf8"));
  const { prisma } = await import("../../lib/db/prisma");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").host;
    } catch {
      return "(unparsed DATABASE_URL)";
    }
  })();
  console.log(`Creating the pitch_intel schema on ${host} (${statements.length} statements)...`);
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'pitch_intel' ORDER BY table_name`,
  );
  console.log(`Done. Tables: ${tables.map((t) => t.table_name).join(", ")}`);
}

async function cmdLink(args: Args): Promise<void> {
  const name = str(args.name) ?? (await ask("Savant player (name, MLB ID or Savant URL): "));
  if (!name) return;

  console.log("Searching Savant...");
  const players = (await findSavantPlayers(name)).slice(0, 10);
  if (!players.length) {
    console.log("No Savant players found. Try the full name, or paste the Savant player URL.");
    return;
  }
  players.forEach((p, i) =>
    console.log(`  ${i + 1}. ${p.name}  ${p.position ?? ""}  ${p.team ?? ""}  ${p.league ?? ""}  (MLB ID ${p.id})${p.lastYear ? `  last ${p.lastYear}` : ""}`),
  );
  const pIdx = players.length === 1 && str(args.name) ? 0 : await pickNumber(players.length, "Savant player #: ");
  if (pIdx == null) return;
  const player = players[pIdx];

  const suggestions = await suggestAthletes(player.name, 8);
  console.log(`\nClosest athletes in the database for "${player.name}":`);
  suggestions.forEach((s, i) =>
    console.log(
      `  ${i + 1}. ${s.name}  [${s.score}% match]  ${s.age_group ?? ""}${s.date_of_birth ? `  DOB ${s.date_of_birth}` : ""}${
        s.linked_to ? `  (already linked to ${s.linked_to.source_player_name})` : ""
      }`,
    ),
  );
  console.log("  (Not listed? Create the athlete through the Athletes page first, then run pi:link again.)");
  const aIdx = await pickNumber(suggestions.length, "Athlete #: ");
  if (aIdx == null) return;
  const athlete = suggestions[aIdx];

  const fromSeason = Number(str(args["from-season"]) ?? defaultBackfillFrom());
  const confirm = await ask(`Link ${athlete.name} -> ${player.name} (${player.id}) and backfill from ${fromSeason}? [y/N] `);
  if (confirm.toLowerCase() !== "y") return;

  const link = await createLink({ athleteUuid: athlete.athlete_uuid, player, backfillFrom: fromSeason, linkedBy: "cli" });
  console.log(`Linked (link #${link.id}).`);
  if (args["no-backfill"]) return;
  console.log("Backfilling...");
  const results = await backfill(link, link.backfill_from ?? fromSeason, "backfill", { log });
  results.forEach(printResult);
}

async function cmdPull(args: Args): Promise<void> {
  const link = await resolveLink(str(args.athlete));
  let from: string;
  let to: string;
  if (str(args.season)) {
    [from, to] = seasonRange(str(args.season)!);
  } else if (str(args.from)) {
    from = str(args.from)!;
    to = str(args.to) ?? todayET();
    if (!isIsoDate(from) || !isIsoDate(to)) throw new Error("--from/--to must be YYYY-MM-DD");
  } else {
    [from, to] = seasonRange(todayET().slice(0, 4));
  }
  console.log(`${link.athlete_name} (${link.source_player_id}) ${from}..${to}${args["dry-run"] ? " [dry run]" : ""}`);
  printResult(await pullRange(link, from, to, "cli", { dryRun: !!args["dry-run"], log }));
}

async function cmdBackfill(args: Args): Promise<void> {
  const link = await resolveLink(str(args.athlete));
  const fromSeason = Number(str(args["from-season"]) ?? link.backfill_from ?? defaultBackfillFrom());
  console.log(`${link.athlete_name}: backfilling ${fromSeason}..${todayET().slice(0, 4)}${args["dry-run"] ? " [dry run]" : ""}`);
  (await backfill(link, fromSeason, "backfill", { dryRun: !!args["dry-run"], log })).forEach(printResult);
}

async function cmdImport(args: Args): Promise<void> {
  const link = await resolveLink(str(args.athlete));
  const file = str(args.file);
  if (!file) throw new Error("--file is required");
  const text = readFileSync(file, "utf8");
  console.log(`${link.athlete_name}: importing ${file}${args["dry-run"] ? " [dry run]" : ""}`);
  printResult(await importCsv(link, text, { dryRun: !!args["dry-run"] }));
}

async function cmdCheck(args: Args): Promise<void> {
  const link = await resolveLink(str(args.athlete));
  const [from, to] = seasonRange(str(args.season) ?? todayET().slice(0, 4));
  for (const level of ["mlb", "minors"] as const) {
    try {
      const { text } = await fetchSavantCsv(level, link.source_player_id, from, to);
      const { headers, rows } = parseCsv(text);
      const result = runChecks(headers, rows, link.source_player_id, { checkRowCap: false });
      console.log(`\n${level.toUpperCase()} ${from}..${to}: ${rows.length} pitches, ${result.stats.games} games, takes ${result.stats.takesPct ?? "-"}%`);
      const perGame = new Map<string, number>();
      for (const r of rows) perGame.set(`${r.game_date} ${r.home_team}-${r.away_team}`, (perGame.get(`${r.game_date} ${r.home_team}-${r.away_team}`) ?? 0) + 1);
      [...perGame.entries()].sort().forEach(([g, n]) => console.log(`  ${g}: ${n}`));
      result.stats.pitchTypes.forEach((p) =>
        console.log(`  ${p.pitchType.padEnd(7)} n=${String(p.count).padEnd(5)} velo ${p.avgVelo ?? "-"}  IVB ${p.avgIvb ?? "-"}"  HB ${p.avgHb ?? "-"}" (catcher's view)`),
      );
      result.fatal.forEach((f) => console.log(`  x ${f}`));
      result.flags.forEach((f) => console.log(`  ! ${f.message}`));
    } catch (err) {
      console.log(`\n${level.toUpperCase()}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function cmdNightly(args: Args): Promise<void> {
  const summary = await runNightly({ dryRun: !!args["dry-run"], log });
  if (summary.skipped) {
    console.log(`Skipped: ${summary.reason}`);
    return;
  }
  console.log(`\nNightly ${summary.date}: ${summary.ok} ok, ${summary.flagged} flagged, ${summary.failed} failed`);
  if (summary.failed) process.exitCode = 2;
}

async function cmdUnlink(args: Args): Promise<void> {
  const link = await resolveLink(str(args.athlete));
  await setPullEnabled(link.id, false);
  const after = await getLink(link.id);
  console.log(`${link.athlete_name}: nightly pulls ${after?.pull_enabled ? "still on" : "stopped"}. Stored pitches were kept.`);
}

async function cmdList(): Promise<void> {
  const links = await listLinks();
  if (!links.length) return console.log("No linked athletes yet. Run pi:link.");
  for (const l of links) {
    console.log(
      `#${l.id} ${l.athlete_name.padEnd(24)} ${l.source_player_name} (${l.source_player_id}) ${l.throws ?? "?"}HP ${l.league ?? ""}  ` +
        `${l.pitch_count} pitches / ${l.season_count} seasons  last game ${l.last_game_date ?? "-"}  ` +
        `${l.pull_enabled ? "" : "[paused] "}last run ${l.last_run_status ?? "-"}`,
    );
  }
}

async function cmdRuns(args: Args): Promise<void> {
  const runs = await recentRuns(Number(str(args.limit) ?? 20));
  for (const r of runs) {
    console.log(
      `#${r.id} ${r.started_at.slice(0, 16)} ${r.trigger.padEnd(8)} ${r.status.padEnd(7)} ${(r.athlete_name ?? "").padEnd(22)} ` +
        `${r.date_from ?? ""}..${r.date_to ?? ""}  +${r.rows_inserted} ~${r.rows_updated}${r.error ? `  ${r.error}` : ""}`,
    );
  }
}

const COMMANDS: Record<string, (args: Args) => Promise<void>> = {
  setup: cmdSetup,
  link: cmdLink,
  pull: cmdPull,
  backfill: cmdBackfill,
  import: cmdImport,
  check: cmdCheck,
  nightly: cmdNightly,
  unlink: cmdUnlink,
  list: cmdList,
  runs: cmdRuns,
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const fn = command ? COMMANDS[command] : undefined;
  if (!fn) {
    console.log(`Usage: npm run pi:<command> -- [flags]\nCommands: ${Object.keys(COMMANDS).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  await fn(args);
}

main()
  .catch((err) => {
    console.error(err instanceof LinkError ? err.message : err instanceof Error ? `Error: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl?.close();
    const { prisma } = await import("../../lib/db/prisma");
    await prisma.$disconnect().catch(() => {});
  });
