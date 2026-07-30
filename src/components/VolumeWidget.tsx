import { invoke } from "@tauri-apps/api/core";
import { Play, SkipBack, SkipForward, Sun, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { WidgetFrame } from "./WidgetFrame";

/**
 * Selects a volume glyph using thresholds that remain legible at widget scale.
 * @param props - The current system volume percentage.
 * @returns A muted, low-volume, or full-volume glyph.
 */
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

type MediaAction = "previous" | "play_pause" | "next";

/**
 * Renders a labeled percentage control shared by volume and brightness.
 * @param props - The control label, value, icon, availability, and change callback.
 * @returns An accessible range control with a numeric readout.
 */
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

/**
 * Coordinates optimistic volume and brightness controls with the Windows backend.
 * @returns The combined audio and display control widget.
 * @remarks Side effects: reads and writes native system settings through Tauri commands.
 */
export function VolumeWidget() {
  // --- Control State and Initial Read ---
  const [volume, setVolume] = useState(42);
  const [brightness, setBrightness] = useState(62);
  const [brightnessAvailable, setBrightnessAvailable] = useState(true);
  const [status, setStatus] = useState("Reading system controls");
  const [mediaBusy, setMediaBusy] = useState<MediaAction | null>(null);
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
      setStatus(brightnessResult.status === "fulfilled" ? "Audio, media and internal display" : "Brightness unavailable on this display");
    });

    return () => {
      active = false;
      if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
      if (brightnessTimer.current) window.clearTimeout(brightnessTimer.current);
    };
  }, []);

  // --- Debounced Native Writes ---

  /**
   * Applies volume optimistically and coalesces rapid slider events.
   * @param next - The requested volume percentage.
   * @returns Nothing.
   * @remarks Side effects: updates local state and schedules a native volume write.
   */
  const changeVolume = (next: number) => {
    setVolume(next);
    if (!isTauriRuntime()) return;
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    // Debouncing keeps native COM traffic bounded while the range thumb is dragged.
    volumeTimer.current = window.setTimeout(() => {
      void invoke("set_system_volume", { level: next }).catch((error: unknown) => setStatus(errorMessage(error)));
    }, 80);
  };

  /**
   * Applies brightness optimistically and coalesces rapid slider events.
   * @param next - The requested brightness percentage.
   * @returns Nothing.
   * @remarks Side effects: updates local state and schedules a native display write.
   */
  const changeBrightness = (next: number) => {
    setBrightness(next);
    if (!isTauriRuntime()) return;
    if (brightnessTimer.current) window.clearTimeout(brightnessTimer.current);
    brightnessTimer.current = window.setTimeout(() => {
      void invoke("set_system_brightness", { level: next })
        .then(() => setStatus("Audio, media and internal display"))
        .catch((error: unknown) => setStatus(errorMessage(error)));
    }, 180);
  };

  const controlMedia = async (action: MediaAction) => {
    if (mediaBusy) return;
    setMediaBusy(action);
    try {
      if (isTauriRuntime()) await invoke("media_control", { action });
      setStatus(action === "previous" ? "Previous track" : action === "next" ? "Next track" : "Play or pause sent");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setMediaBusy(null);
    }
  };

  // --- Widget Rendering ---
  return (
    <WidgetFrame
      widgetId="volume"
      title="Audio, media and display"
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
        <div className="mt-3 flex items-end justify-between gap-3">
          <span className="sr-only" aria-live="polite">{status}</span>
          <div>
            <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-600">Media</p>
            <div className="flex items-center gap-1.5">
              <TactileButton aria-label="Previous track" title="Previous track" disabled={mediaBusy !== null} onClick={() => void controlMedia("previous")} data-speech-id="media:previous" data-speech-label="Previous media track" data-speech-phrase="previous media|previous track" data-control-action="media-previous" className="grid size-9 place-items-center">
                <SkipBack size={16} strokeWidth={1.8} />
              </TactileButton>
              <TactileButton aria-label="Play or pause media" title="Play or pause" disabled={mediaBusy !== null} onClick={() => void controlMedia("play_pause")} data-speech-id="media:toggle" data-speech-label="Play or pause media" data-speech-phrase="toggle media|play pause media" data-control-action="media-play-pause" className="grid size-9 place-items-center">
                <Play size={16} strokeWidth={1.8} />
              </TactileButton>
              <TactileButton aria-label="Next track" title="Next track" disabled={mediaBusy !== null} onClick={() => void controlMedia("next")} data-speech-id="media:next" data-speech-label="Next media track" data-speech-phrase="next media|next track" data-control-action="media-next" className="grid size-9 place-items-center">
                <SkipForward size={16} strokeWidth={1.8} />
              </TactileButton>
            </div>
          </div>
          <TactileButton aria-label="Mute system volume" onClick={() => changeVolume(0)} data-speech-id="volume:mute" data-speech-label="Mute system volume" data-speech-phrase="mute computer|mute volume" className="grid size-9 place-items-center">
            <VolumeGlyph level={volume} />
          </TactileButton>
        </div>
      </div>
    </WidgetFrame>
  );
}
