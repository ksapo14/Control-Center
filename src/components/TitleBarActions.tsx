import { invoke } from "@tauri-apps/api/core";
import { Minus, X } from "lucide-react";
import { isTauriRuntime } from "../lib/runtime";

export function TitleBarActions() {
  const runWindowAction = async (action: "minimize" | "close") => {
    if (!isTauriRuntime()) return;
    await invoke(action === "minimize" ? "minimize_main_window" : "close_main_window");
  };

  return (
    <div className="flex items-center gap-1" data-tauri-drag-region="false">
      <button
        type="button"
        aria-label="Minimize control panel"
        data-tauri-drag-region="false"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void runWindowAction("minimize")}
        className="titlebar-button"
      >
        <Minus size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label="Close control panel"
        data-tauri-drag-region="false"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void runWindowAction("close")}
        className="titlebar-button hover:text-signal-300"
      >
        <X size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}
