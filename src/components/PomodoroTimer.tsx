import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";

const DEFAULT_SECONDS = 25 * 60;

type AudioBands = {
  bass: number;
  mids: number;
  treble: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatTimePart(value: number) {
  return String(value).padStart(2, "0");
}

function parseTimePart(value: string, maximum: number) {
  return clamp(Number.parseInt(value || "0", 10) || 0, 0, maximum);
}

export function PomodoroTimer() {
  const [remainingSeconds, setRemainingSeconds] = useState(DEFAULT_SECONDS);
  const [running, setRunning] = useState(false);
  const [minuteDraft, setMinuteDraft] = useState("25");
  const [secondDraft, setSecondDraft] = useState("00");
  const endTimeRef = useRef<number | null>(null);
  const activeControlRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const rawBass = useMotionValue(0);
  const rawMids = useMotionValue(0);
  const rawTreble = useMotionValue(0);
  const bass = useSpring(rawBass, { stiffness: 82, damping: 17, mass: 0.9 });
  const mids = useSpring(rawMids, { stiffness: 108, damping: 19, mass: 0.72 });
  const treble = useSpring(rawTreble, { stiffness: 148, damping: 21, mass: 0.56 });
  const bassScale = useTransform(bass, [0, 1], [0.9, 1.3]);
  const midsScale = useTransform(mids, [0, 1], [0.92, 1.24]);
  const trebleScale = useTransform(treble, [0, 1], [0.88, 1.2]);
  const bassOpacity = useTransform(bass, [0, 1], [0.56, 1]);
  const midsOpacity = useTransform(mids, [0, 1], [0.52, 0.96]);
  const trebleOpacity = useTransform(treble, [0, 1], [0.5, 0.94]);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  useEffect(() => {
    if (!running || endTimeRef.current === null) return;

    const update = () => {
      if (endTimeRef.current === null) return;
      const next = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setRemainingSeconds(next);
      if (next === 0) {
        setMinuteDraft("00");
        setSecondDraft("00");
        endTimeRef.current = null;
        setRunning(false);
      }
    };

    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => activeControlRef.current?.focus(), reduceMotion ? 0 : 500);

    const keepFocusOnTimer = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      activeControlRef.current?.focus();
    };

    document.addEventListener("keydown", keepFocusOnTimer);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keepFocusOnTimer);
    };
  }, [reduceMotion, running]);

  useEffect(() => {
    if (!running || reduceMotion || !isTauriRuntime()) {
      rawBass.set(0);
      rawMids.set(0);
      rawTreble.set(0);
      return;
    }

    let active = true;
    let reading = false;
    const sample = async () => {
      if (reading) return;
      reading = true;
      try {
        const bands = await invoke<AudioBands>("get_system_audio_bands");
        if (active) {
          rawBass.set(Math.pow(clamp(bands.bass, 0, 1), 0.52));
          rawMids.set(Math.pow(clamp(bands.mids, 0, 1), 0.5));
          rawTreble.set(Math.pow(clamp(bands.treble, 0, 1), 0.46));
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
  }, [rawBass, rawMids, rawTreble, reduceMotion, running]);

  const play = () => {
    const nextMinutes = parseTimePart(minuteDraft, 99);
    const nextSeconds = parseTimePart(secondDraft, 59);
    const nextTotal = nextMinutes * 60 + nextSeconds;
    setMinuteDraft(formatTimePart(nextMinutes));
    setSecondDraft(formatTimePart(nextSeconds));
    setRemainingSeconds(nextTotal);
    if (nextTotal <= 0) return;
    endTimeRef.current = Date.now() + nextTotal * 1000;
    setRunning(true);
  };

  const pause = () => {
    let next = remainingSeconds;
    if (endTimeRef.current !== null) {
      next = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
    }
    setRemainingSeconds(next);
    setMinuteDraft(formatTimePart(Math.floor(next / 60)));
    setSecondDraft(formatTimePart(next % 60));
    endTimeRef.current = null;
    setRunning(false);
  };

  const setMinutes = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 2);
    setMinuteDraft(digits);
    setRemainingSeconds(parseTimePart(digits, 99) * 60 + parseTimePart(secondDraft, 59));
  };

  const setSeconds = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 2);
    const nextSeconds = parseTimePart(digits, 59);
    setSecondDraft(digits && Number.parseInt(digits, 10) > 59 ? "59" : digits);
    setRemainingSeconds(parseTimePart(minuteDraft, 99) * 60 + nextSeconds);
  };

  const normalizeDrafts = () => {
    const nextMinutes = parseTimePart(minuteDraft, 99);
    const nextSeconds = parseTimePart(secondDraft, 59);
    setMinuteDraft(formatTimePart(nextMinutes));
    setSecondDraft(formatTimePart(nextSeconds));
    setRemainingSeconds(nextMinutes * 60 + nextSeconds);
  };

  const timerPanel = (focused: boolean) => (
    <motion.section
      role={focused ? "dialog" : undefined}
      aria-modal={focused ? true : undefined}
      aria-label={focused ? "Active Pomodoro timer" : "Pomodoro timer"}
      aria-hidden={!focused && running ? true : undefined}
      initial={focused || reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: !focused && running ? 0 : 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.9, ease: [0.22, 1, 0.36, 1], delay: focused ? 0 : 0.12 }}
      className={`widget-panel relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] border-t-white/[0.16] bg-graphite-800 shadow-panel ${
        focused
          ? "pointer-events-auto max-h-[calc(100dvh-2rem)] min-h-[clamp(280px,54vh,360px)] w-[min(31rem,calc(100vw-2rem))] border-signal-400/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_90px_rgba(0,0,0,0.72)]"
          : `h-full min-h-[220px] md:col-span-2 lg:col-span-3 ${running ? "pointer-events-none" : ""}`
      }`}
    >
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <h2 className="sr-only">Pomodoro</h2>

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
            value={running ? formatTimePart(minutes) : minuteDraft}
            onChange={(event) => setMinutes(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={normalizeDrafts}
            readOnly={running}
            tabIndex={running ? -1 : 0}
            aria-label="Pomodoro minutes"
            className={`timer-input min-w-0 w-[2.05ch] border-0 bg-transparent p-0 text-center font-mono font-semibold leading-none tabular-nums tracking-[-0.08em] text-stone-100 outline-none selection:bg-signal-400/30 focus:text-signal-300 ${
              focused ? "text-[clamp(2.8rem,14vw,6.5rem)]" : "text-[3.05rem]"
            }`}
          />
          <span
            className={`shrink-0 font-mono font-medium leading-none text-signal-300 ${
              focused ? "text-[clamp(2.4rem,10vw,4.25rem)]" : "text-[2.5rem]"
            }`}
          >
            :
          </span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={running ? formatTimePart(seconds) : secondDraft}
            onChange={(event) => setSeconds(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={normalizeDrafts}
            readOnly={running}
            tabIndex={running ? -1 : 0}
            aria-label="Pomodoro seconds"
            className={`timer-input min-w-0 w-[2.05ch] border-0 bg-transparent p-0 text-center font-mono font-semibold leading-none tabular-nums tracking-[-0.08em] text-stone-100 outline-none selection:bg-signal-400/30 focus:text-signal-300 ${
              focused ? "text-[clamp(2.8rem,14vw,6.5rem)]" : "text-[3.05rem]"
            }`}
          />
        </div>

        <TactileButton
          ref={focused ? activeControlRef : undefined}
          onClick={running ? pause : play}
          disabled={!running && remainingSeconds === 0}
          selected={running}
          aria-label={running ? "Pause Pomodoro timer" : "Play Pomodoro timer"}
          title={running ? "Pause" : "Play"}
          className={`grid place-items-center rounded-full ${focused ? "size-14" : "size-11"}`}
        >
          {running ? <Pause size={focused ? 22 : 18} strokeWidth={1.8} /> : <Play size={focused ? 22 : 18} strokeWidth={1.8} className="translate-x-px" />}
        </TactileButton>
      </div>
    </motion.section>
  );

  return (
    <>
      {timerPanel(false)}

      <AnimatePresence initial={false}>
        {running && (
          <motion.div
            key="pomodoro-veil"
            aria-hidden="true"
            className="pointer-events-auto fixed inset-0 z-40 overflow-hidden bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.16 : 1.45, ease: [0.65, 0, 0.35, 1] }}
          >
            <motion.div
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.16 : 1.3, delay: reduceMotion ? 0 : 0.45, ease: "easeInOut" }}
            >
              <motion.div
                className="absolute -left-[24vmax] top-[18vh] size-[72vmax] rounded-full blur-[86px] mix-blend-screen will-change-transform"
                style={{
                  background: "radial-gradient(circle, rgba(34, 255, 204, 0.4) 0%, rgba(0, 191, 166, 0.17) 36%, transparent 69%)",
                  opacity: reduceMotion ? 0.82 : bassOpacity,
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
                className="absolute left-[22vw] -top-[24vmax] h-[68vmax] w-[46vmax] -rotate-12 rounded-full blur-[96px] mix-blend-screen will-change-transform"
                style={{
                  background: "radial-gradient(ellipse, rgba(120, 93, 255, 0.38) 0%, rgba(80, 46, 235, 0.15) 40%, transparent 72%)",
                  opacity: reduceMotion ? 0.78 : midsOpacity,
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
                className="absolute -right-[18vmax] -top-[16vmax] h-[50vmax] w-[42vmax] rounded-full blur-[80px] mix-blend-screen will-change-transform"
                style={{
                  background: "radial-gradient(ellipse, rgba(255, 178, 43, 0.46) 0%, rgba(255, 47, 143, 0.16) 38%, transparent 70%)",
                  opacity: reduceMotion ? 0.76 : trebleOpacity,
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
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {running && (
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
