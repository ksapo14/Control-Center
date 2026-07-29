import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import { isTauriRuntime } from "../lib/runtime";

const AUDIO_NOISE_FLOOR = 0.02;
const AUDIO_VISUAL_CEILING = 0.55;

type AudioBands = { bass: number; mids: number; treble: number };

function audioMotionLevel(value: number) {
  const normalized = Math.min(1, Math.max(0, (value - AUDIO_NOISE_FLOOR) / (AUDIO_VISUAL_CEILING - AUDIO_NOISE_FLOOR)));
  return Math.pow(normalized, 1.35);
}

type AudioReactiveFocusBackdropProps = {
  active: boolean;
  completed?: boolean;
};

/** Shared, audio-reactive backdrop used by Pomodoro and productivity focus sessions. */
export function AudioReactiveFocusBackdrop({ active, completed = false }: AudioReactiveFocusBackdropProps) {
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

  useEffect(() => {
    if (!active || completed || reduceMotion || !isTauriRuntime()) {
      rawBass.set(0);
      rawMids.set(0);
      rawTreble.set(0);
      return;
    }

    let mounted = true;
    let reading = false;
    const sample = async () => {
      if (reading) return;
      reading = true;
      try {
        const bands = await invoke<AudioBands>("get_system_audio_bands");
        if (mounted) {
          rawBass.set(audioMotionLevel(bands.bass));
          rawMids.set(audioMotionLevel(bands.mids));
          rawTreble.set(audioMotionLevel(bands.treble));
        }
      } catch {
        if (mounted) {
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
      mounted = false;
      window.clearInterval(interval);
      rawBass.set(0);
      rawMids.set(0);
      rawTreble.set(0);
    };
  }, [active, completed, rawBass, rawMids, rawTreble, reduceMotion]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black" aria-hidden="true">
      <AnimatePresence initial={false} mode="sync">
        {completed ? (
          <motion.div key="focus-complete-glow" className="absolute inset-0 overflow-hidden bg-[#100001]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.16 : 0.8, ease: "easeInOut" }}>
            <motion.div className="absolute inset-[-12%] will-change-transform" style={{ background: "radial-gradient(circle at 50% 48%, rgba(255, 82, 82, 0.9) 0%, rgba(237, 28, 36, 0.62) 25%, rgba(132, 4, 12, 0.4) 58%, rgba(20, 0, 2, 0.96) 100%)" }} animate={reduceMotion ? { opacity: 0.82 } : { opacity: [0.58, 1, 0.58], scale: [0.98, 1.055, 0.98] }} transition={{ duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }} />
            <motion.div className="absolute left-1/2 top-1/2 size-[112vmax] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[110px] mix-blend-screen will-change-transform" style={{ background: "radial-gradient(circle, rgba(255, 64, 64, 0.58) 0%, rgba(255, 16, 30, 0.3) 38%, transparent 70%)" }} animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.4, 0.82, 0.4], scale: [0.86, 1.08, 0.86] }} transition={{ duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }} />
            <motion.div className="absolute inset-0 shadow-[inset_0_0_180px_rgba(255,40,48,0.42)]" animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.42, 0.88, 0.42] }} transition={{ duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }} />
          </motion.div>
        ) : (
          <motion.div key="focus-frequency-glow" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.16 : 0.8, ease: "easeInOut" }}>
            <motion.div className="absolute -left-[20vmax] top-[14vh] h-[68vmax] w-[76vmax] blur-[54px] mix-blend-screen will-change-transform" style={{ background: "radial-gradient(circle at 32% 28%, rgba(145, 255, 226, 0.7) 0%, transparent 19%), radial-gradient(ellipse at 48% 52%, rgba(34, 255, 204, 0.58) 0%, rgba(0, 191, 166, 0.34) 48%, transparent 77%)", borderRadius: "63% 37% 54% 46% / 42% 58% 35% 65%", boxShadow: "inset 0 0 72px rgba(156, 255, 230, 0.16)", opacity: reduceMotion ? 0.88 : bassOpacity, scale: reduceMotion ? 1 : bassScale }} animate={reduceMotion ? undefined : { x: ["-8vw", "24vw", "48vw", "13vw", "-8vw"], y: ["18vh", "-24vh", "10vh", "34vh", "18vh"], rotate: [-14, 4, 18, -5, -14] }} transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }} />
            <motion.div className="absolute left-[20vw] -top-[20vmax] h-[70vmax] w-[50vmax] -rotate-12 blur-[58px] mix-blend-screen will-change-transform" style={{ background: "radial-gradient(circle at 68% 25%, rgba(191, 174, 255, 0.62) 0%, transparent 18%), radial-gradient(ellipse at 48% 50%, rgba(120, 93, 255, 0.56) 0%, rgba(80, 46, 235, 0.3) 49%, transparent 78%)", borderRadius: "46% 54% 34% 66% / 61% 38% 62% 39%", boxShadow: "inset 0 0 76px rgba(199, 185, 255, 0.14)", opacity: reduceMotion ? 0.84 : midsOpacity, scale: reduceMotion ? 1 : midsScale }} animate={reduceMotion ? undefined : { x: ["8vw", "34vw", "-20vw", "18vw", "8vw"], y: ["-10vh", "36vh", "48vh", "8vh", "-10vh"], rotate: [-18, 14, -4, 22, -18] }} transition={{ duration: 29, repeat: Infinity, ease: "easeInOut" }} />
            <motion.div className="absolute -right-[14vmax] -top-[12vmax] h-[54vmax] w-[46vmax] blur-[48px] mix-blend-screen will-change-transform" style={{ background: "radial-gradient(circle at 63% 28%, rgba(255, 229, 151, 0.72) 0%, transparent 17%), radial-gradient(ellipse at 50% 48%, rgba(255, 178, 43, 0.62) 0%, rgba(255, 47, 143, 0.3) 48%, transparent 76%)", borderRadius: "57% 43% 68% 32% / 36% 64% 44% 56%", boxShadow: "inset 0 0 64px rgba(255, 231, 165, 0.16)", opacity: reduceMotion ? 0.82 : trebleOpacity, scale: reduceMotion ? 1 : trebleScale }} animate={reduceMotion ? undefined : { x: ["12vw", "-34vw", "-56vw", "-18vw", "12vw"], y: ["-12vh", "20vh", "52vh", "10vh", "-12vh"], rotate: [12, -16, 8, -8, 12] }} transition={{ duration: 19, repeat: Infinity, ease: "easeInOut" }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
