"use client";

import { useEffect, useState, useTransition, Suspense, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function NavigationLoaderContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPending, startTransition] = useTransition();
  const isCompleteRef = useRef(false);

  // Track route changes
  useEffect(() => {
    // Reset completion flag
    isCompleteRef.current = false;
    setIsNavigating(true);
    setProgress(30);

    // Simulate progress - slow increment toward 90%
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (isCompleteRef.current || prev >= 90) return prev;
        // Slower increment as we get closer to 90
        const remaining = 90 - prev;
        const increment = Math.min(remaining * 0.3, Math.random() * 8 + 2);
        return prev + increment;
      });
    }, 150);

    // Complete navigation after page loads
    const completeTimeout = setTimeout(() => {
      isCompleteRef.current = true;
      clearInterval(progressInterval);
      setProgress(100);

      // Keep at 100% briefly so user sees completion, then hide
      const hideTimeout = setTimeout(() => {
        setIsNavigating(false);
        setProgress(0);
      }, 400);

      return () => clearTimeout(hideTimeout);
    }, 600);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(completeTimeout);
    };
  }, [pathname, searchParams]);

  if (!isNavigating && progress === 0) return null;

  const displayProgress = Math.min(progress, 100);

  return (
    <div className="navigation-loader" aria-live="polite" aria-busy={isNavigating}>
      <div
        className="navigation-loader-bar"
        style={{
          transform: `translateX(${-100 + displayProgress}%)`,
          opacity: displayProgress < 100 ? 1 : 0,
          transition: displayProgress >= 100
            ? "transform 150ms ease-out, opacity 200ms ease 300ms"
            : "transform 200ms ease-out",
        }}
      />
      {displayProgress < 100 && (
        <div className="navigation-loader-spinner" aria-hidden="true">
          <div className="navigation-loader-spinner-ring" />
        </div>
      )}
    </div>
  );
}

export function NavigationLoader() {
  return (
    <Suspense fallback={null}>
      <NavigationLoaderContent />
    </Suspense>
  );
}
