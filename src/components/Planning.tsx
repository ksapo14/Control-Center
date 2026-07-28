import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Check,
  FilePlus2,
  NotebookPen,
  PencilLine,
  Trash2,
  X,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TactileButton } from "./TactileButton";

type PlanDocument = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type EditorMode = "write" | "read";

const PLANS_STORAGE_KEY = "control-panel.plans";

/** Restores locally saved plans while rejecting malformed persisted values. */
function initialPlans(): PlanDocument[] {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(PLANS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(stored)) return [];
    return stored.filter((candidate): candidate is PlanDocument => {
      if (!candidate || typeof candidate !== "object") return false;
      const plan = candidate as Partial<PlanDocument>;
      return [plan.id, plan.title, plan.content, plan.createdAt, plan.updatedAt].every(
        (value) => typeof value === "string",
      );
    });
  } catch {
    return [];
  }
}

/** Creates a collision-resistant local identifier without requiring a backend. */
function localId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Formats a compact timestamp for the document list and editor status. */
function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently edited";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Restricts Markdown links to normal navigable protocols. */
function safeHref(value: string) {
  const href = value.trim();
  return /^(https?:|mailto:)/i.test(href) ? href : "#";
}

/** Renders the small inline subset used by common README files. */
function renderInline(value: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^\s)]+\))/g;
  const parts = value.split(pattern).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (
      (part.startsWith("**") && part.endsWith("**"))
      || (part.startsWith("__") && part.endsWith("__"))
    ) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (
      (part.startsWith("*") && part.endsWith("*"))
      || (part.startsWith("_") && part.endsWith("_"))
    ) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      return (
        <a
          key={index}
          href={href}
          target={href === "#" ? undefined : "_blank"}
          rel={href === "#" ? undefined : "noreferrer"}
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** Converts lightweight README-style Markdown into safe React elements. */
function MarkdownDocument({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const output: ReactNode[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      if (line.trimStart().startsWith("```")) {
        const language = line.trim().slice(3).trim();
        const code: string[] = [];
        index += 1;
        while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
          code.push(lines[index]);
          index += 1;
        }
        index += index < lines.length ? 1 : 0;
        output.push(
          <pre key={`code-${index}`} data-language={language || undefined}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const Heading = `h${level}` as keyof JSX.IntrinsicElements;
        output.push(<Heading key={`heading-${index}`}>{renderInline(heading[2])}</Heading>);
        index += 1;
        continue;
      }

      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        output.push(<hr key={`rule-${index}`} />);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote: string[] = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        output.push(<blockquote key={`quote-${index}`}>{renderInline(quote.join(" "))}</blockquote>);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items: Array<{ text: string; checked?: boolean }> = [];
        while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
          const item = lines[index].replace(/^\s*[-*+]\s+/, "");
          const task = item.match(/^\[([ xX])\]\s*(.*)$/);
          items.push(task
            ? { text: task[2], checked: task[1].toLowerCase() === "x" }
            : { text: item });
          index += 1;
        }
        output.push(
          <ul key={`list-${index}`}>
            {items.map((item, itemIndex) => (
              <li key={itemIndex} className={item.checked === undefined ? undefined : "plan-task"}>
                {item.checked === undefined ? null : (
                  <span className="plan-checkbox" aria-label={item.checked ? "Complete" : "Incomplete"}>
                    {item.checked ? <Check size={11} strokeWidth={2.4} /> : null}
                  </span>
                )}
                <span>{renderInline(item.text)}</span>
              </li>
            ))}
          </ul>,
        );
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
          index += 1;
        }
        output.push(
          <ol key={`ordered-${index}`}>
            {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
          </ol>,
        );
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (
        index < lines.length
        && lines[index].trim()
        && !/^(#{1,6})\s+|^\s*[-*+]\s+|^\s*\d+[.)]\s+|^>\s?|^```/.test(lines[index])
      ) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      output.push(<p key={`paragraph-${index}`}>{renderInline(paragraph.join(" "))}</p>);
    }

    return output;
  }, [content]);

  if (!content.trim()) {
    return (
      <div className="grid min-h-64 place-items-center text-center text-stone-600">
        <div>
          <BookOpen size={26} className="mx-auto text-stone-700" />
          <p className="mt-3 text-sm font-semibold text-stone-400">Nothing to read yet</p>
          <p className="mt-1 text-xs">Switch to Write and start with a heading.</p>
        </div>
      </div>
    );
  }

  return <article className="plan-markdown">{blocks}</article>;
}

/** Provides a local, minimalist Markdown notebook from the top toolbar. */
export function Planning() {
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanDocument[]>(initialPlans);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialPlans()[0]?.id ?? null);
  const [mode, setMode] = useState<EditorMode>("write");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const activePlan = plans.find((plan) => plan.id === selectedId) ?? null;
  const sortedPlans = useMemo(
    () => [...plans].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [plans],
  );

  useEffect(() => {
    if (plans.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!plans.some((plan) => plan.id === selectedId)) setSelectedId(plans[0].id);
  }, [plans, selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(plans));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [plans]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setDeleteArmed(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 80);

    const handleDialogKeys = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
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

    document.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleDialogKeys);
    };
  }, [closeDialog, open]);

  useEffect(() => {
    if (!deleteArmed) return;
    const timer = window.setTimeout(() => setDeleteArmed(false), 3500);
    return () => window.clearTimeout(timer);
  }, [deleteArmed]);

  const createPlan = useCallback((template?: { title: string; content: string }) => {
    const now = new Date().toISOString();
    const plan: PlanDocument = {
      id: localId(),
      title: template?.title ?? "Untitled plan",
      content: template?.content ?? "",
      createdAt: now,
      updatedAt: now,
    };
    setOpen(true);
    setPlans((current) => [plan, ...current]);
    setSelectedId(plan.id);
    setMode("write");
    setDeleteArmed(false);
    setSaveState("saving");
    window.setTimeout(() => titleRef.current?.select(), 0);
  }, []);

  useEffect(() => {
    const handlePlanningAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action !== "create-daily") return;
      const today = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
      const title = `Plan for ${today}`;
      const existing = plans.find((plan) => plan.title === title);
      if (existing) {
        setSelectedId(existing.id);
        setMode("write");
        setOpen(true);
        return;
      }
      createPlan({
        title,
        content: `# ${title}\n\n## Priorities\n\n- [ ] \n\n## Notes\n\n`,
      });
    };
    window.addEventListener("control-panel:planning-action", handlePlanningAction);
    return () => window.removeEventListener("control-panel:planning-action", handlePlanningAction);
  }, [createPlan, plans]);

  const updatePlan = (change: Pick<PlanDocument, "title"> | Pick<PlanDocument, "content">) => {
    if (!selectedId) return;
    const updatedAt = new Date().toISOString();
    setPlans((current) => current.map((plan) => (
      plan.id === selectedId ? { ...plan, ...change, updatedAt } : plan
    )));
    setSaveState("saving");
  };

  const deletePlan = () => {
    if (!activePlan) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const remaining = sortedPlans.filter((plan) => plan.id !== activePlan.id);
    setPlans(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setDeleteArmed(false);
    setSaveState("saving");
  };

  return (
    <>
      <TactileButton
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="h-9 px-2.5 sm:px-3"
        aria-haspopup="dialog"
        data-shortcut-combo="Control+Alt+KeyP"
        data-shortcut-id="control:planning"
        data-shortcut-label="Open Planning"
        data-shortcut-detail="Write local Markdown plans"
        data-shortcut-group="Control panel"
        data-shortcut-order="1"
        data-control-action="open-planning"
      >
        <span className="flex items-center gap-2">
          <NotebookPen size={15} strokeWidth={1.7} className="text-signal-300" />
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-300 xl:inline">
            Planning
          </span>
        </span>
      </TactileButton>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-2 backdrop-blur-md sm:p-5"
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
              aria-labelledby="planning-title"
              className="schedule-panel relative my-auto flex h-[calc(100dvh-16px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[18px] border border-black/80 border-t-white/10 shadow-panel sm:h-[min(860px,calc(100dvh-40px))]"
              initial={{ opacity: 0, y: 10, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 7, scale: 0.995 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-black/60 px-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-black/70 border-t-white/10 bg-gradient-to-br from-[#272a27] to-[#0d0f0e] text-signal-300 shadow-skeuo-raised">
                    <NotebookPen size={19} strokeWidth={1.55} />
                  </span>
                  <div className="min-w-0">
                    <h2 id="planning-title" className="truncate text-lg font-semibold tracking-[-0.02em] text-stone-100">
                      Planning
                    </h2>
                    <p className="mt-0.5 text-[10px] text-stone-600">Local Markdown documents</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <TactileButton onClick={() => createPlan()} className="h-10 px-3" aria-label="Create a new plan">
                    <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em]">
                      <FilePlus2 size={14} className="text-signal-300" />
                      <span className="hidden sm:inline">New plan</span>
                    </span>
                  </TactileButton>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={closeDialog}
                    className="grid size-10 place-items-center rounded-[10px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                    aria-label="Close planning"
                  >
                    <X size={19} />
                  </button>
                </div>
              </header>

              <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] md:grid-cols-[230px_1fr] md:grid-rows-1">
                <aside className="border-b border-black/60 bg-black/15 md:border-b-0 md:border-r">
                  <div className="flex max-h-36 gap-1.5 overflow-x-auto p-2 md:max-h-none md:flex-col md:overflow-y-auto md:p-3">
                    {sortedPlans.length === 0 ? (
                      <div className="hidden px-3 py-5 text-xs leading-relaxed text-stone-600 md:block">
                        Plans stay on this device. Create one to begin.
                      </div>
                    ) : sortedPlans.map((plan) => {
                      const selected = plan.id === selectedId;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(plan.id);
                            setDeleteArmed(false);
                          }}
                          className={`min-w-44 rounded-[10px] px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 md:min-w-0 ${selected ? "bg-white/[0.065] text-stone-100 shadow-well" : "text-stone-500 hover:bg-white/[0.025] hover:text-stone-300"}`}
                          aria-current={selected ? "page" : undefined}
                        >
                          <span className="block truncate text-xs font-semibold">{plan.title.trim() || "Untitled plan"}</span>
                          <span className="mt-1.5 block truncate font-mono text-[8px] uppercase tracking-[0.08em] text-stone-700">
                            {formatUpdatedAt(plan.updatedAt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <section className="min-h-0 overflow-hidden">
                  {activePlan ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="flex shrink-0 flex-col gap-3 border-b border-black/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                        <input
                          ref={titleRef}
                          value={activePlan.title}
                          onChange={(event) => updatePlan({ title: event.target.value })}
                          className="plan-title-input min-w-0 flex-1"
                          aria-label="Plan title"
                          maxLength={100}
                          spellCheck
                        />
                        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                          <span className={`text-[10px] ${saveState === "error" ? "text-red-400" : "text-stone-700"}`} aria-live="polite">
                            {saveState === "saving" ? "Saving locally..." : saveState === "error" ? "Could not save locally" : "Saved locally"}
                          </span>
                          <div className="flex rounded-[9px] border border-black/65 bg-black/20 p-1 shadow-well" aria-label="Editor mode">
                            <button
                              type="button"
                              onClick={() => setMode("write")}
                              className={`flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[10px] font-semibold transition ${mode === "write" ? "bg-white/[0.075] text-signal-300" : "text-stone-600 hover:text-stone-300"}`}
                              aria-pressed={mode === "write"}
                            >
                              <PencilLine size={13} /> Write
                            </button>
                            <button
                              type="button"
                              onClick={() => setMode("read")}
                              className={`flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[10px] font-semibold transition ${mode === "read" ? "bg-white/[0.075] text-signal-300" : "text-stone-600 hover:text-stone-300"}`}
                              aria-pressed={mode === "read"}
                            >
                              <BookOpen size={13} /> Read
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto">
                        {mode === "write" ? (
                          <textarea
                            value={activePlan.content}
                            onChange={(event) => updatePlan({ content: event.target.value })}
                            className="plan-editor"
                            placeholder={"# Plan title\n\nWrite with Markdown. Use - [ ] for tasks."}
                            aria-label="Plan content"
                            spellCheck
                          />
                        ) : (
                          <div className="mx-auto w-full max-w-[760px] px-5 py-8 sm:px-10 sm:py-10">
                            <MarkdownDocument content={activePlan.content} />
                          </div>
                        )}
                      </div>

                      <footer className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-black/60 px-4 sm:px-6">
                        <p className="truncate text-[10px] text-stone-700">
                          Edited {formatUpdatedAt(activePlan.updatedAt)}
                        </p>
                        <button
                          type="button"
                          onClick={deletePlan}
                          className={`flex min-h-9 shrink-0 items-center gap-2 rounded-[9px] px-3 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${deleteArmed ? "bg-red-950/45 text-red-300" : "text-stone-700 hover:bg-red-950/20 hover:text-red-400"}`}
                        >
                          <Trash2 size={13} />
                          {deleteArmed ? "Confirm delete" : "Delete"}
                        </button>
                      </footer>
                    </div>
                  ) : (
                    <div className="grid h-full min-h-64 place-items-center px-5 text-center">
                      <div>
                        <NotebookPen size={30} className="mx-auto text-stone-700" />
                        <h3 className="mt-4 text-base font-semibold text-stone-300">Make a simple plan</h3>
                        <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-stone-600">
                          Keep notes, checklists, and headings in a local Markdown document.
                        </p>
                        <TactileButton onClick={() => createPlan()} className="mt-5 h-11 px-4">
                          <span className="flex items-center gap-2 text-xs font-semibold">
                            <FilePlus2 size={15} className="text-signal-300" /> Create first plan
                          </span>
                        </TactileButton>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
