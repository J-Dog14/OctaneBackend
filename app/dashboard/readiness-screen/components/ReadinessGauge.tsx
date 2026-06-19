"use client";

type Props = {
  score: number | null;
  band:  string | null;
  date?: string | null;
};

const CIRCUMFERENCE = 2 * Math.PI * 84; // ≈ 527.8

function arcColor(band: string | null): string {
  if (band === "READY")    return "var(--accent-green, #3ecf8e)";
  if (band === "CAUTION")  return "var(--accent-yellow, #e7b53c)";
  if (band === "FATIGUED") return "var(--accent-red, #f06a6a)";
  return "var(--text-muted, #6e7681)";
}

function bandLabel(band: string | null): string {
  if (band === "READY")    return "Ready to train";
  if (band === "CAUTION")  return "Monitor load";
  if (band === "FATIGUED") return "Modify training";
  return "Insufficient data";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const p = d.split("-");
  if (p.length !== 3) return d;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(p[1]!, 10) - 1]} ${parseInt(p[2]!, 10)}`;
}

export function ReadinessGauge({ score, band, date }: Props) {
  const filled = score !== null ? (Math.max(0, Math.min(100, score)) / 100) * CIRCUMFERENCE : 0;
  const color  = arcColor(band);
  const label  = score !== null ? Math.round(score).toString() : "—";

  return (
    <div style={{ position: "relative", width: 210, height: 210, flexShrink: 0 }}>
      <svg viewBox="0 0 210 210" width="210" height="210" aria-label={`Readiness score: ${label}`}>
        {/* Background ring */}
        <circle
          cx="105" cy="105" r="84"
          fill="none"
          stroke="var(--bg-inset, #0d1117)"
          strokeWidth="18"
        />
        {/* Filled arc — rotated so 0 starts at top */}
        <circle
          cx="105" cy="105" r="84"
          fill="none"
          stroke={color}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${filled.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
          transform="rotate(-90 105 105)"
          style={{ transition: "stroke-dasharray 0.5s ease" }}
        />
      </svg>
      {/* Centered text overlay */}
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        gap: 2,
      }}>
        <span style={{
          fontSize: "2.75rem",
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          letterSpacing: "-0.03em",
          color: score !== null ? color : "rgba(255,255,255,0.2)",
          lineHeight: 1,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          color: score !== null ? color : "rgba(255,255,255,0.2)",
          letterSpacing: "0.04em",
          textAlign: "center",
          maxWidth: 130,
        }}>
          {bandLabel(band)}
        </span>
        {date && (
          <span style={{ fontSize: "0.67rem", color: "var(--text-muted)", marginTop: 3 }}>
            {fmtDate(date)}
          </span>
        )}
      </div>
    </div>
  );
}
