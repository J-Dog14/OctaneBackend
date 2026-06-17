CREATE TABLE "public"."audit_log" (
    "id"             TEXT NOT NULL,
    "run_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "duration_ms"    INTEGER NOT NULL,
    "triggered_by"   TEXT NOT NULL,
    "critical_count" INTEGER NOT NULL,
    "warning_count"  INTEGER NOT NULL,
    "info_count"     INTEGER NOT NULL,
    "report_json"    JSONB NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
