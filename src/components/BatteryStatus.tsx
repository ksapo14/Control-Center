import { invoke } from "@tauri-apps/api/core";
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
} from "lucide-react";
import { useEffect, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";

type BatteryData = {
  level: number | null;
  charging: boolean;
  present: boolean;
};

/**
 * Selects the icon that best communicates the current battery state.
 * @param props - The normalized battery reading.
 * @returns A charging, level-specific, or unavailable battery glyph.
 */
function BatteryGlyph({ battery }: { battery: BatteryData }) {
  if (battery.charging) return <BatteryCharging size={14} strokeWidth={1.7} />;
  if (!battery.present || battery.level === null) return <Battery size={14} strokeWidth={1.7} />;
  if (battery.level <= 20) return <BatteryLow size={14} strokeWidth={1.7} />;
  if (battery.level <= 65) return <BatteryMedium size={14} strokeWidth={1.7} />;
  return <BatteryFull size={14} strokeWidth={1.7} />;
}

/**
 * Displays the latest Windows battery state in the application header.
 * @returns A compact, accessible battery status indicator.
 * @remarks Side effects: polls the native battery command once per minute while mounted.
 */
export function BatteryStatus() {
  // --- Native State Synchronization ---
  const [battery, setBattery] = useState<BatteryData>({
    level: 78,
    charging: false,
    present: true,
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;

    // Guard late native responses so an unmounted header is never updated.
    let active = true;
    const refresh = () => {
      void invoke<BatteryData>("get_battery_status")
        .then((next) => {
          if (active) setBattery(next);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // --- Display Model ---
  const label = battery.present && battery.level !== null ? `${battery.level}%` : "AC";

  return (
    <div
      className="flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-white/[0.055] bg-[#090a09] px-2.5 text-stone-400 shadow-well"
      title={`${battery.charging ? "Charging · " : ""}${label}`}
      aria-label={`${battery.charging ? "Charging, " : ""}${label}`}
    >
      <span className={battery.charging ? "text-signal-300" : "text-stone-500"}>
        <BatteryGlyph battery={battery} />
      </span>
      <span className="font-mono text-[10px] tabular-nums">{label}</span>
    </div>
  );
}
