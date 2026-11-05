// Co-located client component for the tour fixture — where the value domains live.
"use client";
import { useState } from "react";

type Mode = "slideshow" | "tour";
type SlideDef = { title: string };
type TourStep = { target: string };

// Typed array literals (`: SlideDef[]`) — the bracket in the annotation must not
// break element counting (a regression test: it once did).
const SLIDES: SlideDef[] = [
  { title: "Connect" },
  { title: "Context" },
  { title: "Build" },
];

const TOUR_STEPS: TourStep[] = [
  { target: "nav" },
  { target: "modes" },
  { target: "agents" },
  { target: "play" },
  { target: "chat" },
  { target: "local" },
];

export function Tour({
  initialMode,
  initialSlide,
  initialStep,
}: {
  initialMode?: string;
  initialSlide?: string;
  initialStep?: string;
}) {
  const [mode] = useState<Mode>(initialMode === "tour" ? "tour" : "slideshow");
  const [slide] = useState<number>(() => {
    const n = Number(initialSlide);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), SLIDES.length - 1) : 0;
  });
  const [step] = useState<number>(() => {
    const n = Number(initialStep);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), TOUR_STEPS.length - 1) : 0;
  });

  if (mode === "slideshow") return <section>{SLIDES[slide].title}</section>;
  return <section>{TOUR_STEPS[step].target}</section>;
}
