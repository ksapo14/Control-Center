import { invoke } from "@tauri-apps/api/core";
import { Sun, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { WidgetFrame } from "./WidgetFrame";

function VolumeGlyph({ level }: { level: number }) {
  if (level === 0) return <VolumeX size={19} strokeWidth={1.7} />;
  if (level < 45) return <Volume1 size={19} strokeWidth={1.7} />;
  return <Volume2 size={19} strokeWidth={1.7} />;
}

type ControlRailProps = {
  label: string;
  value: number;
  icon: ReactNode;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function ControlRail({ label, value, icon, disabled = false, onChange }: ControlRailProps) {
  return (
    <div className={disabled ? "opacity-45" : undefined}>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div className="flex items-center gap-2 text-stone-500">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</span>
        </div>
        <p className="font-mono text-2xl font-medium leading-none tracking-[-0.07em] text-stone-100">
          {String(value).padStart(2, "0")}
          <span className="ml-1 text-[10px] tracking-normal text-stone-600">%</span>
        </p>
      </div>
      <div className="rounded-[10px] border border-black/70 bg-[#080908] px-3 py-2.5 shadow-well">
        <input
          aria-label={`System ${label.toLowerCase()}`}
          type="range"
          min="0"
          max="100"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="control-range w-full"
          style={{ "--level": `${value}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}

export function VolumeWidget() {
  const [volume, setVolume] = useState(42);
  const [brightness, setBrightness] = useState(62);
  const [brightnessAvailable, setBrightnessAvailable] = useState(true);
  const [status, setStatus] = useState("Reading system controls");
  const volumeTimer = useRef<number>();
  const brightnessTimer = useRef<number>();

  useEffect(() => {
    let active = true;
    if (!isTauriRuntime()) {
      setStatus("Preview controls");
      return () => {
        active = false;
      };
    }

    void Promise.allSettled([
      invoke<number>("get_system_volume"),
      invoke<number>("get_system_brightness"),
    ]).then(([volumeResult, brightnessResult]) => {
      if (!active) return;
      if (volumeResult.status === "fulfilled") setVolume(volumeResult.value);
      if (brightnessResult.status === "fulfilled") {
        setBrightness(brightnessResult.value);
      } else {
        setBrightnessAvailable(false);
      }
      setStatus(brightnessResult.status === "fulfilled" ? "Audio and internal display" : "Brightness unavailable on this display");
    });

    return () => {
      active = false;
      if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
      if (brightnessTimer.current) window.clearTimeout(brightnessTimer.current);
    };
  }, []);

  const changeVolume = (next: number) => {
    setVolume(next);
    if (!isTauriRuntime()) return;
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => {
      void invoke("set_system_volume", { level: next }).catch((error: unknown) => setStatus(errorMessage(error)));
    }, 80);
  };

  const changeBrightness = (next: number) => {
    setBrightness(next);
    if (!isTauriRuntime()) return;
    if (brightnessTimer.current) window.clearTimeout(brightnessTimer.current);
    brightnessTimer.current = window.setTimeout(() => {
      void invoke("set_system_brightness", { level: next })
        .then(() => setStatus("Audio and internal display"))
        .catch((error: unknown) => setStatus(errorMessage(error)));
    }, 180);
  };

  return (
    <WidgetFrame
      title="Audio and display"
      icon={<Volume2 size={16} strokeWidth={1.7} />}
      className="lg:col-span-5"
    >
      <div className="flex h-full min-h-[186px] flex-col justify-between p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
          <ControlRail
            label="Volume"
            value={volume}
            icon={<Volume2 size={14} strokeWidth={1.7} />}
            onChange={changeVolume}
          />
          <ControlRail
            label="Brightness"
            value={brightness}
            icon={<Sun size={14} strokeWidth={1.7} />}
            disabled={!brightnessAvailable}
            onChange={changeBrightness}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <span className="sr-only" aria-live="polite">{status}</span>
          <TactileButton aria-label="Mute system volume" onClick={() => changeVolume(0)} className="grid size-9 place-items-center">
            <VolumeGlyph level={volume} />
          </TactileButton>
        </div>
      </div>
    </WidgetFrame>
  );
}
