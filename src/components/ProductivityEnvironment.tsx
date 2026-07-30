import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Bell,
  CalendarRange,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  Command,
  Copy,
  Inbox,
  Layers3,
  ListTodo,
  Orbit,
  PanelTop,
  Pause,
  Pin,
  Play,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import {
  PRODUCTIVITY_STORAGE_KEY,
  TRACKER_UPDATED_EVENT,
  addTrackerTask,
  localDateKey,
  localId,
  localTimeKey,
  readTrackerData,
  restoreProductivityData,
  setTrackerTaskCompleted,
  type CaptureKind,
  type ControlPanelExtension,
  type EnvironmentCommand,
  type MeetingItem,
  type ProductivityData,
  type ProjectScene,
  type ShelfItem,
  type TimelineBlock,
  type TrackerTask,
} from "../lib/productivity";
import { useControlCenter } from "./ControlCenter";
import { AudioReactiveFocusBackdrop } from "./AudioReactiveFocusBackdrop";
import { useDashboardCustomization, type DashboardTheme } from "./DashboardCustomization";

type EnvironmentView = "today" | "scenes" | "capture" | "meetings" | "sessions" | "extensions" | "attention";
type CommandItem = EnvironmentCommand & { group: string };

const views: Array<{ id: EnvironmentView; label: string; icon: typeof Orbit }> = [
  { id: "today", label: "Today", icon: CalendarRange },
  { id: "scenes", label: "Scenes", icon: Layers3 },
  { id: "capture", label: "Capture", icon: Inbox },
  { id: "meetings", label: "Meetings", icon: Video },
  { id: "sessions", label: "Sessions", icon: Timer },
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "attention", label: "Attention", icon: Bell },
];

const builtInExtensions: ControlPanelExtension[] = [
  { id: "core.capture", name: "Capture inbox", description: "Quick notes, tasks, links, and shelf filing.", version: "1.0.0" },
  { id: "core.clipboard", name: "Clipboard tools", description: "On-demand clipboard capture and local text transformations.", version: "1.0.0" },
  { id: "core.meetings", name: "Meeting cockpit", description: "Agendas, preparation checks, room links, and notes.", version: "1.0.0" },
];

function nextRoundedTime(minutesAhead = 0) {
  const date = new Date(Date.now() + minutesAhead * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return date;
}

function datetimeLocalValue(date: Date) {
  return `${localDateKey(date)}T${localTimeKey(date)}`;
}

function addMinutesToTime(value: string, minutes: number) {
  const [hours, minute] = value.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, hours * 60 + minute + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unscheduled" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unscheduled" : new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function safeWebUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function editableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function setDataWith(data: ProductivityData, patch: Partial<ProductivityData>): ProductivityData {
  return { ...data, ...patch };
}

function EmptyState({ children }: { children: string }) {
  return <p className="environment-empty">{children}</p>;
}

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="environment-section-heading">
      <div><p>{eyebrow}</p><h3>{title}</h3></div>
      {action}
    </div>
  );
}

/** A single lightweight shell for command search, project scenes, daily flow, capture, and session state. */
export function ProductivityEnvironment() {
  const initial = useMemo(restoreProductivityData, []);
  const [data, setData] = useState<ProductivityData>(initial);
  const [trackerTasks, setTrackerTasks] = useState<TrackerTask[]>(() => readTrackerData().tasks);
  const [hubOpen, setHubOpen] = useState(false);
  const [view, setView] = useState<EnvironmentView>("today");
  const [commandOpen, setCommandOpen] = useState(false);
  const [nowOpen, setNowOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [captureKind, setCaptureKind] = useState<CaptureKind>("note");
  const [sceneName, setSceneName] = useState("");
  const [sceneIntention, setSceneIntention] = useState("");
  const [sceneGroup, setSceneGroup] = useState("");
  const [sceneTheme, setSceneTheme] = useState<DashboardTheme>("black");
  const [sceneDuration, setSceneDuration] = useState(50);
  const [sceneResources, setSceneResources] = useState("");
  const [blockTitle, setBlockTitle] = useState("");
  const [blockStart, setBlockStart] = useState(() => localTimeKey(nextRoundedTime()));
  const [blockEnd, setBlockEnd] = useState(() => localTimeKey(nextRoundedTime(45)));
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingStart, setMeetingStart] = useState(() => datetimeLocalValue(nextRoundedTime(60)));
  const [meetingLink, setMeetingLink] = useState("");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(initial.meetings[0]?.id ?? null);
  const [checklistText, setChecklistText] = useState("");
  const [tomorrowMove, setTomorrowMove] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [registeredExtensions, setRegisteredExtensions] = useState<ControlPanelExtension[]>([]);
  const extensionMapRef = useRef(new Map<string, ControlPanelExtension>());
  const commandInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useDashboardCustomization();
  const {
    appGroups,
    focusEnabled,
    notifications,
    addNotification,
    launchAppGroup,
    markNotificationsRead,
    toggleFocusMode,
  } = useControlCenter();

  const updateData = useCallback((updater: (current: ProductivityData) => ProductivityData) => {
    setData((current) => updater(current));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(PRODUCTIVITY_STORAGE_KEY, JSON.stringify(data)); } catch {
        setFeedback("Changes are available for this session but local storage is unavailable.");
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    const refreshTasks = () => setTrackerTasks(readTrackerData().tasks);
    window.addEventListener(TRACKER_UPDATED_EVENT, refreshTasks);
    window.addEventListener("storage", refreshTasks);
    return () => {
      window.removeEventListener(TRACKER_UPDATED_EVENT, refreshTasks);
      window.removeEventListener("storage", refreshTasks);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setRegisteredExtensions(Array.from(extensionMapRef.current.values()));
    window.controlPanelExtensions = {
      register: (extension) => {
        if (!extension?.id || !extension.name || !extension.version) return () => undefined;
        extensionMapRef.current.set(extension.id, extension);
        refresh();
        return () => {
          extensionMapRef.current.delete(extension.id);
          refresh();
        };
      },
      list: () => Array.from(extensionMapRef.current.values()),
    };
    return () => { delete window.controlPanelExtensions; };
  }, []);

  useEffect(() => {
    const tickRate = data.activeSession && !data.activeSession.pausedAt
      ? 1_000
      : data.meetings.length
        ? 30_000
        : null;
    if (!tickRate) return;
    const timer = window.setInterval(() => setClock(Date.now()), tickRate);
    return () => window.clearInterval(timer);
  }, [data.activeSession, data.meetings.length]);

  const openHub = useCallback((nextView: EnvironmentView) => {
    setView(nextView);
    setHubOpen(true);
    setCommandOpen(false);
  }, []);

  useEffect(() => {
    const handleKeys = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (commandOpen) setCommandOpen(false);
        else if (nowOpen) setNowOpen(false);
        else if (hubOpen) setHubOpen(false);
        return;
      }
      if (editableTarget(event.target)) return;
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        setHubOpen(false);
        window.setTimeout(() => commandInputRef.current?.focus(), 50);
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        openHub("capture");
        window.setTimeout(() => captureInputRef.current?.focus(), 70);
      }
    };
    document.addEventListener("keydown", handleKeys, true);
    return () => document.removeEventListener("keydown", handleKeys, true);
  }, [commandOpen, hubOpen, nowOpen, openHub]);

  const addCapture = useCallback((text: string, kind: CaptureKind = "note") => {
    const clean = text.trim();
    if (!clean) return;
    updateData((current) => setDataWith(current, {
      captures: [{ id: localId("capture"), kind, text: clean.slice(0, 2_000), createdAt: new Date().toISOString(), state: "inbox" as const }, ...current.captures].slice(0, 120),
    }));
    setCaptureText("");
    setFeedback("Saved to the capture inbox.");
  }, [updateData]);

  const addShelfItem = useCallback((text: string, source: ShelfItem["source"] = "manual") => {
    const clean = text.trim();
    if (!clean) return;
    updateData((current) => setDataWith(current, {
      shelf: [{ id: localId("shelf"), text: clean.slice(0, 10_000), source, createdAt: new Date().toISOString(), pinned: false }, ...current.shelf].slice(0, 60),
    }));
  }, [updateData]);

  const startSession = useCallback((title: string, intention: string, minutes: number, sceneId: string | null = null) => {
    const now = new Date();
    const totalSeconds = Math.max(5 * 60, Math.round(minutes * 60));
    updateData((current) => setDataWith(current, {
      activeSession: {
        id: localId("session"), sceneId, title, intention, startedAt: now.toISOString(),
        endsAt: new Date(now.getTime() + totalSeconds * 1_000).toISOString(), pausedAt: null,
        remainingSeconds: totalSeconds, totalSeconds,
      },
    }));
    setClock(Date.now());
    setNowOpen(true);
  }, [updateData]);

  const finishSession = useCallback((summary = "Session completed from Now mode.") => {
    const session = data.activeSession;
    if (!session) return;
    const minutes = Math.max(1, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60_000));
    updateData((current) => setDataWith(current, {
      activeSession: null,
      sessionHistory: [{
        id: localId("history"), sceneId: session.sceneId, title: session.title,
        startedAt: session.startedAt, completedAt: new Date().toISOString(), minutes, summary,
      }, ...current.sessionHistory].slice(0, 120),
    }));
    addNotification(session.title, `${minutes} minute session recorded.`, "success");
    setNowOpen(false);
  }, [addNotification, data.activeSession, updateData]);

  const pauseSession = () => {
    const session = data.activeSession;
    if (!session || session.pausedAt) return;
    const remainingSeconds = Math.max(0, Math.round((new Date(session.endsAt).getTime() - Date.now()) / 1_000));
    updateData((current) => setDataWith(current, { activeSession: { ...session, pausedAt: new Date().toISOString(), remainingSeconds } }));
  };

  const resumeSession = () => {
    const session = data.activeSession;
    if (!session?.pausedAt) return;
    updateData((current) => setDataWith(current, {
      activeSession: { ...session, pausedAt: null, endsAt: new Date(Date.now() + session.remainingSeconds * 1_000).toISOString() },
    }));
  };

  const runScene = useCallback(async (scene: ProjectScene) => {
    try {
      setTheme(scene.theme);
      if (scene.focus !== focusEnabled) toggleFocusMode(scene.focus);
      const group = appGroups.find((candidate) => candidate.id === scene.appGroupId);
      if (group) launchAppGroup(group);
      if (isTauriRuntime() && scene.volume !== null) await invoke("set_system_volume", { level: scene.volume });
      if (isTauriRuntime() && scene.brightness !== null) await invoke("set_system_brightness", { level: scene.brightness });
      for (const resource of scene.resourceUrls.slice(0, 4)) {
        const url = safeWebUrl(resource);
        if (url) await openExternal(url);
      }
      startSession(scene.name, scene.intention, scene.durationMinutes, scene.id);
      addNotification(scene.name, "Project scene started and Now mode is ready.", "success");
    } catch (error) {
      setFeedback(errorMessage(error));
    }
  }, [addNotification, appGroups, focusEnabled, launchAppGroup, setTheme, startSession, toggleFocusMode]);

  useEffect(() => {
    const captureFromPhone = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (text) addCapture(text, "note");
    };
    const sceneFromPhone = (event: Event) => {
      const sceneId = (event as CustomEvent<{ sceneId?: string }>).detail?.sceneId;
      const scene = data.scenes.find((candidate) => candidate.id === sceneId);
      if (scene) void runScene(scene);
    };
    window.addEventListener("control-panel:productivity-capture", captureFromPhone);
    window.addEventListener("control-panel:productivity-scene", sceneFromPhone);
    return () => {
      window.removeEventListener("control-panel:productivity-capture", captureFromPhone);
      window.removeEventListener("control-panel:productivity-scene", sceneFromPhone);
    };
  }, [addCapture, data.scenes, runScene]);

  const saveScene = (capturedApps: string[] = [], nameOverride?: string, themeOverride?: DashboardTheme) => {
    const name = (nameOverride ?? sceneName).trim();
    if (!name) return;
    const requestedDuration = Number.isFinite(sceneDuration) ? sceneDuration : 50;
    const scene: ProjectScene = {
      id: localId("scene"), name: name.slice(0, 64), intention: sceneIntention.trim().slice(0, 240),
      appGroupId: sceneGroup || null, theme: themeOverride ?? sceneTheme, durationMinutes: Math.min(240, Math.max(5, requestedDuration)),
      focus: true, volume: null, brightness: null,
      resourceUrls: sceneResources.split(/\r?\n|,/).map((value) => value.trim()).filter((value) => safeWebUrl(value)).slice(0, 8),
      capturedApps: capturedApps.slice(0, 30), createdAt: new Date().toISOString(),
    };
    updateData((current) => setDataWith(current, { scenes: [scene, ...current.scenes].slice(0, 30) }));
    setSceneName("");
    setSceneIntention("");
    setSceneResources("");
    setFeedback("Scene saved.");
  };

  const captureCurrentScene = async () => {
    let capturedApps: string[] = [];
    if (isTauriRuntime()) {
      try {
        const workspace = await invoke<{ windows: Array<{ name: string; protected: boolean }> }>("get_window_workspace");
        capturedApps = Array.from(new Set(workspace.windows.filter((item) => !item.protected).map((item) => item.name)));
      } catch (error) {
        setFeedback(errorMessage(error));
      }
    }
    const capturedName = sceneName.trim() || `Captured setup · ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date())}`;
    saveScene(capturedApps, capturedName, theme);
  };

  const addTimelineBlock = (title: string, start: string, end: string, kind: TimelineBlock["kind"] = "focus", taskId: string | null = null) => {
    if (!title.trim() || end <= start) {
      setFeedback("Add a title and an end time after the start time.");
      return;
    }
    updateData((current) => setDataWith(current, {
      timeline: [{ id: localId("block"), title: title.trim().slice(0, 160), date: localDateKey(), start, end, kind, taskId, completed: false }, ...current.timeline].slice(0, 240),
    }));
    setBlockTitle("");
    setFeedback("Added to today's timeline.");
  };

  const planTaskNext = (task: TrackerTask) => {
    const todayBlocks = data.timeline.filter((block) => block.date === localDateKey()).sort((a, b) => a.end.localeCompare(b.end));
    const base = localTimeKey(nextRoundedTime());
    const start = todayBlocks.reduce((latest, block) => block.end > latest ? block.end : latest, base);
    addTimelineBlock(task.title, start, addMinutesToTime(start, 45), "task", task.id);
  };

  const addMeeting = (event: FormEvent) => {
    event.preventDefault();
    if (!meetingTitle.trim() || !meetingStart) return;
    const meeting: MeetingItem = {
      id: localId("meeting"), title: meetingTitle.trim().slice(0, 140), startsAt: new Date(meetingStart).toISOString(),
      durationMinutes: 30, link: safeWebUrl(meetingLink) ?? "", agenda: "", notes: "", checklist: [],
    };
    updateData((current) => setDataWith(current, { meetings: [meeting, ...current.meetings].slice(0, 120) }));
    setSelectedMeetingId(meeting.id);
    setMeetingTitle("");
    setMeetingLink("");
    setMeetingStart(datetimeLocalValue(nextRoundedTime(60)));
  };

  const updateMeeting = (meetingId: string, patch: Partial<MeetingItem>) => {
    updateData((current) => setDataWith(current, {
      meetings: current.meetings.map((meeting) => meeting.id === meetingId ? { ...meeting, ...patch } : meeting),
    }));
  };

  const startMeeting = async (meeting: MeetingItem) => {
    if (meeting.link) {
      try { await openExternal(meeting.link); } catch (error) { setFeedback(errorMessage(error)); }
    }
    if (!focusEnabled) toggleFocusMode(true);
    startSession(meeting.title, meeting.agenda || "Stay present and capture the decisions that matter.", meeting.durationMinutes, null);
  };

  const captureClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("The clipboard does not contain text.");
      addShelfItem(text, "clipboard");
      setFeedback("Clipboard text added to the working shelf.");
    } catch (error) {
      setFeedback(`Clipboard read failed: ${errorMessage(error)}`);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Copied to the clipboard.");
    } catch (error) {
      setFeedback(`Copy failed: ${errorMessage(error)}`);
    }
  };

  const transformShelfItem = (item: ShelfItem, transform: "clean" | "bullets" | "markdown") => {
    const next = transform === "clean"
      ? item.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
      : transform === "bullets"
        ? item.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => `- ${line.replace(/^[-*]\s*/, "")}`).join("\n")
        : `\`\`\`text\n${item.text.trim()}\n\`\`\``;
    updateData((current) => setDataWith(current, { shelf: current.shelf.map((candidate) => candidate.id === item.id ? { ...candidate, text: next } : candidate) }));
  };

  const extensionEnabled = (extensionId: string) => data.extensions.find((item) => item.id === extensionId)?.enabled !== false;
  const toggleExtension = (extensionId: string) => {
    updateData((current) => setDataWith(current, {
      extensions: [...current.extensions.filter((item) => item.id !== extensionId), { id: extensionId, enabled: !extensionEnabled(extensionId) }],
    }));
  };

  const attentionItems = useMemo(() => {
    const today = localDateKey();
    const overdue = trackerTasks.filter((task) => !task.completed && task.dueDate && task.dueDate < today);
    const inboxCount = data.captures.filter((capture) => capture.state === "inbox").length;
    const upcoming = data.meetings.filter((meeting) => {
      const delta = new Date(meeting.startsAt).getTime() - clock;
      return delta >= 0 && delta <= 30 * 60_000;
    });
    return [
      ...overdue.map((task) => ({ id: `task-${task.id}`, title: "Overdue task", detail: task.title, view: "today" as EnvironmentView })),
      ...(inboxCount ? [{ id: "captures", title: `${inboxCount} capture${inboxCount === 1 ? "" : "s"} to file`, detail: "Clear the capture inbox when you have a natural pause.", view: "capture" as EnvironmentView }] : []),
      ...upcoming.map((meeting) => ({ id: `meeting-${meeting.id}`, title: "Meeting starts soon", detail: meeting.title, view: "meetings" as EnvironmentView })),
      ...notifications.filter((item) => !item.read).slice(0, 6).map((item) => ({ id: `notification-${item.id}`, title: item.title, detail: item.message, view: "attention" as EnvironmentView })),
    ].slice(0, 18);
  }, [clock, data.captures, data.meetings, notifications, trackerTasks]);

  const selectedMeeting = data.meetings.find((meeting) => meeting.id === selectedMeetingId) ?? data.meetings[0] ?? null;
  const today = localDateKey();
  const todayBlocks = data.timeline.filter((block) => block.date === today).sort((a, b) => a.start.localeCompare(b.start));
  const todayMeetings = data.meetings.filter((meeting) => localDateKey(new Date(meeting.startsAt)) === today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const openTasks = trackerTasks.filter((task) => !task.completed).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const plannedTaskIds = new Set(data.timeline.filter((block) => !block.completed && block.taskId).map((block) => block.taskId));

  const allExtensions = [...builtInExtensions, ...registeredExtensions.filter((extension) => !builtInExtensions.some((item) => item.id === extension.id))];

  const commandItems: CommandItem[] = [
    { id: "environment", label: "Open productivity environment", detail: "Today, scenes, capture, meetings, and sessions", group: "Control Panel", keywords: ["dashboard", "today"], run: () => openHub("today") },
    { id: "capture", label: "Quick capture", detail: "Save a thought without leaving your flow", group: "Control Panel", keywords: ["note", "inbox"], run: () => openHub("capture") },
    { id: "focus", label: focusEnabled ? "End Focus Mode" : "Start Focus Mode", detail: "Apply the current focus preferences", group: "Control Panel", keywords: ["do not disturb", "pomodoro"], run: () => toggleFocusMode() },
    ...appGroups.map((group) => ({ id: `group-${group.id}`, label: `Launch ${group.name}`, detail: `${group.launcherIds.length} app shortcuts`, group: "App groups", keywords: ["workspace", "apps"], run: () => launchAppGroup(group) })),
    ...data.scenes.map((scene) => ({ id: `scene-${scene.id}`, label: `Start ${scene.name}`, detail: scene.intention || `${scene.durationMinutes} minute project scene`, group: "Scenes", keywords: ["project", "now"], run: () => runScene(scene) })),
    ...allExtensions.filter((extension) => extensionEnabled(extension.id)).flatMap((extension) => (extension.commands ?? []).map((command) => ({ ...command, group: extension.name }))),
    ...Array.from(document.querySelectorAll<HTMLButtonElement>("[data-shortcut-label]"))
      .filter((button) => !["control:environment", "control:command-bar"].includes(button.dataset.shortcutId ?? ""))
      .filter((button, index, buttons) => buttons.findIndex((candidate) => candidate.dataset.shortcutId === button.dataset.shortcutId) === index)
      .map((button) => ({
        id: `dom-${button.dataset.shortcutId ?? button.dataset.shortcutLabel}`,
        label: button.dataset.shortcutLabel ?? "Dashboard action",
        detail: button.dataset.shortcutDetail ?? "",
        group: button.dataset.shortcutGroup ?? "Dashboard",
        keywords: [button.dataset.shortcutId ?? ""],
        run: () => button.click(),
      })),
  ];

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = commandItems.filter((command, index, entries) => {
    if (entries.findIndex((candidate) => candidate.id === command.id) !== index) return false;
    if (!normalizedQuery) return true;
    const haystack = [command.label, command.detail, command.group, ...(command.keywords ?? [])].join(" ").toLowerCase();
    return normalizedQuery.split(/\s+/).every((term) => haystack.includes(term));
  }).slice(0, 14);

  const runCommand = async (command?: CommandItem) => {
    if (!command) {
      if (query.trim()) addCapture(query, "note");
      setCommandOpen(false);
      setQuery("");
      return;
    }
    try { await command.run(); } catch (error) { setFeedback(errorMessage(error)); }
    setCommandOpen(false);
    setQuery("");
  };

  const session = data.activeSession;
  const remainingSeconds = session
    ? session.pausedAt ? session.remainingSeconds : Math.max(0, Math.round((new Date(session.endsAt).getTime() - clock) / 1_000))
    : 0;
  const totalSeconds = session?.totalSeconds ?? Math.max(session?.remainingSeconds ?? 1, 1);
  const progress = session ? Math.min(100, Math.max(0, ((totalSeconds - remainingSeconds) / totalSeconds) * 100)) : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="header-icon-button relative grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-graphite-800 text-stone-500 shadow-skeuo-raised transition hover:text-signal-300 active:translate-y-px active:shadow-skeuo-pressed"
        aria-label="Open command bar"
        title="Command bar · Ctrl+K"
        data-shortcut-combo="Control+Alt+KeyK"
        data-shortcut-id="control:command-bar"
        data-shortcut-label="Open command bar"
        data-shortcut-detail="Search every Control Panel action"
        data-shortcut-group="Control Panel"
      >
        <Command size={15} strokeWidth={1.65} />
      </button>
      <button
        type="button"
        onClick={() => session ? setNowOpen(true) : openHub("today")}
        className="header-control-button relative grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-graphite-800 text-stone-400 shadow-skeuo-raised transition hover:text-stone-100 active:translate-y-px active:shadow-skeuo-pressed"
        aria-label={session ? "Open Now mode" : "Open productivity environment"}
        title={session ? `${Math.floor(remainingSeconds / 60)} minutes remaining` : "Productivity environment"}
        data-shortcut-combo="Control+Alt+KeyE"
        data-shortcut-id="control:environment"
        data-shortcut-label="Open productivity environment"
        data-shortcut-detail="Today, project scenes, capture, meetings, and sessions"
        data-shortcut-group="Control Panel"
      >
        {session ? <Timer size={14} className="text-signal-300" /> : <Orbit size={14} />}
        {attentionItems.length > 0 ? <span className="environment-badge">{Math.min(9, attentionItems.length)}</span> : null}
      </button>

      <div className="hidden" aria-hidden="true">
        {views.map(({ id, label }) => (
          <button key={id} type="button" tabIndex={-1} data-speech-id={`environment:view:${id}`} data-speech-label={`Open ${label}`} data-speech-phrase={id === "today" ? "today timeline" : id === "scenes" ? "project scenes" : id === "capture" ? "quick capture" : id === "attention" ? "attention center" : id} onClick={() => openHub(id)} />
        ))}
        {data.scenes.map((scene) => (
          <button key={scene.id} type="button" tabIndex={-1} data-speech-id={`environment:scene:${scene.id}`} data-speech-label={`Start ${scene.name}`} data-speech-phrase={`start ${scene.name}`} onClick={() => void runScene(scene)} />
        ))}
      </div>

      <AnimatePresence>
        {commandOpen ? (
          <motion.div className="environment-overlay items-start pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && setCommandOpen(false)}>
            <motion.section className="command-palette" role="dialog" aria-modal="true" aria-label="Command bar" initial={{ opacity: 0, y: -12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .99 }} transition={{ duration: .18 }}>
              <div className="command-input-row">
                <Search size={18} />
                <input ref={commandInputRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void runCommand(filteredCommands[0]); }
                }} placeholder="Search apps, scenes, tasks, settings…" aria-label="Search commands" />
                <kbd>Esc</kbd>
              </div>
              <div className="command-results">
                {filteredCommands.map((command, index) => (
                  <button key={command.id} type="button" className={index === 0 ? "selected" : ""} onClick={() => void runCommand(command)}>
                    <span><strong>{command.label}</strong><small>{command.detail}</small></span>
                    <em>{command.group}</em>
                  </button>
                ))}
                {filteredCommands.length === 0 ? (
                  <button type="button" className="selected" onClick={() => void runCommand()}>
                    <span><strong>Capture “{query.trim()}”</strong><small>Save this text to the inbox</small></span><em>Capture</em>
                  </button>
                ) : null}
              </div>
              <footer><span><kbd>Ctrl</kbd><kbd>K</kbd> anywhere</span><span>Type any thought to capture it</span></footer>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {hubOpen ? (
          <motion.div className="environment-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.section className="environment-shell" role="dialog" aria-modal="true" aria-labelledby="environment-title" initial={{ opacity: 0, y: 18, scale: .992 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .995 }} transition={{ duration: .2 }}>
              <header className="environment-header">
                <div><p>Control Panel</p><h2 id="environment-title">Productivity environment</h2></div>
                <div className="flex items-center gap-2">
                  <button type="button" className="environment-quiet-button" onClick={() => { setHubOpen(false); setCommandOpen(true); }}>Command bar <kbd>Ctrl K</kbd></button>
                  <button type="button" className="environment-close" onClick={() => setHubOpen(false)} aria-label="Close productivity environment"><X size={18} /></button>
                </div>
              </header>
              <nav className="environment-tabs" aria-label="Productivity environment sections">
                {views.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" onClick={() => setView(id)} className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined}>
                    <Icon size={14} /><span>{label}</span>{id === "attention" && attentionItems.length ? <b>{attentionItems.length}</b> : null}
                  </button>
                ))}
              </nav>
              <div className="environment-content">
                {feedback ? <div className="environment-feedback"><span>{feedback}</span><button type="button" onClick={() => setFeedback("")} aria-label="Dismiss message"><X size={13} /></button></div> : null}

                {view === "today" ? (
                  <div className="environment-grid environment-grid-today">
                    <section className="environment-panel environment-span-2">
                      <SectionHeading eyebrow={new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date())} title="Today timeline" action={<button type="button" className="environment-text-button" onClick={() => session ? setNowOpen(true) : startSession("Open focus", "Choose one useful outcome and protect it.", 50)}>{session ? "Return to Now" : "Start open focus"} <Play size={12} /></button>} />
                      <form className="timeline-quick-add" onSubmit={(event) => { event.preventDefault(); addTimelineBlock(blockTitle, blockStart, blockEnd); }}>
                        <input value={blockTitle} onChange={(event) => setBlockTitle(event.target.value)} placeholder="Add a focus block" maxLength={160} />
                        <input type="time" value={blockStart} onChange={(event) => setBlockStart(event.target.value)} aria-label="Start time" />
                        <input type="time" value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} aria-label="End time" />
                        <button type="submit" aria-label="Add timeline block"><Plus size={15} /></button>
                      </form>
                      <div className="timeline-list">
                        {[...todayBlocks.map((block) => ({ type: "block" as const, time: block.start, item: block })), ...todayMeetings.map((meeting) => ({ type: "meeting" as const, time: localTimeKey(new Date(meeting.startsAt)), item: meeting }))]
                          .sort((a, b) => a.time.localeCompare(b.time)).map((entry) => entry.type === "block" ? (
                            <article key={entry.item.id} className={`timeline-entry ${entry.item.completed ? "completed" : ""}`}>
                              <time>{entry.item.start}</time><span className={`timeline-kind ${entry.item.kind}`} />
                              <div><strong>{entry.item.title}</strong><small>{entry.item.start}–{entry.item.end} · {entry.item.kind}</small></div>
                              <button type="button" onClick={() => {
                                updateData((current) => setDataWith(current, { timeline: current.timeline.map((block) => block.id === entry.item.id ? { ...block, completed: !block.completed } : block) }));
                                if (entry.item.taskId) setTrackerTaskCompleted(entry.item.taskId, !entry.item.completed);
                              }} aria-label={entry.item.completed ? "Reopen block" : "Complete block"}><Check size={14} /></button>
                            </article>
                          ) : (
                            <button key={entry.item.id} type="button" className="timeline-entry meeting" onClick={() => { setSelectedMeetingId(entry.item.id); setView("meetings"); }}>
                              <time>{formatTime(entry.item.startsAt)}</time><span className="timeline-kind meeting" />
                              <div><strong>{entry.item.title}</strong><small>Meeting · {entry.item.durationMinutes} min</small></div><ChevronRight size={14} />
                            </button>
                          ))}
                        {todayBlocks.length === 0 && todayMeetings.length === 0 ? <EmptyState>Your day is open. Add one meaningful block rather than filling every minute.</EmptyState> : null}
                      </div>
                    </section>
                    <section className="environment-panel">
                      <SectionHeading eyebrow={`${openTasks.length} open`} title="Unscheduled tasks" action={<button type="button" className="environment-icon-text" onClick={() => document.querySelector<HTMLButtonElement>("[data-shortcut-id='control:tasks-habits']")?.click()}><ListTodo size={13} /> All tasks</button>} />
                      <div className="environment-list compact">
                        {openTasks.slice(0, 8).map((task) => (
                          <article key={task.id}><div><strong>{task.title}</strong><small>{task.dueDate ? `Due ${task.dueDate}` : "No due date"}</small></div><button type="button" onClick={() => planTaskNext(task)} disabled={plannedTaskIds.has(task.id)}>{plannedTaskIds.has(task.id) ? "Planned" : "Plan next"}</button></article>
                        ))}
                        {openTasks.length === 0 ? <EmptyState>No open tasks. Use quick capture when something appears.</EmptyState> : null}
                      </div>
                    </section>
                    <section className="environment-panel">
                      <SectionHeading eyebrow="Current state" title={session ? session.title : "No active session"} />
                      {session ? <div className="session-mini"><div style={{ width: `${progress}%` }} /><p>{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")} remaining</p><button type="button" onClick={() => setNowOpen(true)}>Open Now mode</button></div> : <button type="button" className="environment-primary wide" onClick={() => startSession("Open focus", "Choose one useful outcome and protect it.", 50)}><Play size={14} /> Start 50 minutes</button>}
                    </section>
                  </div>
                ) : null}

                {view === "scenes" ? (
                  <div className="environment-grid environment-grid-scenes">
                    <section className="environment-panel">
                      <SectionHeading eyebrow="Compose" title="New project scene" />
                      <div className="environment-form">
                        <label><span>Name</span><input value={sceneName} onChange={(event) => setSceneName(event.target.value)} placeholder="Writing sprint" maxLength={64} /></label>
                        <label><span>Intention</span><textarea value={sceneIntention} onChange={(event) => setSceneIntention(event.target.value)} placeholder="Finish the first draft without polishing." maxLength={240} /></label>
                        <div className="environment-form-row">
                          <label><span>App group</span><select value={sceneGroup} onChange={(event) => setSceneGroup(event.target.value)}><option value="">None</option>{appGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                          <label><span>Theme</span><select value={sceneTheme} onChange={(event) => setSceneTheme(event.target.value as DashboardTheme)}>{["black", "tan", "green", "blue", "white"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                          <label><span>Minutes</span><input type="number" min="5" max="240" value={sceneDuration} onChange={(event) => setSceneDuration(Number(event.target.value))} /></label>
                        </div>
                        <label><span>Resource URLs · one per line</span><textarea value={sceneResources} onChange={(event) => setSceneResources(event.target.value)} placeholder="https://docs.example.com/project" /></label>
                        <div className="environment-actions"><button type="button" className="environment-primary" onClick={() => saveScene()} disabled={!sceneName.trim()}><Plus size={14} /> Save scene</button><button type="button" className="environment-secondary" onClick={() => void captureCurrentScene()}><PanelTop size={14} /> Capture current setup</button></div>
                      </div>
                    </section>
                    <section className="environment-panel environment-span-2">
                      <SectionHeading eyebrow={`${data.scenes.length} saved`} title="Project scenes" />
                      <div className="scene-grid">
                        {data.scenes.map((scene) => (
                          <article key={scene.id} className="scene-card">
                            <div className="scene-card-top"><span>{scene.theme}</span><button type="button" onClick={() => updateData((current) => setDataWith(current, { scenes: current.scenes.filter((item) => item.id !== scene.id) }))} aria-label={`Delete ${scene.name}`}><Trash2 size={13} /></button></div>
                            <h4>{scene.name}</h4><p>{scene.intention || "Enter this scene with one clear outcome."}</p>
                            <div className="scene-meta"><span><Clock3 size={12} /> {scene.durationMinutes}m</span><span><Layers3 size={12} /> {appGroups.find((group) => group.id === scene.appGroupId)?.name ?? "No app group"}</span></div>
                            {scene.capturedApps.length ? <small>Captured: {scene.capturedApps.slice(0, 4).join(", ")}</small> : null}
                            <button type="button" className="environment-primary wide" onClick={() => void runScene(scene)}><Play size={14} /> Enter scene</button>
                          </article>
                        ))}
                        {data.scenes.length === 0 ? <EmptyState>Build a scene around a kind of work, then enter it with one action.</EmptyState> : null}
                      </div>
                    </section>
                  </div>
                ) : null}

                {view === "capture" ? (
                  <div className="environment-grid environment-grid-capture">
                    <section className="environment-panel environment-span-2">
                      <SectionHeading eyebrow="Ctrl Shift C" title="Capture without sorting" />
                      <form className="capture-composer" onSubmit={(event) => { event.preventDefault(); addCapture(captureText, captureKind); }}>
                        <input ref={captureInputRef} value={captureText} onChange={(event) => setCaptureText(event.target.value)} placeholder="Write the thought before it disappears…" maxLength={2_000} />
                        <select value={captureKind} onChange={(event) => setCaptureKind(event.target.value as CaptureKind)} aria-label="Capture type"><option value="note">Note</option><option value="task">Task</option><option value="link">Link</option></select>
                        <button type="submit" className="environment-primary" disabled={!captureText.trim()}><Plus size={14} /> Capture</button>
                      </form>
                      <div className="capture-list">
                        {data.captures.filter((item) => item.state === "inbox").map((item) => (
                          <article key={item.id}><span>{item.kind}</span><p>{item.text}</p><div>
                            {item.kind === "task" ? <button type="button" onClick={() => { addTrackerTask(item.text); updateData((current) => setDataWith(current, { captures: current.captures.map((capture) => capture.id === item.id ? { ...capture, state: "filed" } : capture) })); }}>To tasks</button> : null}
                            <button type="button" onClick={() => { addShelfItem(item.text, "capture"); updateData((current) => setDataWith(current, { captures: current.captures.map((capture) => capture.id === item.id ? { ...capture, state: "filed" } : capture) })); }}>To shelf</button>
                            <button type="button" onClick={() => updateData((current) => setDataWith(current, { captures: current.captures.map((capture) => capture.id === item.id ? { ...capture, state: "filed" } : capture) }))}>Archive</button>
                          </div></article>
                        ))}
                        {data.captures.every((item) => item.state !== "inbox") ? <EmptyState>The inbox is clear. Capture first and organize later.</EmptyState> : null}
                      </div>
                    </section>
                    <section className="environment-panel">
                      <SectionHeading eyebrow={`${data.shelf.length} items`} title="Working shelf" action={<button type="button" className="environment-icon-text" onClick={() => void captureClipboard()}><Clipboard size={13} /> Add clipboard</button>} />
                      <div className="shelf-list">
                        {data.shelf.map((item) => (
                          <article key={item.id}><div className="shelf-head"><span>{item.source}</span><button type="button" onClick={() => updateData((current) => setDataWith(current, { shelf: current.shelf.map((candidate) => candidate.id === item.id ? { ...candidate, pinned: !candidate.pinned } : candidate) }))} className={item.pinned ? "active" : ""} aria-label={item.pinned ? "Unpin item" : "Pin item"}><Pin size={12} /></button></div><pre>{item.text}</pre><div className="shelf-actions"><button type="button" onClick={() => void copyText(item.text)}><Copy size={12} /> Copy</button><button type="button" onClick={() => transformShelfItem(item, "clean")}><WandSparkles size={12} /> Clean</button><button type="button" onClick={() => transformShelfItem(item, "bullets")}>Bullets</button><button type="button" onClick={() => transformShelfItem(item, "markdown")}>Code</button><button type="button" onClick={() => updateData((current) => setDataWith(current, { shelf: current.shelf.filter((candidate) => candidate.id !== item.id) }))}><Trash2 size={12} /></button></div></article>
                        ))}
                        {data.shelf.length === 0 ? <EmptyState>Pin the snippets, links, and notes you need for the current piece of work.</EmptyState> : null}
                      </div>
                    </section>
                  </div>
                ) : null}

                {view === "meetings" ? (
                  <div className="environment-grid environment-grid-meetings">
                    <section className="environment-panel">
                      <SectionHeading eyebrow="Prepare once" title="Meeting cockpit" />
                      <form className="environment-form" onSubmit={addMeeting}>
                        <label><span>Meeting</span><input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder="Weekly project review" maxLength={140} /></label>
                        <label><span>Starts</span><input type="datetime-local" value={meetingStart} onChange={(event) => setMeetingStart(event.target.value)} /></label>
                        <label><span>Room link</span><input type="url" value={meetingLink} onChange={(event) => setMeetingLink(event.target.value)} placeholder="https://meet.google.com/…" /></label>
                        <button type="submit" className="environment-primary" disabled={!meetingTitle.trim()}><Plus size={14} /> Add meeting</button>
                      </form>
                      <div className="meeting-index">{[...data.meetings].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((meeting) => <button key={meeting.id} type="button" className={selectedMeeting?.id === meeting.id ? "active" : ""} onClick={() => setSelectedMeetingId(meeting.id)}><span>{formatDateTime(meeting.startsAt)}</span><strong>{meeting.title}</strong></button>)}{data.meetings.length === 0 ? <EmptyState>Add the meetings that deserve preparation and follow-through.</EmptyState> : null}</div>
                    </section>
                    <section className="environment-panel environment-span-2">
                      {selectedMeeting ? <>
                        <SectionHeading eyebrow={formatDateTime(selectedMeeting.startsAt)} title={selectedMeeting.title} action={<div className="environment-actions"><button type="button" className="environment-primary" onClick={() => void startMeeting(selectedMeeting)}><Video size={13} /> Start meeting</button><button type="button" className="environment-danger" aria-label={`Delete ${selectedMeeting.title}`} onClick={() => { updateData((current) => setDataWith(current, { meetings: current.meetings.filter((meeting) => meeting.id !== selectedMeeting.id) })); setSelectedMeetingId(null); }}><Trash2 size={13} /></button></div>} />
                        <div className="meeting-editor">
                          <label><span>Agenda</span><textarea value={selectedMeeting.agenda} onChange={(event) => updateMeeting(selectedMeeting.id, { agenda: event.target.value.slice(0, 4_000) })} placeholder="What needs a decision?" /></label>
                          <label><span>Notes and decisions</span><textarea value={selectedMeeting.notes} onChange={(event) => updateMeeting(selectedMeeting.id, { notes: event.target.value.slice(0, 12_000) })} placeholder="Capture decisions, owners, and follow-ups." /></label>
                          <div className="meeting-checklist"><p>Preparation checklist</p>{selectedMeeting.checklist.map((item) => <label key={item.id}><input type="checkbox" checked={item.done} onChange={() => updateMeeting(selectedMeeting.id, { checklist: selectedMeeting.checklist.map((candidate) => candidate.id === item.id ? { ...candidate, done: !candidate.done } : candidate) })} /><span>{item.text}</span></label>)}<form onSubmit={(event) => { event.preventDefault(); if (!checklistText.trim()) return; updateMeeting(selectedMeeting.id, { checklist: [...selectedMeeting.checklist, { id: localId("check"), text: checklistText.trim().slice(0, 180), done: false }] }); setChecklistText(""); }}><input value={checklistText} onChange={(event) => setChecklistText(event.target.value)} placeholder="Add preparation item" /><button type="submit"><Plus size={13} /></button></form></div>
                        </div>
                      </> : <EmptyState>Select a meeting to prepare its agenda, checklist, notes, and focus session.</EmptyState>}
                    </section>
                  </div>
                ) : null}

                {view === "sessions" ? (
                  <div className="environment-grid environment-grid-sessions">
                    <section className="environment-panel">
                      <SectionHeading eyebrow="Session state" title={session ? session.title : "Nothing active"} />
                      {session ? <div className="session-control-card"><p>{session.intention}</p><strong>{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</strong><div className="environment-actions"><button type="button" className="environment-primary" onClick={() => setNowOpen(true)}>Open Now</button><button type="button" className="environment-secondary" onClick={() => session.pausedAt ? resumeSession() : pauseSession()}>{session.pausedAt ? <Play size={13} /> : <Pause size={13} />} {session.pausedAt ? "Resume" : "Pause"}</button><button type="button" className="environment-secondary" onClick={() => finishSession()}><Square size={12} /> Finish</button></div></div> : <button type="button" className="environment-primary wide" onClick={() => startSession("Open focus", "Make the next useful thing unmistakable.", 50)}><Play size={14} /> Start open focus</button>}
                      <div className="end-day"><p>Tomorrow’s first move</p><textarea value={tomorrowMove} onChange={(event) => setTomorrowMove(event.target.value)} placeholder="Write the first concrete action for tomorrow." /><button type="button" onClick={() => { if (session) finishSession("Closed during the end-of-day review."); if (tomorrowMove.trim()) addCapture(`Tomorrow: ${tomorrowMove.trim()}`, "task"); setTomorrowMove(""); setFeedback("Workday closed and tomorrow's first move was captured."); }}><Archive size={13} /> End workday</button></div>
                    </section>
                    <section className="environment-panel environment-span-2">
                      <SectionHeading eyebrow={`${data.sessionHistory.length} recorded`} title="Session history" />
                      <div className="history-list">{data.sessionHistory.map((record) => <article key={record.id}><time>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(record.completedAt))}</time><div><strong>{record.title}</strong><p>{record.summary}</p></div><span>{record.minutes}m</span></article>)}{data.sessionHistory.length === 0 ? <EmptyState>Completed sessions will become a compact record of where your attention went.</EmptyState> : null}</div>
                    </section>
                  </div>
                ) : null}

                {view === "extensions" ? (
                  <div className="environment-grid environment-grid-extensions">
                    <section className="environment-panel environment-span-2">
                      <SectionHeading eyebrow="Small by design" title="Extension registry" />
                      <p className="environment-lede">Extensions register command metadata and callbacks in the existing webview. They do not start another service or runtime.</p>
                      <div className="extension-list">{allExtensions.map((extension) => <article key={extension.id}><div className="extension-mark"><Puzzle size={16} /></div><div><strong>{extension.name}</strong><p>{extension.description}</p><small>{extension.id} · v{extension.version}{extension.commands?.length ? ` · ${extension.commands.length} commands` : ""}</small></div><button type="button" className={extensionEnabled(extension.id) ? "active" : ""} onClick={() => toggleExtension(extension.id)} aria-pressed={extensionEnabled(extension.id)}>{extensionEnabled(extension.id) ? "Enabled" : "Disabled"}</button></article>)}</div>
                    </section>
                    <section className="environment-panel">
                      <SectionHeading eyebrow="Developer surface" title="Register a module" />
                      <pre className="extension-code">{`window.controlPanelExtensions?.register({\n  id: "local.example",\n  name: "Example",\n  description: "One useful command.",\n  version: "1.0.0",\n  commands: [{ id, label, run }]\n});`}</pre>
                      <p className="environment-note">Keep extensions bundled and allowlisted. Dynamic remote code is intentionally unsupported.</p>
                    </section>
                  </div>
                ) : null}

                {view === "attention" ? (
                  <div className="environment-grid environment-grid-attention">
                    <section className="environment-panel environment-span-2">
                      <SectionHeading eyebrow={`${attentionItems.length} signals`} title="Attention center" action={<button type="button" className="environment-text-button" onClick={markNotificationsRead}>Mark notifications read <Check size={12} /></button>} />
                      <div className="attention-list">{attentionItems.map((item) => <button key={item.id} type="button" onClick={() => setView(item.view)}><span /><div><strong>{item.title}</strong><p>{item.detail}</p></div><ChevronRight size={14} /></button>)}{attentionItems.length === 0 ? <EmptyState>Nothing needs intervention. The panel can stay quiet.</EmptyState> : null}</div>
                    </section>
                    <section className="environment-panel">
                      <SectionHeading eyebrow="Rule" title="Protect attention" />
                      <p className="environment-lede">This center surfaces only overdue work, near meetings, unfiled captures, and Control Panel outcomes. It does not mirror every Windows notification.</p>
                      <button type="button" className="environment-secondary wide" onClick={() => openHub("capture")}><Inbox size={13} /> Process capture inbox</button>
                    </section>
                  </div>
                ) : null}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {nowOpen && session ? (
          <motion.div className="now-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AudioReactiveFocusBackdrop active={!session.pausedAt} />
            <header><div><p>Now mode</p><span>{session.pausedAt ? "Paused" : "Protected session"}</span></div><button type="button" onClick={() => setNowOpen(false)} aria-label="Close Now mode"><X size={19} /></button></header>
            <main>
              <p className="now-eyebrow">Current outcome</p><h1>{session.title}</h1><p className="now-intention">{session.intention}</p>
              <div className="display-well now-timer-well"><div className="now-time">{String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}<span>:</span>{String(remainingSeconds % 60).padStart(2, "0")}</div></div>
              <div className="now-progress"><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
              <form className="now-capture" onSubmit={(event) => { event.preventDefault(); addCapture(captureText, "note"); }}><Sparkles size={15} /><input value={captureText} onChange={(event) => setCaptureText(event.target.value)} placeholder="Capture a thought without leaving the session" /><button type="submit">Save</button></form>
              <div className="now-actions"><button type="button" className="now-primary-control" aria-label={session.pausedAt ? "Resume focus session" : "Pause focus session"} onClick={() => session.pausedAt ? resumeSession() : pauseSession()}>{session.pausedAt ? <Play size={20} /> : <Pause size={20} />}</button><button type="button" onClick={() => finishSession()}><Square size={15} /> Finish session</button></div>
            </main>
            <footer><span>{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date())}</span><button type="button" onClick={() => { setNowOpen(false); openHub("today"); }}>Open timeline <ChevronRight size={13} /></button></footer>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
