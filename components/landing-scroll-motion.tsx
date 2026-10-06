"use client";

import { useEffect } from "react";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Drives the landing page's scroll choreography with one passive, rAF-throttled
 * listener. Scenes receive a `--p` progress variable (0–1) that CSS maps to
 * compositor-only properties (transform/opacity); reveal targets toggle a class
 * via IntersectionObserver. Nothing runs when the user prefers reduced motion.
 */
export function LandingScrollMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing]");
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.dataset.motion = "off";
      return () => {
        delete root.dataset.motion;
      };
    }

    // Reveal anything already on screen before enabling motion so above-the-fold
    // content never flashes hidden after hydration.
    const reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const viewportHeight = window.innerHeight;
    for (const element of reveals) {
      if (element.getBoundingClientRect().top < viewportHeight) element.classList.add("is-revealed");
    }
    root.dataset.motion = "on";

    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        revealObserver.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    for (const element of reveals) {
      if (!element.classList.contains("is-revealed")) revealObserver.observe(element);
    }

    const scenes = Array.from(root.querySelectorAll<HTMLElement>("[data-scene]"));
    const active = new Set<HTMLElement>();
    const lastProgress = new WeakMap<HTMLElement, number>();
    let frame = 0;

    const update = () => {
      frame = 0;
      const height = window.innerHeight;
      // Read every rect first, then write, so the frame never thrashes layout.
      const measured = Array.from(active, (scene) => ({ scene, rect: scene.getBoundingClientRect() }));
      for (const { scene, rect } of measured) {
        const mode = scene.dataset.scene;
        // pin: 0→1 while a tall section's sticky stage is held on screen.
        // exit: 0→1 as the section scrolls off the top (hero).
        // track: 0→1 from entering at the bottom to leaving at the top.
        let progress: number;
        if (mode === "pin") progress = clamp(-rect.top / Math.max(1, rect.height - height));
        else if (mode === "exit") progress = clamp(-rect.top / Math.max(1, rect.height));
        else progress = clamp((height - rect.top) / (height + rect.height));
        const rounded = Math.round(progress * 1000) / 1000;
        if (lastProgress.get(scene) === rounded) continue;
        lastProgress.set(scene, rounded);
        scene.style.setProperty("--p", String(rounded));
        const steps = Number(scene.dataset.steps);
        if (steps > 1) {
          const index = String(Math.min(steps - 1, Math.floor(rounded * steps)));
          if (scene.dataset.active !== index) scene.dataset.active = index;
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    const sceneObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const scene = entry.target as HTMLElement;
        if (entry.isIntersecting) active.add(scene);
        else active.delete(scene);
      }
      schedule();
    });
    for (const scene of scenes) sceneObserver.observe(scene);

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      revealObserver.disconnect();
      sceneObserver.disconnect();
      delete root.dataset.motion;
    };
  }, []);

  return null;
}
