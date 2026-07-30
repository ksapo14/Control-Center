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
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { useProcessingOverlay } from "./LoadingOverlay";

type CalendarStatus = {
  configured: boolean;
  connected: boolean;
};

type CreatedEvent = {
  id: string;
  htmlLink: string;
  summary: string;
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

type BusyAction = "status" | "import" | "connect" | "disconnect" | "save" | null;

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

/** Provides lightweight manual Google Calendar batch scheduling. */
export function QuickSchedule() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CalendarStatus>({ configured: false, connected: false });
  const [manualRows, setManualRows] = useState<ManualEventRow[]>(() => [createManualRow()]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error" | "success">("info");
  const [created, setCreated] = useState<CreatedEvent[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const processingLabel = busy === "connect"
    ? "Connecting Google Calendar"
    : busy === "disconnect"
      ? "Disconnecting Google Calendar"
      : busy === "import"
        ? "Importing Calendar credentials"
        : busy === "save"
          ? "Adding Calendar events"
          : "Checking Calendar connection";
  useProcessingOverlay(busy !== null, processingLabel);

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
      const calendar = await invoke<CalendarStatus>("get_google_calendar_status");
      setStatus(calendar);
      if (calendar.connected) showNotice("Google Calendar is ready.", "success");
      else if (calendar.configured) showNotice("Connect Google Calendar to schedule events.");
      else showNotice("Import a Google Desktop OAuth JSON file to connect Calendar.");
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
      titleRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open]);

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
        className="grid size-11 place-items-center p-0"
        aria-haspopup="dialog"
        aria-label="Open Quick Schedule"
        title="Quick Schedule"
        data-shortcut-combo="Control+Alt+KeyS"
        data-shortcut-id="control:quick-schedule"
        data-shortcut-label="Open Quick Schedule"
        data-shortcut-detail="Draft and create calendar events"
        data-shortcut-group="Control panel"
        data-shortcut-order="0"
      >
        <CalendarPlus size={15} strokeWidth={1.7} className="text-signal-300" />
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
                    <TactileButton type="submit" form="manual-schedule-form" disabled={!status.connected || isWorking || manualRows.length === 0} className="h-10 min-w-[160px] px-4">
                      <span className="flex items-center justify-center gap-2 text-[12px] font-semibold text-stone-100"><CalendarPlus size={15} className="text-signal-300" /> Add {manualRows.length} to Calendar</span>
                    </TactileButton>
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
