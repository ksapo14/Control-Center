import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";

type OpenApplication = {
  pid: number;
  name: string;
  title: string;
  protected: boolean;
  protectedReason: string | null;
};

const previewApplications: OpenApplication[] = [
  { pid: 4128, name: "chrome", title: "Project research - Google Chrome", protected: false, protectedReason: null },
  { pid: 7816, name: "Code", title: "Control Panel - Visual Studio Code", protected: false, protectedReason: null },
  { pid: 9340, name: "Spotify", title: "Spotify Premium", protected: false, protectedReason: null },
  {
    pid: 1280,
    name: "explorer",
    title: "Desktop",
    protected: true,
    protectedReason: "Windows shell process is protected",
  },
];

/**
 * Derives a stable fallback monogram when Windows does not provide an application icon.
 * @param application - The process metadata displayed by the task manager.
 * @returns One uppercase character suitable for the process tile.
 */
function processInitial(application: OpenApplication) {
  const source = application.name || application.title;
  return source.trim().charAt(0).toUpperCase() || "A";
}

/**
 * Presents visible Windows applications and guarded force-close controls in a modal.
 * @returns The task-manager trigger and its animated dialog when open.
 * @remarks Side effects: polls native processes and can terminate a selected process tree.
 */
export function TaskManager() {
  // --- Dialog and Process State ---
  const [open, setOpen] = useState(false);
  const [applications, setApplications] = useState<OpenApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [closingPid, setClosingPid] = useState<number | null>(null);
  const [notice, setNotice] = useState("Force close ends the selected process and its child tasks.");
  const [noticeKind, setNoticeKind] = useState<"info" | "error" | "success">("info");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // --- Process Synchronization ---

  /**
   * Refreshes visible applications while optionally preserving the current status message.
   * @param quiet - Whether to suppress loading and summary feedback during background polling.
   * @returns A promise that resolves after the process snapshot is handled.
   * @remarks Side effects: reads native process state and updates dialog state.
   */
  const loadApplications = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = isTauriRuntime()
        ? await invoke<OpenApplication[]>("list_open_applications")
        : previewApplications;
      setApplications(next);
      if (!quiet) {
        setNotice(next.length === 0 ? "No open application windows were found." : `${next.length} open application${next.length === 1 ? "" : "s"} found.`);
        setNoticeKind("info");
      }
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // --- Modal Lifecycle ---

  /**
   * Opens the modal with a fresh process snapshot and safety warning.
   * @returns Nothing.
   * @remarks Side effects: updates modal state and starts an asynchronous process read.
   */
  const showDialog = () => {
    setOpen(true);
    setNotice("Force close ends the selected process and its child tasks.");
    setNoticeKind("info");
    void loadApplications();
  };

  /**
   * Closes the modal and restores keyboard focus to its trigger.
   * @returns Nothing.
   * @remarks Side effects: updates modal state and schedules a focus change.
   */
  const closeDialog = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 80);
    const refreshTimer = window.setInterval(() => void loadApplications(true), 4_000);

    // The custom trap keeps keyboard navigation inside this hand-built modal.
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.clearInterval(refreshTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDialog, loadApplications, open]);

  // --- Destructive Process Action ---

  /**
   * Terminates an unprotected application and refreshes the visible process snapshot.
   * @param application - The process selected for termination.
   * @returns A promise that resolves after success or failure has been surfaced.
   * @remarks Side effects: may terminate the process and all child tasks; unsaved work can be lost.
   */
  const forceClose = async (application: OpenApplication) => {
    if (application.protected || closingPid !== null) return;
    setClosingPid(application.pid);
    setNotice(`Ending ${application.title} and its child tasks…`);
    setNoticeKind("info");
    try {
      if (isTauriRuntime()) {
        await invoke("force_close_application", { pid: application.pid });
        await loadApplications(true);
      } else {
        setApplications((current) => current.filter((item) => item.pid !== application.pid));
      }
      setNotice(`${application.title} was force closed.`);
      setNoticeKind("success");
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
      await loadApplications(true);
    } finally {
      setClosingPid(null);
    }
  };

  // --- Dialog Rendering ---
  return (
    <>
      <TactileButton
        ref={triggerRef}
        onClick={showDialog}
        className="h-9 px-2.5 sm:px-3"
        aria-haspopup="dialog"
        aria-label="Manage open applications"
      >
        <span className="flex items-center gap-2">
          <AppWindow size={15} strokeWidth={1.7} className="text-signal-300" />
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-300 md:inline">
            Open apps
          </span>
        </span>
      </TactileButton>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-3 backdrop-blur-md sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onMouseDown={(event) => event.currentTarget === event.target && closeDialog()}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="task-manager-title"
              className="schedule-panel relative my-auto flex max-h-[calc(100dvh-48px)] w-full max-w-[860px] flex-col overflow-hidden rounded-[18px] border border-black/80 border-t-white/10 shadow-panel"
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <header className="flex shrink-0 items-start justify-between border-b border-black/60 px-5 py-4 sm:px-6 sm:py-5">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-black/70 border-t-white/10 bg-gradient-to-br from-[#272a27] to-[#0d0f0e] text-signal-300 shadow-skeuo-raised">
                    <AppWindow size={20} strokeWidth={1.55} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-400">Windows processes</p>
                    <h2 id="task-manager-title" className="mt-1 text-xl font-semibold tracking-[-0.025em] text-stone-100">
                      Open applications
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void loadApplications()}
                    disabled={loading || closingPid !== null}
                    className="grid size-9 place-items-center rounded-[9px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-40"
                    aria-label="Refresh open applications"
                  >
                    <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
                  </button>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={closeDialog}
                    className="grid size-9 place-items-center rounded-[9px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                    aria-label="Close application manager"
                  >
                    <X size={18} />
                  </button>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-stone-400">
                    {loading ? "Reading open windows…" : `${applications.length} visible application${applications.length === 1 ? "" : "s"}`}
                  </p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-600">Auto-refresh 4s</span>
                </div>

                {loading && applications.length === 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Loading applications">
                    {[0, 1, 2, 3].map((item) => (
                      <div key={item} className="h-[92px] animate-pulse rounded-[13px] border border-black/60 bg-black/20 shadow-well" />
                    ))}
                  </div>
                ) : applications.length === 0 ? (
                  <div className="grid min-h-52 place-items-center rounded-[14px] border border-dashed border-white/[0.08] bg-black/10 px-6 text-center">
                    <div>
                      <AppWindow size={28} strokeWidth={1.35} className="mx-auto text-stone-700" />
                      <p className="mt-3 text-sm font-semibold text-stone-300">No open app windows</p>
                      <p className="mt-1 text-xs text-stone-600">Open an application, then refresh this list.</p>
                    </div>
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {applications.map((application) => {
                      const isClosing = closingPid === application.pid;
                      return (
                        <li
                          key={application.pid}
                          className="group flex min-w-0 items-center gap-3 rounded-[13px] border border-black/65 border-t-white/[0.07] bg-black/20 p-3 shadow-well transition-colors hover:bg-white/[0.025]"
                        >
                          <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-black/60 bg-gradient-to-br from-[#242724] to-[#0c0e0d] text-base font-semibold text-signal-300 shadow-skeuo-raised">
                            {processInitial(application)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold tracking-[-0.01em] text-stone-200" title={application.title}>
                              {application.title}
                            </p>
                            <p className="mt-1 truncate font-mono text-[10px] text-stone-600">
                              {application.name}.exe · PID {application.pid}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void forceClose(application)}
                            disabled={application.protected || closingPid !== null}
                            title={application.protected ? application.protectedReason ?? "Protected process" : `Force close ${application.title}`}
                            aria-label={application.protected ? `${application.title} is protected` : `Force close ${application.title}`}
                            className="grid size-9 shrink-0 place-items-center rounded-[9px] border border-transparent text-stone-600 transition duration-200 hover:border-red-900/50 hover:bg-red-950/30 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent"
                          >
                            {isClosing ? (
                              <LoaderCircle size={16} className="animate-spin text-red-300" />
                            ) : application.protected ? (
                              <LockKeyhole size={15} />
                            ) : (
                              <X size={17} />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <footer
                className={`flex min-h-14 shrink-0 items-center gap-2.5 border-t px-5 py-3 text-xs sm:px-6 ${
                  noticeKind === "error"
                    ? "border-red-900/40 bg-red-950/15 text-red-300"
                    : noticeKind === "success"
                      ? "border-emerald-900/40 bg-emerald-950/15 text-emerald-300"
                      : "border-white/[0.04] bg-black/10 text-stone-500"
                }`}
                aria-live="polite"
              >
                {noticeKind === "error" ? <CircleAlert size={15} className="shrink-0" /> : <CircleAlert size={15} className="shrink-0 text-signal-400" />}
                <p className="min-w-0 leading-relaxed">
                  {notice}
                  {noticeKind === "info" ? " Unsaved work may be lost." : ""}
                </p>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
