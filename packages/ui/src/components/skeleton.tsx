import React from "react";
import { cn } from "../lib/utils";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  borderRadius,
  className = "",
  style,
}) => {
  return (
    <div
      className={cn("skeleton", className)}
      style={{
        width: width ?? "100%",
        height: height ?? "1rem",
        borderRadius: borderRadius ?? undefined,
        ...style,
      }}
    />
  );
};
