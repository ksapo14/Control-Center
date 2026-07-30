import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  Check,
  CircleDollarSign,
  Plus,
  Search,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TactileButton } from "./TactileButton";

const FINANCE_STORAGE_KEY = "control-panel.finances";

const categories = [
  "Subscription",
  "Food",
  "Productivity",
  "Leisure",
  "Transport",
  "Health",
  "Home",
  "Other",
] as const;

type FinanceCategory = (typeof categories)[number];
type ChartMode = "week" | "month";
type RangeFilter = "30d" | "90d" | "year" | "all";

type FinanceEntry = {
  id: string;
  date: string;
  description: string;
  location: string;
  amount: number;
  category: FinanceCategory;
  tags: string;
};

type DraftEntry = Omit<FinanceEntry, "amount"> & { amount: string };

type FinanceStore = {
  version: 1;
  entries: FinanceEntry[];
};

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function createDraft(date = localDateValue()): DraftEntry {
  return {
    id: globalThis.crypto.randomUUID(),
    date,
    description: "",
    location: "",
    amount: "",
    category: "Food",
    tags: "",
  };
}

function isCategory(value: unknown): value is FinanceCategory {
  return categories.includes(value as FinanceCategory);
}

function restoreEntries(): FinanceEntry[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(FINANCE_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return [];
    const entries = (stored as Partial<FinanceStore>).entries;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((item: Partial<FinanceEntry>) => {
      if (
        typeof item.id !== "string" ||
        typeof item.date !== "string" ||
        Number.isNaN(parseLocalDate(item.date).getTime()) ||
        typeof item.description !== "string" ||
        typeof item.location !== "string" ||
        typeof item.amount !== "number" ||
        !Number.isFinite(item.amount) ||
        item.amount < 0 ||
        !isCategory(item.category) ||
        typeof item.tags !== "string"
      ) return [];
      return [{
        id: item.id,
        date: item.date,
        description: item.description,
        location: item.location,
        amount: item.amount,
        category: item.category,
        tags: item.tags,
      }];
    });
  } catch {
    return [];
  }
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - ((day + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
}

function rangeStart(range: RangeFilter) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === "all") return null;
  if (range === "year") return new Date(today.getFullYear(), 0, 1);
  const result = new Date(today);
  result.setDate(result.getDate() - (range === "30d" ? 29 : 89));
  return result;
}

function averageSpanDays(range: RangeFilter, entries: FinanceEntry[]) {
  if (range === "30d") return 30;
  if (range === "90d") return 90;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === "year") {
    return Math.max(1, Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1);
  }
  if (entries.length === 0) return 1;
  const oldest = entries.reduce((minimum, entry) => {
    const value = parseLocalDate(entry.date).getTime();
    return Math.min(minimum, value);
  }, today.getTime());
  return Math.max(1, Math.floor((today.getTime() - oldest) / 86_400_000) + 1);
}

function periodBuckets(entries: FinanceEntry[], mode: ChartMode) {
  const count = mode === "week" ? 8 : 6;
  const now = new Date();
  const currentStart = mode === "week"
    ? startOfWeek(now)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  return Array.from({ length: count }, (_, index) => {
    const offset = count - index - 1;
    const start = new Date(currentStart);
    if (mode === "week") start.setDate(start.getDate() - offset * 7);
    else start.setMonth(start.getMonth() - offset);
    const end = new Date(start);
    if (mode === "week") end.setDate(end.getDate() + 7);
    else end.setMonth(end.getMonth() + 1);
    const total = entries.reduce((sum, entry) => {
      const value = parseLocalDate(entry.date);
      return value >= start && value < end ? sum + entry.amount : sum;
    }, 0);
    const label = mode === "week"
      ? start.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : start.toLocaleDateString(undefined, { month: "short" });
    return { key: start.toISOString(), label, total };
  });
}

/** Tracks local expenses with a dense ledger and period analytics. */
export function FinancialTracker() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<FinanceEntry[]>(restoreEntries);
  const [drafts, setDrafts] = useState<DraftEntry[]>(() => [createDraft()]);
  const [chartMode, setChartMode] = useState<ChartMode>("week");
  const [range, setRange] = useState<RangeFilter>("30d");
  const [categoryFilter, setCategoryFilter] = useState<FinanceCategory | "All">("All");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstDescriptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          FINANCE_STORAGE_KEY,
          JSON.stringify({ version: 1, entries } satisfies FinanceStore),
        );
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [entries]);

  const closeDialog = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => firstDescriptionRef.current?.focus(), 90);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
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

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const filteredEntries = useMemo(() => {
    const start = rangeStart(range);
    const query = search.trim().toLocaleLowerCase();
    return entries
      .filter((entry) => !start || parseLocalDate(entry.date) >= start)
      .filter((entry) => categoryFilter === "All" || entry.category === categoryFilter)
      .filter((entry) => {
        if (!query) return true;
        return [entry.description, entry.location, entry.category, entry.tags]
          .some((value) => value.toLocaleLowerCase().includes(query));
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [categoryFilter, entries, range, search]);

  const total = filteredEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const spanDays = averageSpanDays(range, filteredEntries);
  const weeklyAverage = total / Math.max(1, spanDays / 7);
  const monthlyAverage = total / Math.max(1, spanDays / 30.4375);
  const buckets = useMemo(() => periodBuckets(filteredEntries, chartMode), [chartMode, filteredEntries]);
  const bucketAverage = buckets.reduce((sum, bucket) => sum + bucket.total, 0) / buckets.length;
  const chartMaximum = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const categoryTotals = useMemo(() => categories
    .map((category) => ({
      category,
      total: filteredEntries
        .filter((entry) => entry.category === category)
        .reduce((sum, entry) => sum + entry.amount, 0),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total), [filteredEntries]);

  const updateDraft = (id: string, update: Partial<DraftEntry>) => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...update, id } : draft));
  };

  const addDraft = () => {
    setDrafts((current) => [...current, createDraft(current[current.length - 1]?.date)]);
  };

  const removeDraft = (id: string) => {
    setDrafts((current) => {
      const next = current.filter((draft) => draft.id !== id);
      return next.length > 0 ? next : [createDraft()];
    });
  };

  const addEntries = (event: FormEvent) => {
    event.preventDefault();
    const nextEntries: FinanceEntry[] = [];
    for (const [index, draft] of drafts.entries()) {
      const amount = Number.parseFloat(draft.amount);
      if (!draft.description.trim()) {
        setNotice(`Row ${index + 1} needs a description.`);
        return;
      }
      if (!draft.date || Number.isNaN(parseLocalDate(draft.date).getTime())) {
        setNotice(`Row ${index + 1} needs a valid date.`);
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setNotice(`Row ${index + 1} needs a cost greater than zero.`);
        return;
      }
      nextEntries.push({
        ...draft,
        description: draft.description.trim(),
        location: draft.location.trim(),
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean).join(", "),
        amount: Math.round(amount * 100) / 100,
      });
    }
    setEntries((current) => [...nextEntries, ...current]);
    setDrafts([createDraft(drafts[drafts.length - 1]?.date)]);
    setNotice(`Added ${nextEntries.length} expense${nextEntries.length === 1 ? "" : "s"}.`);
  };

  const updateEntry = (id: string, update: Partial<FinanceEntry>) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...update, id } : entry));
  };

  const removeEntry = (id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setNotice("Expense removed.");
  };

  return (
    <>
      <TactileButton
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="grid size-11 place-items-center p-0"
        aria-haspopup="dialog"
        aria-label="Open financial tracker"
        title="Financial tracker"
        data-shortcut-combo="Control+Alt+KeyF"
        data-shortcut-id="control:financial-tracker"
        data-shortcut-label="Open Financial Tracker"
        data-shortcut-detail="Log expenses and review spending"
        data-shortcut-group="Control panel"
        data-shortcut-order="1"
      >
        <WalletCards size={15} strokeWidth={1.7} className="text-signal-300" />
      </TactileButton>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-2 backdrop-blur-md sm:p-5"
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
              aria-labelledby="financial-tracker-title"
              className="finance-panel relative my-auto w-full max-w-[1180px] overflow-hidden rounded-[18px] border border-black/80 border-t-white/10 shadow-panel"
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <header className="flex items-start justify-between border-b border-black/60 px-4 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-black/70 border-t-white/10 bg-gradient-to-br from-[#272a27] to-[#0d0f0e] text-signal-300 shadow-skeuo-raised">
                    <CircleDollarSign size={20} strokeWidth={1.55} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-400">Private local ledger</p>
                    <h2 id="financial-tracker-title" className="mt-1 text-xl font-semibold tracking-[-0.025em] text-stone-100">Financial tracker</h2>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] sm:flex ${saveState === "error" ? "text-red-300" : "text-stone-600"}`} aria-live="polite">
                    {saveState === "saved" && <Check size={11} className="text-signal-300" />}
                    {saveState === "saving" ? "Saving" : saveState === "error" ? "Not saved" : "Saved locally"}
                  </span>
                  <button type="button" onClick={closeDialog} className="grid size-9 shrink-0 place-items-center rounded-[9px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400" aria-label="Close financial tracker">
                    <X size={18} />
                  </button>
                </div>
              </header>

              <div className="max-h-[calc(100dvh-96px)] overflow-y-auto p-3 sm:p-5">
                <form onSubmit={addEntries}>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-stone-200">Add expenses</h3>
                      <p className="mt-1 text-[10px] leading-relaxed text-stone-600">Enter one or more purchases, then add them to the ledger.</p>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone-600">{drafts.length} row{drafts.length === 1 ? "" : "s"}</span>
                  </div>

                  <div className="overflow-x-auto rounded-[10px] border border-white/[0.06] bg-black/10">
                    <table className="w-full min-w-[980px] table-fixed border-collapse" aria-label="New expense entries">
                      <colgroup>
                        <col className="w-[130px]" />
                        <col />
                        <col className="w-[150px]" />
                        <col className="w-[105px]" />
                        <col className="w-[135px]" />
                        <col className="w-[170px]" />
                        <col className="w-[42px]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-white/[0.06] bg-white/[0.018]">
                          {['Date', 'Description', 'Location', 'Cost', 'Category', 'Tags'].map((heading) => (
                            <th key={heading} scope="col" className="tracker-heading">{heading}</th>
                          ))}
                          <th scope="col"><span className="sr-only">Remove</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {drafts.map((draft, index) => (
                          <tr key={draft.id} className="border-b border-white/[0.045] last:border-b-0">
                            <td className="p-1.5"><label className="sr-only" htmlFor={`finance-date-${draft.id}`}>Expense {index + 1} date</label><input id={`finance-date-${draft.id}`} className="schedule-table-input" type="date" value={draft.date} onChange={(event) => updateDraft(draft.id, { date: event.target.value })} required /></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`finance-description-${draft.id}`}>Expense {index + 1} description</label><input ref={index === 0 ? firstDescriptionRef : undefined} id={`finance-description-${draft.id}`} className="schedule-table-input" value={draft.description} onChange={(event) => updateDraft(draft.id, { description: event.target.value })} placeholder="Coffee, Netflix, notebook" autoComplete="off" maxLength={100} required /></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`finance-location-${draft.id}`}>Expense {index + 1} location</label><input id={`finance-location-${draft.id}`} className="schedule-table-input" value={draft.location} onChange={(event) => updateDraft(draft.id, { location: event.target.value })} placeholder="Store or city" autoComplete="off" maxLength={80} /></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`finance-cost-${draft.id}`}>Expense {index + 1} cost</label><div className="finance-money-input"><span>$</span><input id={`finance-cost-${draft.id}`} className="schedule-table-input" type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.amount} onChange={(event) => updateDraft(draft.id, { amount: event.target.value })} placeholder="0.00" required /></div></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`finance-category-${draft.id}`}>Expense {index + 1} category</label><select id={`finance-category-${draft.id}`} className="schedule-table-input cursor-pointer" value={draft.category} onChange={(event) => updateDraft(draft.id, { category: event.target.value as FinanceCategory })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`finance-tags-${draft.id}`}>Expense {index + 1} tags</label><input id={`finance-tags-${draft.id}`} className="schedule-table-input" value={draft.tags} onChange={(event) => updateDraft(draft.id, { tags: event.target.value })} placeholder="work, recurring" autoComplete="off" maxLength={120} /></td>
                            <td className="p-1.5"><button type="button" onClick={() => removeDraft(draft.id)} className="tracker-delete-button" aria-label={`Remove expense row ${index + 1}`}><Trash2 size={13} strokeWidth={1.8} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" onClick={addDraft} className="flex h-9 items-center gap-2 self-start rounded-[7px] border border-white/[0.07] px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-500 transition hover:border-white/[0.12] hover:bg-white/[0.025] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400">
                      <Plus size={13} className="text-signal-300" /> Add row
                    </button>
                    <div className="flex items-center justify-end gap-3">
                      <p className={`text-[10px] ${notice.includes("needs") ? "text-red-300" : "text-stone-600"}`} aria-live="polite">{notice || "Amounts are stored in USD on this device."}</p>
                      <TactileButton type="submit" className="h-9 min-w-[128px] px-3">
                        <span className="flex items-center justify-center gap-2 text-[11px] font-semibold text-stone-100"><Plus size={14} className="text-signal-300" /> Add {drafts.length}</span>
                      </TactileButton>
                    </div>
                  </div>
                </form>

                <section className="mt-5 border-t border-white/[0.055] pt-5" aria-labelledby="finance-overview-title">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h3 id="finance-overview-title" className="text-sm font-semibold text-stone-200">Spending overview</h3>
                      <p className="mt-1 text-[10px] text-stone-600">Totals update with the ledger filters.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                      <label className="finance-search-field col-span-2 sm:col-auto">
                        <Search size={13} aria-hidden="true" />
                        <span className="sr-only">Search ledger</span>
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search expenses" />
                      </label>
                      <label><span className="sr-only">Filter by category</span><select className="finance-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as FinanceCategory | "All")}><option>All</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                      <label><span className="sr-only">Filter by date range</span><select className="finance-filter" value={range} onChange={(event) => setRange(event.target.value as RangeFilter)}><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="year">This year</option><option value="all">All time</option></select></label>
                    </div>
                  </div>

                  <div className="finance-summary mt-3" aria-label="Expense totals">
                    <div><span>Selected total</span><strong>{currency.format(total)}</strong></div>
                    <div><span>Weekly average</span><strong>{currency.format(weeklyAverage)}</strong></div>
                    <div><span>Monthly average</span><strong>{currency.format(monthlyAverage)}</strong></div>
                    <div><span>Transactions</span><strong>{filteredEntries.length}</strong></div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(250px,0.75fr)]">
                    <article className="finance-analytics-panel min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-stone-300"><BarChart3 size={14} className="text-signal-300" /><h4 className="text-[11px] font-semibold">Spend history</h4></div>
                          <p className="mt-1 font-mono text-[9px] text-stone-600">Average {currency.format(bucketAverage)} per {chartMode}</p>
                        </div>
                        <div className="finance-segmented" aria-label="Chart period">
                          <button type="button" className={chartMode === "week" ? "active" : ""} onClick={() => setChartMode("week")}>Weekly</button>
                          <button type="button" className={chartMode === "month" ? "active" : ""} onClick={() => setChartMode("month")}>Monthly</button>
                        </div>
                      </div>
                      <div className={`finance-chart ${chartMode === "month" ? "finance-chart-month" : ""}`} aria-label={`${chartMode === "week" ? "Weekly" : "Monthly"} spending totals`}>
                        {total > 0 && <span className="finance-average-line" style={{ bottom: `${Math.min(96, (bucketAverage / chartMaximum) * 100)}%` }}><em>avg</em></span>}
                        {buckets.map((bucket) => (
                          <div key={bucket.key} className="finance-chart-column">
                            <div className="finance-chart-value">{bucket.total > 0 ? compactCurrency.format(bucket.total) : ""}</div>
                            <div className="finance-chart-track"><span style={{ height: bucket.total > 0 ? `${Math.max(5, (bucket.total / chartMaximum) * 100)}%` : "2px" }} /></div>
                            <span className="finance-chart-label">{bucket.label}</span>
                          </div>
                        ))}
                      </div>
                    </article>

                    <article className="finance-analytics-panel">
                      <div className="flex items-center gap-2 text-stone-300"><CalendarDays size={14} className="text-signal-300" /><h4 className="text-[11px] font-semibold">Category mix</h4></div>
                      {categoryTotals.length > 0 ? (
                        <div className="finance-category-list">
                          {categoryTotals.slice(0, 5).map((item) => (
                            <div key={item.category}>
                              <div><span>{item.category}</span><strong>{currency.format(item.total)}</strong></div>
                              <i><span style={{ width: `${(item.total / total) * 100}%` }} /></i>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="finance-empty-small">Categories appear after you add an expense.</div>
                      )}
                    </article>
                  </div>
                </section>

                <section className="mt-5" aria-labelledby="finance-ledger-title">
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h3 id="finance-ledger-title" className="text-sm font-semibold text-stone-200">Ledger</h3>
                      <p className="mt-1 text-[10px] text-stone-600">Edit any cell. Changes save automatically.</p>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone-600">{filteredEntries.length} of {entries.length}</span>
                  </div>
                  <div className="max-h-[260px] overflow-auto rounded-[10px] border border-white/[0.06] bg-black/10">
                    <table className="w-full min-w-[950px] table-fixed border-collapse" aria-label="Expense ledger">
                      <colgroup><col className="w-[125px]" /><col /><col className="w-[145px]" /><col className="w-[130px]" /><col className="w-[165px]" /><col className="w-[105px]" /><col className="w-[42px]" /></colgroup>
                      <thead className="sticky top-0 bg-[#101210]">
                        <tr className="border-b border-white/[0.06]">{['Date', 'Description', 'Location', 'Category', 'Tags', 'Cost'].map((heading) => <th key={heading} scope="col" className={`tracker-heading ${heading === "Cost" ? "text-right" : ""}`}>{heading}</th>)}<th scope="col"><span className="sr-only">Remove</span></th></tr>
                      </thead>
                      <tbody>
                        {filteredEntries.length > 0 ? filteredEntries.map((entry, index) => (
                          <tr key={entry.id} className="border-b border-white/[0.045] last:border-b-0">
                            <td className="p-1.5"><label className="sr-only" htmlFor={`ledger-date-${entry.id}`}>Ledger row {index + 1} date</label><input id={`ledger-date-${entry.id}`} className="schedule-table-input" type="date" value={entry.date} onChange={(event) => updateEntry(entry.id, { date: event.target.value })} /></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`ledger-description-${entry.id}`}>Ledger row {index + 1} description</label><input id={`ledger-description-${entry.id}`} className="schedule-table-input" value={entry.description} onChange={(event) => updateEntry(entry.id, { description: event.target.value })} /></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`ledger-location-${entry.id}`}>Ledger row {index + 1} location</label><input id={`ledger-location-${entry.id}`} className="schedule-table-input" value={entry.location} onChange={(event) => updateEntry(entry.id, { location: event.target.value })} /></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`ledger-category-${entry.id}`}>Ledger row {index + 1} category</label><select id={`ledger-category-${entry.id}`} className="schedule-table-input cursor-pointer" value={entry.category} onChange={(event) => updateEntry(entry.id, { category: event.target.value as FinanceCategory })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`ledger-tags-${entry.id}`}>Ledger row {index + 1} tags</label><input id={`ledger-tags-${entry.id}`} className="schedule-table-input" value={entry.tags} onChange={(event) => updateEntry(entry.id, { tags: event.target.value })} placeholder="Add tags" /></td>
                            <td className="p-1.5"><label className="sr-only" htmlFor={`ledger-cost-${entry.id}`}>Ledger row {index + 1} cost</label><input id={`ledger-cost-${entry.id}`} className="schedule-table-input text-right font-mono tabular-nums" type="number" min="0.01" step="0.01" value={entry.amount} onChange={(event) => { const amount = Number.parseFloat(event.target.value); if (Number.isFinite(amount) && amount >= 0) updateEntry(entry.id, { amount }); }} /></td>
                            <td className="p-1.5"><button type="button" onClick={() => removeEntry(entry.id)} className="tracker-delete-button" aria-label={`Remove ${entry.description}`}><Trash2 size={13} strokeWidth={1.8} /></button></td>
                          </tr>
                        )) : (
                          <tr><td colSpan={7}><div className="finance-empty-ledger"><WalletCards size={20} strokeWidth={1.5} /><strong>{entries.length === 0 ? "No expenses yet" : "No matching expenses"}</strong><span>{entries.length === 0 ? "Use the table above to add your first purchase." : "Try a different search, category, or date range."}</span></div></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
