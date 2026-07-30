import { AppLauncherWidget } from "./components/AppLauncherWidget";
import { BatteryStatus } from "./components/BatteryStatus";
import { BluetoothWidget } from "./components/BluetoothWidget";
import { ClockWidget } from "./components/ClockWidget";
import { FinancialTracker } from "./components/FinancialTracker";
import { PomodoroTimer } from "./components/PomodoroTimer";
import { Planning } from "./components/Planning";
import { PhoneMode } from "./components/PhoneMode";
import { ProductivityEnvironment } from "./components/ProductivityEnvironment";
import { KeyboardShortcutControls } from "./components/KeyboardShortcuts";
import { QuickSchedule } from "./components/QuickSchedule";
import { SpotifyWidget } from "./components/SpotifyWidget";
import { SpeechMode } from "./components/SpeechMode";
import { SystemVitalsWidget } from "./components/SystemVitalsWidget";
import { TaskHabitTracker } from "./components/TaskHabitTracker";
import { TaskManager } from "./components/TaskManager";
import { TitleBarActions } from "./components/TitleBarActions";
import { VolumeWidget } from "./components/VolumeWidget";
import { VibeMixer } from "./components/VibeMixer";
import { ProcessingOverlayProvider } from "./components/LoadingOverlay";
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
    <ProcessingOverlayProvider>
      <DashboardCustomizationProvider>
        <ControlCenterProvider>
          <main className="dashboard-root relative min-h-[100dvh] overflow-x-hidden text-stone-100">
            <div className="ambient-light pointer-events-none fixed inset-0" />
            <div className="noise-layer pointer-events-none fixed inset-0" />

            <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1600px] flex-col px-3 pb-3 pt-2 sm:px-5 sm:pb-5">
              <header
                className="flex h-14 shrink-0 items-center justify-between px-1 sm:px-2"
                data-tauri-drag-region
              >
                <div className="min-w-6 flex-1 self-stretch" data-tauri-drag-region />
                <div className="flex min-w-0 max-w-full flex-shrink items-center justify-end gap-1.5 sm:gap-2.5">
                  <PhoneMode />
                  <div className="header-control-strip flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2.5">
                    <VibeMixer />
                    <ThemePicker />
                    <ControlCenterControls />
                    <KeyboardShortcutControls />
                    <SpeechMode />
                    <TaskManager />
                    <TaskHabitTracker />
                    <Planning />
                    <QuickSchedule />
                    <FinancialTracker />
                    <BatteryStatus />
                    <ProductivityEnvironment />
                    <TitleBarActions />
                  </div>
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
    </ProcessingOverlayProvider>
  );
}
