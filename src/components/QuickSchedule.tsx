import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CalendarPlus,
  Check,
  Clock3,
  ExternalLink,
  FileKey2,
  Link2,
  LoaderCircle,
  Unplug,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";

type CalendarStatus = {
  configured: boolean;
  connected: boolean;
};

type CreatedEvent = {
  id: string;
  htmlLink: string;
  summary: string;
};

const calendarColors = [
  { id: "1", name: "Lavender", value: "#7986cb" },
  { id: "2", name: "Sage", value: "#33b679" },
  { id: "3", name: "Grape", value: "#8e24aa" },
  { id: "4", name: "Flamingo", value: "#e67c73" },
  { id: "5", name: "Banana", value: "#f6c026" },
  { id: "6", name: "Tangerine", value: "#f5511d" },
  { id: "7", name: "Peacock", value: "#039be5" },
  { id: "8", name: "Graphite", value: "#616161" },
  { id: "9", name: "Blueberry", value: "#3f51b5" },
  { id: "10", name: "Basil", value: "#0b8043" },
  { id: "11", name: "Tomato", value: "#d60000" },
];

/**
 * Formats a local date for an HTML date input without introducing a UTC shift.
 * @param date - The local date to serialize.
 * @returns A `YYYY-MM-DD` value.
 */
function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a local time for an HTML time input.
 * @param date - The local time to serialize.
 * @returns An `HH:mm` value.
 */
function localTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Builds a convenient one-hour default starting at the next half-hour boundary.
 * @returns Local date, start-time, and end-time input values.
 */
function initialSchedule() {
  const now = new Date();
  const start = new Date(now);
  start.setMinutes(Math.ceil((now.getMinutes() + 1) / 30) * 30, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    date: localDateValue(start),
    from: localTimeValue(start),
    to: localTimeValue(end),
  };
}

/**
 * Provides Google Calendar setup and fast primary-calendar event creation in a modal.
 * @returns The schedule trigger and its animated dialog when open.
 * @remarks Side effects: imports credentials, manages OAuth tokens, and creates calendar events.
 */
export function QuickSchedule() {
  // --- Form, Connection, and Dialog State ---
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CalendarStatus>({ configured: false, connected: false });
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => initialSchedule().date);
  const [from, setFrom] = useState(() => initialSchedule().from);
  const [to, setTo] = useState(() => initialSchedule().to);
  const [colorId, setColorId] = useState("7");
  const [busy, setBusy] = useState<"status" | "import" | "connect" | "disconnect" | "save" | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error" | "success">("info");
  const [created, setCreated] = useState<CreatedEvent | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // --- Feedback and Connection Status ---

  /**
   * Updates the modal's unified feedback region.
   * @param message - The user-facing status detail.
   * @param kind - The semantic presentation of the message.
   * @returns Nothing.
   */
  const showNotice = (message: string, kind: "info" | "error" | "success" = "info") => {
    setNotice(message);
    setNoticeKind(kind);
  };

  /**
   * Reads whether Calendar credentials and an authorized session are available.
   * @returns A promise that resolves after status feedback is updated.
   * @remarks Side effects: invokes the native Calendar status command.
   */
  const refreshStatus = async () => {
    if (!isTauriRuntime()) {
      showNotice("Google Calendar setup is available in the installed desktop app.");
      return;
    }
    setBusy("status");
    try {
      const next = await invoke<CalendarStatus>("get_google_calendar_status");
      setStatus(next);
      if (next.connected) showNotice("Google Calendar is connected.", "success");
      else if (next.configured) showNotice("OAuth client ready. Connect your Google account next.");
      else showNotice("Import a Google Desktop OAuth JSON file to begin.");
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  // --- Modal Lifecycle ---

  /**
   * Opens the scheduler with fresh rounded time defaults and connection state.
   * @returns Nothing.
   * @remarks Side effects: resets form state and starts an asynchronous status read.
   */
  const showDialog = () => {
    const defaults = initialSchedule();
    setDate(defaults.date);
    setFrom(defaults.from);
    setTo(defaults.to);
    setCreated(null);
    setOpen(true);
    void refreshStatus();
  };

  /**
   * Closes the scheduler and restores focus to its trigger.
   * @returns Nothing.
   * @remarks Side effects: updates modal state and schedules a focus change.
   */
  const closeDialog = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 80);

    // The custom trap makes this animated div modal behave like a native dialog.
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // --- Calendar Authorization ---

  /**
   * Imports a Google Desktop OAuth file through the native picker.
   * @returns A promise that resolves after configuration state is updated.
   * @remarks Side effects: opens a file picker and stores protected client credentials.
   */
  const importCredentials = async () => {
    if (!isTauriRuntime()) return showNotice("Open the installed desktop app to import OAuth credentials.", "error");
    setBusy("import");
    setCreated(null);
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Import Google Desktop OAuth credentials",
        filters: [{ name: "Google OAuth JSON", extensions: ["json"] }],
      });
      if (!selected || Array.isArray(selected)) {
        showNotice("Credential import canceled.");
        return;
      }
      const next = await invoke<CalendarStatus>("import_google_calendar_credentials", { path: selected });
      setStatus(next);
      showNotice("OAuth client imported. Connect your Google account next.", "success");
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Starts Google authorization for the imported desktop client.
   * @returns A promise that resolves after connection feedback is updated.
   * @remarks Side effects: opens browser authorization and stores protected OAuth tokens.
   */
  const connectCalendar = async () => {
    setBusy("connect");
    setCreated(null);
    showNotice("Finish the Google sign-in in your browser. This window will update when it is done.");
    try {
      const next = await invoke<CalendarStatus>("connect_google_calendar");
      setStatus(next);
      showNotice("Google Calendar connected. You can schedule events now.", "success");
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Removes the local Google Calendar authorization.
   * @returns A promise that resolves after disconnection is reflected in the UI.
   * @remarks Side effects: deletes persisted Calendar OAuth tokens.
   */
  const disconnectCalendar = async () => {
    setBusy("disconnect");
    setCreated(null);
    try {
      const next = await invoke<CalendarStatus>("disconnect_google_calendar");
      setStatus(next);
      showNotice("Calendar disconnected from this PC.");
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  // --- Event Creation ---

  /**
   * Validates the form and creates an event on the user's primary calendar.
   * @param event - The form submission event to suppress during async creation.
   * @returns A promise that resolves after success or validation feedback is shown.
   * @remarks Side effects: sends event data to Google Calendar and clears the title on success.
   */
  const createEvent = async (event: FormEvent) => {
    event.preventDefault();
    setCreated(null);
    if (!title.trim()) return showNotice("Add an event title.", "error");

    // Interpret picker values locally, then send explicit UTC instants to avoid timezone ambiguity.
    const startDate = new Date(`${date}T${from}:00`);
    const endDate = new Date(`${date}T${to}:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return showNotice("Choose an end time after the start time.", "error");
    }

    setBusy("save");
    showNotice("Adding the event to your primary calendar...");
    try {
      const result = await invoke<CreatedEvent>("create_google_calendar_event", {
        request: {
          title: title.trim(),
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          colorId,
        },
      });
      setCreated(result);
      showNotice(`${result.summary} was added to Google Calendar.`, "success");
      setTitle("");
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Opens the most recently created event in Google Calendar.
   * @returns A promise that resolves after the external URL is dispatched.
   * @remarks Side effects: opens the system browser or a preview tab.
   */
  const openCreatedEvent = async () => {
    if (!created) return;
    if (isTauriRuntime()) await openExternal(created.htmlLink);
    else window.open(created.htmlLink, "_blank", "noopener,noreferrer");
  };

  /**
   * Implements wraparound arrow-key selection for the custom color radio group.
   * @param event - The keyboard event raised by a color button.
   * @returns Nothing.
   * @remarks Side effects: updates the selected Calendar color for horizontal arrows.
   */
  const preventEnterOnColor = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const current = calendarColors.findIndex((color) => color.id === colorId);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = (current + direction + calendarColors.length) % calendarColors.length;
      setColorId(calendarColors[next].id);
    }
  };

  // --- Dialog Rendering ---
  const isWorking = busy !== null;

  return (
    <>
      <TactileButton
        ref={triggerRef}
        onClick={showDialog}
        className="h-9 px-2.5 sm:px-3"
        aria-haspopup="dialog"
        data-shortcut-combo="Control+Alt+KeyS"
        data-shortcut-id="control:quick-schedule"
        data-shortcut-label="Open Quick Schedule"
        data-shortcut-detail="Create a calendar event"
        data-shortcut-group="Control panel"
        data-shortcut-order="0"
      >
        <span className="flex items-center gap-2">
          <CalendarPlus size={15} strokeWidth={1.7} className="text-signal-300" />
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-300 sm:inline">
            Quick schedule
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
              aria-labelledby="quick-schedule-title"
              className="schedule-panel relative my-auto w-full max-w-[720px] overflow-hidden rounded-[18px] border border-black/80 border-t-white/10 shadow-panel"
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-start justify-between border-b border-black/60 px-5 py-4 sm:px-6 sm:py-5">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-black/70 border-t-white/10 bg-gradient-to-br from-[#272a27] to-[#0d0f0e] text-signal-300 shadow-skeuo-raised">
                    <CalendarPlus size={20} strokeWidth={1.55} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-400">Primary calendar</p>
                    <h2 id="quick-schedule-title" className="mt-1 text-xl font-semibold tracking-[-0.025em] text-stone-100">
                      Quick schedule
                    </h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDialog}
                  className="grid size-9 shrink-0 place-items-center rounded-[9px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                  aria-label="Close quick schedule"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[calc(100dvh-110px)] overflow-y-auto p-4 sm:p-6">
                <section className="mb-5 flex flex-col gap-3 rounded-[13px] border border-black/70 bg-black/20 p-3.5 shadow-well sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${status.connected ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.72)]" : status.configured ? "bg-signal-400 shadow-amber-led" : "bg-stone-700"}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-200">
                        {status.connected ? "Google Calendar connected" : status.configured ? "OAuth client ready" : "Google connection required"}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                        {status.connected
                          ? "Events save directly to your primary calendar."
                          : status.configured
                            ? "Complete one browser sign-in to authorize event creation."
                            : "Import the Desktop app JSON from Google Cloud once."}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {!status.configured && (
                      <TactileButton onClick={() => void importCredentials()} disabled={isWorking} className="h-9 px-3">
                        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
                          <FileKey2 size={14} className="text-signal-300" /> Import JSON
                        </span>
                      </TactileButton>
                    )}
                    {status.configured && !status.connected && (
                      <>
                        <button
                          type="button"
                          onClick={() => void importCredentials()}
                          disabled={isWorking}
                          className="px-2 text-[11px] font-medium text-stone-500 transition hover:text-stone-200 disabled:opacity-40"
                        >
                          Replace JSON
                        </button>
                        <TactileButton onClick={() => void connectCalendar()} disabled={isWorking} className="h-9 px-3">
                          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
                            <Link2 size={14} className="text-signal-300" /> Connect Google
                          </span>
                        </TactileButton>
                      </>
                    )}
                    {status.connected && (
                      <button
                        type="button"
                        onClick={() => void disconnectCalendar()}
                        disabled={isWorking}
                        className="flex h-9 items-center gap-2 rounded-[9px] px-2.5 text-[11px] font-medium text-stone-500 transition hover:bg-white/[0.03] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-40"
                      >
                        <Unplug size={13} /> Disconnect
                      </button>
                    )}
                  </div>
                </section>

                <form onSubmit={(event) => void createEvent(event)}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="sm:col-span-2">
                      <span className="schedule-label">Title</span>
                      <input
                        ref={titleRef}
                        type="text"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="What are you making time for?"
                        maxLength={512}
                        className="schedule-input"
                        autoComplete="off"
                      />
                    </label>

                    <label>
                      <span className="schedule-label">Date</span>
                      <input
                        type="date"
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                        className="schedule-input"
                        required
                      />
                    </label>

                    <div>
                      <span className="schedule-label">Time</span>
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <label className="sr-only" htmlFor="schedule-from">From time</label>
                        <input
                          id="schedule-from"
                          type="time"
                          value={from}
                          onChange={(event) => setFrom(event.target.value)}
                          className="schedule-input min-w-0"
                          required
                        />
                        <span className="font-mono text-[10px] uppercase text-stone-600">to</span>
                        <label className="sr-only" htmlFor="schedule-to">To time</label>
                        <input
                          id="schedule-to"
                          type="time"
                          value={to}
                          onChange={(event) => setTo(event.target.value)}
                          className="schedule-input min-w-0"
                          required
                        />
                      </div>
                    </div>

                    <fieldset className="sm:col-span-2">
                      <legend className="schedule-label">Event color</legend>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Google Calendar event color">
                        {calendarColors.map((color) => (
                          <button
                            key={color.id}
                            type="button"
                            role="radio"
                            aria-checked={colorId === color.id}
                            aria-label={color.name}
                            title={color.name}
                            onClick={() => setColorId(color.id)}
                            onKeyDown={preventEnterOnColor}
                            className={`relative grid size-8 place-items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-graphite-800 ${colorId === color.id ? "scale-105 border-white/45 shadow-skeuo-raised" : "border-black/70 opacity-65 hover:opacity-100"}`}
                            style={{ backgroundColor: color.value }}
                          >
                            {colorId === color.id && <Check size={14} strokeWidth={2.5} className="text-white drop-shadow" />}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </div>

                  <div
                    className={`mt-5 flex min-h-11 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${noticeKind === "error" ? "border-red-900/50 bg-red-950/20 text-red-300" : noticeKind === "success" ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-300" : "border-black/60 bg-black/15 text-stone-500"}`}
                    aria-live="polite"
                  >
                    {isWorking ? (
                      <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" />
                    ) : noticeKind === "error" ? (
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    ) : noticeKind === "success" ? (
                      <Check size={14} className="mt-0.5 shrink-0" />
                    ) : (
                      <Clock3 size={14} className="mt-0.5 shrink-0" />
                    )}
                    <p className="min-w-0 text-[11px] leading-relaxed">{notice || `Times use ${timezone}.`}</p>
                  </div>

                  <div className="mt-4 flex flex-col-reverse gap-3 border-t border-white/[0.04] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-h-9">
                      {created && (
                        <button
                          type="button"
                          onClick={() => void openCreatedEvent()}
                          className="flex h-9 items-center gap-2 text-[11px] font-medium text-signal-300 transition hover:text-signal-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                        >
                          <ExternalLink size={13} /> Open event in Calendar
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeDialog}
                        className="h-10 rounded-[10px] px-4 text-[12px] font-medium text-stone-500 transition hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                      >
                        Cancel
                      </button>
                      <TactileButton
                        type="submit"
                        disabled={!status.connected || isWorking}
                        className="h-10 min-w-[142px] px-4"
                      >
                        <span className="flex items-center justify-center gap-2 text-[12px] font-semibold text-stone-100">
                          <CalendarPlus size={15} className="text-signal-300" /> Add to Calendar
                        </span>
                      </TactileButton>
                    </div>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
