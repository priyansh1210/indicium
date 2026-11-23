"use client";

import { useEffect } from "react";

/** The landing page's choreography. Everything it animates is visible without it: the page is
 *  complete as rendered, and under reduced motion this does nothing at all. */
export function Motion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cleanup = () => {};
    let cancelled = false;

    (async () => {
      const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("lenis"),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);

      // One smooth-scroll engine, driven by GSAP's clock so scroll-linked work stays in step.
      const lenis = new Lenis({ anchors: true, autoRaf: false });
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      const ctx = gsap.context(() => {
        // Hero: the headline rises word by word, then the example sheet settles under it.
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
        // Their starting state is set by CSS before the page hydrates (see INTRO), so nothing flashes.
        intro
          .fromTo("[data-hero] [data-word] > span", { yPercent: 110 }, { yPercent: 0, duration: 0.9, stagger: 0.05 })
          .fromTo("[data-hero-sub]", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6 }, "-=0.55")
          .fromTo("[data-hero-example]", { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.8 }, "-=0.5");

        // Section headings: the same word rise, once, as each heading comes into view.
        gsap.utils.toArray<HTMLElement>("[data-split]").forEach((heading) => {
          gsap.from(heading.querySelectorAll("[data-word] > span"), {
            yPercent: 110,
            duration: 0.8,
            stagger: 0.04,
            ease: "power3.out",
            scrollTrigger: { trigger: heading, start: "top 85%", once: true },
          });
        });

        // Supporting blocks follow their heading.
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((block) => {
          gsap.from(block, {
            autoAlpha: 0,
            y: 24,
            duration: 0.7,
            ease: "power2.out",
            scrollTrigger: { trigger: block, start: "top 88%", once: true },
          });
        });

        // Result bars grow from the baseline: the length is the number.
        gsap.utils.toArray<HTMLElement>("[data-chart]").forEach((chart) => {
          gsap.from(chart.querySelectorAll("[data-bar]"), {
            scaleX: 0,
            transformOrigin: "left center",
            duration: 0.9,
            stagger: 0.08,
            ease: "power3.out",
            scrollTrigger: { trigger: chart, start: "top 85%", once: true },
          });
        });
      });

      // Fonts change line lengths, and so where each trigger starts.
      document.fonts?.ready.then(() => !cancelled && ScrollTrigger.refresh());

      cleanup = () => {
        ctx.revert();
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return null;
}
