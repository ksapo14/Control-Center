import { Gauge, Power } from "lucide-react";
import { AppLauncherWidget } from "./components/AppLauncherWidget";
import { BatteryStatus } from "./components/BatteryStatus";
import { BluetoothWidget } from "./components/BluetoothWidget";
import { ClockWidget } from "./components/ClockWidget";
import { PomodoroTimer } from "./components/PomodoroTimer";
import { KeyboardShortcutControls } from "./components/KeyboardShortcuts";
import { QuickSchedule } from "./components/QuickSchedule";
import { SpotifyWidget } from "./components/SpotifyWidget";
import { SystemVitalsWidget } from "./components/SystemVitalsWidget";
import { TaskManager } from "./components/TaskManager";
import { TitleBarActions } from "./components/TitleBarActions";
import { VolumeWidget } from "./components/VolumeWidget";
import {
  DashboardCustomizationProvider,
  ThemePicker,
} from "./components/DashboardCustomization";
import {
  ControlCenterControls,
  ControlCenterProvider,
} from "./components/ControlCenter";

/**
 * Renders the root control-panel shell and arranges the system widgets.
 * @returns The complete application interface.
 */
export default function App() {
  // --- Dashboard Layout ---
  return (
    <DashboardCustomizationProvider>
      <ControlCenterProvider>
      <main className="relative min-h-[100dvh] overflow-x-hidden bg-graphite-950 text-stone-100">
        <div className="ambient-light pointer-events-none fixed inset-0" />
        <div className="noise-layer pointer-events-none fixed inset-0" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1600px] flex-col px-3 pb-3 pt-2 sm:px-5 sm:pb-5">
        <header
          className="flex h-14 shrink-0 items-center justify-between px-1 sm:px-2"
          data-tauri-drag-region
        >
          <div className="flex min-w-0 items-center gap-3" data-tauri-drag-region>
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-black/60 border-t-white/15 bg-gradient-to-br from-[#343835] to-[#1b1d1c] text-signal-300 shadow-skeuo-raised">
              <Gauge size={17} strokeWidth={1.6} />
            </span>
            <div className="min-w-0" data-tauri-drag-region>
              <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-stone-200" data-tauri-drag-region>
                Control Panel
              </h1>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-stone-600" data-tauri-drag-region>
                Personal console
              </p>
            </div>
          </div>

          <div className="header-control-strip flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto sm:gap-2.5">
            <ThemePicker />
            <div className="hidden items-center gap-2 rounded-lg border border-black/50 bg-black/10 px-2.5 py-1.5 shadow-well sm:flex">
              <Power size={11} strokeWidth={1.9} className="text-signal-300" />
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone-500">System ready</span>
            </div>
            <ControlCenterControls />
            <KeyboardShortcutControls />
            <TaskManager />
            <QuickSchedule />
            <BatteryStatus />
            <TitleBarActions />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12 lg:grid-rows-[minmax(190px,0.82fr)_minmax(255px,1.08fr)_minmax(178px,0.78fr)] sm:gap-4">
          <ClockWidget />
          <VolumeWidget />
          <BluetoothWidget />
          <AppLauncherWidget />
          <SpotifyWidget />
          <SystemVitalsWidget />
          <PomodoroTimer />
        </div>
        </div>
      </main>
      </ControlCenterProvider>
    </DashboardCustomizationProvider>
  );
}
