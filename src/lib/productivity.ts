export type CaptureKind = "note" | "task" | "link";
export type CaptureState = "inbox" | "filed";

export type CaptureItem = {
  id: string;
  kind: CaptureKind;
  text: string;
  createdAt: string;
  state: CaptureState;
};

export type ShelfItem = {
  id: string;
  text: string;
  source: "capture" | "clipboard" | "manual";
  createdAt: string;
  pinned: boolean;
};

export type TimelineBlock = {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  kind: "focus" | "task" | "meeting" | "break";
  taskId: string | null;
  completed: boolean;
};

export type ProjectScene = {
  id: string;
  name: string;
  intention: string;
  appGroupId: string | null;
  theme: "black" | "tan" | "green" | "blue" | "white";
  durationMinutes: number;
  focus: boolean;
  volume: number | null;
  brightness: number | null;
  resourceUrls: string[];
  capturedApps: string[];
  createdAt: string;
};

export type ActiveSession = {
  id: string;
  sceneId: string | null;
  title: string;
  intention: string;
  startedAt: string;
  endsAt: string;
  pausedAt: string | null;
  remainingSeconds: number;
  totalSeconds: number;
};

export type SessionRecord = {
  id: string;
  sceneId: string | null;
  title: string;
  startedAt: string;
  completedAt: string;
  minutes: number;
  summary: string;
};

export type MeetingItem = {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  link: string;
  agenda: string;
  notes: string;
  checklist: Array<{ id: string; text: string; done: boolean }>;
};

export type ExtensionPreference = {
  id: string;
  enabled: boolean;
};

export type ProductivityData = {
  version: 1;
  captures: CaptureItem[];
  shelf: ShelfItem[];
  timeline: TimelineBlock[];
  scenes: ProjectScene[];
  activeSession: ActiveSession | null;
  sessionHistory: SessionRecord[];
  meetings: MeetingItem[];
  extensions: ExtensionPreference[];
};

export type TrackerTask = {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  createdAt: string;
};

export type TrackerData = {
  version: 1;
  tasks: TrackerTask[];
  habits: unknown[];
};

export type EnvironmentCommand = {
  id: string;
  label: string;
  detail?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

export type ControlPanelExtension = {
  id: string;
  name: string;
  description: string;
  version: string;
  commands?: EnvironmentCommand[];
};

declare global {
  interface Window {
    controlPanelExtensions?: {
      register: (extension: ControlPanelExtension) => () => void;
      list: () => ControlPanelExtension[];
    };
  }
}

export const PRODUCTIVITY_STORAGE_KEY = "control-panel.productivity-environment";
export const TRACKER_STORAGE_KEY = "control-panel.tasks-habits";
export const PRODUCTIVITY_EVENT = "control-panel:productivity-updated";
export const TRACKER_SYNC_EVENT = "control-panel:tracker-sync";
export const TRACKER_UPDATED_EVENT = "control-panel:tracker-updated";

const emptyProductivityData: ProductivityData = {
  version: 1,
  captures: [],
  shelf: [],
  timeline: [],
  scenes: [],
  activeSession: null,
  sessionHistory: [],
  meetings: [],
  extensions: [],
};

export function localId(prefix: string) {
  return globalThis.crypto?.randomUUID?.()
    ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localTimeKey(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function restoreProductivityData(): ProductivityData {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PRODUCTIVITY_STORAGE_KEY) ?? "null") as Partial<ProductivityData> | null;
    if (!stored || typeof stored !== "object") return { ...emptyProductivityData };
    return {
      version: 1,
      captures: Array.isArray(stored.captures) ? stored.captures.slice(0, 120) : [],
      shelf: Array.isArray(stored.shelf) ? stored.shelf.slice(0, 60) : [],
      timeline: Array.isArray(stored.timeline) ? stored.timeline.slice(0, 240) : [],
      scenes: Array.isArray(stored.scenes) ? stored.scenes.slice(0, 30) : [],
      activeSession: stored.activeSession && typeof stored.activeSession === "object" ? stored.activeSession : null,
      sessionHistory: Array.isArray(stored.sessionHistory) ? stored.sessionHistory.slice(0, 120) : [],
      meetings: Array.isArray(stored.meetings) ? stored.meetings.slice(0, 120) : [],
      extensions: Array.isArray(stored.extensions) ? stored.extensions.slice(0, 80) : [],
    };
  } catch {
    return { ...emptyProductivityData };
  }
}

export function persistProductivityData(data: ProductivityData) {
  window.localStorage.setItem(PRODUCTIVITY_STORAGE_KEY, JSON.stringify({
    ...data,
    captures: data.captures.slice(0, 120),
    shelf: data.shelf.slice(0, 60),
    timeline: data.timeline.slice(0, 240),
    scenes: data.scenes.slice(0, 30),
    sessionHistory: data.sessionHistory.slice(0, 120),
    meetings: data.meetings.slice(0, 120),
    extensions: data.extensions.slice(0, 80),
  }));
  window.dispatchEvent(new CustomEvent(PRODUCTIVITY_EVENT));
}

export function readTrackerData(): TrackerData {
  try {
    const stored = JSON.parse(window.localStorage.getItem(TRACKER_STORAGE_KEY) ?? "null") as Partial<TrackerData> | null;
    return {
      version: 1,
      tasks: Array.isArray(stored?.tasks) ? stored.tasks.filter((task): task is TrackerTask => Boolean(
        task
        && typeof task.id === "string"
        && typeof task.title === "string"
        && typeof task.dueDate === "string"
        && typeof task.completed === "boolean"
        && typeof task.createdAt === "string",
      )) : [],
      habits: Array.isArray(stored?.habits) ? stored.habits : [],
    };
  } catch {
    return { version: 1, tasks: [], habits: [] };
  }
}

export function writeTrackerData(data: TrackerData) {
  window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(data));
  window.dispatchEvent(new CustomEvent(TRACKER_SYNC_EVENT));
  window.dispatchEvent(new CustomEvent(TRACKER_UPDATED_EVENT));
}

export function addTrackerTask(title: string, dueDate = "") {
  const tracker = readTrackerData();
  const task: TrackerTask = {
    id: localId("task"),
    title: title.trim().slice(0, 180),
    dueDate,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  tracker.tasks = [task, ...tracker.tasks].slice(0, 300);
  writeTrackerData(tracker);
  return task;
}

export function setTrackerTaskCompleted(taskId: string, completed: boolean) {
  const tracker = readTrackerData();
  tracker.tasks = tracker.tasks.map((task) => task.id === taskId ? { ...task, completed } : task);
  writeTrackerData(tracker);
}
