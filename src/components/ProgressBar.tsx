import { motion } from "framer-motion";

type ProgressBarProps = {
  value: number;
  max?: number;
  tone?: "accent" | "success" | "danger";
};

const tones = {
  accent: "#4FA8E8",
  success: "#4CAF7D",
  danger: "#E55A5A"
};

export function ProgressBar({ value, max = 100, tone = "accent" }: ProgressBarProps) {
  const width = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-900">
      <motion.div
        className="h-full rounded-full"
        animate={{ width: `${width}%`, backgroundColor: tones[tone] }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      />
    </div>
  );
}
