import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  AppWindow,
  CalendarDays,
  Chrome,
  FolderCode,
  Gamepad2,
  Github,
  Globe2,
  LayoutGrid,
  MessageSquareText,
  NotebookPen,
  Plus,
  Sparkles,
  Trash2,
  X,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { useProcessingOverlay } from "./LoadingOverlay";
import { TactileButton } from "./TactileButton";
import { WidgetFrame } from "./WidgetFrame";

type Launcher = {
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  kind: "app" | "web" | "chrome-web" | "folder" | "executable";
  target: string;
  custom?: boolean;
};

type StoredLauncher = Pick<Launcher, "id" | "label" | "detail" | "kind" | "target">;

const CUSTOM_LAUNCHERS_STORAGE_KEY = "control-panel.custom-launchers";
const launcherShortcutCodes = [
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0",
  "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyM", "KeyN", "KeyQ", "KeyR", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
];
const MAX_LAUNCHERS = launcherShortcutCodes.length * 2;
const launchers: Launcher[] = [
  { id: "minecraft", label: "Minecraft", detail: "Launcher", icon: Gamepad2, kind: "app", target: "Minecraft Launcher" },
  { id: "chrome", label: "Chrome", detail: "Browser", icon: Chrome, kind: "app", target: "Chrome" },
  {
    id: "google-calendar",
    label: "Google",
    detail: "Calendar",
    icon: CalendarDays,
    kind: "web",
    target: "https://calendar.google.com",
  },
  { id: "chatgpt", label: "ChatGPT", detail: "Beta", icon: MessageSquareText, kind: "app", target: "ChatGPT (Beta)" },
  { id: "vscode", label: "VS Code", detail: "Choose folder", icon: FolderCode, kind: "folder", target: "" },
  { id: "youtube", label: "YouTube", detail: "Chrome", icon: Youtube, kind: "chrome-web", target: "youtube" },
  { id: "github", label: "GitHub", detail: "Chrome", icon: Github, kind: "chrome-web", target: "github" },
  { id: "gemini", label: "Gemini", detail: "Chrome", icon: Sparkles, kind: "chrome-web", target: "gemini" },
  { id: "neatnotes", label: "NeatNotes", detail: "Notes app", icon: NotebookPen, kind: "app", target: "NeatNotes" },
];

/**
 * Restores user-created shortcuts while rejecting malformed storage entries.
 * @returns Valid custom web and executable launchers.
 */
function initialCustomLaunchers(): Launcher[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CUSTOM_LAUNCHERS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.slice(0, MAX_LAUNCHERS - launchers.length).flatMap((item: Partial<StoredLauncher>) => {
      if (
        typeof item.id !== "string" ||
        typeof item.label !== "string" ||
        typeof item.target !== "string" ||
        (item.kind !== "web" && item.kind !== "executable")
      ) {
        return [];
      }
      return [{
        id: item.id,
        label: item.label,
        detail: item.kind === "web" ? "Website" : "Windows app",
        icon: item.kind === "web" ? Globe2 : AppWindow,
        kind: item.kind,
        target: item.target,
        custom: true,
      }];
    });
  } catch {
    return [];
  }
}

/**
 * Assigns stable order-based mappings to built-in and custom quick links.
 * @param index - Zero-based position in the visible launcher collection.
 * @returns A code-based shortcut combination understood by the global controller.
 */
function launcherShortcut(index: number) {
  const shifted = index >= launcherShortcutCodes.length;
  const code = launcherShortcutCodes[index % launcherShortcutCodes.length];
  return `Control+Alt+${shifted ? "Shift+" : ""}${code}`;
}

/**
 * Exposes curated shortcuts across native apps, websites, and VS Code folders.
 * @returns A launcher grid with per-action status feedback.
 * @remarks Side effects: opens URLs, launches apps, or prompts for a local directory.
 */
export function AppLauncherWidget() {
  // --- Launch State ---
  const [status, setStatus] = useState("Choose a destination");
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [customLaunchers, setCustomLaunchers] = useState<Launcher[]>(initialCustomLaunchers);
  const [adding, setAdding] = useState(false);
  const [launcherKind, setLauncherKind] = useState<"web" | "executable">("web");
  const [launcherName, setLauncherName] = useState("");
  const [launcherTarget, setLauncherTarget] = useState("");
  useProcessingOverlay(busyTarget !== null, `Opening ${busyTarget ?? "destination"}`);

  useEffect(() => {
    try {
      const stored: StoredLauncher[] = customLaunchers.map(({ id, label, detail, kind, target }) => ({
        id,
        label,
        detail,
        kind,
        target,
      }));
      window.localStorage.setItem(CUSTOM_LAUNCHERS_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      setStatus("Custom links work for this session but could not be saved");
    }
  }, [customLaunchers]);

  // --- Destination Routing ---

  /**
   * Dispatches a launcher entry through the runtime appropriate to its destination kind.
   * @param item - The configured destination selected by the user.
   * @returns A promise that resolves once the launch attempt is reflected in the UI.
   * @remarks Side effects: may open a browser, start an app, or show a native folder picker.
   */
  const launch = async (item: Launcher) => {
    setBusyTarget(item.label);
    try {
      // Browser previews bypass native plugins so the same widget remains testable in Vite.
      if (item.kind === "web") {
        if (isTauriRuntime()) await openExternal(item.target);
        else window.open(item.target, "_blank", "noopener,noreferrer");
        setStatus(`${item.label} opened`);
        return;
      }

      if (item.kind === "chrome-web") {
        if (isTauriRuntime()) await invoke("launch_chrome_site", { site: item.target });
        else {
          const previewSites: Record<string, string> = {
            youtube: "https://www.youtube.com/",
            github: "https://github.com/",
            gemini: "https://gemini.google.com/",
          };
          window.open(previewSites[item.target], "_blank", "noopener,noreferrer");
        }
        setStatus(`${item.label} opened in Chrome`);
        return;
      }

      if (!isTauriRuntime()) {
        setStatus(`${item.label} requires the desktop runtime`);
        return;
      }

      if (item.kind === "folder") {
        const selected = await openDialog({ directory: true, multiple: false, title: "Open folder in VS Code" });
        if (!selected) {
          setStatus("Folder selection canceled");
          return;
        }
        await invoke("open_vscode_directory", { path: selected });
        setStatus("Folder opened in VS Code");
        return;
      }

      if (item.kind === "executable") {
        await invoke("launch_custom_app", { path: item.target });
        setStatus(`${item.label} launched`);
        return;
      }

      await invoke("launch_app", { appName: item.target });
      setStatus(`${item.target} launched`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusyTarget(null);
    }
  };

  /**
   * Selects a Windows executable for a custom quick link.
   * @returns A promise that resolves after the native picker closes.
   * @remarks Side effects: opens a native file-selection dialog.
   */
  const chooseExecutable = async () => {
    if (!isTauriRuntime()) {
      setStatus("Windows app selection requires the installed desktop app");
      return;
    }
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "Choose a Windows application",
      filters: [{ name: "Windows application", extensions: ["exe"] }],
    });
    if (typeof selected === "string") setLauncherTarget(selected);
  };

  /**
   * Validates and persists a new website or executable quick link.
   * @returns Nothing.
   * @remarks Side effects: updates the custom launcher collection and local storage.
   */
  const addLauncher = () => {
    const label = launcherName.trim();
    const target = launcherTarget.trim();
    if (!label || !target) {
      setStatus("Add a name and destination first");
      return;
    }
    if (launchers.length + customLaunchers.length >= MAX_LAUNCHERS) {
      setStatus(`Quick links supports up to ${MAX_LAUNCHERS} shortcut mappings`);
      return;
    }
    if (launcherKind === "web") {
      try {
        const url = new URL(target);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        setStatus("Enter a complete http:// or https:// address");
        return;
      }
    }

    const launcher: Launcher = {
      id: `custom-${crypto.randomUUID()}`,
      label: label.slice(0, 32),
      detail: launcherKind === "web" ? "Website" : "Windows app",
      icon: launcherKind === "web" ? Globe2 : AppWindow,
      kind: launcherKind,
      target,
      custom: true,
    };
    setCustomLaunchers((current) => [...current, launcher]);
    setLauncherName("");
    setLauncherTarget("");
    setAdding(false);
    setStatus(`${launcher.label} added to Quick links`);
  };

  const allLaunchers = [...launchers, ...customLaunchers];

  // --- Widget Rendering ---
  return (
    <WidgetFrame
      widgetId="quick-links"
      title="Quick links"
      icon={<LayoutGrid size={16} strokeWidth={1.7} />}
      className="md:col-span-2 lg:col-span-5"
    >
      <div className="relative flex h-full min-h-[250px] flex-col p-3.5">
        <div className="horizontal-collection grid min-h-0 flex-1 grid-flow-col grid-rows-2 auto-cols-[92px] gap-2.5 overflow-x-auto pb-1 sm:auto-cols-[104px] lg:auto-cols-[calc((100%-2.5rem)/5)]">
          {allLaunchers.map((item, index) => {
            const Icon = item.icon;
            const busy = busyTarget === item.label;
            return (
              <div key={item.id} className="group relative aspect-square min-h-0">
                <TactileButton
                  onClick={() => void launch(item)}
                  disabled={busyTarget !== null}
                  aria-label={`${item.label} ${item.detail}`}
                  data-shortcut-combo={launcherShortcut(index)}
                  data-shortcut-id={`launcher:${item.id}`}
                  data-shortcut-label={`Open ${item.label}`}
                  data-shortcut-detail={item.detail}
                  data-shortcut-group="Quick links"
                  data-shortcut-order={index}
                  data-launcher-id={item.id}
                  data-launcher-label={item.label}
                  className="size-full"
                >
                  <span className="flex h-full min-h-0 flex-col items-center justify-center px-1.5 py-2 text-center">
                    <span className="mb-2 grid size-8 place-items-center rounded-[8px] border border-black/50 bg-black/15 text-signal-300 shadow-well">
                      <Icon size={18} strokeWidth={1.55} className={busy ? "animate-pulse" : ""} />
                    </span>
                    <span className="max-w-full truncate text-[11px] font-semibold text-stone-200">{item.label}</span>
                    <span className="mt-0.5 max-w-full truncate text-[9px] uppercase tracking-[0.06em] text-stone-600">
                      {item.detail}
                    </span>
                  </span>
                </TactileButton>
                {item.custom && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomLaunchers((current) => current.filter((launcher) => launcher.id !== item.id));
                      setStatus(`${item.label} removed from Quick links`);
                    }}
                    className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/70 text-stone-600 opacity-0 transition hover:text-red-300 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                    aria-label={`Remove ${item.label}`}
                    title={`Remove ${item.label}`}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            );
          })}
          <TactileButton
            onClick={() => setAdding(true)}
            className="aspect-square min-h-0 border-dashed"
            aria-label="Add a quick link"
          >
            <span className="flex h-full flex-col items-center justify-center gap-2 text-stone-500">
              <Plus size={19} className="text-signal-400" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.11em]">Add link</span>
            </span>
          </TactileButton>
        </div>

        <div className="mt-3 flex h-8 items-center gap-2 rounded-lg border border-black/50 bg-black/15 px-3 shadow-well">
          <span className="size-1.5 shrink-0 rounded-full bg-signal-500 shadow-amber-led" aria-hidden="true" />
          <p className="truncate font-mono text-[11px] text-stone-500" aria-live="polite" title={status}>
            {status}
          </p>
        </div>

        {adding && (
          <div className="absolute inset-2 z-30 flex flex-col rounded-xl border border-white/[0.08] bg-graphite-900/95 p-3 shadow-panel backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-stone-200">Add quick link</p>
                <p className="mt-0.5 text-[9px] text-stone-600">Saved on this device</p>
              </div>
              <button type="button" onClick={() => setAdding(false)} className="deck-button" aria-label="Close add link">
                <X size={15} />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["web", "executable"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    setLauncherKind(kind);
                    setLauncherTarget("");
                  }}
                  className={`rounded-lg border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] ${launcherKind === kind ? "border-signal-400/45 bg-signal-400/10 text-signal-300" : "border-white/[0.06] text-stone-600"}`}
                >
                  {kind === "web" ? "Website" : "Windows app"}
                </button>
              ))}
            </div>
            <input
              value={launcherName}
              onChange={(event) => setLauncherName(event.target.value)}
              placeholder="Display name"
              maxLength={32}
              className="mt-2 rounded-lg border border-white/[0.07] bg-black/35 px-3 py-2 text-xs text-stone-200 outline-none placeholder:text-stone-700 focus:border-signal-400/50"
            />
            {launcherKind === "web" ? (
              <input
                value={launcherTarget}
                onChange={(event) => setLauncherTarget(event.target.value)}
                placeholder="https://example.com"
                className="mt-2 rounded-lg border border-white/[0.07] bg-black/35 px-3 py-2 font-mono text-[10px] text-stone-200 outline-none placeholder:text-stone-700 focus:border-signal-400/50"
              />
            ) : (
              <button
                type="button"
                onClick={() => void chooseExecutable()}
                className="mt-2 truncate rounded-lg border border-dashed border-white/[0.09] bg-black/20 px-3 py-2 text-left font-mono text-[10px] text-stone-500 hover:border-signal-400/40 hover:text-stone-300"
                title={launcherTarget || "Choose an executable"}
              >
                {launcherTarget || "Choose an .exe file…"}
              </button>
            )}
            <TactileButton onClick={addLauncher} className="mt-auto h-9 text-[10px] font-semibold uppercase tracking-[0.1em]">
              Add to Quick links
            </TactileButton>
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}
