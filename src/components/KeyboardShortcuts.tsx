import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, Keyboard, ListChecks, Mic, Pencil, Power, RotateCcw, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSpeechCommandRegistry,
  collectRenderedSpeechCommands,
  speechCommandReference,
  type SpeechCommandReference,
} from "../lib/speechCommands";
import { useControlCenter } from "./ControlCenter";
import { TactileButton } from "./TactileButton";

type ShortcutEntry = {
  id: string;
  combo: string;
  defaultCombo: string;
  label: string;
  detail: string;
  group: string;
  order: number;
};

type ShortcutOverrides = Record<string, string>;

const SHORTCUT_OVERRIDES_STORAGE_KEY = "control-panel.shortcut-overrides";

/**
 * Restores user shortcut mappings while rejecting malformed persisted data.
 * @returns Stable action identifiers mapped to code-based key combinations.
 */
function initialShortcutOverrides(): ShortcutOverrides {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY) ?? "{}",
    );
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Converts a keyboard event into the stable code-based format stored on action buttons.
 * @param event - Global key event raised while shortcut mode is enabled.
 * @returns A modifier-and-code string such as `Control+Alt+KeyP`.
 */
function eventCombo(event: globalThis.KeyboardEvent) {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(event.code);
  return parts.join("+");
}

/**
 * Detects text-entry controls where application shortcuts should never intercept typing.
 * @param target - Event target from the global key listener.
 * @returns Whether the target accepts editable text or selections.
 */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Produces concise key-cap labels from a stored shortcut combination.
 * @param combo - Code-based shortcut combination.
 * @returns Human-readable key names in press order.
 */
function shortcutKeys(combo: string) {
  return combo.split("+").map((part) => {
    if (part === "Control") return "Ctrl";
    if (part.startsWith("Key")) return part.slice(3);
    if (part.startsWith("Digit")) return part.slice(5);
    return part;
  });
}

/**
 * Reads the currently rendered shortcut actions so custom quick links appear automatically.
 * @returns Deduplicated shortcut metadata ordered by group and explicit action order.
 */
function collectShortcutEntries(overrides: ShortcutOverrides): ShortcutEntry[] {
  const entries = Array.from(document.querySelectorAll<HTMLElement>("[data-shortcut-combo]"))
    .flatMap((element) => {
      const defaultCombo = element.dataset.shortcutCombo;
      const label = element.dataset.shortcutLabel;
      if (!defaultCombo || !label) return [];
      const id = element.dataset.shortcutId ?? `${element.dataset.shortcutGroup ?? "General"}:${label}`;
      return [{
        id,
        combo: overrides[id] ?? defaultCombo,
        defaultCombo,
        label,
        detail: element.dataset.shortcutDetail ?? "",
        group: element.dataset.shortcutGroup ?? "General",
        order: Number(element.dataset.shortcutOrder ?? 0),
      }];
    });

  const unique = new Map(entries.map((entry) => [entry.id, entry]));
  return Array.from(unique.values()).sort((left, right) =>
    left.group.localeCompare(right.group) || left.order - right.order || left.label.localeCompare(right.label),
  );
}

/**
 * Provides the master shortcut-mode switch and a modal documenting every active mapping.
 * @returns Title-bar controls plus the animated shortcut reference dialog.
 * @remarks Side effects: installs a global key listener while enabled and programmatically activates mapped buttons.
 */
export function KeyboardShortcutControls() {
  const { appGroups, automationRules } = useControlCenter();
  // --- Mode and Dialog State ---
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutEntry[]>([]);
  const [voiceShortcuts, setVoiceShortcuts] = useState<SpeechCommandReference[]>([]);
  const [overrides, setOverrides] = useState<ShortcutOverrides>(initialShortcutOverrides);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captureMessage, setCaptureMessage] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * Opens the reference modal using the current rendered action set.
   * @returns Nothing.
   * @remarks Side effects: scans shortcut metadata and updates modal state.
   */
  const showDialog = () => {
    setShortcuts(collectShortcutEntries(overrides));
    setVoiceShortcuts(speechCommandReference(
      buildSpeechCommandRegistry(collectRenderedSpeechCommands(), automationRules, appGroups),
    ));
    setOpen(true);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(SHORTCUT_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // Remapping remains active until the current webview closes.
    }
  }, [overrides]);

  /**
   * Closes the reference modal and restores focus to its title-bar trigger.
   * @returns Nothing.
   * @remarks Side effects: updates modal state and schedules a focus change.
   */
  const closeDialog = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return;

      // Avoid stacking application dialogs or firing commands behind the reference modal.
      if (open || document.querySelector("[role='dialog']")) return;
      const combo = eventCombo(event);
      const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-shortcut-combo]"));
      const action = candidates.find((button) => {
        const id = button.dataset.shortcutId;
        const resolvedCombo = id ? overrides[id] ?? button.dataset.shortcutCombo : button.dataset.shortcutCombo;
        return resolvedCombo === combo && !button.disabled;
      });
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();
      action.click();
    };

    document.addEventListener("keydown", handleShortcut, true);
    return () => document.removeEventListener("keydown", handleShortcut, true);
  }, [enabled, open, overrides]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 80);

    const handleDialogKeys = (event: globalThis.KeyboardEvent) => {
      if (editingId) {
        if (event.key === "Escape") {
          event.preventDefault();
          setEditingId(null);
          setCaptureMessage("");
          return;
        }
        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.ctrlKey && !event.altKey) {
          setCaptureMessage("Include Ctrl or Alt so normal typing stays unaffected.");
          return;
        }
        const combo = eventCombo(event);
        const conflict = collectShortcutEntries(overrides).find(
          (shortcut) => shortcut.id !== editingId && shortcut.combo === combo,
        );
        if (conflict) {
          setCaptureMessage(`Already mapped to ${conflict.label}.`);
          return;
        }
        const nextOverrides = { ...overrides, [editingId]: combo };
        setOverrides(nextOverrides);
        setShortcuts(collectShortcutEntries(nextOverrides));
        setEditingId(null);
        setCaptureMessage("Shortcut updated.");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex='-1'])"),
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
  }, [closeDialog, editingId, open, overrides]);

  /** Restores one action to its built-in mapping. */
  const resetShortcut = (shortcut: ShortcutEntry) => {
    const nextOverrides = { ...overrides };
    delete nextOverrides[shortcut.id];
    setOverrides(nextOverrides);
    setShortcuts(collectShortcutEntries(nextOverrides));
    setCaptureMessage(`${shortcut.label} restored to its default.`);
  };

  /** Restores every shortcut without changing the master enabled state. */
  const resetAllShortcuts = () => {
    setOverrides({});
    setShortcuts(collectShortcutEntries({}));
    setEditingId(null);
    setCaptureMessage("All shortcuts restored to their defaults.");
  };

  const groupedShortcuts = useMemo(() => {
    const groups = new Map<string, ShortcutEntry[]>();
    for (const shortcut of shortcuts) {
      const group = groups.get(shortcut.group) ?? [];
      group.push(shortcut);
      groups.set(shortcut.group, group);
    }
    return Array.from(groups.entries());
  }, [shortcuts]);

  // --- Title-Bar Controls and Reference Modal ---
  return (
    <>
      <TactileButton
        onClick={() => setEnabled((current) => !current)}
        selected={enabled}
        className="grid size-11 place-items-center p-0"
        aria-pressed={enabled}
        aria-label={enabled ? "Disable shortcut mode" : "Enable shortcut mode"}
        title={enabled ? "Shortcut mode enabled" : "Shortcut mode disabled"}
      >
        <span>
          <Keyboard size={17} className={enabled ? "text-signal-300" : "text-stone-500"} />
          <span className={`absolute bottom-2 right-2 size-1.5 rounded-full ${enabled ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" : "bg-stone-700"}`} />
        </span>
      </TactileButton>

      <TactileButton
        ref={triggerRef}
        onClick={showDialog}
        className="grid size-11 place-items-center p-0"
        aria-haspopup="dialog"
        aria-label="View keyboard and voice shortcuts"
        data-speech-id="control:keyboard-shortcuts"
        data-speech-label="Open keyboard shortcuts"
        data-speech-phrase="keyboard shortcuts"
        title="Keyboard and voice shortcuts"
      >
        <ListChecks size={17} className="text-signal-300" />
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
              aria-labelledby="keyboard-shortcuts-title"
              className="schedule-panel relative my-auto flex max-h-[calc(100dvh-32px)] w-full max-w-[900px] flex-col overflow-hidden rounded-[20px] border border-black/80 border-t-white/10 shadow-panel"
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/60 px-5 py-4 sm:px-6 sm:py-5">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-black/70 border-t-white/10 bg-gradient-to-br from-[#272a27] to-[#0d0f0e] text-signal-300 shadow-skeuo-raised">
                    <Keyboard size={21} strokeWidth={1.55} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-400">Command reference</p>
                    <h2 id="keyboard-shortcuts-title" className="mt-1 truncate text-xl font-semibold tracking-[-0.025em] text-stone-100">
                      Keyboard and voice shortcuts
                    </h2>
                  </div>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={closeDialog}
                  className="grid size-11 shrink-0 place-items-center rounded-[11px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                  aria-label="Close keyboard shortcuts"
                >
                  <X size={20} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                <section className={`flex flex-col gap-4 rounded-[14px] border p-4 sm:flex-row sm:items-center sm:justify-between ${enabled ? "border-emerald-900/50 bg-emerald-950/15" : "border-black/70 bg-black/20"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] ${enabled ? "bg-emerald-950/60 text-emerald-300" : "bg-black/25 text-stone-600"}`}>
                      {enabled ? <Zap size={17} /> : <Power size={17} />}
                    </span>
                    <div>
                      <p className={`text-sm font-semibold ${enabled ? "text-emerald-200" : "text-stone-300"}`}>Shortcut mode is {enabled ? "enabled" : "disabled"}</p>
                      <p className="mt-1 text-xs leading-relaxed text-stone-600">Shortcuts never run while typing in a field or while another modal is open.</p>
                    </div>
                  </div>
                  <TactileButton
                    onClick={() => setEnabled((current) => !current)}
                    selected={enabled}
                    className="h-11 shrink-0 px-4 text-[11px] font-semibold uppercase tracking-[0.08em]"
                  >
                    {enabled ? "Disable shortcut mode" : "Enable shortcut mode"}
                  </TactileButton>
                </section>

                <div className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-[11px] border border-white/[0.05] bg-black/15 px-3">
                  <p className="text-[11px] text-stone-500" aria-live="polite">
                    {editingId ? "Press the new shortcut now, or Escape to cancel." : captureMessage || "Choose Change beside any mapping to customize it."}
                  </p>
                  <button type="button" onClick={resetAllShortcuts} disabled={Object.keys(overrides).length === 0} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-600 hover:text-stone-300 disabled:opacity-30">
                    <RotateCcw size={13} /> Reset all
                  </button>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {groupedShortcuts.map(([group, entries]) => (
                    <section key={group} className="overflow-hidden rounded-[14px] border border-black/70 border-t-white/[0.06] bg-black/20 shadow-well">
                      <h3 className="border-b border-white/[0.04] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-signal-500">{group}</h3>
                      <ul className="divide-y divide-white/[0.035]">
                        {entries.map((shortcut) => (
                          <li key={shortcut.id} className={`flex min-h-[72px] items-center justify-between gap-3 px-4 py-2.5 ${editingId === shortcut.id ? "bg-signal-950/25" : ""}`}>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-stone-300">{shortcut.label}</p>
                              {shortcut.detail ? <p className="mt-1 truncate text-[10px] text-stone-700">{shortcut.detail}</p> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <div className="flex items-center gap-1" aria-label={shortcutKeys(shortcut.combo).join(" plus ")}>
                                {shortcutKeys(shortcut.combo).map((key) => (
                                  <kbd key={key} className="grid min-w-7 place-items-center rounded-[6px] border border-black/80 border-t-white/10 bg-gradient-to-b from-[#242724] to-[#111311] px-1.5 py-1.5 font-mono text-[9px] font-semibold text-stone-400 shadow-skeuo-raised">
                                    {key}
                                  </kbd>
                                ))}
                              </div>
                              <button type="button" onClick={() => { setEditingId(shortcut.id); setCaptureMessage(""); }} className="grid size-9 place-items-center rounded-lg text-stone-700 hover:bg-white/[0.04] hover:text-signal-300" aria-label={`Change ${shortcut.label} shortcut`} title="Change shortcut"><Pencil size={13} /></button>
                              {shortcut.combo !== shortcut.defaultCombo ? <button type="button" onClick={() => resetShortcut(shortcut)} className="grid size-9 place-items-center rounded-lg text-stone-700 hover:bg-white/[0.04] hover:text-stone-300" aria-label={`Reset ${shortcut.label} shortcut`} title="Reset shortcut"><RotateCcw size={13} /></button> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>

                <section className="mt-7" aria-labelledby="voice-shortcuts-title">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 place-items-center rounded-[9px] border border-emerald-900/40 bg-emerald-950/20 text-emerald-300">
                        <Mic size={15} />
                      </span>
                      <div>
                        <h3 id="voice-shortcuts-title" className="text-sm font-semibold text-stone-200">Voice shortcuts</h3>
                        <p className="mt-0.5 text-[10px] text-stone-600">Enable Speech Mode, then say any phrase shown below.</p>
                      </div>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone-700">{voiceShortcuts.length} actions</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {voiceShortcuts.map((shortcut) => (
                      <article key={shortcut.id} className="rounded-[12px] border border-black/70 border-t-white/[0.06] bg-black/20 px-4 py-3.5 shadow-well">
                        <p className="text-xs font-semibold text-stone-300">{shortcut.label}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {shortcut.phrases.map((phrase) => (
                            <span key={phrase} className="rounded-full border border-emerald-900/35 bg-emerald-950/20 px-2 py-1 font-mono text-[9px] text-emerald-200/80">
                              Say “{phrase}”
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <div className="mt-5 flex items-start gap-2.5 rounded-[12px] border border-signal-950 bg-signal-950/15 px-3.5 py-3 text-xs leading-relaxed text-stone-500">
                  <CircleAlert size={15} className="mt-0.5 shrink-0 text-signal-500" />
                  <p>Quick-link mappings follow their visible order. Newly added links receive the next available mapping automatically.</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
