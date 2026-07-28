import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { Clock3, Pause, Play, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { useDashboardCustomization } from "./DashboardCustomization";
import { HiddenWidgetTile, WidgetVisibilityButton } from "./WidgetFrame";

const DEFAULT_SECONDS = 25 * 60;
const AUDIO_NOISE_FLOOR = 0.02;
const AUDIO_VISUAL_CEILING = 0.55;

type AudioBands = {
  bass: number;
  mids: number;
  treble: number;
};

/**
 * Constrains user or audio input to a supported numeric interval.
 * @param value - The value to constrain.
 * @param minimum - The inclusive lower bound.
 * @param maximum - The inclusive upper bound.
 * @returns The value limited to the supplied bounds.
 */
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Formats one timer field with a stable two-character width.
 * @param value - The minute or second value to display.
 * @returns A zero-padded decimal string.
 */
function formatTimePart(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Converts a draft timer field into a safe bounded integer.
 * @param value - The user-entered timer text.
 * @param maximum - The maximum supported value for the field.
 * @returns A normalized timer field value.
 */
function parseTimePart(value: string, maximum: number) {
  return clamp(Number.parseInt(value || "0", 10) || 0, 0, maximum);
}

/**
 * Maps a native RMS band onto motion without boosting low-level spectral leakage.
 * @param value - The normalized native energy for one frequency band.
 * @returns A contrast-preserving motion level between zero and one.
 */
function audioMotionLevel(value: number) {
  const normalized = clamp(
    (value - AUDIO_NOISE_FLOOR) / (AUDIO_VISUAL_CEILING - AUDIO_NOISE_FLOOR),
    0,
    1,
  );
  return Math.pow(normalized, 1.35);
}

/**
 * Runs an editable Pomodoro timer with an immersive, audio-reactive focus view.
 * @returns The dashboard timer and its focus-mode overlays.
 * @remarks Side effects: manages focus, body scrolling, timers, and native audio-meter polling.
 */
export function PomodoroTimer() {
  // --- Timer and Focus State ---
  const { hiddenWidgets } = useDashboardCustomization();
  const [remainingSeconds, setRemainingSeconds] = useState(DEFAULT_SECONDS);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [minuteDraft, setMinuteDraft] = useState("25");
  const [secondDraft, setSecondDraft] = useState("00");
  const endTimeRef = useRef<number | null>(null);
  const lastDurationRef = useRef(DEFAULT_SECONDS);
  const activeControlRef = useRef<HTMLButtonElement>(null);
  const closeControlRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const rawBass = useMotionValue(0);
  const rawMids = useMotionValue(0);
  const rawTreble = useMotionValue(0);
  const bass = useSpring(rawBass, { stiffness: 82, damping: 17, mass: 0.9 });
  const mids = useSpring(rawMids, { stiffness: 108, damping: 19, mass: 0.72 });
  const treble = useSpring(rawTreble, { stiffness: 148, damping: 21, mass: 0.56 });
  const bassScale = useTransform(bass, [0, 1], [0.7, 1.58]);
  const midsScale = useTransform(mids, [0, 1], [0.72, 1.48]);
  const trebleScale = useTransform(treble, [0, 1], [0.74, 1.38]);
  const bassOpacity = useTransform(bass, [0, 1], [0.08, 1]);
  const midsOpacity = useTransform(mids, [0, 1], [0.07, 1]);
  const trebleOpacity = useTransform(treble, [0, 1], [0.06, 1]);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timerActive = running || completed;

  // --- Completion and Countdown Lifecycle ---

  /**
   * Dismisses the completion state and restores the last configured duration.
   * @returns Nothing.
   * @remarks Side effects: closes focus mode and resets timer state.
   */
  const dismissCompletion = useCallback(() => {
    const resetSeconds = lastDurationRef.current;
    setCompleted(false);
    setFocusOpen(false);
    setRemainingSeconds(resetSeconds);
    setMinuteDraft(formatTimePart(Math.floor(resetSeconds / 60)));
    setSecondDraft(formatTimePart(resetSeconds % 60));
  }, []);

  // --- Countdown Tick ---
  useEffect(() => {
    if (!running || endTimeRef.current === null) return;

    // Derive remaining time from an absolute deadline so throttled tabs do not make the timer drift.
    const update = () => {
      if (endTimeRef.current === null) return;
      const next = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setRemainingSeconds(next);
      if (next === 0) {
        setMinuteDraft("00");
        setSecondDraft("00");
        endTimeRef.current = null;
        setCompleted(true);
        setFocusOpen(true);
        setRunning(false);
      }
    };

    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [running]);

  // --- Focus Containment ---
  useEffect(() => {
    if (!focusOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => activeControlRef.current?.focus(), reduceMotion ? 0 : 500);

    // Focus mode intentionally limits navigation to its active controls until dismissed.
    const keepFocusOnTimer = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && completed) {
        dismissCompletion();
        return;
      }
      if (event.key === "Escape" && running) {
        setFocusOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      event.preventDefault();
      if (running && closeControlRef.current) {
        const nextControl =
          document.activeElement === activeControlRef.current
            ? closeControlRef.current
            : activeControlRef.current;
        nextControl?.focus();
      } else {
        activeControlRef.current?.focus();
      }
    };

    document.addEventListener("keydown", keepFocusOnTimer);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keepFocusOnTimer);
    };
  }, [completed, dismissCompletion, focusOpen, reduceMotion, running]);

  // --- Audio-Reactive Sampling ---
  useEffect(() => {
    if (!running || !focusOpen || reduceMotion || !isTauriRuntime()) {
      rawBass.set(0);
      rawMids.set(0);
      rawTreble.set(0);
      return;
    }

    let active = true;
    let reading = false;
    // Serialize samples because overlapping native capture calls cause unnecessary COM pressure.
    const sample = async () => {
      if (reading) return;
      reading = true;
      try {
        const bands = await invoke<AudioBands>("get_system_audio_bands");
        if (active) {
          // Preserve band contrast instead of making low-level crossover leakage look active.
          rawBass.set(audioMotionLevel(bands.bass));
          rawMids.set(audioMotionLevel(bands.mids));
          rawTreble.set(audioMotionLevel(bands.treble));
        }
      } catch {
        if (active) {
          rawBass.set(0);
          rawMids.set(0);
          rawTreble.set(0);
        }
      } finally {
        reading = false;
      }
    };

    void sample();
    const interval = window.setInterval(() => void sample(), 70);
    return () => {
      active = false;
      window.clearInterval(interval);
      rawBass.set(0);
      rawMids.set(0);
      rawTreble.set(0);
    };
  }, [focusOpen, rawBass, rawMids, rawTreble, reduceMotion, running]);

  // --- Timer Controls ---

  /**
   * Normalizes the draft duration and starts an absolute-deadline countdown.
   * @returns Nothing.
   * @remarks Side effects: enters focus mode and starts the timer update loop.
   */
  const play = () => {
    const nextMinutes = parseTimePart(minuteDraft, 99);
    const nextSeconds = parseTimePart(secondDraft, 59);
    const nextTotal = nextMinutes * 60 + nextSeconds;
    setMinuteDraft(formatTimePart(nextMinutes));
    setSecondDraft(formatTimePart(nextSeconds));
    setRemainingSeconds(nextTotal);
    if (nextTotal <= 0) return;
    lastDurationRef.current = nextTotal;
    setCompleted(false);
    setFocusOpen(true);
    endTimeRef.current = Date.now() + nextTotal * 1000;
    setRunning(true);
  };

  /**
   * Captures the exact remaining duration and exits active focus mode.
   * @returns Nothing.
   * @remarks Side effects: stops the countdown and updates timer drafts.
   */
  const pause = () => {
    let next = remainingSeconds;
    if (endTimeRef.current !== null) {
      next = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
    }
    setRemainingSeconds(next);
    setMinuteDraft(formatTimePart(Math.floor(next / 60)));
    setSecondDraft(formatTimePart(next % 60));
    endTimeRef.current = null;
    if (next === 0) {
      setCompleted(true);
      setFocusOpen(true);
    } else {
      setFocusOpen(false);
    }
    setRunning(false);
  };

  /**
   * Applies a digits-only minute draft and keeps the total duration synchronized.
   * @param value - The latest minute input text.
   * @returns Nothing.
   */
  const setMinutes = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 2);
    setMinuteDraft(digits);
    setRemainingSeconds(parseTimePart(digits, 99) * 60 + parseTimePart(secondDraft, 59));
  };

  /**
   * Applies a digits-only second draft capped at a valid clock value.
   * @param value - The latest second input text.
   * @returns Nothing.
   */
  const setSeconds = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 2);
    const nextSeconds = parseTimePart(digits, 59);
    setSecondDraft(digits && Number.parseInt(digits, 10) > 59 ? "59" : digits);
    setRemainingSeconds(parseTimePart(minuteDraft, 99) * 60 + nextSeconds);
  };

  /**
   * Commits padded and bounded timer drafts when an input loses focus.
   * @returns Nothing.
   * @remarks Side effects: normalizes both input fields and the remaining duration.
   */
  const normalizeDrafts = () => {
    const nextMinutes = parseTimePart(minuteDraft, 99);
    const nextSeconds = parseTimePart(secondDraft, 59);
    setMinuteDraft(formatTimePart(nextMinutes));
    setSecondDraft(formatTimePart(nextSeconds));
    setRemainingSeconds(nextMinutes * 60 + nextSeconds);
  };

  // --- Shared Timer Rendering ---

  /**
   * Builds either the embedded timer or the semantically modal focus-mode variant.
   * @param focused - Whether to render the focus overlay presentation.
   * @returns The configured timer panel.
   */
  const timerPanel = (focused: boolean) => {
    if (!focused && hiddenWidgets.has("pomodoro")) {
      return (
        <HiddenWidgetTile
          widgetId="pomodoro"
          title="Pomodoro"
          icon={<Clock3 size={14} strokeWidth={1.7} />}
          className="h-full min-h-[220px] md:col-span-2 lg:col-span-3"
        />
      );
    }

    return (
      <motion.section
      role={focused ? (completed ? "alertdialog" : "dialog") : undefined}
      aria-modal={focused ? true : undefined}
      aria-label={focused ? (completed ? "Pomodoro complete" : "Active Pomodoro timer") : "Pomodoro timer"}
      aria-hidden={!focused && focusOpen ? true : undefined}
      initial={focused || reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: !focused && focusOpen ? 0 : 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.9, ease: [0.22, 1, 0.36, 1], delay: focused ? 0 : 0.12 }}
      className={`widget-panel relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] border-t-white/[0.16] bg-graphite-800 shadow-panel ${
        focused
          ? `pointer-events-auto max-h-[calc(100dvh-2rem)] min-h-[clamp(280px,54vh,360px)] w-[min(31rem,calc(100vw-2rem))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_90px_rgba(0,0,0,0.72)] ${
              completed ? "border-red-400/35" : "border-signal-400/20"
            }`
          : `h-full min-h-[220px] md:col-span-2 lg:col-span-3 ${focusOpen ? "pointer-events-none" : ""}`
      }`}
      >
        <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <h2 className="sr-only">Pomodoro</h2>
        {!focused && <WidgetVisibilityButton widgetId="pomodoro" title="Pomodoro" />}

      {focused && running && (
        <button
          ref={closeControlRef}
          type="button"
          onClick={() => setFocusOpen(false)}
          aria-label="Exit Pomodoro focus view"
          title="Exit focus view"
          className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full border border-white/[0.08] bg-black/20 text-stone-500 shadow-well transition hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
        >
          <X size={17} strokeWidth={1.8} />
        </button>
      )}

      <div
        className={`relative flex min-h-0 flex-1 flex-col items-center justify-center px-4 ${
          focused ? "gap-[clamp(1rem,4vh,2rem)] py-[clamp(1.25rem,4vh,2.5rem)]" : "gap-4 py-4"
        }`}
      >
        <div
          className={`display-well flex max-w-full items-center justify-center rounded-xl border border-black/60 shadow-well ${
            focused ? "w-full max-w-[25rem] px-[clamp(0.5rem,2vw,1.25rem)] py-[clamp(0.75rem,2vh,1.15rem)]" : "px-3 py-3"
          }`}
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={timerActive ? formatTimePart(minutes) : minuteDraft}
            onChange={(event) => setMinutes(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={normalizeDrafts}
            readOnly={timerActive}
            tabIndex={timerActive ? -1 : 0}
            aria-label="Pomodoro minutes"
            className={`timer-input min-w-0 w-[2.05ch] border-0 bg-transparent p-0 text-center font-mono font-semibold leading-none tabular-nums tracking-[-0.08em] text-stone-100 outline-none selection:bg-signal-400/30 focus:text-signal-300 ${
              focused ? "text-[clamp(2.8rem,14vw,6.5rem)]" : "text-[3.05rem]"
            }`}
          />
          <span
            className={`shrink-0 font-mono font-medium leading-none ${completed ? "text-red-400" : "text-signal-300"} ${
              focused ? "text-[clamp(2.4rem,10vw,4.25rem)]" : "text-[2.5rem]"
            }`}
          >
            :
          </span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={timerActive ? formatTimePart(seconds) : secondDraft}
            onChange={(event) => setSeconds(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={normalizeDrafts}
            readOnly={timerActive}
            tabIndex={timerActive ? -1 : 0}
            aria-label="Pomodoro seconds"
            className={`timer-input min-w-0 w-[2.05ch] border-0 bg-transparent p-0 text-center font-mono font-semibold leading-none tabular-nums tracking-[-0.08em] text-stone-100 outline-none selection:bg-signal-400/30 focus:text-signal-300 ${
              focused ? "text-[clamp(2.8rem,14vw,6.5rem)]" : "text-[3.05rem]"
            }`}
          />
        </div>

        <TactileButton
          ref={focused ? activeControlRef : undefined}
          onClick={completed ? dismissCompletion : running ? pause : play}
          disabled={!timerActive && remainingSeconds === 0}
          selected={timerActive}
          aria-label={completed ? "Dismiss completed Pomodoro and reset" : running ? "Pause Pomodoro timer" : "Play Pomodoro timer"}
          title={completed ? "Reset" : running ? "Pause" : "Play"}
          className={`grid place-items-center rounded-full ${focused ? "size-14" : "size-11"}`}
        >
          {completed ? (
            <RotateCcw size={focused ? 22 : 18} strokeWidth={1.8} />
          ) : running ? (
            <Pause size={focused ? 22 : 18} strokeWidth={1.8} />
          ) : (
            <Play size={focused ? 22 : 18} strokeWidth={1.8} className="translate-x-px" />
          )}
        </TactileButton>
      </div>
      </motion.section>
    );
  };

  // --- Focus Overlay Rendering ---
  return (
    <>
      {timerPanel(false)}

      <AnimatePresence initial={false}>
        {focusOpen && (
          <motion.div
            key="pomodoro-veil"
            aria-hidden="true"
            className="pointer-events-auto fixed inset-0 z-40 overflow-hidden bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.16 : 1.45, ease: [0.65, 0, 0.35, 1] }}
          >
            <AnimatePresence initial={false} mode="sync">
              {completed ? (
                <motion.div
                  key="pomodoro-complete-glow"
                  className="absolute inset-0 overflow-hidden bg-[#100001]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0.16 : 0.8, ease: "easeInOut" }}
                >
                  <motion.div
                    className="absolute inset-[-12%] will-change-transform"
                    style={{
                      background:
                        "radial-gradient(circle at 50% 48%, rgba(255, 82, 82, 0.9) 0%, rgba(237, 28, 36, 0.62) 25%, rgba(132, 4, 12, 0.4) 58%, rgba(20, 0, 2, 0.96) 100%)",
                    }}
                    animate={reduceMotion ? { opacity: 0.82 } : { opacity: [0.58, 1, 0.58], scale: [0.98, 1.055, 0.98] }}
                    transition={{ duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }}
                  />
                  <motion.div
                    className="absolute left-1/2 top-1/2 size-[112vmax] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[110px] mix-blend-screen will-change-transform"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(255, 64, 64, 0.58) 0%, rgba(255, 16, 30, 0.3) 38%, transparent 70%)",
                    }}
                    animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.4, 0.82, 0.4], scale: [0.86, 1.08, 0.86] }}
                    transition={{ duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }}
                  />
                  <motion.div
                    className="absolute inset-0 shadow-[inset_0_0_180px_rgba(255,40,48,0.42)]"
                    animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.42, 0.88, 0.42] }}
                    transition={{ duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="pomodoro-frequency-glow"
                  className="absolute inset-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0.16 : 0.8, ease: "easeInOut" }}
                >
              <motion.div
                className="absolute -left-[20vmax] top-[14vh] h-[68vmax] w-[76vmax] blur-[54px] mix-blend-screen will-change-transform"
                style={{
                  background:
                    "radial-gradient(circle at 32% 28%, rgba(145, 255, 226, 0.7) 0%, transparent 19%), radial-gradient(ellipse at 48% 52%, rgba(34, 255, 204, 0.58) 0%, rgba(0, 191, 166, 0.34) 48%, transparent 77%)",
                  borderRadius: "63% 37% 54% 46% / 42% 58% 35% 65%",
                  boxShadow: "inset 0 0 72px rgba(156, 255, 230, 0.16)",
                  opacity: reduceMotion ? 0.88 : bassOpacity,
                  scale: reduceMotion ? 1 : bassScale,
                }}
                animate={
                  reduceMotion
                    ? undefined
                    : {
                        x: ["-8vw", "24vw", "48vw", "13vw", "-8vw"],
                        y: ["18vh", "-24vh", "10vh", "34vh", "18vh"],
                        rotate: [-14, 4, 18, -5, -14],
                      }
                }
                transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                className="absolute left-[20vw] -top-[20vmax] h-[70vmax] w-[50vmax] -rotate-12 blur-[58px] mix-blend-screen will-change-transform"
                style={{
                  background:
                    "radial-gradient(circle at 68% 25%, rgba(191, 174, 255, 0.62) 0%, transparent 18%), radial-gradient(ellipse at 48% 50%, rgba(120, 93, 255, 0.56) 0%, rgba(80, 46, 235, 0.3) 49%, transparent 78%)",
                  borderRadius: "46% 54% 34% 66% / 61% 38% 62% 39%",
                  boxShadow: "inset 0 0 76px rgba(199, 185, 255, 0.14)",
                  opacity: reduceMotion ? 0.84 : midsOpacity,
                  scale: reduceMotion ? 1 : midsScale,
                }}
                animate={
                  reduceMotion
                    ? undefined
                    : {
                        x: ["8vw", "34vw", "-20vw", "18vw", "8vw"],
                        y: ["-10vh", "36vh", "48vh", "8vh", "-10vh"],
                        rotate: [-18, 14, -4, 22, -18],
                      }
                }
                transition={{ duration: 29, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                className="absolute -right-[14vmax] -top-[12vmax] h-[54vmax] w-[46vmax] blur-[48px] mix-blend-screen will-change-transform"
                style={{
                  background:
                    "radial-gradient(circle at 63% 28%, rgba(255, 229, 151, 0.72) 0%, transparent 17%), radial-gradient(ellipse at 50% 48%, rgba(255, 178, 43, 0.62) 0%, rgba(255, 47, 143, 0.3) 48%, transparent 76%)",
                  borderRadius: "57% 43% 68% 32% / 36% 64% 44% 56%",
                  boxShadow: "inset 0 0 64px rgba(255, 231, 165, 0.16)",
                  opacity: reduceMotion ? 0.82 : trebleOpacity,
                  scale: reduceMotion ? 1 : trebleScale,
                }}
                animate={
                  reduceMotion
                    ? undefined
                    : {
                        x: ["12vw", "-34vw", "-56vw", "-18vw", "12vw"],
                        y: ["-12vh", "20vh", "52vh", "10vh", "-12vh"],
                        rotate: [12, -16, 8, -8, 12],
                      }
                }
                transition={{ duration: 19, repeat: Infinity, ease: "easeInOut" }}
              />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {focusOpen && (
          <motion.div
            key="pomodoro-focus-panel"
            className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 20 }}
            animate={
              reduceMotion
                ? { opacity: 1 }
                : {
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    transition: { duration: 1.05, delay: 0.25, ease: [0.22, 1, 0.36, 1] },
                  }
            }
            exit={
              reduceMotion
                ? { opacity: 0 }
                : {
                    opacity: [1, 1, 0],
                    scale: [1, 0.99, 0.96],
                    y: [0, 0, 18],
                    transition: { duration: 1.45, times: [0, 0.62, 1], ease: [0.65, 0, 0.35, 1] },
                  }
            }
            transition={{ duration: reduceMotion ? 0.16 : undefined }}
          >
            {timerPanel(true)}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
