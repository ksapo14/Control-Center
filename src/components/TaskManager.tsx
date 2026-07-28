import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  CircleAlert,
  Grip,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Monitor,
  PanelLeft,
  PanelRight,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";

type DisplayMonitor = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  workX: number;
  workY: number;
  workWidth: number;
  workHeight: number;
  primary: boolean;
};

type OpenApplication = {
  pid: number;
  name: string;
  title: string;
  handle: number;
  monitorId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  protected: boolean;
  protectedReason: string | null;
};

type DraftWindow = OpenApplication & { close: boolean };
type WindowWorkspace = { monitors: DisplayMonitor[]; windows: OpenApplication[] };
type WindowWorkspaceUpdate = {
  handle: number;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  close: boolean;
  state: "normal" | "minimized" | "maximized";
};
type LayoutProfile = {
  id: string;
  name: string;
  createdAt: string;
  windows: Array<Pick<DraftWindow, "name" | "title" | "monitorId" | "x" | "y" | "width" | "height" | "minimized" | "maximized">>;
};
type Interaction = {
  handle: number;
  pointerId: number;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startWindow: DraftWindow;
};
type LayoutPreset = "full" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

const LAYOUT_PROFILES_STORAGE_KEY = "control-panel.window-layout-profiles";
const SNAP_THRESHOLD = 18;

const previewWorkspace: WindowWorkspace = {
  monitors: [
    {
      id: "DISPLAY1",
      name: "DISPLAY1",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      workX: 0,
      workY: 0,
      workWidth: 1920,
      workHeight: 1032,
      primary: true,
    },
    {
      id: "DISPLAY2",
      name: "DISPLAY2",
      x: 1920,
      y: 0,
      width: 1440,
      height: 900,
      workX: 1920,
      workY: 0,
      workWidth: 1440,
      workHeight: 852,
      primary: false,
    },
  ],
  windows: [
    {
      pid: 4128,
      name: "Chrome",
      title: "Project research - Google Chrome",
      handle: 101,
      monitorId: "DISPLAY1",
      x: 48,
      y: 42,
      width: 1080,
      height: 760,
      minimized: false,
      maximized: false,
      protected: false,
      protectedReason: null,
    },
    {
      pid: 7816,
      name: "Code",
      title: "Control Panel - Visual Studio Code",
      handle: 102,
      monitorId: "DISPLAY1",
      x: 1160,
      y: 80,
      width: 700,
      height: 880,
      minimized: false,
      maximized: false,
      protected: false,
      protectedReason: null,
    },
    {
      pid: 9340,
      name: "Spotify",
      title: "Spotify Premium",
      handle: 103,
      monitorId: "DISPLAY2",
      x: 2000,
      y: 70,
      width: 1120,
      height: 720,
      minimized: false,
      maximized: false,
      protected: false,
      protectedReason: null,
    },
    {
      pid: 1280,
      name: "Explorer",
      title: "Desktop",
      handle: 104,
      monitorId: "DISPLAY2",
      x: 3180,
      y: 120,
      width: 180,
      height: 620,
      minimized: false,
      maximized: false,
      protected: true,
      protectedReason: "Windows shell process is protected",
    },
  ],
};

/**
 * Constrains a numeric value to an inclusive range.
 * @param value - Candidate number.
 * @param minimum - Smallest allowed value.
 * @param maximum - Largest allowed value.
 * @returns The constrained number.
 */
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Serializes the mutable fields used to detect staged workspace changes.
 * @param windows - Current draft windows.
 * @returns A stable JSON representation of editable geometry and close state.
 */
function layoutSignature(windows: DraftWindow[]) {
  return JSON.stringify(
    windows.map(({ handle, monitorId, x, y, width, height, minimized, maximized, close }) => ({ handle, monitorId, x, y, width, height, minimized, maximized, close })),
  );
}

/**
 * Serializes one draft so Save can omit untouched native windows.
 * @param application - Draft window to compare with its captured baseline.
 * @returns A stable representation of its mutable fields.
 */
function windowLayoutSignature({ monitorId, x, y, width, height, minimized, maximized, close }: DraftWindow) {
  return JSON.stringify({ monitorId, x, y, width, height, minimized, maximized, close });
}

/**
 * Restores saved layout profiles without trusting malformed local data.
 * @returns Portable window layout profiles, or an empty list when unavailable.
 */
function initialLayoutProfiles(): LayoutProfile[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(LAYOUT_PROFILES_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

/**
 * Converts a draft into the explicit state contract accepted by the native batch command.
 * @param application - Window draft to serialize.
 * @returns Native workspace update data.
 */
function nativeWindowUpdate(application: DraftWindow): WindowWorkspaceUpdate {
  return {
    handle: application.handle,
    pid: application.pid,
    x: application.x,
    y: application.y,
    width: application.width,
    height: application.height,
    close: application.close,
    state: application.minimized ? "minimized" : application.maximized ? "maximized" : "normal",
  };
}

/**
 * Pulls a coordinate toward nearby workspace guides without making free movement feel sticky.
 * @param value - Proposed native desktop coordinate.
 * @param guides - Nearby edge or center coordinates.
 * @returns The closest guide within the touch-friendly snap threshold.
 */
function snapCoordinate(value: number, guides: number[]) {
  const closest = guides.reduce((best, guide) =>
    Math.abs(guide - value) < Math.abs(best - value) ? guide : best, guides[0] ?? value);
  return Math.abs(closest - value) <= SNAP_THRESHOLD ? closest : value;
}

/**
 * Presents a touch-first editor for arranging visible Windows application windows across displays.
 * @returns The Open Apps trigger and its full workspace modal when active.
 * @remarks Side effects: reads native display state and applies staged window moves, resizes, or graceful close requests on Save.
 */
export function TaskManager() {
  // --- Modal and Workspace State ---
  const [open, setOpen] = useState(false);
  const [monitors, setMonitors] = useState<DisplayMonitor[]>([]);
  const [windows, setWindows] = useState<DraftWindow[]>([]);
  const [selectedHandle, setSelectedHandle] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("Drag a window to move it, then use Save to apply every change together.");
  const [noticeKind, setNoticeKind] = useState<"info" | "error" | "success">("info");
  const [layoutProfiles, setLayoutProfiles] = useState<LayoutProfile[]>(initialLayoutProfiles);
  const [profileName, setProfileName] = useState("");
  const [undoUpdates, setUndoUpdates] = useState<WindowWorkspaceUpdate[] | null>(null);
  const baselineRef = useRef("[]");
  const baselineWindowsRef = useRef(new Map<number, string>());
  const baselineDraftsRef = useRef(new Map<number, DraftWindow>());
  const interactionRef = useRef<Interaction | null>(null);
  const canvasRefs = useRef(new Map<string, HTMLDivElement>());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const selectedWindow = windows.find((window) => window.handle === selectedHandle) ?? null;
  const hasChanges = layoutSignature(windows) !== baselineRef.current;
  const stagedCloseCount = windows.filter((window) => window.close).length;

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_PROFILES_STORAGE_KEY, JSON.stringify(layoutProfiles));
    } catch {
      // Profiles remain available for this session when local storage is blocked.
    }
  }, [layoutProfiles]);

  /**
   * Replaces the draft with a fresh native workspace snapshot.
   * @returns A promise that resolves after state and feedback are updated.
   * @remarks Side effects: reads native monitors/windows and discards any staged draft.
   */
  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = isTauriRuntime()
        ? await invoke<WindowWorkspace>("get_window_workspace")
        : previewWorkspace;
      const draft = snapshot.windows.map((window) => ({ ...window, close: false }));
      setMonitors(snapshot.monitors);
      setWindows(draft);
      baselineRef.current = layoutSignature(draft);
      baselineWindowsRef.current = new Map(draft.map((window) => [window.handle, windowLayoutSignature(window)]));
      baselineDraftsRef.current = new Map(draft.map((window) => [window.handle, { ...window }]));
      setSelectedHandle((current) => (draft.some((window) => window.handle === current) ? current : (draft[0]?.handle ?? null)));
      const missingProfileDisplays = layoutProfiles.some((profile) =>
        profile.windows.some((application) => !snapshot.monitors.some((monitor) => monitor.id === application.monitorId)),
      );
      setNotice(missingProfileDisplays
        ? `${draft.length} windows ready. A saved profile references a disconnected display and will fall back to the primary screen.`
        : `${snapshot.monitors.length} screen${snapshot.monitors.length === 1 ? "" : "s"} and ${draft.length} app window${draft.length === 1 ? "" : "s"} ready to arrange.`);
      setNoticeKind("info");
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    } finally {
      setLoading(false);
    }
  }, [layoutProfiles]);

  /**
   * Opens the editor with current Windows topology and geometry.
   * @returns Nothing.
   * @remarks Side effects: opens the modal and begins a native workspace read.
   */
  const showDialog = () => {
    setOpen(true);
    setNotice("Reading connected screens and application windows…");
    setNoticeKind("info");
    void loadWorkspace();
  };

  /**
   * Closes the editor and returns focus to the Open Apps button.
   * @returns Nothing.
   * @remarks Side effects: discards the in-memory draft and schedules a focus change.
   */
  const closeDialog = useCallback(() => {
    setOpen(false);
    interactionRef.current = null;
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 80);

    // The custom trap keeps keyboard navigation within the full-screen editing surface.
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
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
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDialog, open]);

  /**
   * Updates one draft window without mutating the native desktop.
   * @param handle - Native handle identifying the draft window.
   * @param change - Partial geometry or close-state replacement.
   * @returns Nothing.
   */
  const updateWindow = (handle: number, change: Partial<DraftWindow>) => {
    setWindows((current) => current.map((window) => (window.handle === handle ? { ...window, ...change } : window)));
  };

  /**
   * Starts a captured pointer gesture for touch, pen, or mouse input.
   * @param event - React pointer event from a window block or resize grip.
   * @param application - Window being edited.
   * @param mode - Whether the gesture moves or resizes the window.
   * @returns Nothing.
   * @remarks Side effects: captures the pointer and records transient gesture state.
   */
  const beginInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    application: DraftWindow,
    mode: Interaction["mode"],
  ) => {
    if (application.protected || application.close || saving) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedHandle(application.handle);
    interactionRef.current = {
      handle: application.handle,
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWindow: application,
    };
  };

  /**
   * Converts captured pointer movement into monitor-relative window geometry.
   * @param event - Captured pointer movement event.
   * @param monitor - Display containing the active window block.
   * @returns Nothing.
   */
  const continueInteraction = (event: ReactPointerEvent<HTMLElement>, monitor: DisplayMonitor) => {
    const interaction = interactionRef.current;
    const canvas = canvasRefs.current.get(monitor.id);
    if (!interaction || interaction.pointerId !== event.pointerId || !canvas) return;
    const canvasBounds = canvas.getBoundingClientRect();
    if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return;

    const deltaX = Math.round(((event.clientX - interaction.startClientX) / canvasBounds.width) * monitor.width);
    const deltaY = Math.round(((event.clientY - interaction.startClientY) / canvasBounds.height) * monitor.height);
    const start = interaction.startWindow;

    if (interaction.mode === "move") {
      const proposedX = clamp(start.x + deltaX, monitor.workX, monitor.workX + monitor.workWidth - start.width);
      const proposedY = clamp(start.y + deltaY, monitor.workY, monitor.workY + monitor.workHeight - start.height);
      const peers = windows.filter(
        (application) => application.handle !== interaction.handle && application.monitorId === monitor.id && !application.close,
      );
      // Screen and peer edges act as forgiving guides for finger-driven alignment.
      const xGuides = [
        monitor.workX,
        monitor.workX + Math.round((monitor.workWidth - start.width) / 2),
        monitor.workX + monitor.workWidth - start.width,
        ...peers.flatMap((application) => [application.x, application.x + application.width, application.x - start.width]),
      ];
      const yGuides = [
        monitor.workY,
        monitor.workY + Math.round((monitor.workHeight - start.height) / 2),
        monitor.workY + monitor.workHeight - start.height,
        ...peers.flatMap((application) => [application.y, application.y + application.height, application.y - start.height]),
      ];
      updateWindow(interaction.handle, {
        x: snapCoordinate(proposedX, xGuides),
        y: snapCoordinate(proposedY, yGuides),
      });
      return;
    }

    updateWindow(interaction.handle, {
      width: clamp(start.width + deltaX, 160, monitor.workX + monitor.workWidth - start.x),
      height: clamp(start.height + deltaY, 100, monitor.workY + monitor.workHeight - start.y),
    });
  };

  /**
   * Ends the active pointer gesture after release or cancellation.
   * @param event - Pointer release event.
   * @returns Nothing.
   */
  const endInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
  };

  /**
   * Moves a draft window to another display while preserving its relative position and size.
   * @param application - Window selected for reassignment.
   * @param target - Destination display.
   * @returns Nothing.
   */
  const moveToMonitor = (application: DraftWindow, target: DisplayMonitor) => {
    const source = monitors.find((monitor) => monitor.id === application.monitorId) ?? target;
    const relativeX = (application.x - source.workX) / Math.max(source.workWidth, 1);
    const relativeY = (application.y - source.workY) / Math.max(source.workHeight, 1);
    const width = Math.min(application.width, target.workWidth);
    const height = Math.min(application.height, target.workHeight);
    updateWindow(application.handle, {
      monitorId: target.id,
      width,
      height,
      x: clamp(target.workX + Math.round(relativeX * target.workWidth), target.workX, target.workX + target.workWidth - width),
      y: clamp(target.workY + Math.round(relativeY * target.workHeight), target.workY, target.workY + target.workHeight - height),
    });
  };

  /**
   * Applies a touch-friendly snap layout to the selected draft window.
   * @param application - Window receiving the preset.
   * @param preset - Full-screen, half-screen, or quarter-screen target.
   * @returns Nothing.
   */
  const applyPreset = (application: DraftWindow, preset: LayoutPreset) => {
    const monitor = monitors.find((item) => item.id === application.monitorId);
    if (!monitor) return;
    const halfWidth = Math.floor(monitor.workWidth / 2);
    const halfHeight = Math.floor(monitor.workHeight / 2);
    const geometries: Record<LayoutPreset, Pick<DraftWindow, "x" | "y" | "width" | "height">> = {
      full: { x: monitor.workX, y: monitor.workY, width: monitor.workWidth, height: monitor.workHeight },
      left: { x: monitor.workX, y: monitor.workY, width: halfWidth, height: monitor.workHeight },
      right: { x: monitor.workX + halfWidth, y: monitor.workY, width: monitor.workWidth - halfWidth, height: monitor.workHeight },
      "top-left": { x: monitor.workX, y: monitor.workY, width: halfWidth, height: halfHeight },
      "top-right": { x: monitor.workX + halfWidth, y: monitor.workY, width: monitor.workWidth - halfWidth, height: halfHeight },
      "bottom-left": { x: monitor.workX, y: monitor.workY + halfHeight, width: halfWidth, height: monitor.workHeight - halfHeight },
      "bottom-right": { x: monitor.workX + halfWidth, y: monitor.workY + halfHeight, width: monitor.workWidth - halfWidth, height: monitor.workHeight - halfHeight },
    };
    updateWindow(application.handle, { ...geometries[preset], minimized: false, maximized: false });
  };

  /**
   * Moves every editable window to one screen while preserving relative placement.
   * @param target - Destination display for all staged windows.
   * @returns Nothing.
   */
  const moveAllToMonitor = (target: DisplayMonitor) => {
    setWindows((current) => current.map((application) => {
      if (application.protected || application.close || application.monitorId === target.id) return application;
      const source = monitors.find((monitor) => monitor.id === application.monitorId) ?? target;
      const width = Math.min(application.width, target.workWidth);
      const height = Math.min(application.height, target.workHeight);
      const relativeX = (application.x - source.workX) / Math.max(source.workWidth, 1);
      const relativeY = (application.y - source.workY) / Math.max(source.workHeight, 1);
      return {
        ...application,
        monitorId: target.id,
        width,
        height,
        x: clamp(target.workX + Math.round(relativeX * target.workWidth), target.workX, target.workX + target.workWidth - width),
        y: clamp(target.workY + Math.round(relativeY * target.workHeight), target.workY, target.workY + target.workHeight - height),
      };
    }));
  };

  /**
   * Places a monitor's editable windows into evenly spaced columns for quick cleanup.
   * @param monitor - Display whose windows should be distributed.
   * @returns Nothing.
   */
  const distributeWindows = (monitor: DisplayMonitor) => {
    const candidates = windows.filter(
      (application) => application.monitorId === monitor.id && !application.protected && !application.close,
    );
    if (candidates.length < 2) return;
    const gap = 16;
    const columnWidth = Math.max(160, Math.floor((monitor.workWidth - gap * (candidates.length + 1)) / candidates.length));
    setWindows((current) => current.map((application) => {
      const index = candidates.findIndex((candidate) => candidate.handle === application.handle);
      if (index < 0) return application;
      return {
        ...application,
        x: monitor.workX + gap + index * (columnWidth + gap),
        y: monitor.workY + gap,
        width: Math.min(columnWidth, monitor.workWidth - gap * 2),
        height: monitor.workHeight - gap * 2,
        minimized: false,
        maximized: false,
      };
    }));
  };

  /**
   * Matches a portable profile to live windows by title first and app occurrence second.
   * @param profile - Saved layout to stage.
   * @param liveWindows - Current desktop windows that may receive saved geometry.
   * @param liveMonitors - Connected displays used to validate destinations.
   * @returns Updated drafts plus counts for unavailable windows or displays.
   */
  const mergeLayoutProfile = (
    profile: LayoutProfile,
    liveWindows: DraftWindow[],
    liveMonitors: DisplayMonitor[],
  ) => {
    const matchedHandles = new Set<number>();
    const replacements = new Map<number, DraftWindow>();
    let missingWindows = 0;
    let missingDisplays = 0;
    const fallbackMonitor = liveMonitors.find((monitor) => monitor.primary) ?? liveMonitors[0];

    for (const saved of profile.windows) {
      const exact = liveWindows.find(
        (application) => !matchedHandles.has(application.handle) && application.title === saved.title,
      );
      const match = exact ?? liveWindows.find(
        (application) => !matchedHandles.has(application.handle) && application.name === saved.name,
      );
      if (!match || match.protected) {
        missingWindows += 1;
        continue;
      }
      const monitor = liveMonitors.find((candidate) => candidate.id === saved.monitorId) ?? fallbackMonitor;
      if (!monitor) continue;
      if (monitor.id !== saved.monitorId) missingDisplays += 1;
      const width = Math.min(saved.width, monitor.workWidth);
      const height = Math.min(saved.height, monitor.workHeight);
      matchedHandles.add(match.handle);
      replacements.set(match.handle, {
        ...match,
        monitorId: monitor.id,
        x: clamp(saved.x, monitor.workX, monitor.workX + monitor.workWidth - width),
        y: clamp(saved.y, monitor.workY, monitor.workY + monitor.workHeight - height),
        width,
        height,
        minimized: saved.minimized,
        maximized: saved.maximized,
        close: false,
      });
    }
    return {
      drafts: liveWindows.map((application) => replacements.get(application.handle) ?? application),
      missingWindows,
      missingDisplays,
    };
  };

  /** Saves the current staged arrangement as a reusable, app-title-aware profile. */
  const saveLayoutProfile = () => {
    const name = profileName.trim();
    if (!name || windows.length === 0) return;
    const profile: LayoutProfile = {
      id: crypto.randomUUID(),
      name: name.slice(0, 40),
      createdAt: new Date().toISOString(),
      windows: windows
        .filter((application) => !application.protected && !application.close)
        .map(({ name: appName, title, monitorId, x, y, width, height, minimized, maximized }) => ({
          name: appName,
          title,
          monitorId,
          x,
          y,
          width,
          height,
          minimized,
          maximized,
        })),
    };
    setLayoutProfiles((current) => [profile, ...current].slice(0, 20));
    setProfileName("");
    setNotice(`Saved “${profile.name}” with ${profile.windows.length} windows.`);
    setNoticeKind("success");
  };

  /** Stages a saved profile in the open editor without changing native windows yet. */
  const stageLayoutProfile = (profile: LayoutProfile) => {
    const merged = mergeLayoutProfile(profile, windows, monitors);
    setWindows(merged.drafts);
    setNotice(merged.missingWindows || merged.missingDisplays
      ? `Profile staged with ${merged.missingWindows} unavailable window${merged.missingWindows === 1 ? "" : "s"} and ${merged.missingDisplays} display fallback${merged.missingDisplays === 1 ? "" : "s"}.`
      : `Profile “${profile.name}” staged. Save to apply it.`);
    setNoticeKind(merged.missingWindows || merged.missingDisplays ? "error" : "info");
  };

  /**
   * Applies a profile requested by an app group even when the workspace modal is closed.
   * @param profile - Profile associated with the app group.
   * @returns A promise resolved after native window updates finish.
   */
  const applyLayoutProfileDirectly = async (profile: LayoutProfile) => {
    if (!isTauriRuntime()) return;
    try {
      const snapshot = await invoke<WindowWorkspace>("get_window_workspace");
      const liveDrafts = snapshot.windows.map((application) => ({ ...application, close: false }));
      const merged = mergeLayoutProfile(profile, liveDrafts, snapshot.monitors);
      const updates = merged.drafts
        .filter((application, index) => windowLayoutSignature(application) !== windowLayoutSignature(liveDrafts[index]))
        .map(nativeWindowUpdate);
      if (updates.length > 0) await invoke("apply_window_workspace", { request: { windows: updates } });
    } catch {
      // Group launches stay useful even when a profile becomes stale or a process exits.
    }
  };

  /**
   * Sends only changed, unprotected windows to the validated native batch command.
   * @returns A promise that resolves after the desktop is applied and refreshed.
   * @remarks Side effects: moves, resizes, restores, or gracefully closes native application windows.
   */
  const saveWorkspace = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setNotice("Applying the staged desktop layout…");
    setNoticeKind("info");
    try {
      const changedWindows = windows
        .filter((window) => !window.protected && baselineWindowsRef.current.get(window.handle) !== windowLayoutSignature(window))
      const updates = changedWindows.map(nativeWindowUpdate);
      const reversible = changedWindows.flatMap((application) => {
        const baseline = baselineDraftsRef.current.get(application.handle);
        return baseline && !application.close ? [nativeWindowUpdate({ ...baseline, close: false })] : [];
      });
      if (isTauriRuntime()) {
        await invoke("apply_window_workspace", { request: { windows: updates } });
        await loadWorkspace();
      } else {
        const remaining = windows.filter((window) => !window.close);
        setWindows(remaining);
        baselineRef.current = layoutSignature(remaining);
        baselineWindowsRef.current = new Map(remaining.map((window) => [window.handle, windowLayoutSignature(window)]));
        baselineDraftsRef.current = new Map(remaining.map((window) => [window.handle, { ...window }]));
        setSelectedHandle(remaining[0]?.handle ?? null);
      }
      setUndoUpdates(reversible.length > 0 ? reversible : null);
      setNotice("Window layout saved and applied.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    } finally {
      setSaving(false);
    }
  };

  /** Reapplies the pre-save geometry for windows that still exist. */
  const undoLastSave = async () => {
    if (!undoUpdates || saving) return;
    setSaving(true);
    try {
      if (isTauriRuntime()) {
        await invoke("apply_window_workspace", { request: { windows: undoUpdates } });
        await loadWorkspace();
      } else {
        setWindows((current) => current.map((application) => {
          const previous = undoUpdates.find((update) => update.handle === application.handle);
          return previous ? {
            ...application,
            x: previous.x,
            y: previous.y,
            width: previous.width,
            height: previous.height,
            minimized: previous.state === "minimized",
            maximized: previous.state === "maximized",
          } : application;
        }));
      }
      setUndoUpdates(null);
      setNotice("The previous saved window layout was restored.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    } finally {
      setSaving(false);
    }
  };

  const monitorWindows = useMemo(() => {
    const grouped = new Map<string, DraftWindow[]>();
    for (const monitor of monitors) grouped.set(monitor.id, []);
    for (const application of windows) grouped.get(application.monitorId)?.push(application);
    return grouped;
  }, [monitors, windows]);

  // --- Workspace Rendering ---
  return (
    <>
      <TactileButton
        ref={triggerRef}
        onClick={showDialog}
        className="h-11 px-3 sm:px-4"
        aria-haspopup="dialog"
        aria-label="Arrange open applications"
        data-shortcut-combo="Control+Alt+KeyO"
        data-shortcut-id="control:open-apps"
        data-shortcut-label="Open app workspace"
        data-shortcut-detail="Arrange windows across screens"
        data-shortcut-group="Control panel"
        data-shortcut-order="1"
        data-control-action="open-apps"
      >
        <span className="flex items-center gap-2.5">
          <AppWindow size={18} strokeWidth={1.7} className="text-signal-300" />
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-300 md:inline">
            Open apps
          </span>
        </span>
      </TactileButton>

      {layoutProfiles.map((profile) => (
        <button
          key={profile.id}
          type="button"
          className="hidden"
          data-layout-profile-id={profile.id}
          data-layout-profile-name={profile.name}
          onClick={() => void applyLayoutProfileDirectly(profile)}
          tabIndex={-1}
          aria-hidden="true"
        />
      ))}

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black/85 p-2 backdrop-blur-md sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="window-workspace-title"
              className="schedule-panel relative flex h-[calc(100dvh-16px)] w-full max-w-[1500px] flex-col overflow-hidden rounded-[20px] border border-black/80 border-t-white/10 shadow-panel sm:h-[calc(100dvh-32px)]"
              initial={{ opacity: 0, y: 12, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.995 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <header className="flex min-h-[72px] shrink-0 items-center justify-between gap-3 border-b border-black/60 px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-black/70 border-t-white/10 bg-gradient-to-br from-[#272a27] to-[#0d0f0e] text-signal-300 shadow-skeuo-raised">
                    <LayoutDashboard size={21} strokeWidth={1.55} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-400">Desktop workspace</p>
                    <h2 id="window-workspace-title" className="mt-0.5 truncate text-xl font-semibold tracking-[-0.025em] text-stone-100 sm:text-2xl">
                      Arrange open apps
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void undoLastSave()}
                    disabled={!undoUpdates || saving || loading}
                    className="grid size-11 place-items-center rounded-[11px] border border-black/60 bg-black/20 text-stone-400 shadow-well transition hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-30"
                    aria-label="Undo last saved layout"
                    title="Undo last save"
                  >
                    <Undo2 size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadWorkspace()}
                    disabled={loading || saving}
                    className="grid size-11 place-items-center rounded-[11px] border border-black/60 bg-black/20 text-stone-400 shadow-well transition hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-40"
                    aria-label="Refresh workspace and discard staged changes"
                    title="Refresh current desktop"
                  >
                    <RefreshCw size={18} className={loading ? "animate-spin" : undefined} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveWorkspace()}
                    disabled={!hasChanges || saving || loading}
                    className="flex h-11 items-center gap-2 rounded-[11px] border border-signal-900/70 bg-signal-950/50 px-4 text-xs font-semibold uppercase tracking-[0.08em] text-signal-200 shadow-skeuo-raised transition hover:bg-signal-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {saving ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />}
                    <span className="hidden sm:inline">Save layout</span>
                  </button>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={closeDialog}
                    className="grid size-11 place-items-center rounded-[11px] text-stone-500 transition hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                    aria-label="Close window workspace"
                  >
                    <X size={21} />
                  </button>
                </div>
              </header>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
                <main className="min-h-0 flex-none overflow-visible p-3 sm:p-5 lg:flex-1 lg:overflow-y-auto">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                    <p className="text-xs font-medium text-stone-400">
                      {loading ? "Reading Windows desktop…" : `${monitors.length} screen${monitors.length === 1 ? "" : "s"} · ${windows.length} open window${windows.length === 1 ? "" : "s"}`}
                    </p>
                    <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-stone-600">
                      <Grip size={13} /> Drag · resize from corner
                    </p>
                  </div>

                  {loading && monitors.length === 0 ? (
                    <div className="grid min-h-[420px] place-items-center rounded-[16px] border border-black/60 bg-black/15 shadow-well">
                      <LoaderCircle size={30} className="animate-spin text-signal-400" />
                    </div>
                  ) : monitors.length === 0 ? (
                    <div className="grid min-h-[420px] place-items-center rounded-[16px] border border-dashed border-white/[0.08] bg-black/10 px-6 text-center">
                      <div>
                        <Monitor size={34} className="mx-auto text-stone-700" />
                        <p className="mt-3 text-sm font-semibold text-stone-300">No displays available</p>
                        <p className="mt-1 text-xs text-stone-600">Connect a display, then refresh the workspace.</p>
                      </div>
                    </div>
                  ) : (
                    <div className={`grid gap-4 ${monitors.length > 1 ? "xl:grid-cols-2" : "grid-cols-1"}`}>
                      {monitors.map((monitor, monitorIndex) => (
                        <section key={monitor.id} className="rounded-[16px] border border-black/70 border-t-white/[0.07] bg-black/20 p-3 shadow-well">
                          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
                            <div className="flex items-center gap-2">
                              <Monitor size={15} className="text-signal-400" />
                              <h3 className="text-xs font-semibold text-stone-300">
                                Screen {monitorIndex + 1}
                                {monitor.primary ? <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.1em] text-signal-500">Primary</span> : null}
                              </h3>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button type="button" onClick={() => distributeWindows(monitor)} className="min-h-8 rounded-lg border border-black/50 bg-black/15 px-2 text-[9px] font-semibold uppercase tracking-[0.06em] text-stone-600 hover:text-stone-300" title="Evenly space windows on this screen">Space evenly</button>
                              <button type="button" onClick={() => moveAllToMonitor(monitor)} className="min-h-8 rounded-lg border border-black/50 bg-black/15 px-2 text-[9px] font-semibold uppercase tracking-[0.06em] text-stone-600 hover:text-stone-300" title="Move every editable window to this screen">Move all here</button>
                              <span className="font-mono text-[10px] text-stone-600">{monitor.width} × {monitor.height}</span>
                            </div>
                          </div>
                          <div
                            ref={(node) => {
                              if (node) canvasRefs.current.set(monitor.id, node);
                              else canvasRefs.current.delete(monitor.id);
                            }}
                            className="relative w-full overflow-hidden rounded-[10px] border border-black/80 bg-[#0a0d0b] shadow-inner"
                            style={{ aspectRatio: `${monitor.width} / ${monitor.height}` }}
                            aria-label={`Screen ${monitorIndex + 1} window layout`}
                          >
                            <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:32px_32px]" />
                            {(monitorWindows.get(monitor.id) ?? []).map((application) => {
                              const selected = application.handle === selectedHandle;
                              const left = ((application.x - monitor.x) / monitor.width) * 100;
                              const top = ((application.y - monitor.y) / monitor.height) * 100;
                              const width = (application.width / monitor.width) * 100;
                              const height = (application.height / monitor.height) * 100;
                              return (
                                <button
                                  key={application.handle}
                                  type="button"
                                  onPointerDown={(event) => beginInteraction(event, application, "move")}
                                  onPointerMove={(event) => continueInteraction(event, monitor)}
                                  onPointerUp={endInteraction}
                                  onPointerCancel={endInteraction}
                                  onClick={() => setSelectedHandle(application.handle)}
                                  disabled={application.close}
                                  className={`absolute flex min-h-6 min-w-10 select-none items-center justify-center overflow-hidden rounded-[6px] border px-1.5 text-center text-[clamp(8px,1vw,12px)] font-semibold shadow-lg outline-none transition-[border-color,background-color,opacity] focus-visible:ring-2 focus-visible:ring-signal-300 ${
                                    application.close
                                      ? "border-red-900/50 bg-red-950/25 text-red-700 opacity-25"
                                      : selected
                                        ? "z-20 border-signal-300 bg-signal-900/90 text-signal-50"
                                        : application.protected
                                          ? "z-10 border-white/10 bg-stone-800/90 text-stone-500"
                                          : "z-10 border-signal-900/80 bg-[#1d2923]/95 text-stone-200 hover:border-signal-500"
                                  }`}
                                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, touchAction: "none" }}
                                  aria-label={`${application.name} on screen ${monitorIndex + 1}`}
                                  title={application.title}
                                >
                                  <span className="truncate">{application.name}</span>
                                  {!application.protected && !application.close ? (
                                    <span
                                      role="presentation"
                                      onPointerDown={(event) => beginInteraction(event, application, "resize")}
                                      onPointerMove={(event) => continueInteraction(event, monitor)}
                                      onPointerUp={endInteraction}
                                      onPointerCancel={endInteraction}
                                      className="absolute bottom-0 right-0 size-6 cursor-nwse-resize touch-none border-b-[3px] border-r-[3px] border-signal-200/80"
                                    />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </main>

                <aside className="w-full shrink-0 overflow-visible border-t border-black/60 bg-black/15 p-4 sm:p-5 lg:w-[340px] lg:overflow-y-auto lg:border-l lg:border-t-0">
                  {selectedWindow ? (
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid size-11 shrink-0 place-items-center rounded-[11px] border border-signal-900/50 bg-signal-950/30 text-base font-semibold text-signal-300 shadow-well" aria-hidden="true">{selectedWindow.name.slice(0, 1).toUpperCase()}</span>
                          <div className="min-w-0">
                          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-signal-500">Selected window</p>
                          <h3 className="mt-1 truncate text-lg font-semibold text-stone-100" title={selectedWindow.title}>{selectedWindow.name}</h3>
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-stone-600">{selectedWindow.title}</p>
                          </div>
                        </div>
                        {selectedWindow.protected ? <LockKeyhole size={18} className="mt-1 shrink-0 text-stone-600" /> : null}
                      </div>

                      {selectedWindow.protected ? (
                        <div className="mt-5 rounded-[12px] border border-white/[0.06] bg-black/20 p-3 text-xs leading-relaxed text-stone-500">
                          {selectedWindow.protectedReason ?? "This Windows surface cannot be rearranged here."}
                        </div>
                      ) : (
                        <>
                          <div className="mt-6">
                            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.13em] text-stone-600">Move to screen</p>
                            <div className="grid grid-cols-2 gap-2">
                              {monitors.map((monitor, index) => (
                                <button
                                  key={monitor.id}
                                  type="button"
                                  onClick={() => moveToMonitor(selectedWindow, monitor)}
                                  disabled={selectedWindow.close}
                                  className={`flex min-h-12 items-center justify-center gap-2 rounded-[10px] border text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-35 ${
                                    selectedWindow.monitorId === monitor.id
                                      ? "border-signal-700 bg-signal-950/50 text-signal-200"
                                      : "border-black/60 bg-black/20 text-stone-500 hover:text-stone-200"
                                  }`}
                                >
                                  <Monitor size={15} /> Screen {index + 1}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="mt-5">
                            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.13em] text-stone-600">Window state</p>
                            <div className="grid grid-cols-3 gap-2">
                              {([
                                ["minimized", Minimize2, "Minimize"],
                                ["normal", Square, "Restore"],
                                ["maximized", Maximize2, "Maximize"],
                              ] as const).map(([state, Icon, label]) => {
                                const selected = state === "minimized" ? selectedWindow.minimized : state === "maximized" ? selectedWindow.maximized : !selectedWindow.minimized && !selectedWindow.maximized;
                                return <button key={state} type="button" onClick={() => updateWindow(selectedWindow.handle, { minimized: state === "minimized", maximized: state === "maximized" })} disabled={selectedWindow.close} className={`grid min-h-[54px] place-items-center rounded-[10px] border py-2 text-[9px] font-semibold uppercase tracking-[0.05em] ${selected ? "border-signal-700 bg-signal-950/45 text-signal-200" : "border-black/60 bg-black/20 text-stone-600"}`}><Icon size={16} />{label}</button>;
                              })}
                            </div>
                          </div>

                          <div className="mt-5">
                            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.13em] text-stone-600">Snap layout</p>
                            <div className="grid grid-cols-4 gap-2">
                              {([
                                ["left", PanelLeft, "Left"],
                                ["full", Maximize2, "Full"],
                                ["right", PanelRight, "Right"],
                                ["top-left", Square, "Top left"],
                                ["top-right", Square, "Top right"],
                                ["bottom-left", Square, "Bottom left"],
                                ["bottom-right", Square, "Bottom right"],
                              ] as const).map(([preset, Icon, label]) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => applyPreset(selectedWindow, preset)}
                                  disabled={selectedWindow.close}
                                  className="grid min-h-[58px] place-items-center rounded-[10px] border border-black/60 bg-black/20 py-2 text-[8px] font-semibold uppercase tracking-[0.04em] text-stone-500 shadow-well transition hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:opacity-35"
                                >
                                  <Icon size={17} />
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <dl className="mt-5 grid grid-cols-2 gap-2 font-mono text-[10px]">
                            <div className="rounded-[9px] border border-black/50 bg-black/15 p-2.5">
                              <dt className="uppercase tracking-[0.1em] text-stone-700">Position</dt>
                              <dd className="mt-1 text-stone-400">{selectedWindow.x}, {selectedWindow.y}</dd>
                            </div>
                            <div className="rounded-[9px] border border-black/50 bg-black/15 p-2.5">
                              <dt className="uppercase tracking-[0.1em] text-stone-700">Size</dt>
                              <dd className="mt-1 text-stone-400">{selectedWindow.width} × {selectedWindow.height}</dd>
                            </div>
                          </dl>

                          <button
                            type="button"
                            onClick={() => updateWindow(selectedWindow.handle, { close: !selectedWindow.close })}
                            className={`mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-[11px] border text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 ${
                              selectedWindow.close
                                ? "border-stone-700 bg-stone-900/60 text-stone-300 focus-visible:ring-stone-500"
                                : "border-red-950 bg-red-950/20 text-red-400 hover:bg-red-950/35 focus-visible:ring-red-500"
                            }`}
                          >
                            {selectedWindow.close ? <RotateCcw size={16} /> : <Trash2 size={16} />}
                            {selectedWindow.close ? "Keep this window" : "Close when saved"}
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="grid min-h-52 place-items-center text-center">
                      <div>
                        <AppWindow size={28} className="mx-auto text-stone-700" />
                        <p className="mt-3 text-sm font-semibold text-stone-400">Select a window</p>
                        <p className="mt-1 text-xs leading-relaxed text-stone-600">Tap a program block on any screen to arrange it.</p>
                      </div>
                    </div>
                  )}

                  <section className="mt-6 border-t border-white/[0.05] pt-5">
                    <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-stone-600">Layout profiles</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-stone-700">Recall window positions by title, including duplicate instances of the same app.</p>
                    <div className="mt-3 flex gap-2">
                      <input value={profileName} onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveLayoutProfile()} placeholder="Profile name" maxLength={40} className="schedule-input min-w-0 flex-1" />
                      <button type="button" onClick={saveLayoutProfile} disabled={!profileName.trim() || windows.length === 0} className="min-h-11 rounded-[10px] border border-signal-900/60 bg-signal-950/35 px-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-signal-300 disabled:opacity-30">Save</button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {layoutProfiles.map((profile) => (
                        <div key={profile.id} className="flex items-center gap-2 rounded-[10px] border border-black/60 bg-black/15 p-2">
                          <button type="button" onClick={() => stageLayoutProfile(profile)} className="min-h-10 min-w-0 flex-1 truncate rounded-lg px-2 text-left text-xs font-semibold text-stone-400 hover:bg-white/[0.03] hover:text-stone-200">{profile.name}<span className="ml-2 font-mono text-[8px] font-normal text-stone-700">{profile.windows.length} windows</span></button>
                          <button type="button" onClick={() => setLayoutProfiles((current) => current.filter((candidate) => candidate.id !== profile.id))} className="grid size-10 place-items-center rounded-lg text-stone-700 hover:text-red-300" aria-label={`Delete ${profile.name} layout profile`}><Trash2 size={13} /></button>
                        </div>
                      ))}
                      {layoutProfiles.length === 0 ? <p className="rounded-[10px] border border-dashed border-white/[0.05] p-3 text-center text-[10px] text-stone-700">No saved profiles yet</p> : null}
                    </div>
                  </section>
                </aside>
              </div>

              <footer
                className={`flex min-h-[60px] shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5 sm:px-6 ${
                  noticeKind === "error"
                    ? "border-red-900/40 bg-red-950/15"
                    : noticeKind === "success"
                      ? "border-emerald-900/40 bg-emerald-950/15"
                      : "border-white/[0.04] bg-black/15"
                }`}
              >
                <div className={`flex min-w-0 items-center gap-2.5 text-xs ${noticeKind === "error" ? "text-red-300" : noticeKind === "success" ? "text-emerald-300" : "text-stone-500"}`} aria-live="polite">
                  <CircleAlert size={15} className="shrink-0" />
                  <p className="truncate">{notice}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {stagedCloseCount > 0 ? <span className="hidden text-[10px] font-medium uppercase tracking-[0.08em] text-red-500 sm:inline">{stagedCloseCount} close staged</span> : null}
                  <span className={`size-2 rounded-full ${hasChanges ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)]" : "bg-stone-700"}`} />
                  <span className="hidden font-mono text-[10px] uppercase tracking-[0.1em] text-stone-600 sm:inline">{hasChanges ? "Unsaved changes" : "Layout saved"}</span>
                </div>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
