import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { UaisRunner } from "./runners";

/**
 * Resolve R and Python binary directories and return:
 *  - env: process env with those dirs prepended to PATH (belt-and-suspenders)
 *  - pythonExe: absolute path to python.exe on Windows (used to rewrite the command
 *    so it never goes through the Windows App Execution Alias)
 *  - rBinDir: absolute path to the R bin dir (for Rscript command rewriting)
 */
function resolveRuntimes(env: NodeJS.ProcessEnv): {
  env: NodeJS.ProcessEnv;
  pythonExe: string | null;
  rBinDir: string | null;
} {
  const pathSep = process.platform === "win32" ? ";" : ":";
  const extraBins: string[] = [];

  // --- R ---
  let rBinDir: string | null = null;
  if (process.env.R_HOME) {
    const candidate = path.join(process.env.R_HOME, "bin");
    if (existsSync(candidate)) rBinDir = candidate;
  }
  if (!rBinDir && process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const rRoot = path.join(programFiles, "R");
    if (existsSync(rRoot)) {
      const dirs = readdirSync(rRoot).filter((d) => d.startsWith("R-"));
      if (dirs.length > 0) {
        dirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        const bin = path.join(rRoot, dirs[0], "bin");
        if (existsSync(bin)) rBinDir = bin;
      }
    }
  }
  if (rBinDir) extraBins.push(rBinDir);

  // --- Python (Windows only) ---
  // On Windows, `python` / `python3` in PATH can resolve to the Windows App Execution
  // Alias even when the real Python dir is prepended, because the alias lives in a
  // directory that gets special OS-level treatment. The only reliable fix is to replace
  // `python`/`python3` in the command with the absolute path to python.exe.
  let pythonExe: string | null = null;
  if (process.platform === "win32") {
    let pyDir: string | null = null;
    if (process.env.PYTHON_HOME) {
      const exe = path.join(process.env.PYTHON_HOME, "python.exe");
      if (existsSync(exe)) pyDir = process.env.PYTHON_HOME;
    }
    if (!pyDir) {
      const localAppData = process.env.LOCALAPPDATA || "";
      const userProfile = process.env.USERPROFILE || "";
      const roots = [
        path.join(localAppData, "Programs", "Python"),
        path.join(userProfile, "AppData", "Local", "Programs", "Python"),
        "C:\\Python313", "C:\\Python312", "C:\\Python311", "C:\\Python310", "C:\\Python39",
      ];
      outer: for (const root of roots) {
        if (!existsSync(root)) continue;
        if (existsSync(path.join(root, "python.exe"))) { pyDir = root; break; }
        let dirs: string[] = [];
        try { dirs = readdirSync(root).filter((d) => /^Python\d/i.test(d)); } catch (_e) { continue; }
        dirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        for (const dir of dirs) {
          const candidate = path.join(root, dir);
          if (existsSync(path.join(candidate, "python.exe"))) { pyDir = candidate; break outer; }
        }
      }
    }
    if (pyDir) {
      pythonExe = path.join(pyDir, "python.exe");
      extraBins.push(pyDir);
    }
  }

  if (extraBins.length === 0) return { env, pythonExe, rBinDir };
  const current = env.PATH ?? env.Path ?? "";
  const newPath = extraBins.join(pathSep) + pathSep + current;
  return { env: { ...env, PATH: newPath, Path: newPath }, pythonExe, rBinDir };
}

/**
 * Rewrite a runner command to use absolute paths for python/python3 and Rscript
 * so the Windows App Execution Alias can never intercept them.
 */
function resolveCommand(command: string, pythonExe: string | null, rBinDir: string | null): string {
  let cmd = command;
  if (pythonExe) {
    // Replace leading `python3` or `python` word with the absolute exe path (quoted for spaces)
    const quoted = `"${pythonExe}"`;
    cmd = cmd.replace(/^python3(?=\s|$)/, quoted).replace(/^python(?=\s|$)/, quoted);
  }
  if (rBinDir) {
    const rscript = path.join(rBinDir, "Rscript" + (process.platform === "win32" ? ".exe" : ""));
    if (existsSync(rscript)) {
      const quoted = `"${rscript}"`;
      cmd = cmd.replace(/^Rscript(?=\s|$)/, quoted);
    }
  }
  return cmd;
}

type Job = {
  runner: UaisRunner;
  process: ChildProcess;
  chunks: Uint8Array[];
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  done: boolean;
  reportDir?: string;
};

// Survive Next.js HMR module re-evaluation in dev mode: attach to globalThis so the Map
// is not wiped when the stream route compiles and causes runJob.ts to be re-executed.
declare const globalThis: { __uaisJobs?: Map<string, Job> } & typeof global;
const jobs: Map<string, Job> = (globalThis.__uaisJobs ??= new Map<string, Job>());

function pushChunk(jobId: string, chunk: Uint8Array) {
  const job = jobs.get(jobId);
  if (!job) return;
  // Only buffer until first client attaches; then stream directly to avoid unbounded memory growth (OOM).
  if (!job.controller) job.chunks.push(chunk);
  if (job.controller) {
    try {
      job.controller.enqueue(chunk);
    } catch (_e) {
      // stream may be closed
    }
  }
}

function onExit(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done = true;
  if (job.controller) {
    // A stream client is already connected — close it and clean up now.
    try {
      job.controller.close();
    } catch (_e) {
      // ignore
    }
    job.controller = null;
    jobs.delete(jobId);
  }
  // If no client has connected yet, keep the job in the Map (with buffered
  // chunks) so the stream route can still deliver the output when it arrives.
  // attachStreamController will clean up after flushing.
}

/**
 * After a job exits, scan reportDir for PDF files, upload each to R2,
 * and emit a presigned download URL line into the stream.
 * Silently no-ops if reportDir is unset or R2 is unavailable.
 */
async function emitReportLinks(jobId: string, runnerId: string, reportDir?: string, jobStartTime?: number): Promise<void> {
  if (!reportDir) return;
  // Hard cap: never hold the stream open longer than 30 s waiting for R2
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
  await Promise.race([doEmitReportLinks(jobId, runnerId, reportDir, jobStartTime), timeout]);
}

async function doEmitReportLinks(jobId: string, runnerId: string, reportDir: string, jobStartTime?: number): Promise<void> {
  try {
    const entries = await readdir(reportDir).catch(() => [] as string[]);
    const pdfs = entries.filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return;

    // Only emit PDFs created or modified during this run. This prevents the entire
    // historical reports folder from flooding the stream after every run.
    const recentPdfs: string[] = [];
    if (jobStartTime) {
      for (const filename of pdfs) {
        try {
          const s = await stat(path.join(reportDir, filename));
          if (s.mtimeMs >= jobStartTime - 2000) recentPdfs.push(filename);
        } catch (_e) { /* skip unreadable files */ }
      }
    } else {
      recentPdfs.push(...pdfs);
    }
    if (recentPdfs.length === 0) return;

    const { uploadFileToR2, getPresignedUrl } = await import("../r2/upload");
    const timestamp = Date.now();

    for (const filename of recentPdfs) {
      try {
        const filePath = path.join(reportDir, filename);
        const key = `reports/${runnerId}/${timestamp}/${filename}`;
        await uploadFileToR2(filePath, key, "application/pdf");
        const url = await getPresignedUrl(key, 86400); // 24-hour link
        pushChunk(jobId, new TextEncoder().encode(`\n[REPORT] ${filename}::${url}\n`));
      } catch (_e) {
        // Non-fatal — report upload failures don't affect the run result
      }
    }
  } catch (_e) {
    // Non-fatal
  }
}

/** Maps assessment runner IDs to their data-directory env var name. */
export const ASSESSMENT_DATA_DIR_ENV: Record<string, string> = {
  pitching: "PITCHING_DATA_DIR",
  hitting: "HITTING_DATA_DIR",
  "athletic-screen": "ATHLETIC_SCREEN_DATA_DIR",
  "arm-action": "ARM_ACTION_DATA_DIR",
  curveball: "CURVEBALL_DATA_DIR",
  "pro-sup": "PRO_SUP_DATA_DIR",
  mobility: "MOBILITY_DATA_DIR",
  "readiness-screen": "READINESS_SCREEN_DATA_DIR",
  proteus: "PROTEUS_DATA_DIR",
};

export type CreateJobOptions = {
  /** When set (Existing Athlete flow), passed as ATHLETE_UUID to the process. */
  athleteUuid?: string | null;
  /**
   * R2 object keys of uploaded files to download to a temp dir before running.
   * When provided, the appropriate DATA_DIR env var is set to that temp dir.
   * Files are deleted from R2 immediately after download.
   */
  uploadedFileKeys?: string[];
  /**
   * Extra environment variables to inject into the spawned process.
   * Merged on top of process.env before any other overrides (uploads take precedence).
   */
  extraEnv?: Record<string, string>;
  /**
   * Directory to scan for PDF reports after the process exits.
   * Any PDFs found are uploaded to R2 and presigned download URLs are emitted to the stream.
   */
  reportDir?: string;
};

export function createJob(runner: UaisRunner, options?: CreateJobOptions): string {
  const jobId = crypto.randomUUID();
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options?.extraEnv ?? {}) };
  if (options?.athleteUuid?.trim()) {
    env.ATHLETE_UUID = options.athleteUuid.trim();
  }
  // Inject a unique batch ID so every pipeline can tag inserted rows with the originating job.
  // Format: ISO timestamp + jobId (chronologically sortable, globally unique).
  env.UPLOAD_BATCH_ID = `${new Date().toISOString().replace(/[:.]/g, "-")}-${jobId}`;

  // If uploaded file keys are provided, download them from R2 to a temp dir
  // and set the assessment's DATA_DIR env var. Done asynchronously; process
  // starts after downloads complete (or immediately if no uploads).
  const tempDir = path.join(process.cwd(), "tmp", `uais-${jobId}`);
  const fileKeys = options?.uploadedFileKeys ?? [];

  if (fileKeys.length > 0) {
    // Download files, then spawn. Return jobId immediately so the stream can attach.
    const job: Job = { runner, process: null as unknown as ChildProcess, chunks: [], controller: null, done: false, reportDir: options?.reportDir };
    jobs.set(jobId, job);

    void (async () => {
      try {
        const { downloadFromR2ToDir, deleteFromR2 } = await import("../r2/upload");
        for (const key of fileKeys) {
          await downloadFromR2ToDir(key, tempDir);
          // Delete from R2 immediately after download — keeps the bucket clean for the next run
          deleteFromR2(key).catch(() => undefined);
        }
        // Set the data dir env var for this runner
        const dataDirVar = ASSESSMENT_DATA_DIR_ENV[runner.id];
        if (dataDirVar) env[dataDirVar] = tempDir;

        const { env: envWithPath, pythonExe, rBinDir } = resolveRuntimes(env);
        const command = resolveCommand(runner.command, pythonExe, rBinDir);
        const jobStartTime = Date.now();
        const proc = spawn(command, [], { shell: true, cwd: runner.cwd, env: envWithPath });
        job.process = proc;
        proc.stdout?.on("data", (data: Buffer) => pushChunk(jobId, data));
        proc.stderr?.on("data", (data: Buffer) => pushChunk(jobId, data));
        proc.on("error", (err) => {
          pushChunk(jobId, new TextEncoder().encode(`\n[Process error] ${err.message}\n`));
        });
        proc.on("exit", (code, signal) => {
          const msg = code != null
            ? `\n[Process exited with code ${code}]\n`
            : `\n[Process exited with signal ${signal}]\n`;
          pushChunk(jobId, new TextEncoder().encode(msg));
          void emitReportLinks(jobId, runner.id, options?.reportDir, jobStartTime).then(() => {
            onExit(jobId);
            rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushChunk(jobId, new TextEncoder().encode(`\n[R2 download error] ${msg}\n`));
        onExit(jobId);
      }
    })();

    return jobId;
  }

  const { env: envWithPath, pythonExe, rBinDir } = resolveRuntimes(env);
  const command = resolveCommand(runner.command, pythonExe, rBinDir);
  const jobStartTime = Date.now();
  const proc = spawn(command, [], {
    shell: true,
    cwd: runner.cwd,
    env: envWithPath,
  });

  const job: Job = {
    runner,
    process: proc,
    chunks: [],
    controller: null,
    done: false,
    reportDir: options?.reportDir,
  };
  jobs.set(jobId, job);

  proc.stdout?.on("data", (data: Buffer) => pushChunk(jobId, data));
  proc.stderr?.on("data", (data: Buffer) => pushChunk(jobId, data));
  proc.on("error", (err) => {
    pushChunk(jobId, new TextEncoder().encode(`\n[Process error] ${err.message}\n`));
  });
  proc.on("exit", (code, signal) => {
    const msg = code != null
      ? `\n[Process exited with code ${code}]\n`
      : `\n[Process exited with signal ${signal}]\n`;
    pushChunk(jobId, new TextEncoder().encode(msg));
    void emitReportLinks(jobId, runner.id, options?.reportDir, jobStartTime).then(() => onExit(jobId));
  });

  return jobId;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function attachStreamController(jobId: string, controller: ReadableStreamDefaultController<Uint8Array>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.controller = controller;
  // Send any buffered chunks that were received before the client connected
  for (const chunk of job.chunks) {
    try {
      controller.enqueue(chunk);
    } catch (_e) {
      break;
    }
  }
  job.chunks = []; // Free buffer; new output streams directly via pushChunk

  // If the process already exited before the client connected, close the
  // stream immediately and clean up the job now.
  if (job.done) {
    try {
      controller.close();
    } catch (_e) {
      // ignore
    }
    job.controller = null;
    jobs.delete(jobId);
  }
}

export function writeInput(jobId: string, input: string): boolean {
  const job = jobs.get(jobId);
  if (!job?.process.stdin || job.done) return false;
  job.process.stdin.write(input);
  return true;
}

/** Send SIGTERM to the running process. Returns false if job not found or already done. */
export function killJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.done) return false;
  try {
    job.process.kill("SIGTERM");
  } catch (_e) {
    // Process may have already exited
  }
  return true;
}
