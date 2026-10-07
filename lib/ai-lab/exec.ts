import { execFile } from "node:child_process";
import { aiLayerEnv, getAiLabConfig } from "./config";

/**
 * Run a short AI-layer command synchronously and parse its JSON stdout
 * (the `--json` variants print exactly one JSON document; logs go to stderr).
 * No shell; args must already be validated.
 */
export async function runAiJson<T = unknown>(args: string[], timeoutMs = 90_000): Promise<T> {
  const cfg = await getAiLabConfig();
  if (!cfg.root || !cfg.python) {
    throw new Error(cfg.problems.join(" ") || "AI layer is not configured");
  }
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      cfg.python!,
      ["-m", "src.main", ...args],
      { cwd: cfg.root!, env: aiLayerEnv(), timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, out, errOut) => {
        if (err) {
          // Surface the Python error line, not the whole traceback.
          const lines = `${out}\n${errOut}`.split(/\r?\n/).filter(Boolean);
          const msg = lines.reverse().find((l) => /\[ERROR\]|Error:|Exception/.test(l)) ?? err.message;
          reject(new Error(msg.replace(/^\[ERROR\]\s*/, "")));
          return;
        }
        resolve({ stdout: out, stderr: errOut });
      }
    );
  });
  // The --json commands print one document; tolerate stray lines before it.
  const text = stdout.trim();
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((l) => l.startsWith("{") || l.startsWith("["));
  if (first < 0) throw new Error(`No JSON in AI layer output. ${stderr.slice(-400)}`);
  return JSON.parse(lines.slice(first).join("\n")) as T;
}
