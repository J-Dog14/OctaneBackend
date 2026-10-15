"use client";

/**
 * HittingDiagram — skeleton imagery for the hitting explorer sections.
 *
 * Same images as the Octane app's hitting report (Octane/public/biomech/hitting),
 * served from /public/biomech/hitting/. Mirrors PitchingDiagram.
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

const DIAGRAM_MAP: Record<string, () => React.ReactElement> = {
  "kinematic-sequence":      () => <Img src="/biomech/hitting/kinematic-sequence.jpg" alt="Kinematic sequence" />,
  "bat-attack-and-distance": () => <Img src="/biomech/hitting/bat-attack-angles.jpg"  alt="Bat attack angles" />,
  "bat-contact-angles":      () => <Img src="/biomech/hitting/bat-angles-contact.jpg" alt="Bat angles at contact" />,
  "lead-knee-block":         () => <Img src="/biomech/hitting/lead-knee-block.jpg"    alt="Lead knee block" />,
  pelvis:                    () => <Img src="/biomech/hitting/pelvis.jpg"             alt="Pelvis rotation" />,
  "hip-shoulder-separation": () => <Img src="/biomech/hitting/hip-shoulder.jpg"       alt="Hip-shoulder separation" />,
  trunk:                     () => <Img src="/biomech/hitting/trunk.jpg"              alt="Trunk rotation" />,
  "stride-width":            () => <Img src="/biomech/hitting/stride-length.jpg"      alt="Stride" />,
};

/** True if a diagram exists for the section (use for layout decisions). */
export function hasHittingDiagram(sectionId: string): boolean {
  return sectionId in DIAGRAM_MAP;
}

/** Renders the image for the given hitting section, or null if none. */
export function HittingDiagram({ sectionId }: { sectionId: string }) {
  const Component = DIAGRAM_MAP[sectionId];
  return Component ? <Component /> : null;
}
