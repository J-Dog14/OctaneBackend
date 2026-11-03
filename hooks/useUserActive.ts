"use client";

import { useEffect, useState } from "react";

const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart", "focus"] as const;

/**
 * True while the tab is visible and the user has interacted within `idleMs`.
 * Use it to gate polling, so a tab left open on a desk or a second monitor
 * stops hitting the API (and the database) until someone touches it again.
 */
export function useUserActive(idleMs = 10 * 60_000) {
  const [active, setActive] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const goIdle = () => setActive(false);
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      // Throttle: pointermove fires constantly, timers only need resetting occasionally.
      if (now - last < 5_000) return;
      last = now;
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(goIdle, idleMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { last = 0; wake(); }
      else { clearTimeout(timer); goIdle(); }
    };
    EVENTS.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      clearTimeout(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, wake));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [idleMs]);
  return active;
}
