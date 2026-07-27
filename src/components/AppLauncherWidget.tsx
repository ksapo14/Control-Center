import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  CalendarDays,
  Chrome,
  FolderCode,
  Gamepad2,
  LayoutGrid,
  MessageSquareText,
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
  kind: "app" | "web" | "folder";
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
];

export function AppLauncherWidget() {
  const [status, setStatus] = useState("Choose a destination");
  const [busyTarget, setBusyTarget] = useState<string | null>(null);

  const launch = async (item: Launcher) => {
    setBusyTarget(item.label);
    try {
      if (item.kind === "web") {
        if (isTauriRuntime()) await openExternal(item.target);
        else window.open(item.target, "_blank", "noopener,noreferrer");
        setStatus("Calendar opened");
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

  return (
    <WidgetFrame
      title="Applications"
      icon={<LayoutGrid size={16} strokeWidth={1.7} />}
      className="md:col-span-2 lg:col-span-5"
    >
      <div className="flex h-full min-h-[250px] flex-col p-3.5">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {launchers.map((item, index) => {
            const Icon = item.icon;
            const busy = busyTarget === item.label;
            return (
              <TactileButton
                key={item.label}
                onClick={() => void launch(item)}
                disabled={busyTarget !== null}
                aria-label={`${item.label} ${item.detail}`}
                className={index === launchers.length - 1 ? "col-span-2 sm:col-span-1" : undefined}
              >
                <span className="flex h-full min-h-[94px] flex-col items-center justify-center px-2 py-3 text-center">
                  <span className="mb-3 grid size-10 place-items-center rounded-[9px] border border-black/50 bg-black/15 text-signal-300 shadow-well">
                    <Icon size={21} strokeWidth={1.55} className={busy ? "animate-pulse" : ""} />
                  </span>
                  <span className="whitespace-nowrap text-xs font-semibold text-stone-200">{item.label}</span>
                  <span className="mt-1 whitespace-nowrap text-[10px] uppercase tracking-[0.08em] text-stone-600">
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
