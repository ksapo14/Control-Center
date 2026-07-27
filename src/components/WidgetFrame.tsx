import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type WidgetFrameProps = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
};

export function WidgetFrame({
  title,
  icon,
  children,
  className,
}: WidgetFrameProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "widget-panel relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] border-t-white/[0.16] bg-graphite-800 shadow-panel",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <h2 className="sr-only">{title}</h2>
      <span className="sr-only" aria-hidden="true">{icon}</span>
      <div className="relative min-h-0 flex-1">{children}</div>
    </motion.section>
  );
}
