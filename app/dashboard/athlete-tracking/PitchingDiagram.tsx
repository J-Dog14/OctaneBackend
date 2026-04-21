"use client";

/**
 * PitchingDiagram v3 — Real skeleton imagery for pitching report sections.
 *
 * Images live in /public/biomech/ and are served as static assets.
 * Shoulder External Rotation shows two images (arm timing + ER position).
 */

import React from "react";

const BASE: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: 220,
  borderRadius: 10,
  border: "1px solid #243044",
  flexShrink: 0,
};

function Img({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} style={BASE} />;
}

// Shoulder ER gets two stacked images
function ShoulderExternalRotationDiagram() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flexShrink: 0, width: "100%", maxWidth: 220 }}>
      <img src="/biomech/arm-timing.jpg" alt="Arm timing" style={{ ...BASE, maxWidth: "100%" }} />
      <img src="/biomech/shoulder-external-rotation.jpg" alt="Shoulder external rotation" style={{ ...BASE, maxWidth: "100%" }} />
    </div>
  );
}

const DIAGRAM_MAP: Record<string, () => React.ReactElement> = {
  "lead-leg-grf":               () => <Img src="/biomech/lead-leg-grf.jpg"            alt="Lead leg GRF" />,
  "pelvis":                     () => <Img src="/biomech/pelvis-rotation.jpg"          alt="Pelvis rotation" />,
  "hip-shoulder-separation":    () => <Img src="/biomech/hip-shoulder-separation.jpg"  alt="Hip-shoulder separation" />,
  "torso":                      () => <Img src="/biomech/trunk-lateral-flexion.jpg"    alt="Trunk lateral flexion" />,
  "horizontal-abduction":       () => <Img src="/biomech/horizontal-abduction.jpg"     alt="Horizontal abduction" />,
  "shoulder-external-rotation": ShoulderExternalRotationDiagram,
  "kinematic-sequence":         () => <Img src="/biomech/kinematic-sequencing.jpg"     alt="Kinematic sequencing" />,
};

/**
 * Returns true if a diagram exists for the given section ID.
 * Use this for conditional layout decisions — avoids the JSX-always-truthy pitfall.
 */
export function hasPitchingDiagram(sectionId: string): boolean {
  return sectionId in DIAGRAM_MAP;
}

/**
 * Renders the diagram image for the given pitching section.
 * Returns null if no diagram is defined.
 */
export function PitchingDiagram({ sectionId }: { sectionId: string }) {
  const Component = DIAGRAM_MAP[sectionId];
  if (!Component) return null;
  return <Component />;
}
