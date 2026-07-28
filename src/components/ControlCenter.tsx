import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Bot,
  Check,
  Download,
  FlaskConical,
  Focus,
  History,
  Layers3,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Workflow,
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
import { errorMessage, isTauriRuntime } from "../lib/runtime";
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

export type AutomationTrigger =
  | "manual"
  | "startup"
  | "time"
  | "pomodoro-start"
  | "pomodoro-complete"
  | "bluetooth"
  | "monitor"
  | "battery"
  | "app";

export type AutomationActionType =
  | "focus-on"
  | "focus-off"
  | "group"
  | "open-apps"
  | "open-planning"
  | "create-daily-plan"
  | "pomodoro-start"
  | "spotify-play"
  | "spotify-pause"
  | "theme"
  | "volume"
  | "brightness";

export type AutomationAction = {
  id: string;
  type: AutomationActionType;
  groupId: string | null;
  value: string;
};

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  time: string;
  days: number[];
  focusRequirement: "any" | "enabled" | "disabled";
  batteryMode: "below" | "above" | "charging";
  batteryLevel: number;
  appName: string;
  appState: "opened" | "closed";
  actions: AutomationAction[];
};

type AutomationRun = {
  id: string;
  ruleId: string;
  ruleName: string;
  startedAt: string;
  kind: "trigger" | "manual" | "test" | "undo";
  status: "success" | "partial" | "skipped" | "tested";
  summary: string;
};

type FocusPreferences = {
  theme: DashboardTheme;
  startSpotify: boolean;
  hideDistractions: boolean;
};

type ControlCenterValue = {
  appGroups: AppGroup[];
  automationRules: AutomationRule[];
  automationRuns: AutomationRun[];
  focusEnabled: boolean;
  focusPreferences: FocusPreferences;
  notifications: ControlNotification[];
  addNotification: (title: string, message: string, kind?: ControlNotification["kind"]) => void;
  setAppGroups: (groups: AppGroup[]) => void;
  setAutomationRules: (rules: AutomationRule[]) => void;
  setFocusPreferences: (preferences: FocusPreferences) => void;
  toggleFocusMode: (force?: boolean) => void;
  launchAppGroup: (group: AppGroup) => void;
  runAutomation: (rule: AutomationRule, kind?: AutomationRun["kind"]) => Promise<void>;
  undoLastAutomation: () => Promise<void>;
  canUndoAutomation: boolean;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
};

type LauncherOption = { id: string; label: string };
type LayoutProfileOption = { id: string; name: string };
type HubSection = "groups" | "automations" | "notifications" | "settings";
type AutomationView = "routines" | "history";

const CONTROL_CENTER_STORAGE_KEY = "control-panel.control-center";
const backupPrefix = "control-panel.";
const focusHiddenWidgets: WidgetId[] = ["clock", "volume", "bluetooth", "quick-links", "system-vitals"];
const defaultFocusPreferences: FocusPreferences = { theme: "black", startSpotify: true, hideDistractions: true };
const ControlCenterContext = createContext<ControlCenterValue | null>(null);

const allWeekdays = [0, 1, 2, 3, 4, 5, 6];

const actionLabels: Record<AutomationActionType, string> = {
  "focus-on": "Enable Focus Mode",
  "focus-off": "Disable Focus Mode",
  group: "Launch app group",
  "open-apps": "Open window workspace",
  "open-planning": "Open Planning",
  "create-daily-plan": "Create today's plan",
  "pomodoro-start": "Start Pomodoro",
  "spotify-play": "Play Spotify",
  "spotify-pause": "Pause Spotify",
  theme: "Change color scheme",
  volume: "Set system volume",
  brightness: "Set brightness",
};

const triggerLabels: Record<AutomationTrigger, string> = {
  manual: "Manual only",
  startup: "Control Panel starts",
  time: "At a scheduled time",
  "pomodoro-start": "Pomodoro starts",
  "pomodoro-complete": "Pomodoro completes",
  bluetooth: "Headphones connect",
  monitor: "Monitor setup changes",
  battery: "Battery condition is met",
  app: "An application changes",
};

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function createAutomationAction(type: AutomationActionType = "focus-on"): AutomationAction {
  return { id: crypto.randomUUID(), type, groupId: null, value: type === "theme" ? "black" : type === "volume" ? "35" : type === "brightness" ? "60" : "" };
}

type StoredAutomationRule = Partial<Omit<AutomationRule, "trigger">> & {
  trigger?: AutomationTrigger | "pomodoro";
  action?: string;
  groupId?: string | null;
};

function normalizeAutomationRule(candidate: StoredAutomationRule): AutomationRule | null {
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return null;
  const legacyAction = candidate.action === "focus"
    ? createAutomationAction("focus-on")
    : candidate.action === "group"
      ? { ...createAutomationAction("group"), groupId: candidate.groupId ?? null }
      : candidate.action === "open-apps"
        ? createAutomationAction("open-apps")
        : null;
  const trigger = candidate.trigger === "pomodoro" ? "pomodoro-start" : candidate.trigger;
  const validTrigger = typeof trigger === "string" && trigger in triggerLabels ? trigger as AutomationTrigger : "manual";
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.filter((action): action is AutomationAction => Boolean(
      action
      && typeof action.id === "string"
      && typeof action.type === "string"
      && action.type in actionLabels,
    )).map((action) => ({ ...action, groupId: action.groupId ?? null, value: String(action.value ?? "") }))
    : legacyAction ? [legacyAction] : [];
  return {
    id: candidate.id,
    name: candidate.name.slice(0, 48),
    enabled: candidate.enabled !== false,
    trigger: validTrigger,
    time: typeof candidate.time === "string" ? candidate.time : "09:00",
    days: Array.isArray(candidate.days) ? candidate.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : allWeekdays,
    focusRequirement: ["any", "enabled", "disabled"].includes(candidate.focusRequirement ?? "") ? candidate.focusRequirement! : "any",
    batteryMode: ["below", "above", "charging"].includes(candidate.batteryMode ?? "") ? candidate.batteryMode! : "below",
    batteryLevel: typeof candidate.batteryLevel === "number" ? Math.min(100, Math.max(1, candidate.batteryLevel)) : 20,
    appName: typeof candidate.appName === "string" ? candidate.appName.slice(0, 80) : "",
    appState: candidate.appState === "closed" ? "closed" : "opened",
    actions,
  };
}

function automationActionDetail(action: AutomationAction, groups: AppGroup[]) {
  if (action.type === "group") return groups.find((group) => group.id === action.groupId)?.name ?? "Missing app group";
  if (action.type === "theme") return `${action.value || "black"} scheme`;
  if (action.type === "volume" || action.type === "brightness") return `${action.value || "0"}%`;
  return "";
}

function automationTriggerDetail(rule: AutomationRule) {
  if (rule.trigger === "time") return `${rule.time} on ${rule.days.length === 7 ? "every day" : rule.days.map((day) => weekdayLabels[day]).join(", ")}`;
  if (rule.trigger === "battery") return rule.batteryMode === "charging" ? "when charging starts" : `${rule.batteryMode} ${rule.batteryLevel}%`;
  if (rule.trigger === "app") return `${rule.appName || "application"} ${rule.appState}`;
  return triggerLabels[rule.trigger];
}

/**
 * Restores the shared control-center configuration while tolerating older stored shapes.
 * @returns Valid app groups, automations, focus preferences, and notifications.
 */
function initialControlCenterState() {
  const fallback = {
    appGroups: [] as AppGroup[],
    automationRules: [] as AutomationRule[],
    automationRuns: [] as AutomationRun[],
    focusPreferences: defaultFocusPreferences,
    notifications: [] as ControlNotification[],
  };
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONTROL_CENTER_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return fallback;
    return {
      appGroups: Array.isArray(stored.appGroups) ? stored.appGroups : fallback.appGroups,
      automationRules: Array.isArray(stored.automationRules)
        ? stored.automationRules.map(normalizeAutomationRule).filter((rule: AutomationRule | null): rule is AutomationRule => Boolean(rule))
        : fallback.automationRules,
      automationRuns: Array.isArray(stored.automationRuns) ? stored.automationRuns.slice(0, 60) : fallback.automationRuns,
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
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>(initial.automationRuns);
  const [focusPreferences, setFocusPreferences] = useState<FocusPreferences>(initial.focusPreferences);
  const [notifications, setNotifications] = useState<ControlNotification[]>(initial.notifications);
  const [focusEnabled, setFocusEnabled] = useState(false);
  const { theme, hiddenWidgets, setTheme, setWidgetHidden } = useDashboardCustomization();
  const focusRestoreRef = useRef<{ theme: DashboardTheme; hiddenWidgets: Set<WidgetId> } | null>(null);
  const startupHandledRef = useRef(false);
  const lastTimedRunRef = useRef(new Map<string, string>());
  const monitorSignatureRef = useRef<string | null>(null);
  const applicationNamesRef = useRef<Set<string> | null>(null);
  const batteryMatchRef = useRef(new Map<string, boolean>());
  const undoAutomationRef = useRef<{
    ruleName: string;
    theme: DashboardTheme;
    focusEnabled: boolean;
    volume: number | null;
    brightness: number | null;
  } | null>(null);
  const [canUndoAutomation, setCanUndoAutomation] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONTROL_CENTER_STORAGE_KEY, JSON.stringify({
        appGroups,
        automationRules,
        automationRuns: automationRuns.slice(0, 60),
        focusPreferences,
        notifications: notifications.slice(0, 80),
      }));
    } catch {
      // Workflows remain usable in memory when storage is unavailable.
    }
  }, [appGroups, automationRules, automationRuns, focusPreferences, notifications]);

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

  const recordAutomationRun = useCallback((run: Omit<AutomationRun, "id" | "startedAt">) => {
    setAutomationRuns((current) => [{
      ...run,
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    }, ...current].slice(0, 60));
  }, []);

  const runAutomation = useCallback(async (rule: AutomationRule, kind: AutomationRun["kind"] = "trigger") => {
    if (kind === "trigger" && !rule.enabled) return;
    const now = new Date();
    const focusMatches = rule.focusRequirement === "any"
      || (rule.focusRequirement === "enabled" && focusEnabled)
      || (rule.focusRequirement === "disabled" && !focusEnabled);
    const dayMatches = rule.trigger !== "time" || rule.days.includes(now.getDay());

    if (kind !== "test" && (!focusMatches || !dayMatches)) {
      const summary = !dayMatches ? "Skipped because today is outside its schedule." : "Skipped because the Focus Mode condition was not met.";
      recordAutomationRun({ ruleId: rule.id, ruleName: rule.name, kind, status: "skipped", summary });
      return;
    }

    const invalidGroup = rule.actions.find((action) => action.type === "group" && !appGroups.some((group) => group.id === action.groupId));
    if (kind === "test") {
      const summary = rule.actions.length === 0
        ? "Test failed: add at least one action."
        : invalidGroup
          ? "Test failed: one app group is no longer available."
          : `${rule.actions.length} ordered action${rule.actions.length === 1 ? " is" : "s are"} ready.`;
      recordAutomationRun({ ruleId: rule.id, ruleName: rule.name, kind, status: invalidGroup || rule.actions.length === 0 ? "partial" : "tested", summary });
      addNotification(`Tested ${rule.name}`, summary, invalidGroup || rule.actions.length === 0 ? "warning" : "success");
      return;
    }

    const hasVolumeAction = rule.actions.some((action) => action.type === "volume");
    const hasBrightnessAction = rule.actions.some((action) => action.type === "brightness");
    const hasReversibleAction = rule.actions.some((action) => ["focus-on", "focus-off", "theme", "volume", "brightness"].includes(action.type));
    let previousVolume: number | null = null;
    let previousBrightness: number | null = null;
    if (isTauriRuntime() && hasVolumeAction) {
      try { previousVolume = await invoke<number>("get_system_volume"); } catch { previousVolume = null; }
    }
    if (isTauriRuntime() && hasBrightnessAction) {
      try { previousBrightness = await invoke<number>("get_system_brightness"); } catch { previousBrightness = null; }
    }

    let completed = 0;
    const failures: string[] = [];
    for (const action of rule.actions) {
      try {
        if (action.type === "focus-on") toggleFocusMode(true);
        if (action.type === "focus-off") toggleFocusMode(false);
        if (action.type === "group") {
          const group = appGroups.find((candidate) => candidate.id === action.groupId);
          if (!group) throw new Error("App group is unavailable");
          launchAppGroup(group);
        }
        if (action.type === "open-apps" && !clickDashboardAction("[data-control-action='open-apps']")) throw new Error("Window workspace is unavailable");
        if (action.type === "open-planning" && !clickDashboardAction("[data-control-action='open-planning']")) throw new Error("Planning is unavailable");
        if (action.type === "create-daily-plan") {
          window.dispatchEvent(new CustomEvent("control-panel:planning-action", { detail: { action: "create-daily" } }));
        }
        if (action.type === "pomodoro-start") {
          const button = document.querySelector<HTMLButtonElement>("[data-control-action='pomodoro-toggle']");
          if (!button) throw new Error("Pomodoro is unavailable");
          if (button.ariaLabel?.startsWith("Play")) button.click();
        }
        if (action.type === "spotify-play" || action.type === "spotify-pause") {
          const button = document.querySelector<HTMLButtonElement>("[data-control-action='spotify-toggle']");
          if (!button) throw new Error("Spotify is unavailable");
          const shouldPlay = action.type === "spotify-play" && button.ariaLabel?.startsWith("Play");
          const shouldPause = action.type === "spotify-pause" && button.ariaLabel?.startsWith("Pause");
          if (shouldPlay || shouldPause) button.click();
        }
        if (action.type === "theme") {
          const nextTheme = action.value as DashboardTheme;
          if (!["black", "tan", "green", "blue", "white"].includes(nextTheme)) throw new Error("Color scheme is invalid");
          setTheme(nextTheme);
        }
        if (action.type === "volume" || action.type === "brightness") {
          if (!isTauriRuntime()) throw new Error("System controls require the desktop app");
          const level = Math.min(100, Math.max(0, Number(action.value)));
          if (!Number.isFinite(level)) throw new Error("System level is invalid");
          await invoke(action.type === "volume" ? "set_system_volume" : "set_system_brightness", { level: Math.round(level) });
        }
        completed += 1;
      } catch (error) {
        failures.push(`${actionLabels[action.type]}: ${errorMessage(error)}`);
      }
    }

    if (hasReversibleAction && completed > 0) {
      undoAutomationRef.current = { ruleName: rule.name, theme, focusEnabled, volume: previousVolume, brightness: previousBrightness };
      setCanUndoAutomation(true);
    }
    const status: AutomationRun["status"] = failures.length === 0 ? "success" : completed > 0 ? "partial" : "partial";
    const summary = failures.length === 0
      ? `${completed} action${completed === 1 ? "" : "s"} completed in order.`
      : `${completed} completed. ${failures.join(" ")}`;
    recordAutomationRun({ ruleId: rule.id, ruleName: rule.name, kind, status, summary });
    addNotification(rule.name, summary, failures.length === 0 ? "success" : "warning");
  }, [addNotification, appGroups, focusEnabled, launchAppGroup, recordAutomationRun, setTheme, theme, toggleFocusMode]);

  const undoLastAutomation = useCallback(async () => {
    const snapshot = undoAutomationRef.current;
    if (!snapshot) return;
    toggleFocusMode(snapshot.focusEnabled);
    setTheme(snapshot.theme);
    const failures: string[] = [];
    if (isTauriRuntime() && snapshot.volume !== null) {
      try { await invoke("set_system_volume", { level: snapshot.volume }); } catch (error) { failures.push(errorMessage(error)); }
    }
    if (isTauriRuntime() && snapshot.brightness !== null) {
      try { await invoke("set_system_brightness", { level: snapshot.brightness }); } catch (error) { failures.push(errorMessage(error)); }
    }
    const summary = failures.length === 0 ? "Reversible settings were restored." : `Some settings could not be restored. ${failures.join(" ")}`;
    recordAutomationRun({ ruleId: "undo", ruleName: snapshot.ruleName, kind: "undo", status: failures.length === 0 ? "success" : "partial", summary });
    addNotification(`Undid ${snapshot.ruleName}`, summary, failures.length === 0 ? "success" : "warning");
    undoAutomationRef.current = null;
    setCanUndoAutomation(false);
  }, [addNotification, recordAutomationRun, setTheme, toggleFocusMode]);

  useEffect(() => {
    if (startupHandledRef.current) return;
    startupHandledRef.current = true;
    const timer = window.setTimeout(() => {
      for (const rule of automationRules.filter((candidate) => candidate.trigger === "startup")) void runAutomation(rule);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [automationRules, runAutomation]);

  useEffect(() => {
    const checkTimeRules = () => {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
      for (const rule of automationRules.filter((candidate) => candidate.trigger === "time" && candidate.time === time)) {
        if (lastTimedRunRef.current.get(rule.id) === dateKey) continue;
        lastTimedRunRef.current.set(rule.id, dateKey);
        void runAutomation(rule);
      }
    };
    checkTimeRules();
    const timer = window.setInterval(checkTimeRules, 20_000);
    return () => window.clearInterval(timer);
  }, [automationRules, runAutomation]);

  useEffect(() => {
    const handleControlEvent = (event: Event) => {
      const trigger = (event as CustomEvent<{ trigger?: AutomationTrigger }>).detail?.trigger;
      if (!trigger) return;
      for (const rule of automationRules.filter((candidate) => candidate.trigger === trigger)) void runAutomation(rule);
    };
    window.addEventListener("control-panel:automation-trigger", handleControlEvent);
    return () => window.removeEventListener("control-panel:automation-trigger", handleControlEvent);
  }, [automationRules, runAutomation]);

  useEffect(() => {
    if (!isTauriRuntime() || !automationRules.some((rule) => ["monitor", "app"].includes(rule.trigger) && rule.enabled)) return;
    const checkWorkspace = async () => {
      try {
        const workspace = await invoke<{ monitors: Array<{ id: string }>; windows: Array<{ name: string }> }>("get_window_workspace");
        const signature = workspace.monitors.map((monitor) => monitor.id).sort().join("|");
        if (monitorSignatureRef.current && monitorSignatureRef.current !== signature) {
          window.dispatchEvent(new CustomEvent("control-panel:automation-trigger", { detail: { trigger: "monitor" } }));
        }
        monitorSignatureRef.current = signature;
        const names = new Set(workspace.windows.map((window) => window.name.toLowerCase()));
        const previous = applicationNamesRef.current;
        if (previous) {
          for (const rule of automationRules.filter((candidate) => candidate.enabled && candidate.trigger === "app" && candidate.appName.trim())) {
            const query = rule.appName.trim().toLowerCase();
            const wasOpen = Array.from(previous).some((name) => name.includes(query));
            const isOpen = Array.from(names).some((name) => name.includes(query));
            if ((rule.appState === "opened" && !wasOpen && isOpen) || (rule.appState === "closed" && wasOpen && !isOpen)) void runAutomation(rule);
          }
        }
        applicationNamesRef.current = names;
      } catch {
        // Workspace automations retry without surfacing recurring native polling errors.
      }
    };
    void checkWorkspace();
    const timer = window.setInterval(() => void checkWorkspace(), 12_000);
    return () => window.clearInterval(timer);
  }, [automationRules, runAutomation]);

  useEffect(() => {
    if (!isTauriRuntime() || !automationRules.some((rule) => rule.trigger === "battery" && rule.enabled)) return;
    const checkBattery = async () => {
      try {
        const battery = await invoke<{ level: number | null; charging: boolean; present: boolean }>("get_battery_status");
        for (const rule of automationRules.filter((candidate) => candidate.enabled && candidate.trigger === "battery")) {
          const matched = battery.present && (rule.batteryMode === "charging"
            ? battery.charging
            : battery.level !== null && (rule.batteryMode === "below" ? battery.level <= rule.batteryLevel : battery.level >= rule.batteryLevel));
          const previouslyMatched = batteryMatchRef.current.get(rule.id) ?? false;
          if (matched && !previouslyMatched) void runAutomation(rule);
          batteryMatchRef.current.set(rule.id, matched);
        }
      } catch {
        // Battery automations retry on the next interval.
      }
    };
    void checkBattery();
    const timer = window.setInterval(() => void checkBattery(), 45_000);
    return () => window.clearInterval(timer);
  }, [automationRules, runAutomation]);

  const value = useMemo<ControlCenterValue>(() => ({
    appGroups,
    automationRules,
    automationRuns,
    canUndoAutomation,
    focusEnabled,
    focusPreferences,
    notifications,
    addNotification,
    setAppGroups,
    setAutomationRules,
    setFocusPreferences,
    toggleFocusMode,
    launchAppGroup,
    runAutomation,
    undoLastAutomation,
    markNotificationsRead: () => setNotifications((current) => current.map((notification) => ({ ...notification, read: true }))),
    clearNotifications: () => setNotifications([]),
  }), [addNotification, appGroups, automationRules, automationRuns, canUndoAutomation, focusEnabled, focusPreferences, launchAppGroup, notifications, runAutomation, toggleFocusMode, undoLastAutomation]);

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
    automationRuns,
    canUndoAutomation,
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
    runAutomation,
    undoLastAutomation,
  } = useControlCenter();
  const { editMode, setEditMode, resetDashboardLayout } = useDashboardCustomization();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<HubSection>("groups");
  const [launchers, setLaunchers] = useState<LauncherOption[]>([]);
  const [layoutProfileOptions, setLayoutProfileOptions] = useState<LayoutProfileOption[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedLaunchers, setSelectedLaunchers] = useState<Set<string>>(new Set());
  const [selectedLayoutProfileId, setSelectedLayoutProfileId] = useState<string | null>(null);
  const [automationView, setAutomationView] = useState<AutomationView>("routines");
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [automationName, setAutomationName] = useState("");
  const [automationTrigger, setAutomationTrigger] = useState<AutomationTrigger>("manual");
  const [automationTime, setAutomationTime] = useState("09:00");
  const [automationDays, setAutomationDays] = useState<number[]>(allWeekdays);
  const [automationFocusRequirement, setAutomationFocusRequirement] = useState<AutomationRule["focusRequirement"]>("any");
  const [automationBatteryMode, setAutomationBatteryMode] = useState<AutomationRule["batteryMode"]>("below");
  const [automationBatteryLevel, setAutomationBatteryLevel] = useState(20);
  const [automationAppName, setAutomationAppName] = useState("");
  const [automationAppState, setAutomationAppState] = useState<AutomationRule["appState"]>("opened");
  const [automationActions, setAutomationActions] = useState<AutomationAction[]>([]);
  const [nextAutomationAction, setNextAutomationAction] = useState<AutomationAction>(() => createAutomationAction());
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

  /** Clears the routine builder without changing saved routines. */
  const resetAutomationBuilder = () => {
    setEditingAutomationId(null);
    setAutomationName("");
    setAutomationTrigger("manual");
    setAutomationTime("09:00");
    setAutomationDays(allWeekdays);
    setAutomationFocusRequirement("any");
    setAutomationBatteryMode("below");
    setAutomationBatteryLevel(20);
    setAutomationAppName("");
    setAutomationAppState("opened");
    setAutomationActions([]);
    setNextAutomationAction(createAutomationAction());
  };

  /** Adds the configured action to the end of the ordered routine. */
  const addAutomationAction = () => {
    if (nextAutomationAction.type === "group" && !nextAutomationAction.groupId) return;
    setAutomationActions((current) => {
      const replaceTypes: AutomationActionType[] = ["theme", "volume", "brightness"];
      const withoutConflicts = current.filter((action) => {
        if (["focus-on", "focus-off"].includes(nextAutomationAction.type)) return !["focus-on", "focus-off"].includes(action.type);
        if (replaceTypes.includes(nextAutomationAction.type)) return action.type !== nextAutomationAction.type;
        return true;
      });
      return [...withoutConflicts, { ...nextAutomationAction, id: crypto.randomUUID() }];
    });
    setNextAutomationAction(createAutomationAction(nextAutomationAction.type));
  };

  /** Moves an action one position while preserving all other step order. */
  const moveAutomationAction = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= automationActions.length) return;
    setAutomationActions((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /** Loads one saved routine into the builder for modification. */
  const editAutomation = (rule: AutomationRule) => {
    setEditingAutomationId(rule.id);
    setAutomationName(rule.name);
    setAutomationTrigger(rule.trigger);
    setAutomationTime(rule.time);
    setAutomationDays(rule.days);
    setAutomationFocusRequirement(rule.focusRequirement);
    setAutomationBatteryMode(rule.batteryMode);
    setAutomationBatteryLevel(rule.batteryLevel);
    setAutomationAppName(rule.appName);
    setAutomationAppState(rule.appState);
    setAutomationActions(rule.actions.map((action) => ({ ...action })));
  };

  /** Creates or updates a routine using the active builder fields. */
  const saveAutomation = () => {
    const name = automationName.trim();
    if (!name || automationActions.length === 0 || (automationTrigger === "app" && !automationAppName.trim()) || (automationTrigger === "time" && automationDays.length === 0)) return;
    const rule: AutomationRule = {
      id: editingAutomationId ?? crypto.randomUUID(),
      name: name.slice(0, 48),
      enabled: true,
      trigger: automationTrigger,
      time: automationTime,
      days: automationDays,
      focusRequirement: automationFocusRequirement,
      batteryMode: automationBatteryMode,
      batteryLevel: automationBatteryLevel,
      appName: automationAppName.trim().slice(0, 80),
      appState: automationAppState,
      actions: automationActions,
    };
    setAutomationRules(editingAutomationId
      ? automationRules.map((candidate) => candidate.id === editingAutomationId ? { ...rule, enabled: candidate.enabled } : candidate)
      : [...automationRules, rule]);
    resetAutomationBuilder();
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
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-stone-100">Routines</h3>
                          <p className="mt-1 text-xs text-stone-600">Connect one trigger to conditions and an ordered set of actions.</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button type="button" onClick={() => void undoLastAutomation()} disabled={!canUndoAutomation} className="flex min-h-10 items-center gap-2 rounded-[9px] px-3 text-[10px] font-semibold text-stone-500 transition hover:bg-white/[0.035] hover:text-stone-200 disabled:opacity-30"><Undo2 size={14} /> Undo last</button>
                          <div className="flex rounded-[9px] border border-black/65 bg-black/20 p-1 shadow-well">
                            <button type="button" onClick={() => setAutomationView("routines")} className={`flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[10px] font-semibold ${automationView === "routines" ? "bg-white/[0.075] text-signal-300" : "text-stone-600 hover:text-stone-300"}`}><Workflow size={13} /> Routines</button>
                            <button type="button" onClick={() => setAutomationView("history")} className={`flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[10px] font-semibold ${automationView === "history" ? "bg-white/[0.075] text-signal-300" : "text-stone-600 hover:text-stone-300"}`}><History size={13} /> History</button>
                          </div>
                        </div>
                      </div>

                      {automationView === "routines" ? (
                        <>
                          <div className="mt-4 space-y-2">
                            {automationRules.length === 0 ? (
                              <div className="grid min-h-32 place-items-center rounded-[13px] border border-dashed border-white/[0.06] text-center">
                                <div><Bot size={23} className="mx-auto text-stone-700" /><p className="mt-2 text-xs text-stone-500">No routines yet</p></div>
                              </div>
                            ) : automationRules.map((rule) => (
                              <article key={rule.id} className="rounded-[13px] border border-black/60 bg-black/20 p-3 shadow-well">
                                <div className="flex items-start gap-3">
                                  <button type="button" onClick={() => setAutomationRules(automationRules.map((candidate) => candidate.id === rule.id ? { ...candidate, enabled: !candidate.enabled } : candidate))} className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition ${rule.enabled ? "border-emerald-700 bg-emerald-950" : "border-black/70 bg-black/30"}`} aria-pressed={rule.enabled} aria-label={`${rule.enabled ? "Pause" : "Enable"} ${rule.name}`}><span className={`absolute top-1 size-4 rounded-full transition ${rule.enabled ? "left-6 bg-emerald-300" : "left-1 bg-stone-700"}`} /></button>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-stone-300">{rule.name}</p>
                                    <p className="mt-1 text-[10px] text-stone-600">{automationTriggerDetail(rule)} · {rule.actions.length} action{rule.actions.length === 1 ? "" : "s"}{rule.focusRequirement === "any" ? "" : ` · focus ${rule.focusRequirement}`}</p>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-0.5">
                                    <button type="button" onClick={() => { closeHub(); void runAutomation(rule, "manual"); }} className="grid size-9 place-items-center rounded-lg text-stone-600 hover:bg-white/[0.04] hover:text-signal-300" aria-label={`Run ${rule.name}`} title="Run now"><Play size={14} /></button>
                                    <button type="button" onClick={() => void runAutomation(rule, "test")} className="grid size-9 place-items-center rounded-lg text-stone-600 hover:bg-white/[0.04] hover:text-stone-300" aria-label={`Test ${rule.name}`} title="Test without changes"><FlaskConical size={14} /></button>
                                    <button type="button" onClick={() => editAutomation(rule)} className="grid size-9 place-items-center rounded-lg text-stone-600 hover:bg-white/[0.04] hover:text-stone-300" aria-label={`Edit ${rule.name}`} title="Edit"><Pencil size={14} /></button>
                                    <button type="button" onClick={() => setAutomationRules(automationRules.filter((candidate) => candidate.id !== rule.id))} className="grid size-9 place-items-center rounded-lg text-stone-700 hover:bg-red-950/20 hover:text-red-300" aria-label={`Delete ${rule.name}`} title="Delete"><Trash2 size={14} /></button>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>

                          <div className="mt-5 rounded-[14px] border border-white/[0.06] bg-black/15 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div><h4 className="text-sm font-semibold text-stone-300">{editingAutomationId ? "Edit routine" : "New routine"}</h4><p className="mt-1 text-[10px] text-stone-700">Actions run from top to bottom.</p></div>
                              {editingAutomationId ? <button type="button" onClick={resetAutomationBuilder} className="min-h-9 rounded-lg px-2 text-[10px] text-stone-600 hover:text-stone-300">Cancel edit</button> : null}
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <label className="sm:col-span-2"><span className="schedule-label">Routine name</span><input value={automationName} onChange={(event) => setAutomationName(event.target.value)} placeholder="Start work" maxLength={48} className="schedule-input" /></label>
                              <label><span className="schedule-label">Trigger</span><select value={automationTrigger} onChange={(event) => setAutomationTrigger(event.target.value as AutomationTrigger)} className="schedule-input">{Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                              <label><span className="schedule-label">Condition</span><select value={automationFocusRequirement} onChange={(event) => setAutomationFocusRequirement(event.target.value as AutomationRule["focusRequirement"])} className="schedule-input"><option value="any">Any Focus Mode state</option><option value="disabled">Only when Focus Mode is off</option><option value="enabled">Only when Focus Mode is on</option></select></label>

                              {automationTrigger === "time" ? (
                                <div className="sm:col-span-2">
                                  <label><span className="schedule-label">Local time</span><input type="time" value={automationTime} onChange={(event) => setAutomationTime(event.target.value)} className="schedule-input max-w-52" /></label>
                                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Scheduled weekdays">{weekdayLabels.map((label, day) => { const selected = automationDays.includes(day); return <button key={label} type="button" onClick={() => setAutomationDays((current) => selected ? current.filter((value) => value !== day) : [...current, day].sort())} className={`min-h-9 rounded-[8px] border px-2.5 text-[10px] font-semibold ${selected ? "border-signal-500/45 bg-white/[0.055] text-signal-300" : "border-black/60 bg-black/20 text-stone-700"}`} aria-pressed={selected}>{label}</button>; })}</div>
                                </div>
                              ) : null}

                              {automationTrigger === "battery" ? <><label><span className="schedule-label">Battery event</span><select value={automationBatteryMode} onChange={(event) => setAutomationBatteryMode(event.target.value as AutomationRule["batteryMode"])} className="schedule-input"><option value="below">Drops to or below</option><option value="above">Rises to or above</option><option value="charging">Starts charging</option></select></label>{automationBatteryMode === "charging" ? <div /> : <label><span className="schedule-label">Level</span><input type="number" min={1} max={100} value={automationBatteryLevel} onChange={(event) => setAutomationBatteryLevel(Math.min(100, Math.max(1, Number(event.target.value))))} className="schedule-input" /></label>}</> : null}

                              {automationTrigger === "app" ? <><label><span className="schedule-label">Application name</span><input value={automationAppName} onChange={(event) => setAutomationAppName(event.target.value)} placeholder="Chrome" className="schedule-input" /></label><label><span className="schedule-label">Change</span><select value={automationAppState} onChange={(event) => setAutomationAppState(event.target.value as AutomationRule["appState"])} className="schedule-input"><option value="opened">Application opens</option><option value="closed">Application closes</option></select></label></> : null}
                            </div>

                            <div className="mt-5">
                              <span className="schedule-label">Ordered actions</span>
                              {automationActions.length === 0 ? <p className="rounded-[10px] border border-dashed border-white/[0.06] px-3 py-4 text-center text-[10px] text-stone-700">Add the first action below.</p> : <ol className="space-y-1.5">{automationActions.map((action, index) => <li key={action.id} className="flex min-h-12 items-center gap-2 rounded-[10px] border border-black/60 bg-black/20 px-2.5"><span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/[0.04] font-mono text-[9px] text-stone-600">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-stone-400">{actionLabels[action.type]}</p>{automationActionDetail(action, appGroups) ? <p className="mt-0.5 truncate text-[9px] text-stone-700">{automationActionDetail(action, appGroups)}</p> : null}</div><button type="button" onClick={() => moveAutomationAction(index, -1)} disabled={index === 0} className="grid size-8 place-items-center text-stone-700 hover:text-stone-300 disabled:opacity-20" aria-label={`Move ${actionLabels[action.type]} up`}><ArrowUp size={13} /></button><button type="button" onClick={() => moveAutomationAction(index, 1)} disabled={index === automationActions.length - 1} className="grid size-8 place-items-center text-stone-700 hover:text-stone-300 disabled:opacity-20" aria-label={`Move ${actionLabels[action.type]} down`}><ArrowDown size={13} /></button><button type="button" onClick={() => setAutomationActions(automationActions.filter((candidate) => candidate.id !== action.id))} className="grid size-8 place-items-center text-stone-700 hover:text-red-300" aria-label={`Remove ${actionLabels[action.type]}`}><X size={13} /></button></li>)}</ol>}

                              <div className="mt-3 grid gap-2 rounded-[11px] border border-white/[0.05] bg-black/15 p-3 sm:grid-cols-[1fr_1fr_auto]">
                                <select value={nextAutomationAction.type} onChange={(event) => setNextAutomationAction(createAutomationAction(event.target.value as AutomationActionType))} className="schedule-input">{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                                {nextAutomationAction.type === "group" ? <select value={nextAutomationAction.groupId ?? ""} onChange={(event) => setNextAutomationAction({ ...nextAutomationAction, groupId: event.target.value || null })} className="schedule-input"><option value="">Choose app group</option>{appGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select> : nextAutomationAction.type === "theme" ? <select value={nextAutomationAction.value} onChange={(event) => setNextAutomationAction({ ...nextAutomationAction, value: event.target.value })} className="schedule-input"><option value="black">Black</option><option value="tan">Tan</option><option value="green">Green</option><option value="blue">Blue</option><option value="white">White</option></select> : ["volume", "brightness"].includes(nextAutomationAction.type) ? <input type="number" min={0} max={100} value={nextAutomationAction.value} onChange={(event) => setNextAutomationAction({ ...nextAutomationAction, value: event.target.value })} className="schedule-input" aria-label={`${actionLabels[nextAutomationAction.type]} percent`} /> : <div className="hidden sm:block" />}
                                <TactileButton onClick={addAutomationAction} disabled={nextAutomationAction.type === "group" && !nextAutomationAction.groupId} className="h-11 px-4"><span className="flex items-center justify-center gap-2 text-[10px] font-semibold"><Plus size={14} /> Add step</span></TactileButton>
                              </div>
                            </div>

                            <TactileButton onClick={saveAutomation} disabled={!automationName.trim() || automationActions.length === 0 || (automationTrigger === "app" && !automationAppName.trim()) || (automationTrigger === "time" && automationDays.length === 0)} className="mt-4 h-11 w-full"><span className="flex items-center justify-center gap-2 text-xs font-semibold">{editingAutomationId ? <Save size={15} /> : <Workflow size={15} />} {editingAutomationId ? "Save routine" : "Create routine"}</span></TactileButton>
                          </div>
                        </>
                      ) : (
                        <div className="mt-4 space-y-2">
                          {automationRuns.length === 0 ? <div className="grid min-h-48 place-items-center rounded-[14px] border border-dashed border-white/[0.06] text-center"><div><History size={25} className="mx-auto text-stone-700" /><p className="mt-2 text-xs text-stone-500">No routine activity yet</p></div></div> : automationRuns.map((run) => (
                            <article key={run.id} className="flex gap-3 rounded-[12px] border border-black/60 bg-black/20 p-3">
                              <span className={`mt-1 grid size-8 shrink-0 place-items-center rounded-[9px] ${run.status === "success" || run.status === "tested" ? "bg-emerald-950/40 text-emerald-300" : run.status === "skipped" ? "bg-black/20 text-stone-600" : "bg-amber-950/30 text-amber-300"}`}>{run.kind === "test" ? <FlaskConical size={14} /> : run.kind === "undo" ? <Undo2 size={14} /> : <Play size={14} />}</span>
                              <div className="min-w-0"><p className="text-xs font-semibold text-stone-300">{run.ruleName}</p><p className="mt-1 text-[11px] leading-relaxed text-stone-600">{run.summary}</p><time className="mt-1.5 block font-mono text-[9px] text-stone-800">{new Date(run.startedAt).toLocaleString()} · {run.kind}</time></div>
                            </article>
                          ))}
                        </div>
                      )}
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
