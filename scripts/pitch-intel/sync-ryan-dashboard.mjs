#!/usr/bin/env node
/**
 * Brings Ryan Chasse's Pitch Intelligence dashboard into this app, unchanged.
 *
 *   node scripts/pitch-intel/sync-ryan-dashboard.mjs <path to a clone of rnchasse8/8ctane-pitch-intelligence>
 *
 * 1. Copies his dashboard files into public/pitch-intel-app/ and adds two
 *    lines to athletes.html that load pi-embed.js / pi-embed.css (ours): they
 *    point his data calls at /api/dashboard/pitch-intel/legacy and hide the
 *    controls that write to his Google Sheet.
 * 2. Extracts his Statcast and Trackman parsers (parseStatcastBulk, parseTrackmanBulk and everything they use)
 *    verbatim from athletes-v2.js into lib/pitch-intel/legacy/ryan-statcast.js,
 *    so the server computes outings with exactly his math.
 *
 * Re-run it whenever Ryan ships an update; nothing else needs editing.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = process.argv[2] ? resolve(process.argv[2]) : null;
if (!src || !existsSync(join(src, "athletes-v2.js"))) {
  console.error("Usage: node scripts/pitch-intel/sync-ryan-dashboard.mjs <path to 8ctane-pitch-intelligence clone>");
  process.exit(1);
}

let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: src, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git checkout */
}

// ---------------------------------------------------------------------------
// 1. Static dashboard files
// ---------------------------------------------------------------------------

const STATIC_FILES = [
  "athletes.html",
  "athletes-v2.js",
  "athletes.css",
  "style.css",
  "baselines-ref.js",
  "baselines.json",
  "mlb-shape-match.js",
  "release-templates.js",
  "shape_baselines.json",
  "pitcher_comps.json",
  "logo.png",
];

const outDir = join(repoRoot, "public", "pitch-intel-app");
mkdirSync(outDir, { recursive: true });

for (const f of STATIC_FILES) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.warn(`  skipped ${f} (not in source)`);
    continue;
  }
  copyFileSync(from, join(outDir, f));
}

const EMBED_TAGS =
  '  <!-- pitch-intel embed (added by sync-ryan-dashboard.mjs) -->\n' +
  '  <link rel="stylesheet" href="pi-embed.css">\n' +
  '  <script src="pi-embed.js"></script>\n';

const htmlPath = join(outDir, "athletes.html");
let html = readFileSync(htmlPath, "utf8");
if (!html.includes("pi-embed.js")) {
  if (!html.includes("</head>")) throw new Error("athletes.html has no </head>; cannot add the embed tags");
  html = html.replace("</head>", `${EMBED_TAGS}</head>`);
}
writeFileSync(htmlPath, html);
writeFileSync(
  join(outDir, "SOURCE.txt"),
  `Copied from rnchasse8/8ctane-pitch-intelligence @ ${commit} on ${new Date().toISOString().slice(0, 10)}\n` +
    `by scripts/pitch-intel/sync-ryan-dashboard.mjs. Only change: athletes.html loads pi-embed.css/pi-embed.js.\n` +
    `Do not edit these files by hand; re-run the sync script instead.\n`,
);
console.log(`Copied dashboard files to public/pitch-intel-app (source ${commit})`);

// ---------------------------------------------------------------------------
// 2. Extract the Statcast parser
// ---------------------------------------------------------------------------

const code = readFileSync(join(src, "athletes-v2.js"), "utf8").replace(/\r\n/g, "\n");
const lines = code.split("\n");

/** Top-level declarations: name -> [startLine, endLine) */
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const starts = [];
lines.forEach((line, i) => {
  const m = line.match(DECL);
  if (m) starts.push({ name: m[1] ?? m[2], start: i });
});

/** A declaration runs until the next line that starts a new top-level statement or comment at column 0. */
function endOf(start) {
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l === "" || /^[\s})\]]/.test(l)) continue;
    return i;
  }
  return lines.length;
}

const decls = new Map();
for (const s of starts) {
  if (decls.has(s.name)) continue; // first definition wins (matches classic-script hoisting for functions)
  let end = endOf(s.start);
  while (end > s.start + 1 && lines[end - 1].trim() === "") end--;
  decls.set(s.name, { ...s, end, body: lines.slice(s.start, end).join("\n") });
}

const ROOTS = ["parseStatcastBulk", "parseTrackmanBulk", "computeSituational"];
const needed = new Set();
const queue = [...ROOTS];
while (queue.length) {
  const name = queue.pop();
  if (needed.has(name)) continue;
  const d = decls.get(name);
  if (!d) throw new Error(`Could not find top-level declaration "${name}" in athletes-v2.js`);
  needed.add(name);
  for (const other of decls.keys()) {
    if (!needed.has(other) && new RegExp(`(?<![\\w$.])${other.replace(/\$/g, "\\$")}(?![\\w$])`).test(d.body)) queue.push(other);
  }
}

// Guard: the parser must stay DOM-free to run on the server.
const BROWSER_ONLY = /\b(document|window|localStorage|XMLHttpRequest|alert)\b/;
const ordered = [...decls.values()].filter((d) => needed.has(d.name)).sort((a, b) => a.start - b.start);
for (const d of ordered) {
  const stripped = d.body.replace(/\/\/.*$/gm, "");
  if (BROWSER_ONLY.test(stripped)) throw new Error(`"${d.name}" uses browser-only APIs; the server extract would break`);
}

const header = `/* AUTO-GENERATED by scripts/pitch-intel/sync-ryan-dashboard.mjs. Do not edit by hand.
 * Source: rnchasse8/8ctane-pitch-intelligence athletes-v2.js @ ${commit}
 * Declarations (verbatim, original order): ${ordered.map((d) => d.name).join(", ")}
 */
/* eslint-disable */
// @ts-nocheck
`;
const out = `${header}\n${ordered.map((d) => d.body).join("\n\n")}\n\nexport { ${ROOTS.join(", ")} };\n`;
const legacyDir = join(repoRoot, "lib", "pitch-intel", "legacy");
mkdirSync(legacyDir, { recursive: true });
writeFileSync(join(legacyDir, "ryan-statcast.js"), out);
console.log(`Extracted ${ordered.length} declarations to lib/pitch-intel/legacy/ryan-statcast.js`);
