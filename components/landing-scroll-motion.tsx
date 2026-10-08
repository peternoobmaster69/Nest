"use client";

import { useEffect } from "react";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function sceneProgress(mode: string | undefined, rect: DOMRect, viewportHeight: number) {
  if (mode === "pin") return clamp(-rect.top / Math.max(1, rect.height - viewportHeight));
  if (mode === "exit") return clamp(-rect.top / Math.max(1, rect.height));
  return clamp((viewportHeight - rect.top) / (viewportHeight + rect.height));
}

/**
 * Drives the landing page's scroll choreography with one passive, rAF-throttled
 * listener. Scenes receive a `--p` progress variable (0–1) that CSS maps to
 * compositor-only properties (transform/opacity); reveal targets toggle a class
 * via IntersectionObserver. It also runs the hero intro, number count-ups, the nav
 * condense state and a page progress bar. Nothing runs when the user prefers reduced motion.
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

    // Hero intro runs after the first paint, so the server-rendered hero stays the LCP
    // frame. Keyframes start from hidden and end at the resting state.
    const introFrame = window.requestAnimationFrame(() => {
      if (window.scrollY < window.innerHeight * 0.5) root.dataset.intro = "on";
    });
    const introDone = window.setTimeout(() => delete root.dataset.intro, 2400);

    // Count-up numbers: final values are in the HTML; only the visible text animates.
    const counted = new WeakSet<Element>();
    const countFrames = new Set<number>();
    const pendingCounts = new Map<HTMLElement, string>();
    const scheduleCount = (callback: FrameRequestCallback) => {
      const countFrame = window.requestAnimationFrame((now) => {
        countFrames.delete(countFrame);
        callback(now);
      });
      countFrames.add(countFrame);
    };
    const countUp = (element: HTMLElement) => {
      if (counted.has(element)) return;
      counted.add(element);
      const finalText = element.textContent ?? "";
      const match = /-?[\d,]+(?:\.\d+)?/.exec(finalText);
      if (!match) return;
      const target = Number(match[0].replaceAll(",", ""));
      const decimals = match[0].includes(".") ? match[0].split(".")[1].length : 0;
      const grouped = match[0].includes(",");
      const format = (value: number) => {
        const fixed = value.toFixed(decimals);
        return grouped ? Number(fixed).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed;
      };
      const duration = 1100;
      const start = performance.now();
      pendingCounts.set(element, finalText);
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        element.textContent = finalText.replace(match[0], format(target * eased));
        if (t < 1) scheduleCount(tick);
        else {
          element.textContent = finalText;
          pendingCounts.delete(element);
        }
      };
      scheduleCount(tick);
    };

    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        entry.target.querySelectorAll<HTMLElement>("[data-count]").forEach(countUp);
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

    const nav = root.querySelector<HTMLElement>(".lp-nav");
    // Write page progress on the bar itself: a custom property set on the page root
    // would invalidate style for the whole page on every scroll frame.
    const progressBar = root.querySelector<HTMLElement>(".lp-progress");
    let lastPage = -1;
    let scrolled = false;

    const update = () => {
      frame = 0;
      const height = window.innerHeight;
      // Page-level progress drives the thin reading bar; the nav condenses after the first screen.
      const max = Math.max(1, document.documentElement.scrollHeight - height);
      const page = Math.round(clamp(window.scrollY / max) * 1000) / 1000;
      if (page !== lastPage) {
        lastPage = page;
        progressBar?.style.setProperty("--page", String(page));
      }
      const nextScrolled = window.scrollY > 24;
      if (nav && nextScrolled !== scrolled) {
        scrolled = nextScrolled;
        nav.dataset.scrolled = scrolled ? "true" : "false";
      }
      // Read every rect first, then write, so the frame never thrashes layout.
      const measured = Array.from(active, (scene) => ({ scene, rect: scene.getBoundingClientRect() }));
      for (const { scene, rect } of measured) {
        // pin: 0→1 while a tall section's sticky stage is held on screen.
        // exit: 0→1 as the section scrolls off the top (hero).
        // track: 0→1 from entering at the bottom to leaving at the top.
        const progress = sceneProgress(scene.dataset.scene, rect, height);
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
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(introFrame);
      for (const countFrame of countFrames) window.cancelAnimationFrame(countFrame);
      for (const [element, text] of pendingCounts) element.textContent = text;
      window.clearTimeout(introDone);
      delete root.dataset.intro;
      revealObserver.disconnect();
      sceneObserver.disconnect();
      delete root.dataset.motion;
    };
  }, []);

  return null;
}
