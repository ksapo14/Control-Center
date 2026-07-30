import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ProcessingTask = {
  id: number;
  label: string;
};

type ProcessingContextValue = {
  begin: (label: string) => () => void;
};

const ProcessingContext = createContext<ProcessingContextValue | null>(null);
const OVERLAY_DELAY_MS = 420;

/**
 * Owns the dashboard-wide delayed processing overlay.
 * Fast work finishes before the overlay delay, avoiding distracting flashes.
 */
export function ProcessingOverlayProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const sequence = useRef(0);
  const [tasks, setTasks] = useState<ProcessingTask[]>([]);
  const [visible, setVisible] = useState(false);

  const begin = useCallback((label: string) => {
    const id = ++sequence.current;
    let finished = false;
    setTasks((current) => [...current, { id, label }]);
    return () => {
      if (finished) return;
      finished = true;
      setTasks((current) => current.filter((task) => task.id !== id));
    };
  }, []);

  useEffect(() => {
    if (tasks.length === 0) {
      setVisible(false);
      return;
    }
    if (visible) return;
    const timer = window.setTimeout(() => setVisible(true), OVERLAY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [tasks.length, visible]);

  const value = useMemo(() => ({ begin }), [begin]);
  const label = tasks[tasks.length - 1]?.label ?? "Working";

  return (
    <ProcessingContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {visible && tasks.length > 0 ? (
          <motion.div
            className="processing-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: "easeOut" }}
            role="status"
            aria-live="polite"
            aria-label={label}
          >
            <motion.div
              className="processing-indicator"
              initial={reduceMotion ? false : { opacity: 0, y: 5, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: reduceMotion ? 0.08 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="processing-spinner" aria-hidden="true" />
              <span>{label}</span>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ProcessingContext.Provider>
  );
}

/** Registers a real in-progress operation with the shared delayed overlay. */
export function useProcessingOverlay(active: boolean, label: string) {
  const context = useContext(ProcessingContext);
  if (!context) throw new Error("useProcessingOverlay must be used inside ProcessingOverlayProvider");

  useEffect(() => {
    if (!active) return;
    return context.begin(label);
  }, [active, context, label]);
}
