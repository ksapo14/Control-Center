import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type TactileButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  selected?: boolean;
};

/**
 * Renders the shared tactile button while forwarding native button behavior and its ref.
 * @param props - Native button props plus the optional selected appearance.
 * @param ref - The forwarded reference to the underlying button.
 * @returns A consistently styled native button.
 */
export const TactileButton = forwardRef<HTMLButtonElement, TactileButtonProps>(function TactileButton(
  { className, children, selected = false, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "tactile-button relative isolate rounded-[10px] border border-black/70 border-t-white/[0.08] bg-gradient-to-br from-[#1c1f1c] via-[#141614] to-[#0b0c0b] text-stone-300 shadow-skeuo-raised transition duration-200 ease-tactile hover:text-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-graphite-800 active:translate-y-px active:shadow-skeuo-pressed disabled:cursor-not-allowed disabled:opacity-40",
        selected && "text-signal-300 shadow-skeuo-pressed",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute inset-x-1.5 top-px h-px rounded-full bg-white/10" />
      {children}
    </button>
  );
});
