"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Runner = { id: string; label: string };
type AthleteOption = { athlete_uuid: string; name: string; email?: string | null };

const DUPLICATE_SESSION_REGEX = /DUPLICATE_SESSION:(\d{4}-\d{2}-\d{2})/;

export default function UaisMaintenancePage() {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [selectedRunnerIds, setSelectedRunnerIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<{ jobId: string; label: string } | null>(null);
  const [runSelectedProgress, setRunSelectedProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [output, setOutput] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSelectedError, setRunSelectedError] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const [runMode, setRunMode] = useState<"new" | "existing">("new");
  const [athleteSearch, setAthleteSearch] = useState("");
  const [athleteOptions, setAthleteOptions] = useState<AthleteOption[]>([]);
  const [athleteSelected, setAthleteSelected] = useState<AthleteOption | null>(null);
  const [athleteDropdownOpen, setAthleteDropdownOpen] = useState(false);
  const [filterNonApp, setFilterNonApp] = useState(false);
  const athleteSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [emailPopup, setEmailPopup] = useState<{ athleteUuid: string; name: string } | null>(null);
  const [emailPopupValue, setEmailPopupValue] = useState("");
  const [emailPopupSaving, setEmailPopupSaving] = useState(false);
  const [updateEmailModal, setUpdateEmailModal] = useState<AthleteOption | null>(null);
  const [updateEmailValue, setUpdateEmailValue] = useState("");
  const [updateEmailSaving, setUpdateEmailSaving] = useState(false);

  const [duplicateSessionModal, setDuplicateSessionModal] = useState<{ jobId: string; date: string } | null>(null);
  const duplicateSessionModalOpenRef = useRef(false);
  const duplicateSessionResponseResolverRef = useRef<(() => void) | null>(null);

  const [checkDuplicatesQuery, setCheckDuplicatesQuery] = useState("");
  const [checkDuplicatesResult, setCheckDuplicatesResult] = useState<{ athlete_uuid: string; name: string; email: string | null }[] | null>(null);
  const [checkDuplicatesLoading, setCheckDuplicatesLoading] = useState(false);

  type UploadedFile = { key: string; filename: string; size: number };
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [r2Available, setR2Available] = useState<boolean | null>(null);

  // Probe R2 availability by attempting a dry-run OPTIONS check
  useEffect(() => {
    fetch("/api/dashboard/uais/upload", { method: "HEAD" })
      .then((r) => setR2Available(r.status !== 503))
      .catch(() => setR2Available(false));
  }, []);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const primaryRunnerId = selectedRunnerIds.size > 0 ? Array.from(selectedRunnerIds)[0] : "generic";
    try {
      const results: UploadedFile[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("assessmentType", primaryRunnerId);
        const res = await fetch("/api/dashboard/uais/upload", { method: "POST", body: formData });
        const data = await res.json() as UploadedFile & { error?: string };
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

  const loadRunners = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/uais/runners");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load runners");
      setRunners(data.runners ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runners");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRunners();
  }, [loadRunners]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const fetchAthletes = useCallback(async (q: string) => {
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
  }, [filterNonApp]);

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

  const readStream = useCallback(async (jobId: string) => {
    setStreaming(true);
    try {
      const res = await fetch(`/api/dashboard/uais/stream?jobId=${encodeURIComponent(jobId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setOutput((prev) => prev + `\n[Error] ${data.error ?? res.statusText}\n`);
        setActiveJob(null);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setOutput((prev) => prev + "\n[Error] No stream body\n");
        setActiveJob(null);
        return;
      }
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setOutput(accumulated);
        const match = accumulated.match(DUPLICATE_SESSION_REGEX);
        if (match && !duplicateSessionModalOpenRef.current) {
          duplicateSessionModalOpenRef.current = true;
          setDuplicateSessionModal({ jobId, date: match[1] });
        }
      }
      outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setOutput((prev) => prev + `\n[Error] ${e instanceof Error ? e.message : "Stream failed"}\n`);
    } finally {
      setStreaming(false);
      setActiveJob(null);
    }
  }, []);

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
    setError(null);
    setStreaming(true);
    const athleteUuid = runMode === "existing" ? athleteSelected!.athlete_uuid : undefined;
    const total = ordered.length;
    for (let i = 0; i < ordered.length; i++) {
      const runner = ordered[i];
      setRunSelectedProgress({ current: i + 1, total, label: runner.label });
      try {
        const uploadedFileKeys = uploadedFiles.length > 0 ? uploadedFiles.map((f) => f.key) : undefined;
        const res = await fetch("/api/dashboard/uais/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runnerId: runner.id, athleteUuid, uploadedFileKeys }),
        });
        const data = await res.json();
        if (!res.ok) {
          setOutput((prev) => prev + `\n[Error] ${runner.label}: ${data.error ?? res.statusText}\n`);
          continue;
        }
        const jobId = data.jobId;
        if (!jobId) continue;
        setActiveJob({ jobId, label: runner.label });
        setOutput((prev) => prev + `\n——— ${runner.label} ———\n`);
        await new Promise<void>((resolve) => {
          const check = async () => {
            const sres = await fetch(`/api/dashboard/uais/stream?jobId=${encodeURIComponent(jobId)}`);
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
            }
            resolve();
          };
          check();
        });
        setActiveJob(null);
      } catch (e) {
        setOutput((prev) => prev + `\n[Error] ${runner.label}: ${e instanceof Error ? e.message : "Failed"}\n`);
      }
    }
    setRunSelectedProgress(null);
    setStreaming(false);
    setUploadedFiles([]);
    if (runMode === "new") {
      const latestRes = await fetch("/api/dashboard/athletes/latest?updated=1");
      const latestData = await latestRes.json();
      const athlete = latestData?.athlete_uuid ? latestData : null;
      if (athlete && (athlete.email == null || athlete.email === "")) {
        setEmailPopup({ athleteUuid: athlete.athlete_uuid, name: athlete.name ?? "This athlete" });
        setEmailPopupValue("");
      }
    }
  };

  const toggleRunnerSelection = (id: string) => {
    setSelectedRunnerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      setOutput((prev) => prev + `\n[Send error] ${e instanceof Error ? e.message : "Failed"}\n`);
    }
  };

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
      setOutput((prev) => prev + `\n[Send error] ${e instanceof Error ? e.message : "Failed"}\n`);
    } finally {
      const resume = duplicateSessionResponseResolverRef.current;
      duplicateSessionResponseResolverRef.current = null;
      if (resume) resume();
    }
  };

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

  const hasNoEmail = (a: AthleteOption) => a.email == null || a.email === "";

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>
        UAIS Maintenance
      </h1>
      <p className="text-muted" style={{ marginBottom: "0.5rem" }}>
        For <strong>New Athlete</strong>, running Athletic Screen first is recommended. For <strong>Existing Athlete</strong>, select an athlete and which sources to run. Output streams below; use the input field when a script prompts for input (e.g. athlete conflicts).
      </p>
      <p className="text-muted" style={{ marginBottom: "1.5rem", fontSize: "14px" }}>
        If no email is found in the data for a new athlete, they will not be linkable to the app until you add one.
      </p>

      {error && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent-secondary)", borderWidth: "1px", borderStyle: "solid" }}>
          {error}
        </div>
      )}
      {runSelectedError && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent-secondary)", borderWidth: "1px", borderStyle: "solid" }}>
          {runSelectedError}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Add/Run New Data</h2>
        <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="radio" name="runMode" checked={runMode === "new"} onChange={() => setRunMode("new")} />
            New Athlete
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="radio" name="runMode" checked={runMode === "existing"} onChange={() => { setRunMode("existing"); setCheckDuplicatesResult(null); }} />
            Existing Athlete
          </label>
          {runMode === "new" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={checkDuplicatesQuery}
                  onChange={(e) => { setCheckDuplicatesQuery(e.target.value); setCheckDuplicatesResult(null); }}
                  placeholder="Check for duplicates (name or email)"
                  style={{ minWidth: "200px", padding: "0.35rem 0.5rem" }}
                />
                <button type="button" className="btn-ghost" onClick={checkDuplicates} disabled={checkDuplicatesLoading || !checkDuplicatesQuery.trim()}>
                  {checkDuplicatesLoading ? "Checking…" : "Check"}
                </button>
                {checkDuplicatesResult !== null && (
                  <span className="text-muted" style={{ fontSize: "13px" }}>
                    {checkDuplicatesResult.length === 0
                      ? "No matches."
                      : `${checkDuplicatesResult.length} possible existing athlete(s). Use Existing Athlete instead?`}
                  </span>
                )}
              </div>
              {checkDuplicatesResult != null && checkDuplicatesResult.length > 0 && (
                <ul style={{ margin: "0.25rem 0 0 1rem", paddingLeft: "1rem", fontSize: "14px" }}>
                  {checkDuplicatesResult.map((a) => (
                    <li key={a.athlete_uuid}>
                      <Link href={`/dashboard/athletes/${a.athlete_uuid}`}>{a.name}</Link>
                      {a.email && <span className="text-muted"> — {a.email}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {runMode === "existing" && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" checked={filterNonApp} onChange={(e) => setFilterNonApp(e.target.checked)} />
                Filter Non App Athletes
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={athleteSelected ? athleteSelected.name : athleteSearch}
                  onChange={(e) => {
                    setAthleteSelected(null);
                    setAthleteSearch(e.target.value);
                    setAthleteDropdownOpen(true);
                  }}
                  onFocus={() => setAthleteDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setAthleteDropdownOpen(false), 150)}
                  placeholder="Search athletes…"
                  style={{ minWidth: "220px", padding: "0.35rem 0.5rem" }}
                />
                {athleteDropdownOpen && athleteOptions.length > 0 && (
                  <ul
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      margin: 0,
                      padding: "0.25rem 0",
                      listStyle: "none",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      maxHeight: "200px",
                      overflow: "auto",
                      zIndex: 10,
                    }}
                  >
                    {athleteOptions.map((a) => (
                      <li
                        key={a.athlete_uuid}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setAthleteSelected(a);
                          setAthleteSearch(a.name);
                          setAthleteDropdownOpen(false);
                        }}
                        style={{ padding: "0.4rem 0.75rem", cursor: "pointer" }}
                      >
                        {a.name}
                        {hasNoEmail(a) && <span className="text-muted" style={{ marginLeft: "0.5rem", fontSize: "12px" }}> (no email)</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {athleteSelected && hasNoEmail(athleteSelected) && (
                <button type="button" className="btn-ghost" onClick={() => { setUpdateEmailModal(athleteSelected); setUpdateEmailValue(""); }}>
                  Update Email
                </button>
              )}
            </>
          )}
        </div>

        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Which data to run</h2>
        {loading ? (
          <p className="text-muted">Loading runners…</p>
        ) : runners.length === 0 ? (
          <p className="text-muted">No runners configured. Set env vars (see lib/uais/runners.ts) or create config/uais-runners.json (or path in UAIS_RUNNERS_CONFIG) with an array of &#123; id, label, cwd, command &#125;. See config/uais-runners.example.json.</p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
              {runners.map((r) => {
                const selected = selectedRunnerIds.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => !streaming && toggleRunnerSelection(r.id)}
                    disabled={streaming}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: selected ? "rgba(34, 197, 94, 0.25)" : "var(--bg-primary)",
                      color: "var(--text-primary)",
                      cursor: streaming ? "not-allowed" : "pointer",
                      fontWeight: selected ? 600 : 400,
                      transition: "background 0.15s ease",
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            {/* File upload section — shown when R2 is available */}
            {r2Available && selectedRunnerIds.size > 0 && (
              <div style={{ margin: "1rem 0", padding: "0.75rem 1rem", border: "1px dashed var(--border)", borderRadius: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>Upload data files</span>
                  <span className="text-muted" style={{ fontSize: "12px" }}>Files are sent to the cloud processor before running</span>
                </div>
                {uploadError && (
                  <p style={{ color: "var(--error, #e53e3e)", fontSize: "13px", margin: "0 0 0.5rem" }}>{uploadError}</p>
                )}
                <label
                  style={{ display: "inline-block", cursor: "pointer" }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); void handleFileSelect(e.dataTransfer.files); }}
                >
                  <input
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => void handleFileSelect(e.target.files)}
                    disabled={uploading || streaming}
                  />
                  <span className="btn-ghost" style={{ pointerEvents: "none" }}>
                    {uploading ? "Uploading…" : "Choose files or drop here"}
                  </span>
                </label>
                {uploadedFiles.length > 0 && (
                  <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {uploadedFiles.map((f) => (
                      <li
                        key={f.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          padding: "0.3rem 0.6rem",
                          background: "rgba(34,197,94,0.15)",
                          borderRadius: "6px",
                          fontSize: "13px",
                        }}
                      >
                        <span>{f.filename}</span>
                        <span className="text-muted">({(f.size / 1024).toFixed(0)} KB)</span>
                        <button
                          type="button"
                          onClick={() => void removeUploadedFile(f.key)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1, padding: "0 2px" }}
                          title="Remove"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button type="button" className="btn-primary" onClick={runSelected} disabled={streaming}>
              {uploadedFiles.length > 0 ? `Run selected (${uploadedFiles.length} file${uploadedFiles.length !== 1 ? "s" : ""} uploaded)` : "Run selected"}
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

      {(output || activeJob || streaming || runSelectedProgress) && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
            {runSelectedProgress ? `Running ${runSelectedProgress.current} of ${runSelectedProgress.total}: ${runSelectedProgress.label}` : activeJob ? `${activeJob.label} — running` : "Output"}
          </h2>
          <pre
            style={{
              margin: 0,
              padding: "0.75rem",
              background: "var(--bg-primary)",
              borderRadius: "6px",
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              maxHeight: "400px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {output || (streaming ? "Starting…" : "")}
            <span ref={outputEndRef} />
          </pre>
          {activeJob && (
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendInput()}
                placeholder="Type input for the process (e.g. 1 for conflict) and press Enter"
                style={{ flex: 1 }}
              />
              <button type="button" className="btn-primary" onClick={sendInput}>Send</button>
            </div>
          )}
        </div>
      )}

      {duplicateSessionModal && (
        <div
          role="dialog"
          aria-labelledby="duplicate-session-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={(e) => e.target === e.currentTarget && sendDuplicateSessionResponse("no")}
        >
          <div
            className="card"
            style={{
              maxWidth: "400px",
              margin: "1rem",
              borderColor: "var(--accent-secondary)",
              borderWidth: "1px",
              borderStyle: "solid",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="duplicate-session-title" style={{ margin: "0 0 0.5rem" }}>
              Duplicate session?
            </h3>
            <p className="text-muted" style={{ marginBottom: "1rem" }}>
              It looks like you already ran this data for the following date: <strong>{duplicateSessionModal.date}</strong>. Are you sure you want to continue?
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => sendDuplicateSessionResponse("yes")}
              >
                Yes
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => sendDuplicateSessionResponse("no")}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {emailPopup && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent)", borderWidth: "1px", borderStyle: "solid" }}>
          <h3 style={{ margin: "0 0 0.5rem" }}>Add email for this athlete?</h3>
          <p className="text-muted" style={{ marginBottom: "0.5rem" }}>
            <Link href={`/dashboard/athletes/${emailPopup.athleteUuid}`}>{emailPopup.name}</Link> has no email and won’t be linkable to the app until one is set.
          </p>
          <input
            type="email"
            value={emailPopupValue}
            onChange={(e) => setEmailPopupValue(e.target.value)}
            placeholder="Email (optional)"
            style={{ marginBottom: "0.5rem", display: "block", width: "100%", maxWidth: "320px" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={saveEmailPopup} disabled={emailPopupSaving}>
              {emailPopupSaving ? "Saving…" : "Save email"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEmailPopup(null);
                setRunSelectedError("This athlete will not be able to be linked to the app.");
              }}
            >
              Continue without email
            </button>
          </div>
          <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "13px" }}>
            If you continue without email: this athlete will not be able to be linked to the app.
          </p>
        </div>
      )}

      {updateEmailModal && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent)", borderWidth: "1px", borderStyle: "solid" }}>
          <h3 style={{ margin: "0 0 0.5rem" }}>Update email for {updateEmailModal.name}</h3>
          <input
            type="email"
            value={updateEmailValue}
            onChange={(e) => setUpdateEmailValue(e.target.value)}
            placeholder="Email"
            style={{ marginBottom: "0.5rem", display: "block", width: "100%", maxWidth: "320px" }}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-primary" onClick={saveUpdateEmail} disabled={updateEmailSaving}>
              {updateEmailSaving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setUpdateEmailModal(null); setUpdateEmailValue(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
