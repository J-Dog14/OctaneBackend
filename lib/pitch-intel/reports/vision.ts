/**
 * Reads a screenshot (or PDF page) of a pitch summary into per-pitch-type rows
 * with Claude vision. The model fills a fixed schema through a tool call, so the
 * result is structured; the person uploading reviews and corrects every value
 * before anything is saved.
 *
 * Env: ANTHROPIC_API_KEY (required), PITCH_INTEL_VISION_MODEL (optional,
 * falls back to PITCH_INTEL_AI_MODEL, then claude-sonnet-4-5).
 */

import { isPitchCode, type PitchCode } from "../pitch-types";

export type ReportSource = "trackman_summary" | "savant" | "claw" | "rapsodo" | "other";
export const REPORT_SOURCES: ReportSource[] = ["trackman_summary", "savant", "claw", "rapsodo", "other"];

export interface ReportPitchRow {
  pitchType: PitchCode;
  label: string | null; // as written on the screenshot
  count: number | null;
  usagePct: number | null;
  velo: number | null;
  veloMax: number | null;
  spinRate: number | null;
  ivb: number | null;
  hbAsShown: number | null;
  hbArm: number | null; // arm-side positive
  extension: number | null;
  relHeight: number | null;
  relSide: number | null;
  vaa: number | null;
  spinEfficiency: number | null;
  whiffPct: number | null;
}

export interface ReportExtraction {
  source: ReportSource;
  playerName: string | null;
  throws: "L" | "R" | null;
  reportDate: string | null;
  season: number | null;
  level: string | null;
  title: string | null;
  hbConvention: string | null;
  notes: string | null;
  pitches: ReportPitchRow[];
}

const num = { type: ["number", "null"] } as const;

const TOOL = {
  name: "record_pitch_report",
  description: "Record the pitch-level summary shown in the image. Use null for anything not shown.",
  input_schema: {
    type: "object",
    required: ["source", "pitches"],
    properties: {
      source: { type: "string", enum: ["trackman_summary", "savant", "claw", "rapsodo", "other"] },
      player_name: { type: ["string", "null"] },
      throws: { type: ["string", "null"], enum: ["L", "R", null] },
      report_date: { type: ["string", "null"], description: "YYYY-MM-DD if a single date is shown" },
      season: { type: ["integer", "null"] },
      level: { type: ["string", "null"], description: "Competition level or league if shown (e.g. MLB, AAA, NCAA D1, High School, Atlantic League)" },
      title: { type: ["string", "null"] },
      hb_convention: { type: ["string", "null"], description: "How horizontal break is shown (sign, arm/glove labels, view)" },
      notes: { type: ["string", "null"] },
      pitches: {
        type: "array",
        items: {
          type: "object",
          required: ["pitch_type"],
          properties: {
            label: { type: ["string", "null"], description: "Pitch name exactly as written" },
            pitch_type: { type: "string", enum: ["FF", "SI", "FC", "SL", "ST", "CU", "KC", "CH", "FS", "OTHER"] },
            count: { type: ["integer", "null"] },
            usage_pct: num,
            velo: num,
            velo_max: num,
            spin_rate: num,
            ivb: { type: ["number", "null"], description: "Induced vertical break, inches" },
            hb_as_shown: { type: ["number", "null"], description: "Horizontal break exactly as displayed, inches" },
            hb_arm_side: {
              type: ["number", "null"],
              description: "Horizontal break in inches, positive = toward the pitcher's ARM side, negative = glove side. Null if the direction can't be determined.",
            },
            extension: num,
            release_height: num,
            release_side: num,
            vaa: num,
            spin_efficiency: { type: ["number", "null"], description: "Percent, 0-100" },
            whiff_pct: num,
          },
        },
      },
    },
  },
} as const;

const PROMPT = `Read this baseball pitching summary and record it with the record_pitch_report tool.

Rules:
- Copy only values that are visible. Never estimate or compute a value that isn't shown; use null.
- One row per pitch type. Map names to codes: 4-Seam/Four-Seam/Fastball=FF, Sinker/Two-Seam=SI, Cutter=FC, Slider=SL, Sweeper=ST, Curveball=CU, Knuckle Curve=KC, Changeup=CH, Splitter/Split-Finger=FS, anything else=OTHER.
- Velocity in mph, spin in rpm, breaks in inches, extension and release in feet, approach angles in degrees, percentages as numbers (34.5 not 0.345).
- Horizontal break: put the displayed number in hb_as_shown. Then fill hb_arm_side (positive = arm side) using the pitcher's throwing hand and the source's convention:
  - Trackman HorzBreak: positive = toward the pitcher's right (arm side for a righty, glove side for a lefty).
  - Baseball Savant pitch movement: usually labeled arm side / glove side, or from the catcher's view.
  - Rapsodo HB: positive = toward the pitcher's right.
  - CLAW: a fastball/sinker with negative HB means a left-handed pitcher (reversed from Savant).
  - If arm side/glove side labels are shown, follow them. If you can't tell, leave hb_arm_side null.
- Describe the convention you used in hb_convention.
- Do not report psStuff+, Stuff+ or any model grade even if shown.`;

export function visionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const n = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function extractReport(bytes: Buffer, mediaType: string): Promise<ReportExtraction> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Screenshot reading isn't set up: add ANTHROPIC_API_KEY to the backend's environment.");
  const data = bytes.toString("base64");
  const media =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.PITCH_INTEL_VISION_MODEL || process.env.PITCH_INTEL_AI_MODEL || "claude-sonnet-4-5",
      max_tokens: 4096,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: [media, { type: "text", text: PROMPT }] }],
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
  };
  if (!res.ok || json.error) throw new Error(`Screenshot reading failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  const input = json.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name)?.input;
  if (!input) throw new Error("Couldn't read a pitch table from that image.");
  return normalizeExtraction(input);
}

/** Turns the model's tool input into our shape, defensively. */
export function normalizeExtraction(input: Record<string, unknown>): ReportExtraction {
  const src = String(input.source ?? "other");
  const throws = input.throws === "L" || input.throws === "R" ? input.throws : null;
  const date = typeof input.report_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.report_date) ? input.report_date : null;
  const rows = Array.isArray(input.pitches) ? (input.pitches as Array<Record<string, unknown>>) : [];
  return {
    source: (REPORT_SOURCES as string[]).includes(src) ? (src as ReportSource) : "other",
    playerName: typeof input.player_name === "string" ? input.player_name : null,
    throws,
    reportDate: date,
    season: n(input.season) ?? (date ? Number(date.slice(0, 4)) : null),
    level: typeof input.level === "string" ? input.level : null,
    title: typeof input.title === "string" ? input.title : null,
    hbConvention: typeof input.hb_convention === "string" ? input.hb_convention : null,
    notes: typeof input.notes === "string" ? input.notes : null,
    pitches: rows.map((r) => ({
      pitchType: isPitchCode(r.pitch_type) ? r.pitch_type : "OTHER",
      label: typeof r.label === "string" ? r.label : null,
      count: n(r.count),
      usagePct: n(r.usage_pct),
      velo: n(r.velo),
      veloMax: n(r.velo_max),
      spinRate: n(r.spin_rate),
      ivb: n(r.ivb),
      hbAsShown: n(r.hb_as_shown),
      hbArm: n(r.hb_arm_side),
      extension: n(r.extension),
      relHeight: n(r.release_height),
      relSide: n(r.release_side),
      vaa: n(r.vaa),
      spinEfficiency: n(r.spin_efficiency),
      whiffPct: n(r.whiff_pct),
    })),
  };
}
