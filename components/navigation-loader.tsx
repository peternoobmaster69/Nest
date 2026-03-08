"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function NavigationLoaderContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Track route changes
  useEffect(() => {
    setIsNavigating(true);
    setProgress(30);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 100);

    // Complete navigation after a short delay
    const completeTimeout = setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        setIsNavigating(false);
        setProgress(0);
      }, 200);
    }, 300);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(completeTimeout);
    };
  }, [pathname, searchParams]);

  if (!isNavigating && progress === 0) return null;

  return (
    <div className="navigation-loader" aria-live="polite" aria-busy={isNavigating}>
      <div
        className="navigation-loader-bar"
        style={{
          transform: `translateX(${-100 + Math.min(progress, 100)}%)`,
          opacity: isNavigating || progress < 100 ? 1 : 0,
        }}
      />
      {isNavigating && (
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
