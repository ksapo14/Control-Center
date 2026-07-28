import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Bot,
  Check,
  Download,
  Focus,
  Layers3,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { useDashboardCustomization, type DashboardTheme, type WidgetId } from "./DashboardCustomization";

type ControlNotification = {
  id: string;
  title: string;
  message: string;
  kind: "info" | "success" | "warning" | "error";
  createdAt: string;
  read: boolean;
};

export type AppGroup = {
  id: string;
  name: string;
  launcherIds: string[];
  layoutProfileId?: string | null;
};

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "startup" | "time" | "pomodoro" | "bluetooth" | "monitor";
  time: string;
  action: "focus" | "group" | "open-apps";
  groupId: string | null;
};

type FocusPreferences = {
  theme: DashboardTheme;
  startSpotify: boolean;
  hideDistractions: boolean;
};

type ControlCenterValue = {
  appGroups: AppGroup[];
  automationRules: AutomationRule[];
  focusEnabled: boolean;
  focusPreferences: FocusPreferences;
  notifications: ControlNotification[];
  addNotification: (title: string, message: string, kind?: ControlNotification["kind"]) => void;
  setAppGroups: (groups: AppGroup[]) => void;
  setAutomationRules: (rules: AutomationRule[]) => void;
  setFocusPreferences: (preferences: FocusPreferences) => void;
  toggleFocusMode: (force?: boolean) => void;
  launchAppGroup: (group: AppGroup) => void;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
};

type LauncherOption = { id: string; label: string };
type LayoutProfileOption = { id: string; name: string };
type HubSection = "groups" | "automations" | "notifications" | "settings";

const CONTROL_CENTER_STORAGE_KEY = "control-panel.control-center";
const backupPrefix = "control-panel.";
const focusHiddenWidgets: WidgetId[] = ["clock", "volume", "bluetooth", "quick-links", "system-vitals"];
const defaultFocusPreferences: FocusPreferences = { theme: "black", startSpotify: true, hideDistractions: true };
const ControlCenterContext = createContext<ControlCenterValue | null>(null);

/**
 * Restores the shared control-center configuration while tolerating older stored shapes.
 * @returns Valid app groups, automations, focus preferences, and notifications.
 */
function initialControlCenterState() {
  const fallback = {
    appGroups: [] as AppGroup[],
    automationRules: [] as AutomationRule[],
    focusPreferences: defaultFocusPreferences,
    notifications: [] as ControlNotification[],
  };
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONTROL_CENTER_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return fallback;
    return {
      appGroups: Array.isArray(stored.appGroups) ? stored.appGroups : fallback.appGroups,
      automationRules: Array.isArray(stored.automationRules) ? stored.automationRules : fallback.automationRules,
      focusPreferences: { ...defaultFocusPreferences, ...(stored.focusPreferences ?? {}) },
      notifications: Array.isArray(stored.notifications) ? stored.notifications.slice(0, 80) : fallback.notifications,
    };
  } catch {
    return fallback;
  }
}

/**
 * Clicks a rendered dashboard action through the same path used by touch controls.
 * @param selector - Stable data-attribute selector for the target action.
 * @returns Whether an enabled action was found and activated.
 */
function clickDashboardAction(selector: string) {
  const action = document.querySelector<HTMLButtonElement>(selector);
  if (!action || action.disabled) return false;
  action.click();
  return true;
}

/**
 * Reads current launcher metadata for app-group editing.
 * @returns Unique launcher identifiers and visible names in dashboard order.
 */
function collectLauncherOptions(): LauncherOption[] {
  const options = Array.from(document.querySelectorAll<HTMLElement>("[data-launcher-id]"))
    .flatMap((element) => {
      const id = element.dataset.launcherId;
      const label = element.dataset.launcherLabel;
      return id && label ? [{ id, label }] : [];
    });
  return Array.from(new Map(options.map((option) => [option.id, option])).values());
}

/**
 * Reads hidden Task Manager profile actions so app groups can optionally arrange launched windows.
 * @returns Unique profile identifiers and names.
 */
function collectLayoutProfileOptions(): LayoutProfileOption[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-layout-profile-id]"))
    .flatMap((element) => {
      const id = element.dataset.layoutProfileId;
      const name = element.dataset.layoutProfileName;
      return id && name ? [{ id, name }] : [];
    });
}

/**
 * Owns persisted workflows, notifications, focus mode, and lightweight automation execution.
 * @param props - Dashboard content consuming control-center state.
 * @returns Shared control-center context.
 * @remarks Side effects: persists preferences, polls monitor topology, and dispatches configured dashboard actions.
 */
export function ControlCenterProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(initialControlCenterState, []);
  const [appGroups, setAppGroups] = useState<AppGroup[]>(initial.appGroups);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>(initial.automationRules);
  const [focusPreferences, setFocusPreferences] = useState<FocusPreferences>(initial.focusPreferences);
  const [notifications, setNotifications] = useState<ControlNotification[]>(initial.notifications);
  const [focusEnabled, setFocusEnabled] = useState(false);
  const { theme, hiddenWidgets, setTheme, setWidgetHidden } = useDashboardCustomization();
  const focusRestoreRef = useRef<{ theme: DashboardTheme; hiddenWidgets: Set<WidgetId> } | null>(null);
  const startupHandledRef = useRef(false);
  const lastTimedRunRef = useRef(new Map<string, string>());
  const monitorSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONTROL_CENTER_STORAGE_KEY, JSON.stringify({
        appGroups,
        automationRules,
        focusPreferences,
        notifications: notifications.slice(0, 80),
      }));
    } catch {
      // Workflows remain usable in memory when storage is unavailable.
    }
  }, [appGroups, automationRules, focusPreferences, notifications]);

  const addNotification = useCallback((title: string, message: string, kind: ControlNotification["kind"] = "info") => {
    const notification: ControlNotification = {
      id: crypto.randomUUID(),
      title,
      message,
      kind,
      createdAt: new Date().toISOString(),
      read: false,
    };
    setNotifications((current) => [notification, ...current].slice(0, 80));
  }, []);

  const launchAppGroup = useCallback((group: AppGroup) => {
    let launched = 0;
    for (const launcherId of group.launcherIds) {
      if (clickDashboardAction(`[data-launcher-id="${CSS.escape(launcherId)}"]`)) launched += 1;
    }
    if (group.layoutProfileId) {
      // Give newly launched processes time to create top-level windows before arranging them.
      window.setTimeout(() => {
        clickDashboardAction(`[data-layout-profile-id="${CSS.escape(group.layoutProfileId ?? "")}"]`);
      }, 1_800);
    }
    addNotification(
      group.name,
      launched === group.launcherIds.length
        ? `${launched} app shortcut${launched === 1 ? "" : "s"} launched.`
        : `${launched} of ${group.launcherIds.length} shortcuts were currently available.`,
      launched > 0 ? "success" : "warning",
    );
  }, [addNotification]);

  const toggleFocusMode = useCallback((force?: boolean) => {
    const nextEnabled = force ?? !focusEnabled;
    if (nextEnabled === focusEnabled) return;

    if (nextEnabled) {
      focusRestoreRef.current = { theme, hiddenWidgets: new Set(hiddenWidgets) };
      setTheme(focusPreferences.theme);
      if (focusPreferences.hideDistractions) {
        for (const widgetId of focusHiddenWidgets) setWidgetHidden(widgetId, true);
      }
      const pomodoroButton = document.querySelector<HTMLButtonElement>("[data-control-action='pomodoro-toggle']");
      if (pomodoroButton?.ariaLabel?.startsWith("Play")) pomodoroButton.click();
      if (focusPreferences.startSpotify) {
        const spotifyButton = document.querySelector<HTMLButtonElement>("[data-control-action='spotify-toggle']");
        if (spotifyButton?.ariaLabel?.startsWith("Play")) spotifyButton.click();
      }
      addNotification("Focus mode enabled", "Distractions were hidden and the focus workflow started.", "success");
    } else {
      const restore = focusRestoreRef.current;
      if (restore) {
        setTheme(restore.theme);
        for (const widgetId of focusHiddenWidgets) setWidgetHidden(widgetId, restore.hiddenWidgets.has(widgetId));
      }
      focusRestoreRef.current = null;
      addNotification("Focus mode disabled", "Your previous dashboard appearance was restored.");
    }
    setFocusEnabled(nextEnabled);
  }, [addNotification, focusEnabled, focusPreferences, hiddenWidgets, setTheme, setWidgetHidden, theme]);

  const runAutomation = useCallback((rule: AutomationRule) => {
    if (!rule.enabled) return;
    if (rule.action === "focus") {
      toggleFocusMode(true);
    } else if (rule.action === "open-apps") {
      clickDashboardAction("[data-control-action='open-apps']");
    } else {
      const group = appGroups.find((candidate) => candidate.id === rule.groupId);
      if (group) launchAppGroup(group);
    }
    addNotification("Automation ran", rule.name, "success");
  }, [addNotification, appGroups, launchAppGroup, toggleFocusMode]);

  useEffect(() => {
    if (startupHandledRef.current) return;
    startupHandledRef.current = true;
    const timer = window.setTimeout(() => {
      for (const rule of automationRules.filter((candidate) => candidate.trigger === "startup")) runAutomation(rule);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [automationRules, runAutomation]);

  useEffect(() => {
    const checkTimeRules = () => {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const dateKey = now.toISOString().slice(0, 10);
      for (const rule of automationRules.filter((candidate) => candidate.trigger === "time" && candidate.time === time)) {
        if (lastTimedRunRef.current.get(rule.id) === dateKey) continue;
        lastTimedRunRef.current.set(rule.id, dateKey);
        runAutomation(rule);
      }
    };
    checkTimeRules();
    const timer = window.setInterval(checkTimeRules, 20_000);
    return () => window.clearInterval(timer);
  }, [automationRules, runAutomation]);

  useEffect(() => {
    const handleControlEvent = (event: Event) => {
      const trigger = (event as CustomEvent<{ trigger?: AutomationRule["trigger"] }>).detail?.trigger;
      if (!trigger) return;
      for (const rule of automationRules.filter((candidate) => candidate.trigger === trigger)) runAutomation(rule);
    };
    window.addEventListener("control-panel:automation-trigger", handleControlEvent);
    return () => window.removeEventListener("control-panel:automation-trigger", handleControlEvent);
  }, [automationRules, runAutomation]);

  useEffect(() => {
    if (!isTauriRuntime() || !automationRules.some((rule) => rule.trigger === "monitor" && rule.enabled)) return;
    const checkMonitors = async () => {
      try {
        const workspace = await invoke<{ monitors: Array<{ id: string }> }>("get_window_workspace");
        const signature = workspace.monitors.map((monitor) => monitor.id).sort().join("|");
        if (monitorSignatureRef.current && monitorSignatureRef.current !== signature) {
          window.dispatchEvent(new CustomEvent("control-panel:automation-trigger", { detail: { trigger: "monitor" } }));
        }
        monitorSignatureRef.current = signature;
      } catch {
        // Monitor automations retry without surfacing recurring native polling errors.
      }
    };
    void checkMonitors();
    const timer = window.setInterval(() => void checkMonitors(), 15_000);
    return () => window.clearInterval(timer);
  }, [automationRules]);

  const value = useMemo<ControlCenterValue>(() => ({
    appGroups,
    automationRules,
    focusEnabled,
    focusPreferences,
    notifications,
    addNotification,
    setAppGroups,
    setAutomationRules,
    setFocusPreferences,
    toggleFocusMode,
    launchAppGroup,
    markNotificationsRead: () => setNotifications((current) => current.map((notification) => ({ ...notification, read: true }))),
    clearNotifications: () => setNotifications([]),
  }), [addNotification, appGroups, automationRules, focusEnabled, focusPreferences, launchAppGroup, notifications, toggleFocusMode]);

  return <ControlCenterContext.Provider value={value}>{children}</ControlCenterContext.Provider>;
}

/**
 * Provides workflow, automation, focus, and notification state to dashboard controls.
 * @returns The nearest control-center context.
 * @throws When called outside `ControlCenterProvider`.
 */
export function useControlCenter() {
  const context = useContext(ControlCenterContext);
  if (!context) throw new Error("Control center requires its provider");
  return context;
}

/**
 * Renders focus mode and a unified hub for groups, automations, notifications, and backups.
 * @returns Touch-friendly title-bar controls and the active hub modal.
 * @remarks Side effects: can launch applications, update preferences, and import or export local configuration.
 */
export function ControlCenterControls() {
  const {
    appGroups,
    automationRules,
    clearNotifications,
    focusEnabled,
    focusPreferences,
    launchAppGroup,
    markNotificationsRead,
    notifications,
    setAppGroups,
    setAutomationRules,
    setFocusPreferences,
    toggleFocusMode,
  } = useControlCenter();
  const { editMode, setEditMode, resetDashboardLayout } = useDashboardCustomization();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<HubSection>("groups");
  const [launchers, setLaunchers] = useState<LauncherOption[]>([]);
  const [layoutProfileOptions, setLayoutProfileOptions] = useState<LayoutProfileOption[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedLaunchers, setSelectedLaunchers] = useState<Set<string>>(new Set());
  const [selectedLayoutProfileId, setSelectedLayoutProfileId] = useState<string | null>(null);
  const [automationName, setAutomationName] = useState("");
  const [automationTrigger, setAutomationTrigger] = useState<AutomationRule["trigger"]>("startup");
  const [automationAction, setAutomationAction] = useState<AutomationRule["action"]>("focus");
  const [automationTime, setAutomationTime] = useState("09:00");
  const [automationGroupId, setAutomationGroupId] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  /** Opens the requested hub section with freshly scanned launcher options. */
  const showHub = (nextSection: HubSection) => {
    setLaunchers(collectLauncherOptions());
    setLayoutProfileOptions(collectLayoutProfileOptions());
    setSection(nextSection);
    setOpen(true);
    if (nextSection === "notifications") markNotificationsRead();
  };

  /** Closes the control center and restores title-bar focus. */
  const closeHub = useCallback(() => {
    setOpen(false);
    setResetArmed(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 80);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeHub();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeHub, open]);

  /** Adds an app group from the currently selected launcher identifiers. */
  const addGroup = () => {
    const name = groupName.trim();
    if (!name || selectedLaunchers.size === 0) return;
    setAppGroups([...appGroups, { id: crypto.randomUUID(), name: name.slice(0, 40), launcherIds: [...selectedLaunchers], layoutProfileId: selectedLayoutProfileId }]);
    setGroupName("");
    setSelectedLaunchers(new Set());
    setSelectedLayoutProfileId(null);
  };

  /** Adds an automation rule using the active editor fields. */
  const addAutomation = () => {
    const name = automationName.trim();
    if (!name || (automationAction === "group" && !automationGroupId)) return;
    setAutomationRules([...automationRules, {
      id: crypto.randomUUID(),
      name: name.slice(0, 48),
      enabled: true,
      trigger: automationTrigger,
      time: automationTime,
      action: automationAction,
      groupId: automationAction === "group" ? automationGroupId : null,
    }]);
    setAutomationName("");
  };

  /** Downloads every Control Panel local preference as a portable JSON backup. */
  const exportBackup = () => {
    const entries: Record<string, string> = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(backupPrefix)) entries[key] = window.localStorage.getItem(key) ?? "";
    }
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `control-panel-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /** Validates and restores a previously exported local preference backup. */
  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.version !== 1 || !backup.entries || typeof backup.entries !== "object") throw new Error();
      for (const [key, value] of Object.entries(backup.entries)) {
        if (key.startsWith(backupPrefix) && typeof value === "string") window.localStorage.setItem(key, value);
      }
      setImportStatus("Backup restored. Reloading…");
      window.setTimeout(() => window.location.reload(), 700);
    } catch {
      setImportStatus("That file is not a valid Control Panel backup.");
    }
  };

  /** Removes only Control Panel-owned preferences after a deliberate two-step confirmation. */
  const resetPreferences = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(backupPrefix)));
    for (const key of keys) window.localStorage.removeItem(key);
    window.location.reload();
  };

  const sectionButtons: Array<{ id: HubSection; label: string; icon: typeof Layers3 }> = [
    { id: "groups", label: "App groups", icon: Layers3 },
    { id: "automations", label: "Automations", icon: Bot },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <>
      <TactileButton
        onClick={() => toggleFocusMode()}
        selected={focusEnabled}
        className="h-11 px-3"
        aria-pressed={focusEnabled}
        aria-label={focusEnabled ? "Disable focus mode" : "Enable focus mode"}
        title="Focus mode"
      >
        <Focus size={17} className={focusEnabled ? "text-emerald-300" : "text-signal-300"} />
      </TactileButton>
      <TactileButton
        ref={triggerRef}
        onClick={() => showHub(unreadCount > 0 ? "notifications" : "groups")}
        className="relative h-11 px-3"
        aria-haspopup="dialog"
        aria-label="Open control center"
        title="Groups, automations, notifications, and settings"
      >
        <Sparkles size={17} className="text-signal-300" />
        {unreadCount > 0 ? <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">{Math.min(unreadCount, 9)}</span> : null}
      </TactileButton>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-3 backdrop-blur-md sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.currentTarget === event.target && closeHub()}>
            <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="control-center-title" className="schedule-panel relative my-auto flex max-h-[calc(100dvh-32px)] w-full max-w-[1040px] flex-col overflow-hidden rounded-[20px] border border-black/80 border-t-white/10 shadow-panel" initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }}>
              <header className="flex shrink-0 items-center justify-between border-b border-black/60 px-5 py-4 sm:px-6">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-400">Personal workflows</p>
                  <h2 id="control-center-title" className="mt-1 text-xl font-semibold text-stone-100">Control center</h2>
                </div>
                <button ref={closeRef} type="button" onClick={closeHub} className="grid size-11 place-items-center rounded-[11px] text-stone-500 hover:bg-white/[0.04] hover:text-stone-200" aria-label="Close control center"><X size={20} /></button>
              </header>

              <div className="grid min-h-0 flex-1 md:grid-cols-[220px_1fr]">
                <nav className="flex overflow-x-auto border-b border-black/60 bg-black/15 p-2 md:flex-col md:border-b-0 md:border-r md:p-3" aria-label="Control center sections">
                  {sectionButtons.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" onClick={() => { setSection(id); if (id === "notifications") markNotificationsRead(); }} className={`flex min-h-11 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-left text-xs font-semibold transition ${section === id ? "bg-signal-950/45 text-signal-200 shadow-well" : "text-stone-600 hover:bg-white/[0.03] hover:text-stone-300"}`}>
                      <Icon size={15} /> {label}
                      {id === "notifications" && unreadCount > 0 ? <span className="ml-auto rounded-full bg-red-500/80 px-1.5 text-[8px] text-white">{unreadCount}</span> : null}
                    </button>
                  ))}
                </nav>

                <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
                  {section === "groups" ? (
                    <div>
                      <h3 className="text-lg font-semibold text-stone-100">App groups</h3>
                      <p className="mt-1 text-xs text-stone-600">Launch a complete workspace with one touch.</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {appGroups.map((group) => (
                          <div key={group.id} className="rounded-[13px] border border-black/65 bg-black/20 p-3 shadow-well">
                            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-stone-200">{group.name}</p><p className="mt-1 text-[10px] text-stone-600">{group.launcherIds.length} shortcuts{group.layoutProfileId ? " · arranged after launch" : ""}</p></div><button type="button" onClick={() => setAppGroups(appGroups.filter((candidate) => candidate.id !== group.id))} className="grid size-9 place-items-center rounded-lg text-stone-700 hover:text-red-300" aria-label={`Delete ${group.name}`}><Trash2 size={14} /></button></div>
                            <TactileButton onClick={() => launchAppGroup(group)} className="mt-3 h-10 w-full text-[10px] font-semibold uppercase tracking-[0.08em]">Launch group</TactileButton>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 rounded-[14px] border border-white/[0.06] bg-black/15 p-4">
                        <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Group name" maxLength={40} className="schedule-input" />
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {launchers.map((launcher) => {
                            const selected = selectedLaunchers.has(launcher.id);
                            return <button key={launcher.id} type="button" onClick={() => setSelectedLaunchers((current) => { const next = new Set(current); if (selected) next.delete(launcher.id); else next.add(launcher.id); return next; })} className={`flex min-h-11 items-center justify-between rounded-[10px] border px-3 text-xs ${selected ? "border-signal-700 bg-signal-950/40 text-signal-200" : "border-black/60 bg-black/20 text-stone-500"}`}><span className="truncate">{launcher.label}</span>{selected ? <Check size={14} /> : null}</button>;
                          })}
                        </div>
                        <select value={selectedLayoutProfileId ?? ""} onChange={(event) => setSelectedLayoutProfileId(event.target.value || null)} className="schedule-input mt-3">
                          <option value="">Do not arrange windows after launch</option>
                          {layoutProfileOptions.map((profile) => <option key={profile.id} value={profile.id}>Apply layout: {profile.name}</option>)}
                        </select>
                        <TactileButton onClick={addGroup} disabled={!groupName.trim() || selectedLaunchers.size === 0} className="mt-3 h-11 w-full"><span className="flex items-center justify-center gap-2 text-xs font-semibold"><Plus size={15} /> Create app group</span></TactileButton>
                      </div>
                    </div>
                  ) : null}

                  {section === "automations" ? (
                    <div>
                      <h3 className="text-lg font-semibold text-stone-100">Automation rules</h3>
                      <p className="mt-1 text-xs text-stone-600">Run focus mode, app groups, or Open Apps from system events.</p>
                      <div className="mt-4 space-y-2">
                        {automationRules.map((rule) => (
                          <div key={rule.id} className="flex items-center gap-3 rounded-[12px] border border-black/60 bg-black/20 p-3">
                            <button type="button" onClick={() => setAutomationRules(automationRules.map((candidate) => candidate.id === rule.id ? { ...candidate, enabled: !candidate.enabled } : candidate))} className={`relative h-7 w-12 shrink-0 rounded-full border transition ${rule.enabled ? "border-emerald-700 bg-emerald-950" : "border-black/70 bg-black/30"}`} aria-pressed={rule.enabled} aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}><span className={`absolute top-1 size-4 rounded-full transition ${rule.enabled ? "left-6 bg-emerald-300" : "left-1 bg-stone-700"}`} /></button>
                            <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-stone-300">{rule.name}</p><p className="mt-1 font-mono text-[9px] uppercase text-stone-700">{rule.trigger === "time" ? `${rule.trigger} · ${rule.time}` : rule.trigger} → {rule.action}</p></div>
                            <button type="button" onClick={() => setAutomationRules(automationRules.filter((candidate) => candidate.id !== rule.id))} className="grid size-9 place-items-center text-stone-700 hover:text-red-300" aria-label={`Delete ${rule.name}`}><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 grid gap-3 rounded-[14px] border border-white/[0.06] bg-black/15 p-4 sm:grid-cols-2">
                        <input value={automationName} onChange={(event) => setAutomationName(event.target.value)} placeholder="Rule name" className="schedule-input sm:col-span-2" />
                        <select value={automationTrigger} onChange={(event) => setAutomationTrigger(event.target.value as AutomationRule["trigger"])} className="schedule-input"><option value="startup">App starts</option><option value="time">At a time</option><option value="pomodoro">Pomodoro starts</option><option value="bluetooth">Headphones connect</option><option value="monitor">Monitor setup changes</option></select>
                        {automationTrigger === "time" ? <input type="time" value={automationTime} onChange={(event) => setAutomationTime(event.target.value)} className="schedule-input" /> : <div />}
                        <select value={automationAction} onChange={(event) => setAutomationAction(event.target.value as AutomationRule["action"])} className="schedule-input"><option value="focus">Enable Focus Mode</option><option value="group">Launch app group</option><option value="open-apps">Open window workspace</option></select>
                        {automationAction === "group" ? <select value={automationGroupId ?? ""} onChange={(event) => setAutomationGroupId(event.target.value || null)} className="schedule-input"><option value="">Choose group</option>{appGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select> : <div />}
                        <TactileButton onClick={addAutomation} disabled={!automationName.trim() || (automationAction === "group" && !automationGroupId)} className="h-11 sm:col-span-2"><span className="flex items-center justify-center gap-2 text-xs font-semibold"><Plus size={15} /> Add automation</span></TactileButton>
                      </div>
                    </div>
                  ) : null}

                  {section === "notifications" ? (
                    <div>
                      <div className="flex items-center justify-between"><div><h3 className="text-lg font-semibold text-stone-100">Notifications</h3><p className="mt-1 text-xs text-stone-600">Recent workflows, warnings, and automation activity.</p></div><button type="button" onClick={clearNotifications} disabled={notifications.length === 0} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-600 hover:text-stone-300 disabled:opacity-30">Clear all</button></div>
                      <div className="mt-4 space-y-2">
                        {notifications.length === 0 ? <div className="grid min-h-48 place-items-center rounded-[14px] border border-dashed border-white/[0.06] text-center"><div><Bell size={25} className="mx-auto text-stone-700" /><p className="mt-2 text-xs text-stone-500">Nothing new yet</p></div></div> : notifications.map((notification) => (
                          <div key={notification.id} className="flex gap-3 rounded-[12px] border border-black/60 bg-black/20 p-3"><span className={`mt-1 size-2 shrink-0 rounded-full ${notification.kind === "error" ? "bg-red-400" : notification.kind === "warning" ? "bg-amber-400" : notification.kind === "success" ? "bg-emerald-400" : "bg-signal-400"}`} /><div className="min-w-0"><p className="text-xs font-semibold text-stone-300">{notification.title}</p><p className="mt-1 text-[11px] leading-relaxed text-stone-600">{notification.message}</p><time className="mt-1.5 block font-mono text-[9px] text-stone-800">{new Date(notification.createdAt).toLocaleString()}</time></div></div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {section === "settings" ? (
                    <div>
                      <h3 className="text-lg font-semibold text-stone-100">Settings and backup</h3>
                      <p className="mt-1 text-xs text-stone-600">Configure focus behavior, dashboard editing, and portable preferences.</p>
                      <section className="mt-4 rounded-[14px] border border-black/60 bg-black/20 p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-400">Focus mode</h4>
                        <label className="mt-3 flex items-center justify-between gap-3 text-xs text-stone-400"><span>Start Spotify playback</span><input type="checkbox" checked={focusPreferences.startSpotify} onChange={(event) => setFocusPreferences({ ...focusPreferences, startSpotify: event.target.checked })} /></label>
                        <label className="mt-3 flex items-center justify-between gap-3 text-xs text-stone-400"><span>Hide distracting widgets</span><input type="checkbox" checked={focusPreferences.hideDistractions} onChange={(event) => setFocusPreferences({ ...focusPreferences, hideDistractions: event.target.checked })} /></label>
                        <label className="mt-3 block text-xs text-stone-400"><span>Focus color scheme</span><select value={focusPreferences.theme} onChange={(event) => setFocusPreferences({ ...focusPreferences, theme: event.target.value as DashboardTheme })} className="schedule-input mt-2"><option value="black">Black</option><option value="tan">Tan</option><option value="green">Green</option><option value="blue">Blue</option><option value="white">White</option></select></label>
                      </section>
                      <section className="mt-3 rounded-[14px] border border-black/60 bg-black/20 p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-400">Dashboard layout</h4>
                        <div className="mt-3 flex flex-wrap gap-2"><TactileButton onClick={() => { setEditMode(!editMode); closeHub(); }} selected={editMode} className="h-10 px-4 text-xs">{editMode ? "Finish editing" : "Edit dashboard"}</TactileButton><button type="button" onClick={resetDashboardLayout} className="flex h-10 items-center gap-2 rounded-[10px] px-3 text-xs text-stone-600 hover:text-stone-300"><RotateCcw size={14} /> Reset layout</button></div>
                      </section>
                      <section className="mt-3 rounded-[14px] border border-black/60 bg-black/20 p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-400">Portable configuration</h4>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2"><TactileButton onClick={exportBackup} className="h-11"><span className="flex items-center justify-center gap-2 text-xs"><Download size={15} /> Export backup</span></TactileButton><TactileButton onClick={() => importRef.current?.click()} className="h-11"><span className="flex items-center justify-center gap-2 text-xs"><Upload size={15} /> Import backup</span></TactileButton></div>
                        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importBackup(event)} />
                        {importStatus ? <p className="mt-2 text-[11px] text-stone-500">{importStatus}</p> : null}
                        <button type="button" onClick={resetPreferences} className={`mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] border text-xs font-semibold ${resetArmed ? "border-red-700 bg-red-950/30 text-red-300" : "border-red-950/70 text-red-600"}`}><Trash2 size={14} />{resetArmed ? "Confirm reset and reload" : "Reset all Control Panel settings"}</button>
                      </section>
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
