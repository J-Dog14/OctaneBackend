"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUaisRunners } from "@/hooks";
import { useAgentStatus } from "@/hooks";
import { UaisAthleteSelector } from "./components/UaisAthleteSelector";
import { CloudDataConfig } from "./components/CloudDataConfig";
import { RunnerSelection } from "./components/RunnerSelection";
import { JobOutputPanel } from "./components/JobOutputPanel";
import { DuplicateSessionModal } from "./components/DuplicateSessionModal";
import { EmailCollectionModal } from "./components/EmailCollectionModal";
import { UpdateEmailModal } from "./components/UpdateEmailModal";
import { MissingDobModal } from "./components/MissingDobModal";
import { AthleteInfoUpdateModal, type MismatchItem } from "./components/AthleteInfoUpdateModal";
import type { AthleteOption, UploadedFile } from "./types";

const DUPLICATE_SESSION_REGEX = /DUPLICATE_SESSION:(\d{4}-\d{2}-\d{2})/;
const REPORT_LINE_REGEX = /\[REPORT\] ([^:]+)::([^\s]+)/g;
const NEW_ATHLETE_REGEX = /NEW_ATHLETE:([a-f0-9-]+):([^\n]+)/;
const MISSING_DOB_REGEX = /MISSING_DOB:([^:\n]+):([a-f0-9-]+)/g;
const HEIGHT_MISMATCH_REGEX = /HEIGHT_MISMATCH:([^:]+):([a-f0-9-]+):stored=([\d.]+):incoming=([\d.]+)/g;
const WEIGHT_MISMATCH_REGEX = /WEIGHT_MISMATCH:([^:]+):([a-f0-9-]+):stored=([\d.]+):incoming=([\d.]+)/g;

// Maps runner IDs to the Octane domain IDs they produce data for.
// Multiple runners can feed the same domain (e.g. pro-sup and readiness-screen → athleticScreen).
const RUNNER_DOMAIN_MAP: Record<string, string[]> = {
  "pitching":         ["pitching"],
  "curveball":        ["pitching"],
  "hitting":          ["hitting"],
  "mobility":         ["mobility"],
  "athletic-screen":  ["athleticScreen"],
  "pro-sup":          ["athleticScreen"],
  "readiness-screen": ["athleticScreen"],
  "arm-action":       ["armAction"],
  "proteus":          ["proteus"],
};

export function UaisMaintenanceContent() {
  // ── Runners (via hook) ─────────────────────────────────────────────────────
  const {
    runners,
    loading,
    error,
    runnerDataPaths,
    setRunnerDataPaths,
  } = useUaisRunners();

  const [selectedRunnerIds, setSelectedRunnerIds] = useState<Set<string>>(new Set());

  // ── Agent / sync status (via hook) ────────────────────────────────────────
  const { agentOnline, syncStatus, setSyncStatus, r2Available } = useAgentStatus();

  // ── Data mode ─────────────────────────────────────────────────────────────
  const [dataMode, setDataMode] = useState<"local" | "cloud">("local");

  // ── Upload ────────────────────────────────────────────────────────────────
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Job / streaming ───────────────────────────────────────────────────────
  const [activeJob, setActiveJob] = useState<{ jobId: string; label: string } | null>(null);
  const [runSelectedProgress, setRunSelectedProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [output, setOutput] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [runSelectedError, setRunSelectedError] = useState<string | null>(null);
  const [reportLinks, setReportLinks] = useState<{ filename: string; url: string }[]>([]);
  const outputEndRef = useRef<HTMLDivElement>(null);

  // ── Athlete search ────────────────────────────────────────────────────────
  const [runMode, setRunMode] = useState<"new" | "existing">("new");
  const [athleteSearch, setAthleteSearch] = useState("");
  const [athleteOptions, setAthleteOptions] = useState<AthleteOption[]>([]);
  const [athleteSelected, setAthleteSelected] = useState<AthleteOption | null>(null);
  const [athleteDropdownOpen, setAthleteDropdownOpen] = useState(false);
  const [filterNonApp, setFilterNonApp] = useState(false);
  const athleteSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Signal collection refs (reset each run) ──────────────────────────────
  const collectedNewAthleteRef = useRef<{ uuid: string; name: string } | null>(null);
  const collectedMissingDobsRef = useRef<Array<{ uuid: string; name: string }>>([]);
  const collectedMismatchesRef = useRef<Map<string, MismatchItem>>(new Map());

  // ── Missing DOB queue (B.2) ───────────────────────────────────────────────
  const [missingDobQueue, setMissingDobQueue] = useState<Array<{ uuid: string; name: string }>>([]);
  const [dobValue, setDobValue] = useState("");
  const [dobSaving, setDobSaving] = useState(false);

  // ── Height/weight mismatch queue (B.3) ───────────────────────────────────
  const [mismatchQueue, setMismatchQueue] = useState<MismatchItem[]>([]);
  const [mismatchSaving, setMismatchSaving] = useState(false);

  // ── New athlete completeness (B.5) ────────────────────────────────────────
  const [newAthleteCompletion, setNewAthleteCompletion] = useState<{
    uuid: string; name: string;
    missingHeight: boolean; missingWeight: boolean; missingGender: boolean;
  } | null>(null);
  const [completionHeight, setCompletionHeight] = useState("");
  const [completionWeight, setCompletionWeight] = useState("");
  const [completionGender, setCompletionGender] = useState("");
  const [completionSaving, setCompletionSaving] = useState(false);

  // ── Duplicate check (new mode) ────────────────────────────────────────────
  const [checkDuplicatesQuery, setCheckDuplicatesQuery] = useState("");
  const [checkDuplicatesResult, setCheckDuplicatesResult] = useState<
    { athlete_uuid: string; name: string; email: string | null }[] | null
  >(null);
  const [checkDuplicatesLoading, setCheckDuplicatesLoading] = useState(false);

  // ── Duplicate session modal ───────────────────────────────────────────────
  const [duplicateSessionModal, setDuplicateSessionModal] = useState<{
    jobId: string;
    date: string;
  } | null>(null);
  const duplicateSessionModalOpenRef = useRef(false);
  const duplicateSessionResponseResolverRef = useRef<(() => void) | null>(null);

  // ── Email modals ──────────────────────────────────────────────────────────
  const [emailPopup, setEmailPopup] = useState<{ athleteUuid: string; name: string } | null>(null);
  const [emailPopupValue, setEmailPopupValue] = useState("");
  const [emailPopupSaving, setEmailPopupSaving] = useState(false);
  const [updateEmailModal, setUpdateEmailModal] = useState<AthleteOption | null>(null);
  const [updateEmailValue, setUpdateEmailValue] = useState("");
  const [updateEmailSaving, setUpdateEmailSaving] = useState(false);

  // ── Send to App ───────────────────────────────────────────────────────────
  const [sendToAppStatus, setSendToAppStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [sendToAppError, setSendToAppError] = useState<string | null>(null);
  const [lastRunDomainIds, setLastRunDomainIds] = useState<string[]>([]);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const fetchAthletes = useCallback(
    async (q: string) => {
      const params = new URLSearchParams({ limit: "50" });
      if (q.trim()) params.set("q", q.trim());
      if (filterNonApp) params.set("filterNonApp", "1");
      const res = await fetch(`/api/dashboard/athletes?${params}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data?.items)) {
        setAthleteOptions(
          data.items.map((a: { athlete_uuid: string; name: string; email?: string | null }) => ({
            athlete_uuid: a.athlete_uuid,
            name: a.name ?? "",
            email: a.email ?? null,
          }))
        );
      } else {
        setAthleteOptions([]);
      }
    },
    [filterNonApp]
  );

  useEffect(() => {
    if (athleteSearchDebounce.current) clearTimeout(athleteSearchDebounce.current);
    if (runMode !== "existing") return;
    athleteSearchDebounce.current = setTimeout(() => {
      fetchAthletes(athleteSearch);
    }, 200);
    return () => {
      if (athleteSearchDebounce.current) clearTimeout(athleteSearchDebounce.current);
    };
  }, [runMode, athleteSearch, fetchAthletes]);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const primaryRunnerId =
      selectedRunnerIds.size > 0 ? Array.from(selectedRunnerIds)[0] : "generic";
    try {
      const results: UploadedFile[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("assessmentType", primaryRunnerId);
        const res = await fetch("/api/dashboard/uais/upload", { method: "POST", body: formData });
        const data = (await res.json()) as UploadedFile & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        results.push(data);
      }
      setUploadedFiles((prev) => [...prev, ...results]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeUploadedFile = async (key: string) => {
    await fetch(`/api/dashboard/uais/upload?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    setUploadedFiles((prev) => prev.filter((f) => f.key !== key));
  };

  // ── Sync agent file fetch ─────────────────────────────────────────────────
  const waitForAgentUpload = async (
    runnerId: string,
    athleteUuid?: string,
    dataPath?: string
  ): Promise<string[] | null> => {
    setSyncStatus("Fetching files from your machine…");
    try {
      const reqRes = await fetch("/api/sync/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runnerId,
          athleteUuid,
          dataPath: dataPath?.trim() || undefined,
        }),
      });
      if (!reqRes.ok) {
        const d = (await reqRes.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to create sync request");
      }
      const { requestId } = (await reqRes.json()) as { requestId: string };

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(`/api/sync/status/${requestId}`);
        const status = (await statusRes.json()) as {
          status: string;
          fileKeys?: string[];
          errorMsg?: string;
        };
        if (status.status === "fulfilled") {
          setSyncStatus(null);
          return status.fileKeys ?? [];
        }
        if (status.status === "error") {
          throw new Error(status.errorMsg ?? "Agent upload failed");
        }
        setSyncStatus(
          `Uploading files… (${Math.round((deadline - Date.now()) / 1000)}s remaining)`
        );
      }
      throw new Error("Agent did not respond in time. Is OctaneSync running?");
    } catch (e) {
      setSyncStatus(null);
      throw e;
    }
  };

  // ── Run selected ──────────────────────────────────────────────────────────
  const runSelected = async () => {
    setRunSelectedError(null);
    if (runMode === "existing" && !athleteSelected?.athlete_uuid) {
      setRunSelectedError("Select an athlete.");
      return;
    }
    const ordered = runners.filter((r) => selectedRunnerIds.has(r.id));
    if (ordered.length === 0) {
      setRunSelectedError("Select at least one source to run.");
      return;
    }
    setOutput("");
    setStreaming(true);
    setLastRunDomainIds([...new Set(ordered.flatMap(r => RUNNER_DOMAIN_MAP[r.id] ?? []))]);
    setReportLinks([]);
    setSendToAppStatus("idle");
    setSendToAppError(null);
    // Reset per-run signal collection
    collectedNewAthleteRef.current = null;
    collectedMissingDobsRef.current = [];
    collectedMismatchesRef.current = new Map();
    const athleteUuid = runMode === "existing" ? athleteSelected!.athlete_uuid : undefined;
    const total = ordered.length;
    for (let i = 0; i < ordered.length; i++) {
      const runner = ordered[i];
      setRunSelectedProgress({ current: i + 1, total, label: runner.label });
      try {
        let uploadedFileKeys: string[] | undefined;
        if (dataMode === "cloud") {
          if (agentOnline) {
            const dataPath = runnerDataPaths[runner.id];
            try {
              const keys = await waitForAgentUpload(runner.id, athleteUuid, dataPath);
              uploadedFileKeys = keys ?? undefined;
            } catch (e) {
              setOutput(
                (prev) =>
                  prev +
                  `\n[Error] ${runner.label}: ${e instanceof Error ? e.message : "Agent upload failed"}\n`
              );
              continue;
            }
          } else if (uploadedFiles.length > 0) {
            uploadedFileKeys = uploadedFiles.map((f) => f.key);
          }
        }

        const res = await fetch("/api/dashboard/uais/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runnerId: runner.id, athleteUuid, uploadedFileKeys }),
        });
        const data = await res.json();
        if (!res.ok) {
          setOutput(
            (prev) => prev + `\n[Error] ${runner.label}: ${data.error ?? res.statusText}\n`
          );
          continue;
        }
        const jobId = data.jobId;
        if (!jobId) continue;
        setActiveJob({ jobId, label: runner.label });
        setOutput((prev) => prev + `\n——— ${runner.label} ———\n`);
        await new Promise<void>((resolve) => {
          const check = async () => {
            const sres = await fetch(
              `/api/dashboard/uais/stream?jobId=${encodeURIComponent(jobId)}`
            );
            if (!sres.ok) {
              setOutput((o) => o + `[Error] ${sres.statusText}\n`);
              resolve();
              return;
            }
            const reader = sres.body?.getReader();
            if (!reader) {
              resolve();
              return;
            }
            const decoder = new TextDecoder();
            let streamText = "";
            let duplicatePromptHandled = false;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              streamText += chunk;
              let reportMatch: RegExpExecArray | null;
              REPORT_LINE_REGEX.lastIndex = 0;
              const newLinks: { filename: string; url: string }[] = [];
              while ((reportMatch = REPORT_LINE_REGEX.exec(chunk)) !== null) {
                newLinks.push({ filename: reportMatch[1], url: reportMatch[2] });
              }
              if (newLinks.length > 0) setReportLinks((prev) => [...prev, ...newLinks]);
              setOutput((o) => o + chunk);
              const match = streamText.match(DUPLICATE_SESSION_REGEX);
              if (match && !duplicatePromptHandled && !duplicateSessionModalOpenRef.current) {
                duplicatePromptHandled = true;
                duplicateSessionModalOpenRef.current = true;
                setDuplicateSessionModal({ jobId, date: match[1] });
                await new Promise<void>((resumeAfterResponse) => {
                  duplicateSessionResponseResolverRef.current = resumeAfterResponse;
                });
                duplicateSessionResponseResolverRef.current = null;
              }
              // Collect signals from this chunk (not blocking)
              if (!collectedNewAthleteRef.current) {
                const naMatch = chunk.match(NEW_ATHLETE_REGEX);
                if (naMatch) collectedNewAthleteRef.current = { uuid: naMatch[1], name: naMatch[2].trim() };
              }
              MISSING_DOB_REGEX.lastIndex = 0;
              let dobMatch: RegExpExecArray | null;
              while ((dobMatch = MISSING_DOB_REGEX.exec(chunk)) !== null) {
                const dName = dobMatch[1].trim(), dUuid = dobMatch[2].trim();
                if (!collectedMissingDobsRef.current.find(d => d.uuid === dUuid))
                  collectedMissingDobsRef.current.push({ uuid: dUuid, name: dName });
              }
              HEIGHT_MISMATCH_REGEX.lastIndex = 0;
              let hmMatch: RegExpExecArray | null;
              while ((hmMatch = HEIGHT_MISMATCH_REGEX.exec(chunk)) !== null) {
                const mUuid = hmMatch[2].trim();
                const prev = collectedMismatchesRef.current.get(mUuid) ?? { uuid: mUuid, name: hmMatch[1].trim() };
                collectedMismatchesRef.current.set(mUuid, { ...prev, heightStored: parseFloat(hmMatch[3]), heightIncoming: parseFloat(hmMatch[4]) });
              }
              WEIGHT_MISMATCH_REGEX.lastIndex = 0;
              let wmMatch: RegExpExecArray | null;
              while ((wmMatch = WEIGHT_MISMATCH_REGEX.exec(chunk)) !== null) {
                const mUuid = wmMatch[2].trim();
                const prev = collectedMismatchesRef.current.get(mUuid) ?? { uuid: mUuid, name: wmMatch[1].trim() };
                collectedMismatchesRef.current.set(mUuid, { ...prev, weightStored: parseFloat(wmMatch[3]), weightIncoming: parseFloat(wmMatch[4]) });
              }
            }
            resolve();
          };
          check();
        });
        setActiveJob(null);
      } catch (e) {
        setOutput(
          (prev) =>
            prev + `\n[Error] ${runner.label}: ${e instanceof Error ? e.message : "Failed"}\n`
        );
      }
    }
    setRunSelectedProgress(null);
    setStreaming(false);
    setUploadedFiles([]);

    // ── Post-job: process collected signals ───────────────────────────────
    // Missing DOB queue
    if (collectedMissingDobsRef.current.length > 0) {
      setMissingDobQueue([...collectedMissingDobsRef.current]);
      setDobValue("");
    }
    // Height/weight mismatch queue
    const mismatches = Array.from(collectedMismatchesRef.current.values());
    if (mismatches.length > 0) setMismatchQueue(mismatches);

    if (runMode === "new") {
      const latestRes = await fetch("/api/dashboard/athletes/latest?updated=1");
      const latestData = await latestRes.json();
      const athlete = latestData?.athlete_uuid ? latestData : null;
      if (athlete) {
        if (!athlete.email) {
          setEmailPopup({ athleteUuid: athlete.athlete_uuid, name: athlete.name ?? "This athlete" });
          setEmailPopupValue("");
        }
        // B.5: completeness check for new athletes
        const mc = {
          uuid: athlete.athlete_uuid as string,
          name: (athlete.name ?? "This athlete") as string,
          missingHeight: !athlete.height,
          missingWeight: !athlete.weight,
          missingGender: !athlete.gender,
        };
        if (mc.missingHeight || mc.missingWeight || mc.missingGender) {
          setNewAthleteCompletion(mc);
          setCompletionHeight("");
          setCompletionWeight("");
          setCompletionGender("");
        }
      }
    } else if (runMode === "existing" && athleteSelected && !athleteSelected.email) {
      // B.4: email prompt for existing athletes with no email on file
      setEmailPopup({ athleteUuid: athleteSelected.athlete_uuid, name: athleteSelected.name });
      setEmailPopupValue("");
    }
  };

  // ── Inline job controls ───────────────────────────────────────────────────
  const toggleRunnerSelection = (id: string) => {
    setSelectedRunnerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const killActiveJob = async () => {
    if (!activeJob?.jobId) return;
    await fetch("/api/dashboard/uais/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: activeJob.jobId }),
    }).catch(() => undefined);
  };

  const sendInput = async () => {
    if (!activeJob?.jobId || !inputValue.trim()) return;
    try {
      const res = await fetch("/api/dashboard/uais/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJob.jobId, input: inputValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutput((prev) => prev + `\n[Send error] ${data.error ?? res.statusText}\n`);
      } else if (data.ok === false && data.error) {
        setOutput((prev) => prev + `\n[Note] ${data.error}\n`);
      }
      setInputValue("");
    } catch (e) {
      setOutput(
        (prev) => prev + `\n[Send error] ${e instanceof Error ? e.message : "Failed"}\n`
      );
    }
  };

  // ── Duplicate check ───────────────────────────────────────────────────────
  const checkDuplicates = async () => {
    const q = checkDuplicatesQuery.trim();
    if (!q) return;
    setCheckDuplicatesLoading(true);
    setCheckDuplicatesResult(null);
    try {
      const isEmail = q.includes("@");
      const params = new URLSearchParams(isEmail ? { email: q } : { name: q });
      const res = await fetch(`/api/dashboard/athletes/check-duplicates?${params}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data?.matches)) {
        setCheckDuplicatesResult(data.matches);
      } else {
        setCheckDuplicatesResult([]);
      }
    } catch {
      setCheckDuplicatesResult([]);
    } finally {
      setCheckDuplicatesLoading(false);
    }
  };

  // ── Duplicate session modal ───────────────────────────────────────────────
  const sendDuplicateSessionResponse = async (response: "yes" | "no") => {
    if (!duplicateSessionModal?.jobId) return;
    const jobId = duplicateSessionModal.jobId;
    setDuplicateSessionModal(null);
    duplicateSessionModalOpenRef.current = false;
    try {
      const res = await fetch("/api/dashboard/uais/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, input: response }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutput((prev) => prev + `\n[Send error] ${data.error ?? res.statusText}\n`);
      } else if (data.ok === false && data.error) {
        setOutput((prev) => prev + `\n[Note] ${data.error}\n`);
      }
    } catch (e) {
      setOutput(
        (prev) => prev + `\n[Send error] ${e instanceof Error ? e.message : "Failed"}\n`
      );
    } finally {
      const resume = duplicateSessionResponseResolverRef.current;
      duplicateSessionResponseResolverRef.current = null;
      if (resume) resume();
    }
  };

  // ── Email popups ──────────────────────────────────────────────────────────
  const saveEmailPopup = async () => {
    if (!emailPopup?.athleteUuid) return;
    setEmailPopupSaving(true);
    try {
      const res = await fetch(`/api/dashboard/athletes/${emailPopup.athleteUuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailPopupValue.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEmailPopup(null);
      setEmailPopupValue("");
    } catch {
      setRunSelectedError("Failed to save email.");
    } finally {
      setEmailPopupSaving(false);
    }
  };

  const saveUpdateEmail = async () => {
    if (!updateEmailModal?.athlete_uuid) return;
    setUpdateEmailSaving(true);
    try {
      const res = await fetch(`/api/dashboard/athletes/${updateEmailModal.athlete_uuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: updateEmailValue.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setUpdateEmailModal(null);
      setUpdateEmailValue("");
      setAthleteSelected((prev) =>
        prev?.athlete_uuid === updateEmailModal.athlete_uuid
          ? { ...prev, email: updateEmailValue.trim() || null }
          : prev
      );
      fetchAthletes(athleteSearch);
    } catch {
      setRunSelectedError("Failed to save email.");
    } finally {
      setUpdateEmailSaving(false);
    }
  };

  // ── Missing DOB handlers (B.2) ───────────────────────────────────────────
  const saveMissingDob = async () => {
    const current = missingDobQueue[0];
    if (!current || !dobValue) return;
    setDobSaving(true);
    try {
      await fetch(`/api/dashboard/athletes/${current.uuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_of_birth: dobValue }),
      });
    } catch { /* silently continue */ }
    finally {
      setDobSaving(false);
      setMissingDobQueue((prev) => prev.slice(1));
      setDobValue("");
    }
  };

  const skipMissingDob = () => {
    setMissingDobQueue((prev) => prev.slice(1));
    setDobValue("");
  };

  // ── Mismatch handlers (B.3) ───────────────────────────────────────────────
  const confirmMismatch = async () => {
    const current = mismatchQueue[0];
    if (!current) return;
    setMismatchSaving(true);
    try {
      const body: Record<string, number> = {};
      if (current.heightIncoming !== undefined) body.height = current.heightIncoming;
      if (current.weightIncoming !== undefined) body.weight = current.weightIncoming;
      await fetch(`/api/dashboard/athletes/${current.uuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* silently continue */ }
    finally {
      setMismatchSaving(false);
      setMismatchQueue((prev) => prev.slice(1));
    }
  };

  const skipMismatch = () => setMismatchQueue((prev) => prev.slice(1));

  // ── New athlete completeness handler (B.5) ────────────────────────────────
  const saveCompletion = async () => {
    if (!newAthleteCompletion) return;
    setCompletionSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (newAthleteCompletion.missingHeight && completionHeight.trim())
        body.height = parseFloat(completionHeight);
      if (newAthleteCompletion.missingWeight && completionWeight.trim())
        body.weight = parseFloat(completionWeight);
      if (newAthleteCompletion.missingGender && completionGender.trim())
        body.gender = completionGender.trim();
      if (Object.keys(body).length > 0) {
        await fetch(`/api/dashboard/athletes/${newAthleteCompletion.uuid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
    } catch { /* silently continue */ }
    finally {
      setCompletionSaving(false);
      setNewAthleteCompletion(null);
    }
  };

  // ── Send to App ───────────────────────────────────────────────────────────
  const handleSendToApp = useCallback(async () => {
    if (!athleteSelected) return;
    setSendToAppStatus("sending");
    setSendToAppError(null);
    try {
      const res = await fetch("/api/dashboard/send-to-octane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteUuid: athleteSelected.athlete_uuid,
          domainIds: lastRunDomainIds.length > 0 ? lastRunDomainIds : undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setSendToAppStatus("error");
        setSendToAppError(data.error ?? "Unknown error");
      } else {
        setSendToAppStatus("success");
      }
    } catch (err) {
      setSendToAppStatus("error");
      setSendToAppError(err instanceof Error ? err.message : "Network error");
    }
  }, [athleteSelected, lastRunDomainIds]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>UAIS Maintenance</h1>
      <p className="text-muted" style={{ marginBottom: "0.5rem" }}>
        For <strong>New Athlete</strong>, running Athletic Screen first is recommended. For{" "}
        <strong>Existing Athlete</strong>, select an athlete and which sources to run. Output
        streams below; use the input field when a script prompts for input (e.g. athlete
        conflicts).
      </p>
      <p className="text-muted" style={{ marginBottom: "1.5rem", fontSize: "14px" }}>
        If no email is found in the data for a new athlete, they will not be linkable to the app
        until you add one.
      </p>

      {error && (
        <div
          className="card"
          style={{
            marginBottom: "1rem",
            borderColor: "var(--accent-secondary)",
            borderWidth: "1px",
            borderStyle: "solid",
          }}
        >
          {error}
        </div>
      )}
      {runSelectedError && (
        <div
          className="card"
          style={{
            marginBottom: "1rem",
            borderColor: "var(--accent-secondary)",
            borderWidth: "1px",
            borderStyle: "solid",
          }}
        >
          {runSelectedError}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Add/Run New Data</h2>

        <UaisAthleteSelector
          runMode={runMode}
          setRunMode={setRunMode}
          checkDuplicatesQuery={checkDuplicatesQuery}
          setCheckDuplicatesQuery={setCheckDuplicatesQuery}
          checkDuplicatesResult={checkDuplicatesResult}
          setCheckDuplicatesResult={setCheckDuplicatesResult}
          checkDuplicatesLoading={checkDuplicatesLoading}
          onCheckDuplicates={checkDuplicates}
          filterNonApp={filterNonApp}
          setFilterNonApp={setFilterNonApp}
          athleteSearch={athleteSearch}
          setAthleteSearch={setAthleteSearch}
          athleteOptions={athleteOptions}
          athleteSelected={athleteSelected}
          setAthleteSelected={setAthleteSelected}
          athleteDropdownOpen={athleteDropdownOpen}
          setAthleteDropdownOpen={setAthleteDropdownOpen}
          onOpenUpdateEmail={(a) => {
            setUpdateEmailModal(a);
            setUpdateEmailValue("");
          }}
        />

        <CloudDataConfig
          dataMode={dataMode}
          setDataMode={setDataMode}
          streaming={streaming}
          agentOnline={agentOnline}
          syncStatus={syncStatus}
          r2Available={r2Available}
          uploadedFiles={uploadedFiles}
          uploading={uploading}
          uploadError={uploadError}
          selectedRunnerIds={selectedRunnerIds}
          onFileSelect={(files) => void handleFileSelect(files)}
          onRemoveFile={(key) => void removeUploadedFile(key)}
        />

        {loading ? (
          <p className="text-muted">Loading runners…</p>
        ) : runners.length === 0 ? (
          <p className="text-muted">
            No runners configured. Set env vars (see lib/uais/runners.ts) or create
            config/uais-runners.json (or path in UAIS_RUNNERS_CONFIG) with an array of &#123; id,
            label, cwd, command &#125;. See config/uais-runners.example.json.
          </p>
        ) : (
          <>
            <RunnerSelection
              runners={runners}
              selectedRunnerIds={selectedRunnerIds}
              onToggleRunner={toggleRunnerSelection}
              streaming={streaming}
              dataMode={dataMode}
              agentOnline={agentOnline}
              runnerDataPaths={runnerDataPaths}
              setRunnerDataPaths={setRunnerDataPaths}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => void runSelected()}
              disabled={streaming}
            >
              {uploadedFiles.length > 0
                ? `Run selected (${uploadedFiles.length} file${uploadedFiles.length !== 1 ? "s" : ""} uploaded)`
                : "Run selected"}
            </button>
            <p className="text-muted" style={{ marginTop: "0.75rem", fontSize: "13px" }}>
              <Link href="/docs/UAIS_RUNNERS_TROUBLESHOOTING">Troubleshooting</Link>
            </p>
          </>
        )}
        {!loading && runners.length === 0 && (
          <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "13px" }}>
            <Link href="/docs/UAIS_RUNNERS_TROUBLESHOOTING">Troubleshooting</Link>
          </p>
        )}
      </div>

      <JobOutputPanel
        output={output}
        activeJob={activeJob}
        streaming={streaming}
        runSelectedProgress={runSelectedProgress}
        inputValue={inputValue}
        setInputValue={setInputValue}
        reportLinks={reportLinks}
        outputEndRef={outputEndRef}
        onSendInput={() => void sendInput()}
        onKill={() => void killActiveJob()}
      />

      <DuplicateSessionModal
        modal={duplicateSessionModal}
        onResponse={(r) => void sendDuplicateSessionResponse(r)}
      />

      {/* Send to App button — appears after a successful run for an existing athlete */}
      {runMode === 'existing' &&
        athleteSelected &&
        !streaming &&
        !error &&
        !activeJob &&
        output.length > 0 && (
          <div style={{ marginTop: 16, padding: '12px 16px', border: '1px solid #2c2e33', borderRadius: 8 }}>
            <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 14 }}>
              Send to Octane App
            </div>
            <div style={{ marginBottom: 8, fontSize: 13, color: '#adb5bd' }}>
              Push{' '}
              {lastRunDomainIds.length > 0
                ? lastRunDomainIds.join(', ')
                : 'available'}{' '}
              data for <strong>{athleteSelected.name}</strong> to their Octane account.
            </div>

            {sendToAppStatus === 'success' && (
              <div style={{ color: '#40c057', fontSize: 13, marginBottom: 8 }}>
                ✓ Sent successfully
              </div>
            )}
            {sendToAppStatus === 'error' && (
              <div style={{ color: '#fa5252', fontSize: 13, marginBottom: 8 }}>
                ✗ Error: {sendToAppError}
              </div>
            )}

            <button
              onClick={handleSendToApp}
              disabled={sendToAppStatus === 'sending'}
              style={{
                padding: '8px 20px',
                background: sendToAppStatus === 'sending' ? '#495057' : '#228be6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: sendToAppStatus === 'sending' ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {sendToAppStatus === 'sending' ? 'Sending…' : 'Send to App'}
            </button>
          </div>
        )}

      <EmailCollectionModal
        emailPopup={emailPopup}
        emailPopupValue={emailPopupValue}
        setEmailPopupValue={setEmailPopupValue}
        emailPopupSaving={emailPopupSaving}
        onSave={() => void saveEmailPopup()}
        onSkip={() => {
          setEmailPopup(null);
          setRunSelectedError("This athlete will not be able to be linked to the app.");
        }}
      />

      <UpdateEmailModal
        athlete={updateEmailModal}
        emailValue={updateEmailValue}
        setEmailValue={setUpdateEmailValue}
        saving={updateEmailSaving}
        onSave={() => void saveUpdateEmail()}
        onCancel={() => {
          setUpdateEmailModal(null);
          setUpdateEmailValue("");
        }}
      />

      <MissingDobModal
        item={missingDobQueue[0] ?? null}
        dobValue={dobValue}
        setDobValue={setDobValue}
        saving={dobSaving}
        onSave={() => void saveMissingDob()}
        onSkip={skipMissingDob}
      />

      <AthleteInfoUpdateModal
        item={mismatchQueue[0] ?? null}
        saving={mismatchSaving}
        onConfirm={() => void confirmMismatch()}
        onSkip={skipMismatch}
      />

      {newAthleteCompletion && (
        <div
          className="card"
          style={{ marginBottom: "1rem", borderColor: "var(--accent)", borderWidth: "1px", borderStyle: "solid" }}
        >
          <h3 style={{ margin: "0 0 0.5rem" }}>Complete athlete profile</h3>
          <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
            Some information is missing for <strong>{newAthleteCompletion.name}</strong>. Fill in
            what you have (all fields optional).
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "280px", marginBottom: "0.75rem" }}>
            {newAthleteCompletion.missingHeight && (
              <label style={{ fontSize: "14px" }}>
                Height (inches)
                <input
                  type="number"
                  value={completionHeight}
                  onChange={(e) => setCompletionHeight(e.target.value)}
                  placeholder="e.g. 72"
                  style={{ display: "block", width: "100%", marginTop: "2px" }}
                />
              </label>
            )}
            {newAthleteCompletion.missingWeight && (
              <label style={{ fontSize: "14px" }}>
                Weight (lbs)
                <input
                  type="number"
                  value={completionWeight}
                  onChange={(e) => setCompletionWeight(e.target.value)}
                  placeholder="e.g. 185"
                  style={{ display: "block", width: "100%", marginTop: "2px" }}
                />
              </label>
            )}
            {newAthleteCompletion.missingGender && (
              <label style={{ fontSize: "14px" }}>
                Gender
                <select
                  value={completionGender}
                  onChange={(e) => setCompletionGender(e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: "2px" }}
                >
                  <option value="">— select —</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-primary" onClick={() => void saveCompletion()} disabled={completionSaving}>
              {completionSaving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setNewAthleteCompletion(null)}>
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
