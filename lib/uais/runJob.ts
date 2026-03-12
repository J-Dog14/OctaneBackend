import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { UaisRunner } from "./runners";

/** Prepend R's bin to PATH so spawned jobs can find Rscript when the Next.js process didn't inherit it (e.g. Cursor/VS Code). */
function getEnvWithROnPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let rBin: string | null = null;
  if (process.env.R_HOME) {
    const candidate = path.join(process.env.R_HOME, "bin");
    if (existsSync(candidate)) rBin = candidate;
  }
  if (!rBin && process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const rRoot = path.join(programFiles, "R");
    if (existsSync(rRoot)) {
      const dirs = readdirSync(rRoot).filter((d) => d.startsWith("R-"));
      if (dirs.length > 0) {
        dirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        const bin = path.join(rRoot, dirs[0], "bin");
        if (existsSync(bin)) rBin = bin;
      }
    }
  }
  if (!rBin) return env;
  const pathSep = process.platform === "win32" ? ";" : ":";
  const current = env.PATH ?? env.Path ?? "";
  return { ...env, PATH: rBin + pathSep + current, Path: rBin + pathSep + current };
}

type Job = {
  runner: UaisRunner;
  process: ChildProcess;
  chunks: Uint8Array[];
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  done: boolean;
};

const jobs = new Map<string, Job>();

function pushChunk(jobId: string, chunk: Uint8Array) {
  const job = jobs.get(jobId);
  if (!job) return;
  // Only buffer until first client attaches; then stream directly to avoid unbounded memory growth (OOM).
  if (!job.controller) job.chunks.push(chunk);
  if (job.controller) {
    try {
      job.controller.enqueue(chunk);
    } catch {
      // stream may be closed
    }
  }
}

function onExit(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done = true;
  if (job.controller) {
    try {
      job.controller.close();
    } catch {
      // ignore
    }
    job.controller = null;
  }
  jobs.delete(jobId);
}

/** Maps assessment runner IDs to their data-directory env var name. */
const ASSESSMENT_DATA_DIR_ENV: Record<string, string> = {
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
   */
  uploadedFileKeys?: string[];
};

export function createJob(runner: UaisRunner, options?: CreateJobOptions): string {
  const jobId = crypto.randomUUID();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options?.athleteUuid?.trim()) {
    env.ATHLETE_UUID = options.athleteUuid.trim();
  }

  // If uploaded file keys are provided, download them from R2 to a temp dir
  // and set the assessment's DATA_DIR env var. Done asynchronously; process
  // starts after downloads complete (or immediately if no uploads).
  const tempDir = path.join(process.cwd(), "tmp", `uais-${jobId}`);
  const fileKeys = options?.uploadedFileKeys ?? [];

  if (fileKeys.length > 0) {
    // Download files, then spawn. Return jobId immediately so the stream can attach.
    const job: Job = { runner, process: null as unknown as ChildProcess, chunks: [], controller: null, done: false };
    jobs.set(jobId, job);

    void (async () => {
      try {
        const { downloadFromR2ToDir } = await import("../r2/upload");
        for (const key of fileKeys) {
          await downloadFromR2ToDir(key, tempDir);
        }
        // Set the data dir env var for this runner
        const dataDirVar = ASSESSMENT_DATA_DIR_ENV[runner.id];
        if (dataDirVar) env[dataDirVar] = tempDir;

        const envWithPath = getEnvWithROnPath(env);
        const proc = spawn(runner.command, [], { shell: true, cwd: runner.cwd, env: envWithPath });
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
          onExit(jobId);
          // Clean up temp dir
          rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushChunk(jobId, new TextEncoder().encode(`\n[R2 download error] ${msg}\n`));
        onExit(jobId);
      }
    })();

    return jobId;
  }

  const envWithPath = getEnvWithROnPath(env);
  const proc = spawn(runner.command, [], {
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
    onExit(jobId);
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
    } catch {
      break;
    }
  }
  job.chunks = []; // Free buffer; new output streams directly via pushChunk
}

export function writeInput(jobId: string, input: string): boolean {
  const job = jobs.get(jobId);
  if (!job?.process.stdin || job.done) return false;
  job.process.stdin.write(input);
  return true;
}
