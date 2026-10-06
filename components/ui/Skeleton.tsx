"use client";

import type { CSSProperties } from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
}

export function Skeleton({ width, height, borderRadius, className = "" }: Readonly<SkeletonProps>) {
  const style: CSSProperties = {
    width,
    height,
    borderRadius,
  };

  return <span aria-hidden="true" className={`skeleton ${className}`.trim()} style={style} />;
}
