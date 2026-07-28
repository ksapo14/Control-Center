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
  Sparkles,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";

type CalendarStatus = {
  configured: boolean;
  connected: boolean;
};

type GeminiStatus = {
  configured: boolean;
  model: string;
};

type CreatedEvent = {
  id: string;
  htmlLink: string;
  summary: string;
};

type ScheduleDraft = {
  title: string;
  start: string;
  end: string;
  description: string;
  location: string;
  colorId: string;
  needsReview: boolean;
  warnings: string[];
};

type GeminiDraftResponse = {
  model: string;
  events: ScheduleDraft[];
  warnings: string[];
};

type FailedEvent = {
  index: number;
  title: string;
  error: string;
};

type BatchCreateResult = {
  created: CreatedEvent[];
  failed: FailedEvent[];
};

type ManualEventRow = {
  id: string;
  date: string;
  title: string;
  from: string;
  to: string;
  colorId: string;
};

type ScheduleMode = "gemini" | "manual";
type BusyAction = "status" | "import" | "connect" | "disconnect" | "draft" | "save" | "batch" | null;

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

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function localDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDateValue(date)}T${localTimeValue(date)}`;
}

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

function createManualRow(schedule = initialSchedule(), colorId = "7"): ManualEventRow {
  return {
    id: globalThis.crypto.randomUUID(),
    date: schedule.date,
    title: "",
    from: schedule.from,
    to: schedule.to,
    colorId,
  };
}

function nextManualSchedule(previous?: ManualEventRow) {
  if (!previous) return initialSchedule();
  const start = new Date(`${previous.date}T${previous.to}:00`);
  if (Number.isNaN(start.getTime())) return initialSchedule();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    date: localDateValue(start),
    from: localTimeValue(start),
    to: localTimeValue(end),
  };
}

function editableDraft(event: ScheduleDraft): ScheduleDraft {
  return {
    ...event,
    start: localDateTimeValue(event.start),
    end: localDateTimeValue(event.end),
  };
}

/** Provides AI-assisted multi-event drafting and manual Google Calendar creation. */
export function QuickSchedule() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ScheduleMode>("gemini");
  const [status, setStatus] = useState<CalendarStatus>({ configured: false, connected: false });
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>({ configured: false, model: "gemini-3.5-flash" });
  const [instructions, setInstructions] = useState("");
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [manualRows, setManualRows] = useState<ManualEventRow[]>(() => [createManualRow()]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error" | "success">("info");
  const [created, setCreated] = useState<CreatedEvent[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const showNotice = (message: string, kind: "info" | "error" | "success" = "info") => {
    setNotice(message);
    setNoticeKind(kind);
  };

  const refreshStatus = async () => {
    if (!isTauriRuntime()) {
      showNotice("Scheduling integrations are available in the installed desktop app.");
      return;
    }
    setBusy("status");
    try {
      const [calendar, gemini] = await Promise.all([
        invoke<CalendarStatus>("get_google_calendar_status"),
        invoke<GeminiStatus>("get_gemini_schedule_status"),
      ]);
      setStatus(calendar);
      setGeminiStatus(gemini);
      if (calendar.connected && gemini.configured) showNotice("Gemini drafting and Google Calendar are ready.", "success");
      else if (!gemini.configured) showNotice("Add GEMINI_API_KEY to the project-root .env file, then restart the app.");
      else if (calendar.configured) showNotice("Gemini is ready. Connect Google Calendar to schedule reviewed drafts.");
      else showNotice("Gemini is ready. Import a Google Desktop OAuth JSON file to connect Calendar.");
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const showDialog = () => {
    setManualRows([createManualRow()]);
    setCreated([]);
    setOpen(true);
    void refreshStatus();
  };

  const closeDialog = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (mode === "gemini") instructionsRef.current?.focus();
      else titleRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [mode, open]);

  const importCredentials = async () => {
    if (!isTauriRuntime()) return showNotice("Open the installed desktop app to import OAuth credentials.", "error");
    setBusy("import");
    setCreated([]);
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

  const connectCalendar = async () => {
    setBusy("connect");
    setCreated([]);
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

  const disconnectCalendar = async () => {
    setBusy("disconnect");
    setCreated([]);
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

  const draftEvents = async (event: FormEvent) => {
    event.preventDefault();
    setCreated([]);
    if (!instructions.trim()) return showNotice("Describe at least one event.", "error");
    if (!geminiStatus.configured) return showNotice("Add GEMINI_API_KEY to .env and restart the app first.", "error");

    setBusy("draft");
    showNotice("Gemini is turning your instructions into editable event drafts...");
    try {
      const result = await invoke<GeminiDraftResponse>("parse_schedule_with_gemini", {
        request: {
          instructions: instructions.trim(),
          timeZone: timezone,
          referenceTime: new Date().toISOString(),
        },
      });
      setDrafts(result.events.map(editableDraft));
      setDraftWarnings(result.warnings);
      const reviewCount = result.events.filter((item) => item.needsReview).length;
      showNotice(
        reviewCount > 0
          ? `Drafted ${result.events.length} event${result.events.length === 1 ? "" : "s"}; ${reviewCount} need extra review.`
          : `Drafted ${result.events.length} event${result.events.length === 1 ? "" : "s"}. Review before scheduling.`,
        "success",
      );
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const updateDraft = (index: number, update: Partial<ScheduleDraft>) => {
    setDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...update } : item)));
  };

  const removeDraft = (index: number) => {
    setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const scheduleDrafts = async () => {
    if (drafts.length === 0) return showNotice("Draft at least one event first.", "error");
    if (!status.connected) return showNotice("Connect Google Calendar before scheduling.", "error");

    const events = [];
    for (const [index, draft] of drafts.entries()) {
      const start = new Date(draft.start);
      const end = new Date(draft.end);
      if (!draft.title.trim()) return showNotice(`Draft ${index + 1} needs a title.`, "error");
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return showNotice(`Draft ${index + 1} needs a valid end time after its start.`, "error");
      }
      events.push({
        title: draft.title.trim(),
        start: start.toISOString(),
        end: end.toISOString(),
        description: draft.description.trim() || null,
        location: draft.location.trim() || null,
        colorId: draft.colorId || null,
      });
    }

    setBusy("batch");
    setCreated([]);
    showNotice(`Adding ${events.length} reviewed event${events.length === 1 ? "" : "s"} to your primary calendar...`);
    try {
      const result = await invoke<BatchCreateResult>("create_google_calendar_events", { request: { events } });
      setCreated(result.created);
      if (result.failed.length === 0) {
        setDrafts([]);
        setDraftWarnings([]);
        showNotice(`Added ${result.created.length} event${result.created.length === 1 ? "" : "s"} to Google Calendar.`, "success");
      } else {
        const failedIndexes = new Set(result.failed.map((item) => item.index));
        setDrafts((current) => current.filter((_, index) => failedIndexes.has(index)));
        const detail = result.failed.map((item) => `${item.title}: ${item.error}`).join(" ");
        showNotice(`${result.created.length} added; ${result.failed.length} failed. ${detail}`, "error");
      }
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const updateManualRow = (id: string, update: Partial<ManualEventRow>) => {
    setManualRows((current) => current.map((row) => (row.id === id ? { ...row, ...update, id } : row)));
  };

  const addManualRow = () => {
    setManualRows((current) => {
      const previous = current[current.length - 1];
      return [...current, createManualRow(nextManualSchedule(previous), previous?.colorId ?? "7")];
    });
  };

  const removeManualRow = (id: string) => {
    setManualRows((current) => {
      const remaining = current.filter((row) => row.id !== id);
      return remaining.length > 0 ? remaining : [createManualRow()];
    });
  };

  const createManualEvents = async (event: FormEvent) => {
    event.preventDefault();
    setCreated([]);
    if (manualRows.length === 0) return showNotice("Add at least one event row.", "error");

    const events = [];
    for (const [index, row] of manualRows.entries()) {
      const startDate = new Date(`${row.date}T${row.from}:00`);
      const endDate = new Date(`${row.date}T${row.to}:00`);
      if (!row.title.trim()) return showNotice(`Row ${index + 1} needs a title.`, "error");
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
        return showNotice(`Row ${index + 1} needs an end time after its start time.`, "error");
      }
      events.push({
        title: row.title.trim(),
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        description: null,
        location: null,
        colorId: row.colorId,
      });
    }

    setBusy("save");
    showNotice(`Adding ${events.length} event${events.length === 1 ? "" : "s"} to your primary calendar...`);
    try {
      const result = await invoke<BatchCreateResult>("create_google_calendar_events", { request: { events } });
      setCreated(result.created);
      if (result.failed.length === 0) {
        setManualRows([createManualRow()]);
        showNotice(`Added ${result.created.length} event${result.created.length === 1 ? "" : "s"} to Google Calendar.`, "success");
      } else {
        const failedIndexes = new Set(result.failed.map((item) => item.index));
        setManualRows((current) => current.filter((_, index) => failedIndexes.has(index)));
        const detail = result.failed.map((item) => `${item.title}: ${item.error}`).join(" ");
        showNotice(`${result.created.length} added; ${result.failed.length} failed. ${detail}`, "error");
      }
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const openCreatedEvent = async (event: CreatedEvent) => {
    if (isTauriRuntime()) await openExternal(event.htmlLink);
    else window.open(event.htmlLink, "_blank", "noopener,noreferrer");
  };

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
        data-shortcut-detail="Draft and create calendar events"
        data-shortcut-group="Control panel"
        data-shortcut-order="0"
      >
        <span className="flex items-center gap-2">
          <CalendarPlus size={15} strokeWidth={1.7} className="text-signal-300" />
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-300 sm:inline">Quick schedule</span>
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
              className="schedule-panel relative my-auto w-full max-w-[780px] overflow-hidden rounded-[18px] border border-black/80 border-t-white/10 shadow-panel"
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
                    <h2 id="quick-schedule-title" className="mt-1 text-xl font-semibold tracking-[-0.025em] text-stone-100">Quick schedule</h2>
                  </div>
                </div>
                <button type="button" onClick={closeDialog} className="grid size-9 shrink-0 place-items-center rounded-[9px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400" aria-label="Close quick schedule">
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[calc(100dvh-110px)] overflow-y-auto p-4 sm:p-6">
                <section className="mb-4 flex flex-col gap-3 rounded-[13px] border border-black/70 bg-black/20 p-3.5 shadow-well sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`size-2.5 shrink-0 rounded-full ${status.connected ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.72)]" : status.configured ? "bg-signal-400 shadow-amber-led" : "bg-stone-700"}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-200">{status.connected ? "Google Calendar connected" : status.configured ? "OAuth client ready" : "Google connection required"}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                        {status.connected ? "Reviewed events save to your primary calendar." : status.configured ? "Complete one browser sign-in to authorize event creation." : "Import the Desktop app JSON from Google Cloud once."}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!status.configured && (
                      <TactileButton onClick={() => void importCredentials()} disabled={isWorking} className="h-9 px-3">
                        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]"><FileKey2 size={14} className="text-signal-300" /> Import JSON</span>
                      </TactileButton>
                    )}
                    {status.configured && !status.connected && (
                      <>
                        <button type="button" onClick={() => void importCredentials()} disabled={isWorking} className="px-2 text-[11px] font-medium text-stone-500 transition hover:text-stone-200 disabled:opacity-40">Replace JSON</button>
                        <TactileButton onClick={() => void connectCalendar()} disabled={isWorking} className="h-9 px-3">
                          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]"><Link2 size={14} className="text-signal-300" /> Connect Google</span>
                        </TactileButton>
                      </>
                    )}
                    {status.connected && (
                      <button type="button" onClick={() => void disconnectCalendar()} disabled={isWorking} className="flex h-9 items-center gap-2 rounded-[9px] px-2.5 text-[11px] font-medium text-stone-500 transition hover:bg-white/[0.03] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-40"><Unplug size={13} /> Disconnect</button>
                    )}
                  </div>
                </section>

                <div className="mb-5 grid grid-cols-2 gap-1 rounded-[11px] border border-black/70 bg-black/30 p-1" role="tablist" aria-label="Scheduling method">
                  <button type="button" role="tab" aria-selected={mode === "gemini"} onClick={() => setMode("gemini")} className={`flex h-9 items-center justify-center gap-2 rounded-[8px] text-[11px] font-semibold transition ${mode === "gemini" ? "border border-white/[0.08] bg-white/[0.055] text-stone-100 shadow-skeuo-raised" : "text-stone-500 hover:text-stone-300"}`}><Sparkles size={14} className="text-signal-300" /> Describe with Gemini</button>
                  <button type="button" role="tab" aria-selected={mode === "manual"} onClick={() => setMode("manual")} className={`flex h-9 items-center justify-center gap-2 rounded-[8px] text-[11px] font-semibold transition ${mode === "manual" ? "border border-white/[0.08] bg-white/[0.055] text-stone-100 shadow-skeuo-raised" : "text-stone-500 hover:text-stone-300"}`}><Clock3 size={14} /> Manual events</button>
                </div>

                {mode === "gemini" ? (
                  <div role="tabpanel">
                    <form onSubmit={(event) => void draftEvents(event)}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <label htmlFor="gemini-schedule-instructions" className="schedule-label mb-0">Schedule instructions</label>
                        <span className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] ${geminiStatus.configured ? "text-emerald-400" : "text-stone-600"}`}>
                          <span className={`size-1.5 rounded-full ${geminiStatus.configured ? "bg-emerald-400" : "bg-stone-700"}`} /> {geminiStatus.model}
                        </span>
                      </div>
                      <textarea
                        ref={instructionsRef}
                        id="gemini-schedule-instructions"
                        value={instructions}
                        onChange={(event) => setInstructions(event.target.value)}
                        placeholder="Tomorrow: design review at 10 for 45 minutes, lunch with Sam at noon, and focus time from 2–4. Make focus time sage."
                        maxLength={6000}
                        className="schedule-input h-28 resize-y py-3 leading-relaxed"
                      />
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-[10px] leading-relaxed text-stone-600">Use normal language. Dates resolve in {timezone}; drafts stay editable and capacity spikes retry automatically.</p>
                        <TactileButton type="submit" disabled={!geminiStatus.configured || isWorking || !instructions.trim()} className="h-10 shrink-0 px-4">
                          <span className="flex items-center justify-center gap-2 text-[12px] font-semibold text-stone-100">{busy === "draft" ? <LoaderCircle size={15} className="animate-spin text-signal-300" /> : <Sparkles size={15} className="text-signal-300" />} Draft events</span>
                        </TactileButton>
                      </div>
                    </form>

                    {draftWarnings.length > 0 && (
                      <div className="mt-4 rounded-[10px] border border-signal-500/30 bg-signal-500/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-signal-300">
                        {draftWarnings.map((warning) => <p key={warning}>{warning}</p>)}
                      </div>
                    )}

                    {drafts.length > 0 && (
                      <section className="mt-5 border-t border-white/[0.05] pt-5" aria-label="Gemini event drafts">
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-stone-200">Review drafts</h3>
                            <p className="mt-1 text-[10px] text-stone-600">Nothing is scheduled until you confirm below.</p>
                          </div>
                          <span className="rounded-full border border-black/60 bg-black/20 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-stone-500">{drafts.length} event{drafts.length === 1 ? "" : "s"}</span>
                        </div>

                        <div className="space-y-3">
                          {drafts.map((draft, index) => (
                            <article key={index} className="rounded-[13px] border border-black/70 bg-black/15 p-3.5 shadow-well">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-stone-600">Draft {index + 1}</span>
                                  {draft.needsReview && <span className="rounded-full border border-signal-500/30 bg-signal-500/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-signal-300">Check details</span>}
                                </div>
                                <button type="button" onClick={() => removeDraft(index)} disabled={isWorking} className="grid size-8 place-items-center rounded-[8px] text-stone-600 transition hover:bg-red-950/30 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400" aria-label={`Remove draft ${index + 1}`}><Trash2 size={14} /></button>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="sm:col-span-2">
                                  <span className="schedule-label">Title</span>
                                  <input type="text" value={draft.title} onChange={(event) => updateDraft(index, { title: event.target.value })} maxLength={512} className="schedule-input" />
                                </label>
                                <label>
                                  <span className="schedule-label">Starts</span>
                                  <input type="datetime-local" value={draft.start} onChange={(event) => updateDraft(index, { start: event.target.value })} className="schedule-input" />
                                </label>
                                <label>
                                  <span className="schedule-label">Ends</span>
                                  <input type="datetime-local" value={draft.end} onChange={(event) => updateDraft(index, { end: event.target.value })} className="schedule-input" />
                                </label>
                                <label>
                                  <span className="schedule-label">Location</span>
                                  <input type="text" value={draft.location} onChange={(event) => updateDraft(index, { location: event.target.value })} maxLength={1024} placeholder="Optional" className="schedule-input" />
                                </label>
                                <label>
                                  <span className="schedule-label">Color</span>
                                  <select value={draft.colorId} onChange={(event) => updateDraft(index, { colorId: event.target.value })} className="schedule-input">
                                    <option value="">Calendar default</option>
                                    {calendarColors.map((color) => <option key={color.id} value={color.id}>{color.name}</option>)}
                                  </select>
                                </label>
                                <label className="sm:col-span-2">
                                  <span className="schedule-label">Description</span>
                                  <textarea value={draft.description} onChange={(event) => updateDraft(index, { description: event.target.value })} maxLength={8192} placeholder="Optional" className="schedule-input h-20 resize-y py-3 leading-relaxed" />
                                </label>
                              </div>
                              {draft.warnings.length > 0 && (
                                <div className="mt-3 flex gap-2 rounded-[9px] border border-signal-500/25 bg-signal-500/[0.055] px-3 py-2 text-[10px] leading-relaxed text-signal-300">
                                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                                  <div>{draft.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                ) : (
                  <form id="manual-schedule-form" onSubmit={(event) => void createManualEvents(event)} role="tabpanel">
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-stone-200">Event table</h3>
                        <p className="mt-1 text-[10px] leading-relaxed text-stone-600">Each row becomes a separate event in {timezone}.</p>
                      </div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone-600">{manualRows.length} row{manualRows.length === 1 ? "" : "s"}</span>
                    </div>

                    <div className="overflow-x-auto rounded-[10px] border border-white/[0.06] bg-black/10">
                      <table className="w-full min-w-[720px] table-fixed border-collapse" aria-label="Manual calendar events">
                        <colgroup>
                          <col className="w-[145px]" />
                          <col />
                          <col className="w-[105px]" />
                          <col className="w-[105px]" />
                          <col className="w-[135px]" />
                          <col className="w-[42px]" />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-white/[0.06] bg-white/[0.018]">
                            {['Date', 'Title', 'Time from', 'Time to', 'Color'].map((heading) => (
                              <th key={heading} scope="col" className="px-2.5 py-2.5 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-600">{heading}</th>
                            ))}
                            <th scope="col"><span className="sr-only">Remove</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {manualRows.map((row, index) => (
                            <tr key={row.id} className="border-b border-white/[0.045] last:border-b-0">
                              <td className="p-1.5">
                                <label className="sr-only" htmlFor={`manual-date-${row.id}`}>Event {index + 1} date</label>
                                <input id={`manual-date-${row.id}`} type="date" value={row.date} onChange={(event) => updateManualRow(row.id, { date: event.target.value })} className="schedule-table-input" required />
                              </td>
                              <td className="p-1.5">
                                <label className="sr-only" htmlFor={`manual-title-${row.id}`}>Event {index + 1} title</label>
                                <input ref={index === 0 ? titleRef : undefined} id={`manual-title-${row.id}`} type="text" value={row.title} onChange={(event) => updateManualRow(row.id, { title: event.target.value })} placeholder="Event title" maxLength={512} className="schedule-table-input" autoComplete="off" required />
                              </td>
                              <td className="p-1.5">
                                <label className="sr-only" htmlFor={`manual-from-${row.id}`}>Event {index + 1} start time</label>
                                <input id={`manual-from-${row.id}`} type="time" value={row.from} onChange={(event) => updateManualRow(row.id, { from: event.target.value })} className="schedule-table-input" required />
                              </td>
                              <td className="p-1.5">
                                <label className="sr-only" htmlFor={`manual-to-${row.id}`}>Event {index + 1} end time</label>
                                <input id={`manual-to-${row.id}`} type="time" value={row.to} onChange={(event) => updateManualRow(row.id, { to: event.target.value })} className="schedule-table-input" required />
                              </td>
                              <td className="p-1.5">
                                <label className="sr-only" htmlFor={`manual-color-${row.id}`}>Event {index + 1} color</label>
                                <select id={`manual-color-${row.id}`} value={row.colorId} onChange={(event) => updateManualRow(row.id, { colorId: event.target.value })} className="schedule-table-input cursor-pointer pr-1">
                                  {calendarColors.map((color) => <option key={color.id} value={color.id}>{color.name}</option>)}
                                </select>
                              </td>
                              <td className="p-1.5">
                                <button type="button" onClick={() => removeManualRow(row.id)} disabled={isWorking} className="grid size-8 place-items-center rounded-[6px] text-stone-700 transition hover:bg-red-950/20 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-40" aria-label={`Remove event row ${index + 1}`}><Trash2 size={13} strokeWidth={1.8} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <button type="button" onClick={addManualRow} disabled={isWorking} className="mt-3 flex h-9 items-center gap-2 rounded-[7px] border border-white/[0.07] px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-500 transition hover:border-white/[0.12] hover:bg-white/[0.025] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-40">
                      <span aria-hidden="true" className="text-base font-normal leading-none text-signal-300">+</span> Add event row
                    </button>
                  </form>
                )}

                <div className={`mt-5 flex min-h-11 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${noticeKind === "error" ? "border-red-900/50 bg-red-950/20 text-red-300" : noticeKind === "success" ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-300" : "border-black/60 bg-black/15 text-stone-500"}`} aria-live="polite">
                  {isWorking ? <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" /> : noticeKind === "error" ? <AlertCircle size={14} className="mt-0.5 shrink-0" /> : noticeKind === "success" ? <Check size={14} className="mt-0.5 shrink-0" /> : <Clock3 size={14} className="mt-0.5 shrink-0" />}
                  <p className="min-w-0 text-[11px] leading-relaxed">{notice || `Times use ${timezone}.`}</p>
                </div>

                <div className="mt-4 flex flex-col-reverse gap-3 border-t border-white/[0.04] pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1">
                    {created.map((event) => (
                      <button key={event.id || event.htmlLink} type="button" onClick={() => void openCreatedEvent(event)} className="flex h-8 items-center gap-2 text-[11px] font-medium text-signal-300 transition hover:text-signal-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"><ExternalLink size={13} /> {event.summary}</button>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <button type="button" onClick={closeDialog} className="h-10 rounded-[10px] px-4 text-[12px] font-medium text-stone-500 transition hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400">Cancel</button>
                    {mode === "gemini" ? (
                      <TactileButton type="button" onClick={() => void scheduleDrafts()} disabled={!status.connected || isWorking || drafts.length === 0} className="h-10 min-w-[160px] px-4">
                        <span className="flex items-center justify-center gap-2 text-[12px] font-semibold text-stone-100"><CalendarPlus size={15} className="text-signal-300" /> Schedule {drafts.length || "drafts"}</span>
                      </TactileButton>
                    ) : (
                      <TactileButton type="submit" form="manual-schedule-form" disabled={!status.connected || isWorking || manualRows.length === 0} className="h-10 min-w-[160px] px-4">
                        <span className="flex items-center justify-center gap-2 text-[12px] font-semibold text-stone-100"><CalendarPlus size={15} className="text-signal-300" /> Add {manualRows.length} to Calendar</span>
                      </TactileButton>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
