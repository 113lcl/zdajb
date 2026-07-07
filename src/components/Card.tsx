import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-card bg-surface-800 p-5 shadow-soft ${className}`} {...props} />;
}
