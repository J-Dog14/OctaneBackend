"use client";

type Props = {
  cmj_z:         number | null;
  ppu_z:         number | null;
  iso_z:         number | null;
  power_curve_z: number | null;
  grip_z:        number | null;
  metrics_used:  number | null;
  scoring_tier:  string | null;
};

const TIER_LABELS: Record<string, string> = {
  FIRST_RUN: "Peer comparison",
  A_TO_B:    "vs. last session",
};

function zDirection(z: number | null): "up" | "down" | "flat" {
  if (z === null) return "flat";
  if (z >= 0.6)   return "up";
  if (z <= -0.6)  return "down";
  return "flat";
}

export function SubScoreBars({
  cmj_z, ppu_z, iso_z, power_curve_z, grip_z, metrics_used, scoring_tier,
}: Props) {
  const scores = [
    { label: "CMJ z",         z: cmj_z },
    { label: "PPU z",         z: ppu_z },
    { label: "Isometric z",   z: iso_z },
    { label: "Power curve z", z: power_curve_z },
    { label: "Grip z",        z: grip_z },
  ];

  const tierLabel = scoring_tier ? TIER_LABELS[scoring_tier] : null;

  return (
    <div>
      {tierLabel && (
        <span className="badge badge-accent" style={{ marginBottom: "0.65rem", display: "inline-flex" }}>
          {tierLabel}
        </span>
      )}
      <div className="stat-grid" style={{ marginTop: tierLabel ? "0.4rem" : 0 }}>
        {scores.map(({ label, z }) => {
          const dir  = zDirection(z);
          const sign = z !== null && z > 0 ? "+" : "";
          const verb = dir === "up" ? "above baseline" : dir === "down" ? "below baseline" : "stable";
          return (
            <div key={label} className={`stat ${dir}`}>
              <div className="stat-label">{label}</div>
              <div className="stat-value">
                {z !== null ? `${sign}${z.toFixed(2)} σ` : <span className="text-muted">—</span>}
              </div>
              {z !== null && <div className={`stat-delta ${dir}`}>{verb}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: "0.5rem", fontSize: "0.68rem", color: "var(--text-muted)" }}>
        {metrics_used ?? 0} metrics scored
      </div>
    </div>
  );
}
