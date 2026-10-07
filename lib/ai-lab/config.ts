import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";

/**
 * Where the OctaneAiLayer repo and its Python live.
 *
 * Resolution follows the app's usual hierarchy — OrgSetting > env var >
 * convention — so it is zero-config on the ThinkPad (the two repos sit side
 * by side in PycharmProjects) and still overridable from the Settings page:
 *
 *   ai_layer_root    / AI_LAYER_ROOT     → ../OctaneAiLayer
 *   ai_layer_python  / AI_LAYER_PYTHON   → <root>/.venv/Scripts/python.exe (or .venv/bin/python)
 *
 * The UAIS side (Proteus / mobility pulls) uses this repo's uais/ folder and
 * its venv, same as run_daily.bat does.
 */
export type AiLabConfig = {
  root: string | null;
  python: string | null;
  outputsDir: string | null;
  uaisRoot: string;
  uaisPython: string | null;
  problems: string[];
  settings: Record<string, string>;
};

function venvPython(dir: string, venvName: string): string | null {
  const candidates = [
    path.join(dir, venvName, "Scripts", "python.exe"),
    path.join(dir, venvName, "bin", "python"),
    path.join(dir, venvName, "bin", "python3"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

async function loadSettings(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.orgSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

export async function getAiLabConfig(): Promise<AiLabConfig> {
  const settings = await loadSettings();
  const problems: string[] = [];

  const rootCandidate =
    settings.ai_layer_root?.trim() ||
    process.env.AI_LAYER_ROOT?.trim() ||
    path.resolve(process.cwd(), "..", "OctaneAiLayer");
  const root = existsSync(path.join(rootCandidate, "src", "main.py")) ? rootCandidate : null;
  if (!root) {
    problems.push(
      `OctaneAiLayer not found at ${rootCandidate}. Set ai_layer_root in Settings or AI_LAYER_ROOT.`
    );
  }

  const pyExplicit = settings.ai_layer_python?.trim() || process.env.AI_LAYER_PYTHON?.trim();
  let python: string | null = null;
  if (pyExplicit) {
    python = existsSync(pyExplicit) ? pyExplicit : null;
    if (!python) problems.push(`AI layer python not found at ${pyExplicit}.`);
  } else if (root) {
    python = venvPython(root, ".venv");
    if (!python) problems.push(`No .venv in ${root}. Create it or set ai_layer_python.`);
  }

  const uaisRoot = path.join(process.cwd(), "uais");
  const uaisPython =
    venvPython(uaisRoot, "venv") ??
    (process.env.PYTHON_HOME ? path.join(process.env.PYTHON_HOME, "python.exe") : null);

  return {
    root,
    python,
    outputsDir: root ? path.join(root, "outputs") : null,
    uaisRoot,
    uaisPython: uaisPython && existsSync(uaisPython) ? uaisPython : null,
    problems,
    settings,
  };
}

/**
 * Environment for AI-layer processes: the OS basics Python needs and nothing
 * else. The AI layer reads its own .env (python-dotenv never overrides an
 * existing var), so passing the backend's env would both leak this app's
 * secrets (Clerk, R2, Octane keys) into a process that has no use for them
 * and risk shadowing the AI layer's own settings.
 */
const OS_ENV_KEYS = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "COMSPEC", "ComSpec",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA",
  "LOCALAPPDATA", "PROGRAMDATA", "ProgramData", "PROGRAMFILES", "ProgramFiles",
  "ProgramFiles(x86)", "ProgramW6432", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  "OS", "USERNAME", "USER", "LANG", "LC_ALL", "TZ",
];

export function aiLayerEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const k of OS_ENV_KEYS) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return {
    ...env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    MPLBACKEND: "Agg",
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}
