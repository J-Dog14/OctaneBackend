import { requireRole } from "@/lib/auth/requireAuth";
import { publicActions } from "@/lib/ai-lab/actions";
import { getAiLabConfig } from "@/lib/ai-lab/config";
import { runAiJson } from "@/lib/ai-lab/exec";
import { success } from "@/lib/responses";

type SkillsPayload = {
  skills: Array<Record<string, unknown>>;
  headless: Record<string, unknown>;
};

// `wb skills --json` imports the whole research stack; cache it briefly.
let skillsCache: { at: number; data: SkillsPayload } | null = null;

/**
 * GET /api/dashboard/ai-lab/config
 * Where the AI layer lives, whether it is usable, every action the page can
 * run, and the skill registry (from the Python side, the single source).
 */
export async function GET() {
  await requireRole("admin");
  const cfg = await getAiLabConfig();
  let skills: SkillsPayload | null = null;
  let skillsError: string | null = null;
  if (cfg.root && cfg.python) {
    try {
      if (!skillsCache || Date.now() - skillsCache.at > 60_000) {
        skillsCache = { at: Date.now(), data: await runAiJson<SkillsPayload>(["wb", "skills", "--json"]) };
      }
      skills = skillsCache.data;
    } catch (e) {
      skillsError = e instanceof Error ? e.message : String(e);
    }
  }
  return success({
    ready: !!(cfg.root && cfg.python) && !skillsError,
    root: cfg.root,
    python: cfg.python ? true : false,
    uaisPython: !!cfg.uaisPython,
    problems: skillsError ? [...cfg.problems, `wb skills failed: ${skillsError}`] : cfg.problems,
    actions: publicActions(),
    skills: skills?.skills ?? [],
    headless: skills?.headless ?? null,
  });
}
