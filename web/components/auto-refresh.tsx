"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page's data every few seconds while the tab is visible, so a queue or a review in
 *  progress updates without a reload. Typing in a form is kept: a refresh re-renders, it does not
 *  remount. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && router.refresh();
    const timer = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick); // catch up on return to the tab
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}
