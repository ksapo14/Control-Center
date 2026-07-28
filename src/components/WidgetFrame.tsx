import { motion, useReducedMotion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import {
  useDashboardCustomization,
  type WidgetId,
} from "./DashboardCustomization";

type WidgetFrameProps = {
  widgetId: WidgetId;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Provides the shared accessible, animated frame used by dashboard widgets.
 * @param props - The widget title, icon, content, and optional layout classes.
 * @returns A motion-aware widget section.
 */
export function WidgetFrame({
  widgetId,
  title,
  icon,
  children,
  className,
}: WidgetFrameProps) {
  const reduceMotion = useReducedMotion();
  const { hiddenWidgets } = useDashboardCustomization();

  if (hiddenWidgets.has(widgetId)) {
    return (
      <HiddenWidgetTile
        widgetId={widgetId}
        title={title}
        icon={icon}
        className={className}
      />
    );
  }

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
      <WidgetVisibilityButton widgetId={widgetId} title={title} />
      <h2 className="sr-only">{title}</h2>
      <span className="sr-only" aria-hidden="true">{icon}</span>
      <div className="relative min-h-0 flex-1">{children}</div>
    </motion.section>
  );
}

/**
 * Renders the hide action shared by standard and custom-framed widgets.
 * @param props - Tile identity and accessible title.
 * @returns A compact visibility control.
 */
export function WidgetVisibilityButton({ widgetId, title }: { widgetId: WidgetId; title: string }) {
  const { setWidgetHidden } = useDashboardCustomization();

  return (
    <button
      type="button"
      onClick={() => setWidgetHidden(widgetId, true)}
      className="widget-visibility-button absolute right-2 top-2 z-20 grid size-7 place-items-center rounded-lg border border-transparent text-stone-700 opacity-45 transition hover:border-white/[0.06] hover:bg-black/20 hover:text-stone-300 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
      aria-label={`Hide ${title}`}
      title={`Hide ${title}`}
    >
      <EyeOff size={13} strokeWidth={1.7} />
    </button>
  );
}

/**
 * Preserves a hidden widget's grid area while revealing the dashboard background beneath it.
 * @param props - Tile identity, label, icon, and original layout classes.
 * @returns A transparent placeholder with a show control.
 */
export function HiddenWidgetTile({
  widgetId,
  title,
  icon,
  className,
}: {
  widgetId: WidgetId;
  title: string;
  icon: ReactNode;
  className?: string;
}) {
  const { setWidgetHidden } = useDashboardCustomization();

  return (
    <section
      className={cn(
        "group grid min-h-[150px] place-items-center rounded-2xl border border-dashed border-white/[0.035] bg-transparent",
        className,
      )}
      aria-label={`${title} is hidden`}
    >
      <button
        type="button"
        onClick={() => setWidgetHidden(widgetId, false)}
        className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-black/15 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-600 opacity-55 shadow-well transition hover:border-white/[0.12] hover:text-stone-300 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
      >
        <span className="text-signal-400">{icon}</span>
        <Eye size={13} strokeWidth={1.7} />
        Show {title}
      </button>
    </section>
  );
}
