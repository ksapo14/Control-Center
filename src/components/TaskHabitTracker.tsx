import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { TRACKER_SYNC_EVENT, TRACKER_UPDATED_EVENT } from "../lib/productivity";
import { TactileButton } from "./TactileButton";

type TaskItem = {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  createdAt: string;
};

type HabitFrequency = "daily" | "weekdays" | "weekly";

type HabitItem = {
  id: string;
  name: string;
  frequency: HabitFrequency;
  completions: string[];
  createdAt: string;
};

type TrackerData = {
  version: 1;
  tasks: TaskItem[];
  habits: HabitItem[];
};

type TrackerView = "tasks" | "habits";

const TRACKER_STORAGE_KEY = "control-panel.tasks-habits";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function localId(prefix: string) {
  return globalThis.crypto?.randomUUID?.()
    ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function moveDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function isWeekday(value: string) {
  const day = new Date(`${value}T12:00:00`).getDay();
  return day >= 1 && day <= 5;
}

function previousEligibleDay(value: string, frequency: HabitFrequency) {
  let candidate = moveDate(value, -1);
  while (frequency === "weekdays" && !isWeekday(candidate)) candidate = moveDate(candidate, -1);
  return candidate;
}

function weekStart(value: string) {
  const date = new Date(`${value}T12:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return dateKey(date);
}

function habitStreak(habit: HabitItem, today: string) {
  const completions = new Set(habit.completions);
  if (habit.frequency === "weekly") {
    const completedWeeks = new Set(habit.completions.map(weekStart));
    let cursor = weekStart(today);
    if (!completedWeeks.has(cursor)) cursor = moveDate(cursor, -7);
    let streak = 0;
    while (completedWeeks.has(cursor)) {
      streak += 1;
      cursor = moveDate(cursor, -7);
    }
    return streak;
  }

  let cursor = today;
  while (habit.frequency === "weekdays" && !isWeekday(cursor)) cursor = moveDate(cursor, -1);
  if (!completions.has(cursor)) cursor = previousEligibleDay(cursor, habit.frequency);
  let streak = 0;
  while (completions.has(cursor)) {
    streak += 1;
    cursor = previousEligibleDay(cursor, habit.frequency);
  }
  return streak;
}

function restoreTracker(): TrackerData {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(TRACKER_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return { version: 1, tasks: [], habits: [] };
    const candidate = stored as Partial<TrackerData>;
    const tasks = Array.isArray(candidate.tasks)
      ? candidate.tasks.filter((item): item is TaskItem => Boolean(
        item
        && typeof item.id === "string"
        && typeof item.title === "string"
        && typeof item.dueDate === "string"
        && typeof item.completed === "boolean"
        && typeof item.createdAt === "string",
      ))
      : [];
    const habits = Array.isArray(candidate.habits)
      ? candidate.habits.filter((item): item is HabitItem => Boolean(
        item
        && typeof item.id === "string"
        && typeof item.name === "string"
        && ["daily", "weekdays", "weekly"].includes(item.frequency)
        && Array.isArray(item.completions)
        && item.completions.every((value) => typeof value === "string" && datePattern.test(value))
        && typeof item.createdAt === "string",
      ))
      : [];
    return { version: 1, tasks, habits };
  } catch {
    return { version: 1, tasks: [], habits: [] };
  }
}

function ChecklistMark({ size = 17 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
    </svg>
  );
}

function CloseMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function DeleteMark() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
    </svg>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span className={`grid size-[18px] place-items-center rounded-[5px] border transition ${checked ? "border-signal-400/60 bg-signal-500/15 text-signal-300" : "border-white/[0.12] bg-black/15 text-transparent"}`}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m2 6 2.4 2.4L10 3" />
      </svg>
    </span>
  );
}

/** Local checklist for one-off tasks and recurring habit history. */
export function TaskHabitTracker() {
  const initial = useMemo(restoreTracker, []);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<TrackerView>("tasks");
  const [tasks, setTasks] = useState(initial.tasks);
  const [habits, setHabits] = useState(initial.habits);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const today = dateKey();

  useEffect(() => {
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify({ version: 1, tasks, habits } satisfies TrackerData));
        window.dispatchEvent(new CustomEvent(TRACKER_UPDATED_EVENT));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 160);
    return () => window.clearTimeout(timer);
  }, [habits, tasks]);

  useEffect(() => {
    const syncFromEnvironment = () => {
      const next = restoreTracker();
      setTasks(next.tasks);
      setHabits(next.habits);
    };
    window.addEventListener(TRACKER_SYNC_EVENT, syncFromEnvironment);
    return () => window.removeEventListener(TRACKER_SYNC_EVENT, syncFromEnvironment);
  }, []);

  const closeDialog = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 80);
    const handleKeys = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
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
    document.addEventListener("keydown", handleKeys);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeys);
    };
  }, [open]);

  const focusEntry = (id: string) => {
    window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-tracker-entry="${id}"]`)?.focus(), 0);
  };

  const addTask = () => {
    const id = localId("task");
    setTasks((current) => [...current, { id, title: "", dueDate: "", completed: false, createdAt: new Date().toISOString() }]);
    focusEntry(id);
  };

  const addHabit = () => {
    const id = localId("habit");
    setHabits((current) => [...current, { id, name: "", frequency: "daily", completions: [], createdAt: new Date().toISOString() }]);
    focusEntry(id);
  };

  const updateTask = (id: string, update: Partial<TaskItem>) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...update, id } : task)));
  };

  const updateHabit = (id: string, update: Partial<HabitItem>) => {
    setHabits((current) => current.map((habit) => (habit.id === id ? { ...habit, ...update, id } : habit)));
  };

  const toggleHabit = (habit: HabitItem) => {
    const completed = habit.completions.includes(today);
    updateHabit(habit.id, {
      completions: completed
        ? habit.completions.filter((value) => value !== today)
        : [...habit.completions, today].sort(),
    });
  };

  const completedTasks = tasks.filter((task) => task.completed).length;
  const completedHabits = habits.filter((habit) => habit.completions.includes(today)).length;

  return (
    <>
      <TactileButton
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="h-9 px-2.5 sm:px-3"
        aria-haspopup="dialog"
        data-shortcut-combo="Control+Alt+KeyH"
        data-shortcut-id="control:tasks-habits"
        data-shortcut-label="Open Tasks and Habits"
        data-shortcut-detail="Track local tasks and routines"
        data-shortcut-group="Control panel"
        data-shortcut-order="2"
      >
        <span className="flex items-center gap-2">
          <ChecklistMark size={15} />
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-300 lg:inline">Tasks</span>
        </span>
      </TactileButton>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-3 backdrop-blur-md sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onMouseDown={(event) => event.currentTarget === event.target && closeDialog()}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="task-habit-title"
              className="schedule-panel relative my-auto flex h-[min(720px,calc(100dvh-24px))] w-full max-w-[900px] flex-col overflow-hidden rounded-[16px] border border-black/80 border-t-white/10 shadow-panel"
              initial={{ opacity: 0, y: 10, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 7, scale: 0.995 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-white/[0.055] px-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3 text-signal-300">
                  <ChecklistMark size={20} />
                  <div>
                    <h2 id="task-habit-title" className="text-lg font-semibold tracking-[-0.02em] text-stone-100">Tasks and habits</h2>
                    <p className="mt-0.5 text-[10px] text-stone-600">Private to this device</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={view === "tasks" ? addTask : addHabit} className="h-9 rounded-[7px] border border-white/[0.08] px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-stone-400 transition hover:bg-white/[0.03] hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400">
                    + Add {view === "tasks" ? "task" : "habit"}
                  </button>
                  <button ref={closeRef} type="button" onClick={closeDialog} className="grid size-9 place-items-center rounded-[7px] text-stone-600 transition hover:bg-white/[0.03] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400" aria-label="Close tasks and habits"><CloseMark /></button>
                </div>
              </header>

              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.05] px-4 py-3 sm:px-5">
                <div className="grid w-full max-w-[310px] grid-cols-2 gap-1 rounded-[8px] border border-white/[0.06] bg-black/15 p-1" role="tablist" aria-label="Tracker view">
                  <button type="button" role="tab" aria-selected={view === "tasks"} onClick={() => setView("tasks")} className={`h-8 rounded-[6px] text-[10px] font-semibold transition ${view === "tasks" ? "bg-white/[0.06] text-stone-100" : "text-stone-600 hover:text-stone-300"}`}>Tasks · {tasks.length - completedTasks}</button>
                  <button type="button" role="tab" aria-selected={view === "habits"} onClick={() => setView("habits")} className={`h-8 rounded-[6px] text-[10px] font-semibold transition ${view === "habits" ? "bg-white/[0.06] text-stone-100" : "text-stone-600 hover:text-stone-300"}`}>Habits · {completedHabits}/{habits.length}</button>
                </div>
                <p className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] ${saveState === "error" ? "text-red-400" : "text-stone-700"}`} aria-live="polite">
                  {saveState === "saving" ? "Saving" : saveState === "error" ? "Save failed" : "Saved locally"}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
                {view === "tasks" ? (
                  <section role="tabpanel">
                    {tasks.length === 0 ? (
                      <div className="grid min-h-72 place-items-center text-center">
                        <div>
                          <p className="text-sm font-semibold text-stone-400">No tasks yet</p>
                          <p className="mt-1.5 text-xs text-stone-700">Add a row and keep the list short.</p>
                          <button type="button" onClick={addTask} className="mt-4 h-9 rounded-[7px] border border-white/[0.08] px-3 text-[11px] font-semibold text-stone-400 hover:bg-white/[0.03] hover:text-stone-100">+ Add task</button>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-[10px] border border-white/[0.06] bg-black/10">
                        <table className="w-full min-w-[610px] table-fixed border-collapse" aria-label="Tasks">
                          <colgroup><col className="w-[52px]" /><col /><col className="w-[155px]" /><col className="w-[48px]" /></colgroup>
                          <thead><tr className="border-b border-white/[0.06] bg-white/[0.015]"><th><span className="sr-only">Complete</span></th><th className="tracker-heading">Task</th><th className="tracker-heading">Due</th><th><span className="sr-only">Remove</span></th></tr></thead>
                          <tbody>
                            {tasks.map((task, index) => {
                              const overdue = Boolean(task.dueDate && task.dueDate < today && !task.completed);
                              return (
                                <tr key={task.id} className="border-b border-white/[0.045] last:border-b-0">
                                  <td className="px-3 py-1.5">
                                    <button type="button" onClick={() => updateTask(task.id, { completed: !task.completed })} className="grid size-8 place-items-center rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400" aria-label={`${task.completed ? "Mark incomplete" : "Complete"} task ${index + 1}`} aria-pressed={task.completed}><CheckBox checked={task.completed} /></button>
                                  </td>
                                  <td className="p-1.5"><label className="sr-only" htmlFor={`task-${task.id}`}>Task {index + 1}</label><input data-tracker-entry={task.id} id={`task-${task.id}`} value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} onKeyDown={(event) => event.key === "Enter" && addTask()} maxLength={300} placeholder="What needs to be done?" className={`schedule-table-input ${task.completed ? "text-stone-700 line-through" : ""}`} /></td>
                                  <td className="p-1.5"><label className="sr-only" htmlFor={`task-due-${task.id}`}>Task {index + 1} due date</label><input id={`task-due-${task.id}`} type="date" value={task.dueDate} onChange={(event) => updateTask(task.id, { dueDate: event.target.value })} className={`schedule-table-input ${overdue ? "text-red-300" : ""}`} title={overdue ? "Overdue" : undefined} /></td>
                                  <td className="p-1.5"><button type="button" onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))} className="tracker-delete-button" aria-label={`Delete task ${index + 1}`}><DeleteMark /></button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {completedTasks > 0 && <button type="button" onClick={() => setTasks((current) => current.filter((task) => !task.completed))} className="mt-3 text-[10px] font-medium text-stone-700 transition hover:text-red-400">Clear {completedTasks} completed</button>}
                  </section>
                ) : (
                  <section role="tabpanel">
                    {habits.length === 0 ? (
                      <div className="grid min-h-72 place-items-center text-center">
                        <div>
                          <p className="text-sm font-semibold text-stone-400">No habits yet</p>
                          <p className="mt-1.5 text-xs text-stone-700">Daily checks are saved by local date.</p>
                          <button type="button" onClick={addHabit} className="mt-4 h-9 rounded-[7px] border border-white/[0.08] px-3 text-[11px] font-semibold text-stone-400 hover:bg-white/[0.03] hover:text-stone-100">+ Add habit</button>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-[10px] border border-white/[0.06] bg-black/10">
                        <table className="w-full min-w-[610px] table-fixed border-collapse" aria-label="Habits">
                          <colgroup><col className="w-[70px]" /><col /><col className="w-[150px]" /><col className="w-[105px]" /><col className="w-[48px]" /></colgroup>
                          <thead><tr className="border-b border-white/[0.06] bg-white/[0.015]"><th className="tracker-heading text-center">Today</th><th className="tracker-heading">Habit</th><th className="tracker-heading">Rhythm</th><th className="tracker-heading">Streak</th><th><span className="sr-only">Remove</span></th></tr></thead>
                          <tbody>
                            {habits.map((habit, index) => {
                              const completed = habit.completions.includes(today);
                              const available = habit.frequency !== "weekdays" || isWeekday(today);
                              const streak = habitStreak(habit, today);
                              return (
                                <tr key={habit.id} className="border-b border-white/[0.045] last:border-b-0">
                                  <td className="px-5 py-1.5"><button type="button" onClick={() => toggleHabit(habit)} disabled={!available} className="grid size-8 place-items-center rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:cursor-not-allowed disabled:opacity-25" aria-label={`${completed ? "Uncheck" : "Check"} habit ${index + 1} for today`} aria-pressed={completed}><CheckBox checked={completed} /></button></td>
                                  <td className="p-1.5"><label className="sr-only" htmlFor={`habit-${habit.id}`}>Habit {index + 1}</label><input data-tracker-entry={habit.id} id={`habit-${habit.id}`} value={habit.name} onChange={(event) => updateHabit(habit.id, { name: event.target.value })} onKeyDown={(event) => event.key === "Enter" && addHabit()} maxLength={200} placeholder="Habit name" className="schedule-table-input" /></td>
                                  <td className="p-1.5"><label className="sr-only" htmlFor={`habit-frequency-${habit.id}`}>Habit {index + 1} rhythm</label><select id={`habit-frequency-${habit.id}`} value={habit.frequency} onChange={(event) => updateHabit(habit.id, { frequency: event.target.value as HabitFrequency })} className="schedule-table-input cursor-pointer"><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option></select></td>
                                  <td className="px-3 py-1.5"><span className="font-mono text-[10px] text-stone-500">{streak} {habit.frequency === "weekly" ? "wk" : "day"}{streak === 1 ? "" : "s"}</span></td>
                                  <td className="p-1.5"><button type="button" onClick={() => setHabits((current) => current.filter((item) => item.id !== habit.id))} className="tracker-delete-button" aria-label={`Delete habit ${index + 1}`}><DeleteMark /></button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
