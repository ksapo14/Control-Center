import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  CalendarDays,
  Chrome,
  FolderCode,
  Gamepad2,
  Github,
  LayoutGrid,
  MessageSquareText,
  NotebookPen,
  Sparkles,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { WidgetFrame } from "./WidgetFrame";

type Launcher = {
  label: string;
  detail: string;
  icon: LucideIcon;
  kind: "app" | "web" | "chrome-web" | "folder";
  target: string;
};

const launchers: Launcher[] = [
  { label: "Minecraft", detail: "Launcher", icon: Gamepad2, kind: "app", target: "Minecraft Launcher" },
  { label: "Chrome", detail: "Browser", icon: Chrome, kind: "app", target: "Chrome" },
  {
    label: "Google",
    detail: "Calendar",
    icon: CalendarDays,
    kind: "web",
    target: "https://calendar.google.com",
  },
  { label: "ChatGPT", detail: "Beta", icon: MessageSquareText, kind: "app", target: "ChatGPT (Beta)" },
  { label: "VS Code", detail: "Choose folder", icon: FolderCode, kind: "folder", target: "" },
  { label: "YouTube", detail: "Chrome", icon: Youtube, kind: "chrome-web", target: "youtube" },
  { label: "GitHub", detail: "Chrome", icon: Github, kind: "chrome-web", target: "github" },
  { label: "Gemini", detail: "Chrome", icon: Sparkles, kind: "chrome-web", target: "gemini" },
  { label: "NeatNotes", detail: "Notes app", icon: NotebookPen, kind: "app", target: "NeatNotes" },
];

/**
 * Exposes curated shortcuts across native apps, websites, and VS Code folders.
 * @returns A launcher grid with per-action status feedback.
 * @remarks Side effects: opens URLs, launches apps, or prompts for a local directory.
 */
export function AppLauncherWidget() {
  // --- Launch State ---
  const [status, setStatus] = useState("Choose a destination");
  const [busyTarget, setBusyTarget] = useState<string | null>(null);

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

      await invoke("launch_app", { appName: item.target });
      setStatus(`${item.target} launched`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusyTarget(null);
    }
  };

  // --- Widget Rendering ---
  return (
    <WidgetFrame
      title="Quick links"
      icon={<LayoutGrid size={16} strokeWidth={1.7} />}
      className="md:col-span-2 lg:col-span-5"
    >
      <div className="flex h-full min-h-[250px] flex-col p-3.5">
        <div className="grid flex-1 grid-cols-3 gap-2.5 lg:grid-cols-5">
          {launchers.map((item) => {
            const Icon = item.icon;
            const busy = busyTarget === item.label;
            return (
              <TactileButton
                key={item.label}
                onClick={() => void launch(item)}
                disabled={busyTarget !== null}
                aria-label={`${item.label} ${item.detail}`}
                className="aspect-square min-h-0"
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
            );
          })}
        </div>

        <div className="mt-3 flex h-8 items-center gap-2 rounded-lg border border-black/50 bg-black/15 px-3 shadow-well">
          <span className="size-1.5 shrink-0 rounded-full bg-signal-500 shadow-amber-led" aria-hidden="true" />
          <p className="truncate font-mono text-[11px] text-stone-500" aria-live="polite" title={status}>
            {status}
          </p>
        </div>
      </div>
    </WidgetFrame>
  );
}
