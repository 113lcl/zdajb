import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { playUiSound } from "../lib/sound";

type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  tone?: "primary" | "ghost" | "success" | "danger";
  icon?: ReactNode;
  children?: ReactNode;
};

const tones = {
  primary: "border border-accent/70 bg-accent text-surface-950 shadow-lift hover:brightness-110",
  ghost: "border border-zinc-600/60 bg-surface-800 text-zinc-100 hover:border-zinc-500 hover:bg-surface-850",
  success: "border border-success/70 bg-success text-surface-950 shadow-lift",
  danger: "border border-danger/70 bg-danger text-white shadow-lift"
};

export function Button({ tone = "primary", icon, className = "", children, onClick, ...props }: ButtonProps) {
  const handleClick: NonNullable<ButtonProps["onClick"]> = (event) => {
    if (!props.disabled) playUiSound(tone === "success" ? "success" : tone === "danger" ? "danger" : "click");
    onClick?.(event);
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-button px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950 ${tones[tone]} disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
      onClick={handleClick}
    >
      {icon}
      {children}
    </motion.button>
  );
}
