import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Disc3,
  FolderPlus,
  Gauge,
  Headphones,
  ListMusic,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Tag,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AudioReactiveFocusBackdrop, type AudioBands } from "./AudioReactiveFocusBackdrop";
import { TactileButton } from "./TactileButton";
import { isTauriRuntime } from "../lib/runtime";

type DeckId = "A" | "B";
type ModulationMode = "flanger" | "phaser";
type DeckControlKey = "filter" | "pitch" | "trim" | "low" | "mid" | "high" | "channelLevel" | "bpm" | "keyShift" | "vinylBrake" | "beatJumpIndex" | "displayBrightness";
type DeckToggleKey = "masterTempo" | "vinylMode" | "slipMode" | "quantize";
type DeckAction = "play" | "cue" | "monitor" | "sync" | "keySync" | "memory" | "memoryPrevious" | "memoryNext" | "memoryDelete" | "loopFour" | "loopEight" | "loopHalf" | "loopDouble" | "reloop" | "beatBack" | "beatForward" | "hotCue" | "tagTrack" | "shortcut";

type LocalTrack = {
  id: string;
  name: string;
  extension: string;
  size: number;
  url: string;
  duration: number | null;
  tagged: boolean;
  bpm: number;
};

type DeckState = {
  trackId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  filter: number;
  pitch: number;
  trim: number;
  low: number;
  mid: number;
  high: number;
  channelLevel: number;
  bpm: number;
  keyShift: number;
  vinylBrake: number;
  beatJumpIndex: number;
  displayBrightness: number;
  masterTempo: boolean;
  vinylMode: boolean;
  slipMode: boolean;
  quantize: boolean;
  cuePoint: number;
  hotCues: Array<number | null>;
  memoryPoints: number[];
  memoryIndex: number;
  loopStart: number | null;
  loopEnd: number | null;
  loopEnabled: boolean;
  loopBeats: number;
  slipReverse: boolean;
  shortcutOpen: boolean;
};

type MixerSettings = {
  low: number;
  mid: number;
  high: number;
  color: number;
  echo: number;
  reverb: number;
  modulation: number;
  modulationMode: ModulationMode;
  master: number;
};

type AudioRuntime = {
  context: AudioContext;
  analyser: AnalyserNode;
  deckAnalysers: Record<DeckId, AnalyserNode>;
  deckFilters: Record<DeckId, BiquadFilterNode>;
  deckTrimGains: Record<DeckId, GainNode>;
  deckLowEqs: Record<DeckId, BiquadFilterNode>;
  deckMidEqs: Record<DeckId, BiquadFilterNode>;
  deckHighEqs: Record<DeckId, BiquadFilterNode>;
  channelFaders: Record<DeckId, GainNode>;
  deckGains: Record<DeckId, GainNode>;
  cueDeckGains: Record<DeckId, GainNode>;
  cueBusGain: GainNode;
  monitorMasterGain: GainNode;
  monitorVolumeGain: GainNode;
  cueDestination: MediaStreamAudioDestinationNode;
  masterDirectGain: GainNode;
  masterDestination: MediaStreamAudioDestinationNode;
  lowEq: BiquadFilterNode;
  midEq: BiquadFilterNode;
  highEq: BiquadFilterNode;
  colorFilter: BiquadFilterNode;
  colorShaper: WaveShaperNode;
  echoDelay: DelayNode;
  echoWet: GainNode;
  reverbWet: GainNode;
  flangerWet: GainNode;
  phaserWet: GainNode;
  masterGain: GainNode;
  lfo: OscillatorNode;
};

type SinkSelectableAudio = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type OutputSelectableMediaDevices = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

type NativeAudioOutputDevice = {
  name: string;
  isDefault: boolean;
  formFactor: "speakers" | "headphones" | "headset" | "other";
};

const deckIds: DeckId[] = ["A", "B"];
const beatJumpValues = [0.5, 1, 2, 4, 8, 16, 32, 64] as const;
const makeDefaultDeckState = (): DeckState => ({
  trackId: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  filter: 0,
  pitch: 0,
  trim: 74,
  low: 0,
  mid: 0,
  high: 0,
  channelLevel: 82,
  bpm: 120,
  keyShift: 0,
  vinylBrake: 28,
  beatJumpIndex: 3,
  displayBrightness: 82,
  masterTempo: true,
  vinylMode: true,
  slipMode: false,
  quantize: true,
  cuePoint: 0,
  hotCues: Array.from({ length: 8 }, () => null),
  memoryPoints: [],
  memoryIndex: -1,
  loopStart: null,
  loopEnd: null,
  loopEnabled: false,
  loopBeats: 4,
  slipReverse: false,
  shortcutOpen: false,
});
const defaultMixer: MixerSettings = {
  low: 0,
  mid: 0,
  high: 0,
  color: 18,
  echo: 0,
  reverb: 0,
  modulation: 0,
  modulationMode: "flanger",
  master: 76,
};
const defaultCueDecks: Record<DeckId, boolean> = { A: false, B: false };
const defaultMonitorMix = -100;
const defaultMonitorVolume = 68;
const supportedAudioPattern = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function beatLength(bpm: number) {
  return 60 / Math.max(1, bpm);
}

function quantizedTime(state: DeckState, value: number) {
  if (!state.quantize) return value;
  const beat = beatLength(state.bpm);
  return Math.round(value / beat) * beat;
}

function deckBasePlaybackRate(state: DeckState) {
  const tempoRate = 1 + state.pitch / 100;
  const keyRate = Math.pow(2, state.keyShift / 12);
  return clamp(tempoRate * keyRate, 0.25, 4);
}

const genericAudioWords = new Set(["audio", "device", "headphones", "headset", "speakers", "speaker", "stereo", "hands", "free", "output"]);

function normalizedDeviceTokens(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !genericAudioWords.has(token));
}

function matchingBrowserOutput(name: string, devices: MediaDeviceInfo[]) {
  const target = normalizedDeviceTokens(name);
  if (target.length === 0) return null;
  let best: { device: MediaDeviceInfo; score: number } | null = null;
  for (const device of devices) {
    if (!device.label) continue;
    const candidate = normalizedDeviceTokens(device.label);
    const overlap = target.filter((token) => candidate.includes(token)).length;
    const score = overlap / Math.max(target.length, candidate.length, 1);
    if (!best || score > best.score) best = { device, score };
  }
  return best && best.score >= 0.24 ? best.device : null;
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "00:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(value: number) {
  if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1_000))} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function displayTrackName(name: string) {
  return name.replace(supportedAudioPattern, "");
}

function playbackErrorMessage(element: HTMLAudioElement, error: unknown) {
  if (element.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "This audio codec is not supported. Try a standard MP3 or WAV file.";
  }
  if (element.error?.code === MediaError.MEDIA_ERR_DECODE) {
    return "This audio file could not be decoded. It may be damaged or use an unsupported codec.";
  }
  return error instanceof Error ? error.message : "The audio deck could not start.";
}

function makeImpulseResponse(context: AudioContext) {
  const seconds = 2.15;
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const falloff = Math.pow(1 - index / length, 2.7);
      data[index] = (Math.random() * 2 - 1) * falloff;
    }
  }
  return impulse;
}

function makeColorCurve(amount: number) {
  const sampleCount = 1024;
  const curve = new Float32Array(sampleCount);
  const drive = amount / 100 * 2.8;
  for (let index = 0; index < sampleCount; index += 1) {
    const input = index / (sampleCount - 1) * 2 - 1;
    curve[index] = (1 + drive) * input / (1 + drive * Math.abs(input));
  }
  return curve;
}

function setAudioParam(param: AudioParam, value: number, context: AudioContext, response = 0.012) {
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, response);
}

function applyDeckFilter(node: BiquadFilterNode, value: number, context: AudioContext) {
  if (value < 0) {
    node.type = "lowpass";
    const amount = Math.abs(value) / 100;
    setAudioParam(node.frequency, 20_000 * Math.pow(320 / 20_000, amount), context);
    setAudioParam(node.Q, 0.72 + amount * 5.2, context);
    return;
  }
  if (value > 0) {
    node.type = "highpass";
    const amount = value / 100;
    setAudioParam(node.frequency, 24 * Math.pow(5_200 / 24, amount), context);
    setAudioParam(node.Q, 0.72 + amount * 4.4, context);
    return;
  }
  node.type = "lowpass";
  setAudioParam(node.frequency, 22_000, context);
  setAudioParam(node.Q, 0.0001, context);
}

function ControlSlider({
  label,
  value,
  min,
  max,
  step = 1,
  valueLabel,
  accent = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  valueLabel: string;
  accent?: boolean;
  onChange: (value: number) => void;
}) {
  const percentage = clamp((value - min) / (max - min), 0, 1) * 100;
  return (
    <label className={`vibe-slider-control ${accent ? "is-accent" : ""}`}>
      <span className="vibe-slider-meta">
        <span className="vibe-control-label">{label}</span>
        <output>{valueLabel}</output>
      </span>
      <span className="vibe-slider-well">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={`${label}, ${valueLabel}`}
          style={{ "--level": `${percentage}%` } as CSSProperties}
        />
      </span>
    </label>
  );
}

function VuMeter({ level, label }: { level: number; label: string }) {
  return (
    <div className="vibe-vu" aria-label={`${label} level ${Math.round(level * 100)} percent`}>
      <div className="vibe-vu-track" aria-hidden="true">
        <span className="vibe-vu-fill" style={{ height: `${clamp(level, 0, 1) * 100}%` }} />
        {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
      </div>
      <span>{label}</span>
    </div>
  );
}

function ChannelVolumeFader({ id, value, onChange }: { id: DeckId; value: number; onChange: (value: number) => void }) {
  return (
    <label className="vibe-channel-volume">
      <span className="vibe-control-label">CH {id} LEVEL</span>
      <div className="vibe-channel-volume-well">
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={`Deck ${id} channel volume`}
          aria-valuetext={`${value} percent`}
          style={{ "--channel-level": `${value}%` } as CSSProperties}
        />
        <div className="vibe-channel-volume-scale" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
        </div>
      </div>
      <output>{value}%</output>
    </label>
  );
}

function MixerChannel({
  id,
  state,
  track,
  meter,
  monitoring,
  onMonitor,
  onControl,
}: {
  id: DeckId;
  state: DeckState;
  track: LocalTrack | null;
  meter: number;
  monitoring: boolean;
  onMonitor: () => void;
  onControl: (key: DeckControlKey, value: number) => void;
}) {
  return (
    <section className={`vibe-mixer-channel vibe-mixer-channel-${id.toLowerCase()}`} aria-label={`Mixer channel ${id}`}>
      <header>
        <span>CHANNEL</span>
        <strong>{id}</strong>
        <small>{track ? displayTrackName(track.name) : "NO INPUT"}</small>
      </header>
      <div className="vibe-channel-signal-path">
        <div className="vibe-channel-eq-stack">
          <ControlSlider label="TRIM" value={state.trim} min={0} max={125} valueLabel={`${state.trim}%`} onChange={(value) => onControl("trim", value)} />
          <ControlSlider label="HIGH" value={state.high} min={-26} max={6} valueLabel={`${state.high > 0 ? "+" : ""}${state.high} dB`} onChange={(value) => onControl("high", value)} />
          <ControlSlider label="MID" value={state.mid} min={-26} max={6} valueLabel={`${state.mid > 0 ? "+" : ""}${state.mid} dB`} onChange={(value) => onControl("mid", value)} />
          <ControlSlider label="LOW" value={state.low} min={-26} max={6} valueLabel={`${state.low > 0 ? "+" : ""}${state.low} dB`} onChange={(value) => onControl("low", value)} />
          <ControlSlider
            label="FILTER"
            value={state.filter}
            min={-100}
            max={100}
            valueLabel={state.filter === 0 ? "OPEN" : state.filter < 0 ? `LP ${Math.abs(state.filter)}` : `HP ${state.filter}`}
            onChange={(value) => onControl("filter", value)}
          />
        </div>
        <div className="vibe-channel-output-stage">
          <button
            type="button"
            className={`vibe-channel-cue ${monitoring ? "is-selected" : ""}`}
            onClick={onMonitor}
            disabled={!track}
            aria-pressed={monitoring}
            title={`Cue deck ${id} in headphones before its channel fader`}
          >
            <Headphones size={12} strokeWidth={1.8} /> CUE
            <small>PFL</small>
          </button>
          <div className="vibe-channel-fader-row">
            <ChannelVolumeFader id={id} value={state.channelLevel} onChange={(value) => onControl("channelLevel", value)} />
            <VuMeter level={meter} label={id} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Deck({
  id,
  state,
  track,
  meter,
  onAction,
  onControl,
  onToggle,
  onSlipReverse,
  onSeek,
  onJog,
  onScrubStart,
  onScrubEnd,
  onBrowse,
}: {
  id: DeckId;
  state: DeckState;
  track: LocalTrack | null;
  meter: number;
  onAction: (action: DeckAction, payload?: number) => void;
  onControl: (key: DeckControlKey, value: number) => void;
  onToggle: (key: DeckToggleKey) => void;
  onSlipReverse: (active: boolean) => void;
  onSeek: (time: number) => void;
  onJog: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onBrowse: () => void;
}) {
  const platterRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<{ pointerId: number; angle: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const waveform = useMemo(() => {
    const seed = Array.from(track?.name ?? id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return Array.from({ length: 42 }, (_, index) => 18 + ((seed * (index + 7) * 13) % 78));
  }, [id, track?.name]);

  const pointerAngle = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = platterRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2));
  };

  const beginPlatterScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!track || state.duration <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = { pointerId: event.pointerId, angle: pointerAngle(event) };
    setScrubbing(true);
    onScrubStart();
  };

  const movePlatterScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextAngle = pointerAngle(event);
    let delta = nextAngle - scrub.angle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    scrub.angle = nextAngle;
    onJog(delta / (Math.PI * 2) * 10);
  };

  const endPlatterScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubRef.current?.pointerId !== event.pointerId) return;
    scrubRef.current = null;
    setScrubbing(false);
    onScrubEnd();
  };

  const handlePlatterKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!track || state.duration <= 0) return;
    const offsets: Partial<Record<string, number>> = {
      ArrowLeft: -5,
      ArrowDown: -5,
      ArrowRight: 5,
      ArrowUp: 5,
      PageDown: -15,
      PageUp: 15,
    };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onSeek(event.key === "Home" ? 0 : state.duration);
      return;
    }
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    onJog(offset);
  };

  return (
    <section
      className={`vibe-deck vibe-deck-${id.toLowerCase()}`}
      aria-label={`Deck ${id}`}
      style={{ "--display-level": `${state.displayBrightness}%` } as CSSProperties}
    >
      <div className="vibe-deck-heading">
        <div>
          <span className="vibe-eyebrow">DECK</span>
          <h3>{id}</h3>
        </div>
        <div className="vibe-deck-status">
          <span className={state.playing ? "is-live" : ""} />
          {state.playing ? "RUN" : track ? "READY" : "EMPTY"}
        </div>
      </div>

      <div className="vibe-deck-display">
        <div className="vibe-track-copy">
          <strong title={track?.name}>{track ? displayTrackName(track.name) : "No track loaded"}</strong>
          <span>{track ? `${track.extension} / ${formatBytes(track.size)} / ${state.bpm.toFixed(1)} BPM` : "Add audio from the library"}</span>
        </div>
        <span className="vibe-time-readout">{formatTime(state.currentTime)} / {formatTime(state.duration)}</span>
        <div className="vibe-deck-readouts" aria-label="Deck performance status">
          <span>{state.keyShift === 0 ? "KEY 0" : `KEY ${state.keyShift > 0 ? "+" : ""}${state.keyShift}`}</span>
          <span>{state.masterTempo ? "MT" : "RATE"}</span>
          <span>{state.loopEnabled ? `LOOP ${state.loopBeats}B` : "LOOP OFF"}</span>
        </div>
        <div className="vibe-waveform" aria-hidden="true">
          {waveform.map((height, index) => {
            const played = state.duration > 0 && index / waveform.length <= state.currentTime / state.duration;
            return <i key={index} className={played ? "is-played" : ""} style={{ height: `${height}%` }} />;
          })}
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(1, state.duration)}
          step="0.01"
          value={Math.min(state.currentTime, Math.max(1, state.duration))}
          disabled={!track}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="vibe-seek"
          aria-label={`Seek deck ${id}`}
          style={{ "--level": `${state.duration ? state.currentTime / state.duration * 100 : 0}%` } as CSSProperties}
        />
      </div>

      <div className="vibe-deck-mechanics">
        <div
          ref={platterRef}
          className={`vibe-platter ${state.playing ? "is-spinning" : ""} ${scrubbing ? "is-scrubbing" : ""}`}
          role="slider"
          tabIndex={track ? 0 : -1}
          aria-label={`Deck ${id} platter. Drag backward to slow down or forward to speed up. When paused, drag to seek.`}
          aria-disabled={!track}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, state.duration)}
          aria-valuenow={Math.min(state.currentTime, Math.max(1, state.duration))}
          aria-valuetext={`${formatTime(state.currentTime)} of ${formatTime(state.duration)}`}
          title={track ? `${state.vinylMode ? "Vinyl pitch bend" : "CDJ tempo nudge"}. Back slows down and forward speeds up.` : "Load a track to use the platter"}
          onPointerDown={beginPlatterScrub}
          onPointerMove={movePlatterScrub}
          onPointerUp={endPlatterScrub}
          onPointerCancel={endPlatterScrub}
          onKeyDown={handlePlatterKey}
        >
          <span className="vibe-platter-surface" aria-hidden="true">
            <span className="vibe-platter-rings" />
            <span className="vibe-platter-label">{id}</span>
            <span className="vibe-platter-pin" />
          </span>
          <span className="vibe-platter-hint" aria-hidden="true">{state.vinylMode ? "VINYL PITCH BEND" : "CDJ TEMPO NUDGE"}</span>
        </div>
        <div className="vibe-deck-controls">
          <div className="vibe-deck-sliders">
            <ControlSlider
              label="TEMPO"
              value={state.pitch}
              min={-16}
              max={16}
              step={0.1}
              valueLabel={`${state.pitch > 0 ? "+" : ""}${state.pitch.toFixed(1)}%`}
              accent={state.pitch !== 0}
              onChange={(value) => onControl("pitch", value)}
            />
            <ControlSlider
              label="VINYL BRAKE"
              value={state.vinylBrake}
              min={0}
              max={100}
              valueLabel={`${state.vinylBrake}%`}
              onChange={(value) => onControl("vinylBrake", value)}
            />
          </div>
          <div className="vibe-transport">
            <div className="vibe-deck-utility-buttons">
              <button type="button" className="vibe-cue-button" onClick={() => onAction("cue")} disabled={!track} title="Return to the stored cue point">
                <RotateCcw size={12} strokeWidth={1.8} /> CUE
              </button>
            </div>
            <TactileButton
              onClick={track ? () => onAction("play") : onBrowse}
              selected={state.playing}
              className="vibe-play-button"
              aria-label={track ? `${state.playing ? "Pause" : "Play"} deck ${id}` : `Choose audio for deck ${id}`}
            >
              {state.playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" className="translate-x-px" />}
            </TactileButton>
            <VuMeter level={meter} label={id} />
          </div>
        </div>
      </div>

      <div className="vibe-performance-bank" aria-label={`Deck ${id} CDJ performance controls`}>
        <div className="vibe-performance-switches">
          {([
            ["VINYL", "vinylMode"],
            ["SLIP", "slipMode"],
            ["QUANTIZE", "quantize"],
            ["MASTER TEMPO", "masterTempo"],
          ] as Array<[string, DeckToggleKey]>).map(([label, key]) => (
            <button key={key} type="button" className={`vibe-hardware-button ${state[key] ? "is-selected" : ""}`} onClick={() => onToggle(key)} aria-pressed={state[key]}>
              {label}
            </button>
          ))}
          <button type="button" className="vibe-hardware-button" onClick={() => onAction("sync")} disabled={!track}>BEAT SYNC</button>
          <button type="button" className="vibe-hardware-button" onClick={() => onAction("keySync")} disabled={!track}>KEY SYNC</button>
          <button
            type="button"
            className={`vibe-hardware-button is-danger ${state.slipReverse ? "is-selected" : ""}`}
            disabled={!track}
            onPointerDown={() => onSlipReverse(true)}
            onPointerUp={() => onSlipReverse(false)}
            onPointerCancel={() => onSlipReverse(false)}
            onPointerLeave={() => state.slipReverse && onSlipReverse(false)}
            onKeyDown={(event) => { if (!event.repeat && (event.key === " " || event.key === "Enter")) onSlipReverse(true); }}
            onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") onSlipReverse(false); }}
          >
            SLIP REV
          </button>
          <button type="button" className={`vibe-hardware-button ${track?.tagged ? "is-selected" : ""}`} onClick={() => onAction("tagTrack")} disabled={!track}>
            <Tag size={10} /> TAG TRACK
          </button>
        </div>

        <div className="vibe-loop-bank">
          <span className="vibe-bank-label">BEAT LOOP</span>
          <div>
            <button type="button" onClick={() => onAction("loopFour")} disabled={!track}>4 BEAT</button>
            <button type="button" onClick={() => onAction("loopEight")} disabled={!track}>8 BEAT</button>
            <button type="button" onClick={() => onAction("loopHalf")} disabled={!track}>1/2X</button>
            <button type="button" onClick={() => onAction("loopDouble")} disabled={!track}>2X</button>
            <button type="button" className={state.loopEnabled ? "is-selected" : ""} onClick={() => onAction("reloop")} disabled={!track}>RELOOP / EXIT</button>
          </div>
        </div>

        <div className="vibe-hot-cue-bank">
          <span className="vibe-bank-label">HOT CUE A-H</span>
          <div>
            {state.hotCues.map((cue, index) => (
              <button
                key={index}
                type="button"
                className={cue !== null ? "is-set" : ""}
                onClick={(event) => onAction("hotCue", event.shiftKey ? index + 100 : index)}
                disabled={!track}
                title={cue === null ? `Set hot cue ${String.fromCharCode(65 + index)}` : `Jump to ${formatTime(cue)}. Shift-click to clear.`}
              >
                <strong>{String.fromCharCode(65 + index)}</strong>
                <small>{cue === null ? "SET" : formatTime(cue)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="vibe-memory-bank">
          <span className="vibe-bank-label">CUE / LOOP MEMORY</span>
          <div>
            <button type="button" onClick={() => onAction("memoryPrevious")} disabled={!track || state.memoryPoints.length === 0}><ChevronLeft size={12} /></button>
            <output>{state.memoryPoints.length === 0 ? "EMPTY" : `${state.memoryIndex + 1}/${state.memoryPoints.length} ${formatTime(state.memoryPoints[Math.max(0, state.memoryIndex)] ?? 0)}`}</output>
            <button type="button" onClick={() => onAction("memoryNext")} disabled={!track || state.memoryPoints.length === 0}><ChevronRight size={12} /></button>
            <button type="button" onClick={() => onAction("memory")} disabled={!track}><Bookmark size={11} /> MEMORY</button>
            <button type="button" onClick={() => onAction("memoryDelete")} disabled={!track || state.memoryPoints.length === 0}>DELETE</button>
          </div>
        </div>

        <button type="button" className={`vibe-shortcut-button ${state.shortcutOpen ? "is-selected" : ""}`} onClick={() => onAction("shortcut")}>
          <Zap size={11} /> SHORTCUT
        </button>
        {state.shortcutOpen && (
          <div className="vibe-shortcut-panel">
            <ControlSlider label="TRACK BPM" value={state.bpm} min={60} max={200} step={0.1} valueLabel={state.bpm.toFixed(1)} onChange={(value) => onControl("bpm", value)} />
            <ControlSlider label="KEY SHIFT" value={state.keyShift} min={-12} max={12} valueLabel={`${state.keyShift > 0 ? "+" : ""}${state.keyShift} ST`} accent={state.keyShift !== 0} onChange={(value) => onControl("keyShift", value)} />
            <ControlSlider label="BEAT JUMP" value={state.beatJumpIndex} min={0} max={beatJumpValues.length - 1} valueLabel={`${beatJumpValues[state.beatJumpIndex]} BEAT`} onChange={(value) => onControl("beatJumpIndex", Math.round(value))} />
            <ControlSlider label="DISPLAY" value={state.displayBrightness} min={24} max={100} valueLabel={`${state.displayBrightness}%`} onChange={(value) => onControl("displayBrightness", value)} />
            <div className="vibe-beat-jump-buttons">
              <button type="button" onClick={() => onAction("beatBack")} disabled={!track}><SkipBack size={12} /> JUMP</button>
              <button type="button" onClick={() => onAction("beatForward")} disabled={!track}>JUMP <SkipForward size={12} /></button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** A two-deck local audio mixer with low-latency Web Audio effects. */
export function VibeMixer() {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [decks, setDecks] = useState<Record<DeckId, DeckState>>({
    A: makeDefaultDeckState(),
    B: makeDefaultDeckState(),
  });
  const [mixer, setMixer] = useState<MixerSettings>(defaultMixer);
  const [crossfade, setCrossfade] = useState(0);
  const [cueDecks, setCueDecks] = useState<Record<DeckId, boolean>>({ ...defaultCueDecks });
  const [monitorMix, setMonitorMix] = useState(defaultMonitorMix);
  const [monitorVolume, setMonitorVolume] = useState(defaultMonitorVolume);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [nativeAudioOutputs, setNativeAudioOutputs] = useState<NativeAudioOutputDevice[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [selectedOutputName, setSelectedOutputName] = useState("No headphone output selected");
  const [masterOutputName, setMasterOutputName] = useState("Computer sound output");
  const [monitorReady, setMonitorReady] = useState(false);
  const [meters, setMeters] = useState<Record<DeckId, number>>({ A: 0, B: 0 });
  const [status, setStatus] = useState("Drop in a few tracks and build the blend.");
  const [dragging, setDragging] = useState(false);
  const [tagListOnly, setTagListOnly] = useState(false);
  const [trackFilterOpen, setTrackFilterOpen] = useState(false);
  const [libraryBpm, setLibraryBpm] = useState(120);
  const [libraryBpmRange, setLibraryBpmRange] = useState(20);
  const reduceMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const audioRef = useRef<AudioRuntime | null>(null);
  const monitorElementRef = useRef<SinkSelectableAudio | null>(null);
  const masterElementRef = useRef<SinkSelectableAudio | null>(null);
  const frequencyDataRef = useRef<Uint8Array | null>(null);
  const deckFrequencyDataRef = useRef<Record<DeckId, Uint8Array | null>>({ A: null, B: null });
  const elementsRef = useRef<Record<DeckId, HTMLAudioElement> | null>(null);
  const slipOperationRef = useRef<Record<DeckId, { hiddenStart: number; startedAt: number; wasPlaying: boolean } | null>>({ A: null, B: null });
  const reverseTimerRef = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const brakeAnimationRef = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const jogReturnAnimationRef = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const jogReleaseTimerRef = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const playing = decks.A.playing || decks.B.playing;

  if (!elementsRef.current) {
    const a = new Audio();
    const b = new Audio();
    a.preload = "metadata";
    b.preload = "metadata";
    elementsRef.current = { A: a, B: b };
  }

  const updateCrossfadeGraph = useCallback((runtime: AudioRuntime, value: number) => {
    const normalized = (value + 100) / 200;
    const aGain = Math.cos(normalized * Math.PI / 2);
    const bGain = Math.sin(normalized * Math.PI / 2);
    setAudioParam(runtime.deckGains.A.gain, aGain, runtime.context, 0.006);
    setAudioParam(runtime.deckGains.B.gain, bGain, runtime.context, 0.006);
  }, []);

  const updateDeckGraph = useCallback((runtime: AudioRuntime, id: DeckId, state: DeckState) => {
    const { context } = runtime;
    setAudioParam(runtime.deckTrimGains[id].gain, state.trim / 100, context, 0.006);
    setAudioParam(runtime.deckLowEqs[id].gain, state.low, context);
    setAudioParam(runtime.deckMidEqs[id].gain, state.mid, context);
    setAudioParam(runtime.deckHighEqs[id].gain, state.high, context);
    setAudioParam(runtime.channelFaders[id].gain, state.channelLevel / 100, context, 0.006);
    applyDeckFilter(runtime.deckFilters[id], state.filter, context);
  }, []);

  const updateMonitorGraph = useCallback((
    runtime: AudioRuntime,
    cued: Record<DeckId, boolean>,
    mix: number,
    volume: number,
  ) => {
    const normalized = (mix + 100) / 200;
    const cueGain = Math.cos(normalized * Math.PI / 2);
    const masterGain = Math.sin(normalized * Math.PI / 2);
    for (const id of deckIds) {
      setAudioParam(runtime.cueDeckGains[id].gain, cued[id] ? 1 : 0, runtime.context, 0.004);
    }
    setAudioParam(runtime.cueBusGain.gain, cueGain, runtime.context, 0.006);
    setAudioParam(runtime.monitorMasterGain.gain, masterGain, runtime.context, 0.006);
    setAudioParam(runtime.monitorVolumeGain.gain, volume / 100, runtime.context, 0.006);
  }, []);

  const applyMixerGraph = useCallback((runtime: AudioRuntime, settings: MixerSettings) => {
    const { context } = runtime;
    setAudioParam(runtime.lowEq.gain, settings.low, context);
    setAudioParam(runtime.midEq.gain, settings.mid, context);
    setAudioParam(runtime.highEq.gain, settings.high, context);
    const colorRatio = settings.color / 100;
    setAudioParam(runtime.colorFilter.frequency, 20_000 * Math.pow(4_800 / 20_000, colorRatio), context);
    runtime.colorShaper.curve = makeColorCurve(settings.color);
    setAudioParam(runtime.echoWet.gain, settings.echo / 100 * 0.52, context);
    setAudioParam(runtime.echoDelay.delayTime, 0.11 + settings.echo / 100 * 0.38, context);
    setAudioParam(runtime.reverbWet.gain, settings.reverb / 100 * 0.48, context);
    const modulationWet = settings.modulation / 100 * 0.44;
    setAudioParam(runtime.flangerWet.gain, settings.modulationMode === "flanger" ? modulationWet : 0, context);
    setAudioParam(runtime.phaserWet.gain, settings.modulationMode === "phaser" ? modulationWet : 0, context);
    setAudioParam(runtime.masterGain.gain, settings.master / 100, context, 0.008);
  }, []);

  const ensureAudioGraph = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const elements = elementsRef.current;
    if (!elements) throw new Error("Audio decks are unavailable.");
    const context = new AudioContext({ latencyHint: "interactive" });
    const mixBus = context.createGain();
    const deckFilters = { A: context.createBiquadFilter(), B: context.createBiquadFilter() };
    const deckTrimGains = { A: context.createGain(), B: context.createGain() };
    const deckLowEqs = { A: context.createBiquadFilter(), B: context.createBiquadFilter() };
    const deckMidEqs = { A: context.createBiquadFilter(), B: context.createBiquadFilter() };
    const deckHighEqs = { A: context.createBiquadFilter(), B: context.createBiquadFilter() };
    const deckAnalysers = { A: context.createAnalyser(), B: context.createAnalyser() };
    const channelFaders = { A: context.createGain(), B: context.createGain() };
    const deckGains = { A: context.createGain(), B: context.createGain() };
    const cueDeckGains = { A: context.createGain(), B: context.createGain() };
    const cueBusGain = context.createGain();

    for (const id of deckIds) {
      const source = context.createMediaElementSource(elements[id]);
      deckLowEqs[id].type = "lowshelf";
      deckLowEqs[id].frequency.value = 180;
      deckMidEqs[id].type = "peaking";
      deckMidEqs[id].frequency.value = 1_180;
      deckMidEqs[id].Q.value = 0.82;
      deckHighEqs[id].type = "highshelf";
      deckHighEqs[id].frequency.value = 5_800;
      deckAnalysers[id].fftSize = 128;
      deckAnalysers[id].smoothingTimeConstant = 0.72;
      source.connect(deckTrimGains[id]);
      deckTrimGains[id].connect(deckLowEqs[id]);
      deckLowEqs[id].connect(deckMidEqs[id]);
      deckMidEqs[id].connect(deckHighEqs[id]);
      deckHighEqs[id].connect(deckFilters[id]);
      deckFilters[id].connect(deckAnalysers[id]);
      deckAnalysers[id].connect(channelFaders[id]);
      channelFaders[id].connect(deckGains[id]);
      deckGains[id].connect(mixBus);
      deckAnalysers[id].connect(cueDeckGains[id]);
      cueDeckGains[id].connect(cueBusGain);
    }

    const lowEq = context.createBiquadFilter();
    lowEq.type = "lowshelf";
    lowEq.frequency.value = 180;
    const midEq = context.createBiquadFilter();
    midEq.type = "peaking";
    midEq.frequency.value = 1_150;
    midEq.Q.value = 0.76;
    const highEq = context.createBiquadFilter();
    highEq.type = "highshelf";
    highEq.frequency.value = 5_600;
    const colorFilter = context.createBiquadFilter();
    colorFilter.type = "lowpass";
    colorFilter.Q.value = 0.18;
    const colorShaper = context.createWaveShaper();
    colorShaper.oversample = "2x";

    mixBus.connect(lowEq);
    lowEq.connect(midEq);
    midEq.connect(highEq);
    highEq.connect(colorFilter);
    colorFilter.connect(colorShaper);

    const dryGain = context.createGain();
    dryGain.gain.value = 1;
    colorShaper.connect(dryGain);

    const echoDelay = context.createDelay(0.8);
    const echoFeedback = context.createGain();
    const echoWet = context.createGain();
    echoFeedback.gain.value = 0.34;
    colorShaper.connect(echoDelay);
    echoDelay.connect(echoFeedback);
    echoFeedback.connect(echoDelay);
    echoDelay.connect(echoWet);

    const convolver = context.createConvolver();
    const reverbWet = context.createGain();
    convolver.buffer = makeImpulseResponse(context);
    colorShaper.connect(convolver);
    convolver.connect(reverbWet);

    const flangerDelay = context.createDelay(0.03);
    const flangerWet = context.createGain();
    flangerDelay.delayTime.value = 0.005;
    colorShaper.connect(flangerDelay);
    flangerDelay.connect(flangerWet);

    const phaserOne = context.createBiquadFilter();
    const phaserTwo = context.createBiquadFilter();
    const phaserWet = context.createGain();
    phaserOne.type = "allpass";
    phaserTwo.type = "allpass";
    phaserOne.frequency.value = 780;
    phaserTwo.frequency.value = 1_720;
    phaserOne.Q.value = 2.1;
    phaserTwo.Q.value = 2.8;
    colorShaper.connect(phaserOne);
    phaserOne.connect(phaserTwo);
    phaserTwo.connect(phaserWet);

    const lfo = context.createOscillator();
    const flangeDepth = context.createGain();
    const phaseDepthOne = context.createGain();
    const phaseDepthTwo = context.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.23;
    flangeDepth.gain.value = 0.0032;
    phaseDepthOne.gain.value = 520;
    phaseDepthTwo.gain.value = -760;
    lfo.connect(flangeDepth);
    lfo.connect(phaseDepthOne);
    lfo.connect(phaseDepthTwo);
    flangeDepth.connect(flangerDelay.delayTime);
    phaseDepthOne.connect(phaserOne.frequency);
    phaseDepthTwo.connect(phaserTwo.frequency);
    lfo.start();

    const masterGain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    dryGain.connect(masterGain);
    echoWet.connect(masterGain);
    reverbWet.connect(masterGain);
    flangerWet.connect(masterGain);
    phaserWet.connect(masterGain);
    masterGain.connect(analyser);
    const masterDirectGain = context.createGain();
    const masterDestination = context.createMediaStreamDestination();
    masterDirectGain.gain.value = 1;
    analyser.connect(masterDirectGain);
    masterDirectGain.connect(context.destination);
    analyser.connect(masterDestination);

    const monitorMasterGain = context.createGain();
    const monitorVolumeGain = context.createGain();
    const monitorLimiter = context.createDynamicsCompressor();
    const cueDestination = context.createMediaStreamDestination();
    monitorLimiter.threshold.value = -3;
    monitorLimiter.knee.value = 4;
    monitorLimiter.ratio.value = 10;
    monitorLimiter.attack.value = 0.002;
    monitorLimiter.release.value = 0.12;
    cueBusGain.connect(monitorVolumeGain);
    analyser.connect(monitorMasterGain);
    monitorMasterGain.connect(monitorVolumeGain);
    monitorVolumeGain.connect(monitorLimiter);
    monitorLimiter.connect(cueDestination);

    const runtime: AudioRuntime = {
      context,
      analyser,
      deckAnalysers,
      deckFilters,
      deckTrimGains,
      deckLowEqs,
      deckMidEqs,
      deckHighEqs,
      channelFaders,
      deckGains,
      cueDeckGains,
      cueBusGain,
      monitorMasterGain,
      monitorVolumeGain,
      cueDestination,
      masterDirectGain,
      masterDestination,
      lowEq,
      midEq,
      highEq,
      colorFilter,
      colorShaper,
      echoDelay,
      echoWet,
      reverbWet,
      flangerWet,
      phaserWet,
      masterGain,
      lfo,
    };
    audioRef.current = runtime;
    frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    deckFrequencyDataRef.current = {
      A: new Uint8Array(deckAnalysers.A.frequencyBinCount),
      B: new Uint8Array(deckAnalysers.B.frequencyBinCount),
    };
    applyMixerGraph(runtime, mixer);
    for (const id of deckIds) updateDeckGraph(runtime, id, decks[id]);
    updateCrossfadeGraph(runtime, crossfade);
    updateMonitorGraph(runtime, cueDecks, monitorMix, monitorVolume);
    return runtime;
  }, [applyMixerGraph, crossfade, cueDecks, decks, mixer, monitorMix, monitorVolume, updateCrossfadeGraph, updateDeckGraph, updateMonitorGraph]);

  const refreshAudioOutputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audiooutput");
      setAudioOutputs(devices);
      return devices;
    } catch {
      setStatus("Audio outputs could not be read. Headphone cueing is still available when output selection is supported.");
      return [];
    }
  }, []);

  const refreshNativeAudioOutputs = useCallback(async () => {
    if (!isTauriRuntime()) return [];
    try {
      const devices = await invoke<NativeAudioOutputDevice[]>("list_audio_output_devices");
      setNativeAudioOutputs(devices);
      const speaker = devices.find((device) => device.formFactor === "speakers")
        ?? devices.find((device) => device.isDefault);
      if (speaker) setMasterOutputName(speaker.name);
      return devices;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Windows audio outputs could not be read.");
      return [];
    }
  }, []);

  const exposeBrowserAudioOutputs = useCallback(async (targetName: string) => {
    let devices = await refreshAudioOutputs();
    if (matchingBrowserOutput(targetName, devices)) return devices;
    if (!navigator.mediaDevices?.getUserMedia) return devices;
    setStatus(`Windows found ${targetName}. Allow the audio-device scan so it can be routed to the cue bus.`);
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      devices = await refreshAudioOutputs();
    } catch (error) {
      setStatus(error instanceof Error
        ? `Audio-device access is needed to route ${targetName}: ${error.message}`
        : `Audio-device access is needed to route ${targetName}.`);
    }
    return devices;
  }, [refreshAudioOutputs]);

  const startMonitorPlayback = useCallback(async (runtime: AudioRuntime) => {
    let monitor = monitorElementRef.current;
    if (!monitor) {
      monitor = new Audio() as SinkSelectableAudio;
      monitor.autoplay = true;
      monitor.volume = 1;
      monitorElementRef.current = monitor;
    }
    if (monitor.srcObject !== runtime.cueDestination.stream) monitor.srcObject = runtime.cueDestination.stream;
    await monitor.play();
  }, []);

  const routeMasterToComputerOutput = useCallback(async (runtime: AudioRuntime, browserDevices: MediaDeviceInfo[]) => {
    const computerOutput = nativeAudioOutputs.find((device) => device.formFactor === "speakers")
      ?? nativeAudioOutputs.find((device) => device.isDefault);
    if (!computerOutput) return masterOutputName;
    const browserOutput = matchingBrowserOutput(computerOutput.name, browserDevices);
    if (browserOutput?.deviceId) {
      try {
        let master = masterElementRef.current;
        if (!master) {
          master = new Audio() as SinkSelectableAudio;
          master.autoplay = true;
          master.volume = 1;
          masterElementRef.current = master;
        }
        if (!master.setSinkId) return masterOutputName;
        await master.setSinkId(browserOutput.deviceId);
        if (master.srcObject !== runtime.masterDestination.stream) master.srcObject = runtime.masterDestination.stream;
        await master.play();
        setAudioParam(runtime.masterDirectGain.gain, 0, runtime.context, 0.008);
        setMasterOutputName(computerOutput.name);
        return computerOutput.name;
      } catch {
        // The main graph remains on the Windows default output if explicit routing is denied.
      }
    }
    return masterOutputName;
  }, [masterOutputName, nativeAudioOutputs]);

  const routeMonitorOutput = useCallback(async (deviceId: string, deviceName?: string, selectionKey?: string) => {
    try {
      const runtime = ensureAudioGraph();
      if (runtime.context.state === "suspended") await runtime.context.resume();
      let monitor = monitorElementRef.current;
      if (!monitor) {
        monitor = new Audio() as SinkSelectableAudio;
        monitor.autoplay = true;
        monitor.volume = 1;
        monitorElementRef.current = monitor;
      }
      if (!monitor.setSinkId) {
        setMonitorReady(false);
        setStatus("This audio engine cannot route headphones separately. Update WebView2 or use a browser with audio output selection.");
        return;
      }
      await monitor.setSinkId(deviceId);
      await startMonitorPlayback(runtime);
      const devices = await refreshAudioOutputs();
      const computerOutput = await routeMasterToComputerOutput(runtime, devices);
      const matched = devices.find((device) => device.deviceId === deviceId);
      const label = deviceName || matched?.label || "Selected headphone output";
      setSelectedOutputId(selectionKey || `browser:${deviceId}`);
      setSelectedOutputName(label);
      setMonitorReady(true);
      setStatus(`Master is on ${computerOutput}. Cue is on ${label}.`);
    } catch (error) {
      setMonitorReady(false);
      setStatus(error instanceof Error ? `Headphone routing failed: ${error.message}` : "Headphone routing failed.");
    }
  }, [ensureAudioGraph, refreshAudioOutputs, routeMasterToComputerOutput, startMonitorPlayback]);

  const routeNativeMonitorOutput = useCallback(async (device: NativeAudioOutputDevice) => {
    const browserDevices = await exposeBrowserAudioOutputs(device.name);
    const matched = matchingBrowserOutput(device.name, browserDevices);
    if (!matched?.deviceId) {
      setMonitorReady(false);
      setStatus(`Windows sees ${device.name}, but WebView2 has not exposed its audio route. Allow the audio-device prompt, then choose it again.`);
      return;
    }
    await routeMonitorOutput(matched.deviceId, device.name, `native:${device.name}`);
  }, [exposeBrowserAudioOutputs, routeMonitorOutput]);

  const chooseMonitorOutput = async () => {
    const mediaDevices = navigator.mediaDevices as OutputSelectableMediaDevices | undefined;
    if (!mediaDevices) {
      setStatus("No audio output controls are available on this system.");
      return;
    }
    if (!mediaDevices.selectAudioOutput) {
      const devices = await refreshNativeAudioOutputs();
      const headphones = devices.filter((device) => device.formFactor === "headphones" || device.formFactor === "headset");
      if (headphones.length === 1) {
        await routeNativeMonitorOutput(headphones[0]);
      } else {
        setStatus(headphones.length > 1 ? "Choose a connected headset from the output menu." : "No connected headphone endpoints were found in Windows.");
      }
      return;
    }
    try {
      const device = await mediaDevices.selectAudioOutput();
      setAudioOutputs((current) => current.some((item) => item.deviceId === device.deviceId) ? current : [...current, device]);
      await routeMonitorOutput(device.deviceId, device.label || "Selected headphone output", `browser:${device.deviceId}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setStatus("Headphone output selection was cancelled.");
        return;
      }
      setStatus(error instanceof Error ? `Headphone selection failed: ${error.message}` : "Headphone selection failed.");
    }
  };

  const loadTrack = useCallback((id: DeckId, track: LocalTrack) => {
    const element = elementsRef.current?.[id];
    if (!element) return;
    element.pause();
    element.src = track.url;
    element.playbackRate = 1;
    element.preservesPitch = true;
    element.load();
    setDecks((current) => ({
      ...current,
      [id]: {
        ...current[id],
        trackId: track.id,
        playing: false,
        currentTime: 0,
        duration: track.duration ?? 0,
        bpm: track.bpm,
        pitch: 0,
        keyShift: 0,
        cuePoint: 0,
        hotCues: Array.from({ length: 8 }, () => null),
        memoryPoints: [],
        memoryIndex: -1,
        loopStart: null,
        loopEnd: null,
        loopEnabled: false,
        slipReverse: false,
      },
    }));
    setStatus(`${displayTrackName(track.name)} loaded to deck ${id}.`);
  }, []);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("audio/") || supportedAudioPattern.test(file.name));
    if (files.length === 0) {
      setStatus("No supported audio found. Try MP3, WAV, M4A, AAC, OGG or FLAC.");
      return;
    }
    const added = files.map<LocalTrack>((file) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      const extension = file.name.split(".").pop()?.toUpperCase() ?? "AUDIO";
      return { id: crypto.randomUUID(), name: file.name, extension, size: file.size, url, duration: null, tagged: false, bpm: 120 };
    });
    setTracks((current) => [...current, ...added]);
    if (!decks.A.trackId) loadTrack("A", added[0]);
    if (!decks.B.trackId && added[decks.A.trackId ? 0 : 1]) loadTrack("B", added[decks.A.trackId ? 0 : 1]);
    setStatus(`${added.length} local track${added.length === 1 ? "" : "s"} added. Nothing was uploaded.`);
  }, [decks.A.trackId, decks.B.trackId, loadTrack]);

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  };

  const toggleDeck = async (id: DeckId) => {
    const element = elementsRef.current?.[id];
    if (!element || !decks[id].trackId) return;
    try {
      const runtime = ensureAudioGraph();
      if (runtime.context.state === "suspended") await runtime.context.resume();
      if (element.paused) {
        if (brakeAnimationRef.current[id] !== null) window.cancelAnimationFrame(brakeAnimationRef.current[id]!);
        brakeAnimationRef.current[id] = null;
        applyDeckPlayback(id, decks[id]);
        await element.play();
        setDecks((current) => ({ ...current, [id]: { ...current[id], playing: true } }));
        setStatus(`Deck ${id} is live.`);
      } else {
        const brakeMs = decks[id].vinylMode ? 70 + decks[id].vinylBrake * 11 : 0;
        if (brakeMs <= 70) {
          element.pause();
          setDecks((current) => ({ ...current, [id]: { ...current[id], playing: false } }));
          setStatus(`Deck ${id} paused.`);
          return;
        }
        const startedAt = performance.now();
        const startingRate = element.playbackRate;
        setDecks((current) => ({ ...current, [id]: { ...current[id], playing: false } }));
        setStatus(`Deck ${id} vinyl brake engaged.`);
        const brake = (time: number) => {
          const progress = clamp((time - startedAt) / brakeMs, 0, 1);
          element.playbackRate = Math.max(0.08, startingRate * Math.pow(1 - progress, 2));
          if (progress < 1) {
            brakeAnimationRef.current[id] = window.requestAnimationFrame(brake);
            return;
          }
          element.pause();
          applyDeckPlayback(id, decks[id]);
          brakeAnimationRef.current[id] = null;
        };
        brakeAnimationRef.current[id] = window.requestAnimationFrame(brake);
      }
    } catch (error) {
      setStatus(playbackErrorMessage(element, error));
    }
  };

  const cueDeck = (id: DeckId) => {
    const element = elementsRef.current?.[id];
    if (!element) return;
    const state = decks[id];
    if (element.paused && Math.abs(element.currentTime - state.cuePoint) > 0.04) {
      const cuePoint = clamp(quantizedTime(state, element.currentTime), 0, Number.isFinite(element.duration) ? element.duration : element.currentTime);
      element.currentTime = cuePoint;
      setDecks((current) => ({ ...current, [id]: { ...current[id], cuePoint, currentTime: cuePoint } }));
      setStatus(`Deck ${id} cue stored at ${formatTime(cuePoint)}${state.quantize ? " on the beat grid" : ""}.`);
      return;
    }
    element.pause();
    element.currentTime = state.cuePoint;
    setDecks((current) => ({ ...current, [id]: { ...current[id], playing: false, currentTime: state.cuePoint } }));
    setStatus(`Deck ${id} returned to cue at ${formatTime(state.cuePoint)}.`);
  };

  const toggleDeckMonitor = async (id: DeckId) => {
    if (!decks[id].trackId) return;
    try {
      const runtime = ensureAudioGraph();
      if (runtime.context.state === "suspended") await runtime.context.resume();
      const nextCueDecks = { ...cueDecks, [id]: !cueDecks[id] };
      setCueDecks(nextCueDecks);
      updateMonitorGraph(runtime, nextCueDecks, monitorMix, monitorVolume);
      if (monitorReady) await startMonitorPlayback(runtime);
      setStatus(nextCueDecks[id]
        ? monitorReady
          ? `Deck ${id} is live in the headphones before the crossfader.`
          : `Deck ${id} PFL is armed. Choose a headphone output in the monitor strip.`
        : `Deck ${id} removed from the headphone cue.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Headphone cueing could not start.");
    }
  };

  const seekDeck = (id: DeckId, time: number) => {
    const element = elementsRef.current?.[id];
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = clamp(time, 0, element.duration);
    setDecks((current) => ({ ...current, [id]: { ...current[id], currentTime: element.currentTime } }));
  };

  const finishDeckJog = (id: DeckId) => {
    const element = elementsRef.current?.[id];
    if (!element || element.paused) return;
    if (jogReleaseTimerRef.current[id] !== null) window.clearTimeout(jogReleaseTimerRef.current[id]!);
    if (jogReturnAnimationRef.current[id] !== null) window.cancelAnimationFrame(jogReturnAnimationRef.current[id]!);
    jogReleaseTimerRef.current[id] = null;
    const startingRate = element.playbackRate;
    const targetRate = deckBasePlaybackRate(decks[id]);
    const startedAt = performance.now();
    const returnMs = 110 + decks[id].vinylBrake * 1.35;
    const settle = (time: number) => {
      const progress = clamp((time - startedAt) / returnMs, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.playbackRate = startingRate + (targetRate - startingRate) * eased;
      if (progress < 1) {
        jogReturnAnimationRef.current[id] = window.requestAnimationFrame(settle);
        return;
      }
      element.playbackRate = targetRate;
      element.preservesPitch = decks[id].masterTempo && decks[id].keyShift === 0;
      jogReturnAnimationRef.current[id] = null;
    };
    jogReturnAnimationRef.current[id] = window.requestAnimationFrame(settle);
  };

  const jogDeck = (id: DeckId, movement: number) => {
    const element = elementsRef.current?.[id];
    if (!element || !Number.isFinite(element.duration)) return;
    if (element.paused) {
      seekDeck(id, element.currentTime + movement);
      return;
    }
    if (jogReturnAnimationRef.current[id] !== null) window.cancelAnimationFrame(jogReturnAnimationRef.current[id]!);
    if (jogReleaseTimerRef.current[id] !== null) window.clearTimeout(jogReleaseTimerRef.current[id]!);
    jogReturnAnimationRef.current[id] = null;
    const baseRate = deckBasePlaybackRate(decks[id]);
    const bend = clamp(movement * 0.18, -0.78, 1.1);
    element.preservesPitch = false;
    element.playbackRate = clamp(baseRate * (1 + bend), 0.18, 4);
    jogReleaseTimerRef.current[id] = window.setTimeout(() => finishDeckJog(id), 120);
  };

  const beginDeckScrub = (id: DeckId) => {
    const element = elementsRef.current?.[id];
    if (!element) return;
    if (jogReturnAnimationRef.current[id] !== null) window.cancelAnimationFrame(jogReturnAnimationRef.current[id]!);
    if (jogReleaseTimerRef.current[id] !== null) window.clearTimeout(jogReleaseTimerRef.current[id]!);
    jogReturnAnimationRef.current[id] = null;
    jogReleaseTimerRef.current[id] = null;
    setStatus(element.paused
      ? `Deck ${id} platter ready for precise seeking.`
      : `Deck ${id} live jog engaged. Back slows down and forward speeds up.`);
  };

  const endDeckScrub = (id: DeckId) => {
    const element = elementsRef.current?.[id];
    if (!element) return;
    finishDeckJog(id);
    setStatus(element.paused
      ? `Deck ${id} parked at ${formatTime(element.currentTime)}.`
      : `Deck ${id} jog released and returning to ${decks[id].pitch > 0 ? "+" : ""}${decks[id].pitch.toFixed(1)}%.`);
  };

  const applyDeckPlayback = (id: DeckId, state: DeckState) => {
    const element = elementsRef.current?.[id];
    if (!element) return;
    element.preservesPitch = state.masterTempo && state.keyShift === 0;
    element.playbackRate = deckBasePlaybackRate(state);
  };

  const updateDeckControl = (id: DeckId, key: DeckControlKey, value: number) => {
    const nextState = { ...decks[id], [key]: value };
    setDecks((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
    if (key === "bpm" && nextState.trackId) {
      setTracks((currentTracks) => currentTracks.map((track) => track.id === nextState.trackId ? { ...track, bpm: value } : track));
    }
    const runtime = audioRef.current;
    if (runtime) updateDeckGraph(runtime, id, nextState);
    if (key === "pitch" || key === "keyShift") applyDeckPlayback(id, nextState);
  };

  const toggleDeckSetting = (id: DeckId, key: DeckToggleKey) => {
    const nextState = { ...decks[id], [key]: !decks[id][key] };
    setDecks((current) => ({ ...current, [id]: { ...current[id], [key]: nextState[key] } }));
    if (key === "masterTempo") applyDeckPlayback(id, nextState);
    setStatus(`Deck ${id} ${key.replace(/([A-Z])/g, " $1").toLowerCase()} ${nextState[key] ? "on" : "off"}.`);
  };

  const setDeckLoop = (id: DeckId, beats: number) => {
    const element = elementsRef.current?.[id];
    const state = decks[id];
    if (!element || !state.trackId) return;
    const start = clamp(quantizedTime(state, element.currentTime), 0, Math.max(0, element.duration - 0.05));
    const end = clamp(start + beatLength(state.bpm) * beats, start + 0.03, element.duration);
    if (state.slipMode && !element.paused) {
      slipOperationRef.current[id] = { hiddenStart: element.currentTime, startedAt: performance.now(), wasPlaying: true };
    }
    setDecks((current) => ({ ...current, [id]: { ...current[id], loopStart: start, loopEnd: end, loopEnabled: true, loopBeats: beats } }));
    setStatus(`Deck ${id} ${beats}-beat loop armed${state.quantize ? " and quantized" : ""}.`);
  };

  const exitDeckLoop = (id: DeckId) => {
    const element = elementsRef.current?.[id];
    const slip = slipOperationRef.current[id];
    if (element && slip && decks[id].slipMode) {
      const elapsed = (performance.now() - slip.startedAt) / 1000;
      element.currentTime = clamp(slip.hiddenStart + elapsed * element.playbackRate, 0, Number.isFinite(element.duration) ? element.duration : Number.MAX_SAFE_INTEGER);
    }
    slipOperationRef.current[id] = null;
    setDecks((current) => ({ ...current, [id]: { ...current[id], loopEnabled: false } }));
    setStatus(`Deck ${id} exited the loop${slip ? " and rejoined the hidden playhead" : ""}.`);
  };

  const resizeDeckLoop = (id: DeckId, multiplier: number) => {
    const state = decks[id];
    if (state.loopStart === null || state.loopEnd === null) {
      setDeckLoop(id, multiplier < 1 ? 4 : 8);
      return;
    }
    const beats = clamp(state.loopBeats * multiplier, 1 / 64, 128);
    const end = clamp(state.loopStart + beatLength(state.bpm) * beats, state.loopStart + 0.015, state.duration);
    setDecks((current) => ({ ...current, [id]: { ...current[id], loopEnd: end, loopBeats: beats, loopEnabled: true } }));
    setStatus(`Deck ${id} loop length is ${beats} beat${beats === 1 ? "" : "s"}.`);
  };

  const jumpDeckByBeats = (id: DeckId, direction: -1 | 1) => {
    const value = beatJumpValues[decks[id].beatJumpIndex];
    jogDeck(id, beatLength(decks[id].bpm) * value * direction);
    setStatus(`Deck ${id} jumped ${direction < 0 ? "back" : "forward"} ${value} beat${value === 1 ? "" : "s"}.`);
  };

  const useHotCue = (id: DeckId, encodedIndex: number) => {
    const clear = encodedIndex >= 100;
    const index = clear ? encodedIndex - 100 : encodedIndex;
    const state = decks[id];
    const cue = state.hotCues[index];
    if (clear) {
      const hotCues = [...state.hotCues];
      hotCues[index] = null;
      setDecks((current) => ({ ...current, [id]: { ...current[id], hotCues } }));
      setStatus(`Deck ${id} hot cue ${String.fromCharCode(65 + index)} cleared.`);
      return;
    }
    if (cue === null) {
      const point = quantizedTime(state, state.currentTime);
      const hotCues = [...state.hotCues];
      hotCues[index] = point;
      setDecks((current) => ({ ...current, [id]: { ...current[id], hotCues } }));
      setStatus(`Deck ${id} hot cue ${String.fromCharCode(65 + index)} stored at ${formatTime(point)}.`);
    } else {
      seekDeck(id, cue);
      setStatus(`Deck ${id} called hot cue ${String.fromCharCode(65 + index)}.`);
    }
  };

  const useMemoryAction = (id: DeckId, action: "memory" | "memoryPrevious" | "memoryNext" | "memoryDelete") => {
    const state = decks[id];
    if (action === "memory") {
      const point = quantizedTime(state, state.currentTime);
      const memoryPoints = [...state.memoryPoints, point].sort((a, b) => a - b).slice(0, 10);
      const memoryIndex = memoryPoints.findIndex((candidate) => candidate === point);
      setDecks((current) => ({ ...current, [id]: { ...current[id], memoryPoints, memoryIndex, cuePoint: point } }));
      setStatus(`Deck ${id} memory point saved at ${formatTime(point)}.`);
      return;
    }
    if (state.memoryPoints.length === 0) return;
    if (action === "memoryDelete") {
      const memoryPoints = state.memoryPoints.filter((_, index) => index !== state.memoryIndex);
      const memoryIndex = memoryPoints.length ? clamp(state.memoryIndex, 0, memoryPoints.length - 1) : -1;
      setDecks((current) => ({ ...current, [id]: { ...current[id], memoryPoints, memoryIndex } }));
      setStatus(`Deck ${id} memory point deleted.`);
      return;
    }
    const direction = action === "memoryPrevious" ? -1 : 1;
    const memoryIndex = state.memoryIndex < 0
      ? (direction < 0 ? state.memoryPoints.length - 1 : 0)
      : (state.memoryIndex + direction + state.memoryPoints.length) % state.memoryPoints.length;
    const point = state.memoryPoints[memoryIndex];
    seekDeck(id, point);
    setDecks((current) => ({ ...current, [id]: { ...current[id], memoryIndex, cuePoint: point } }));
    setStatus(`Deck ${id} called memory point ${memoryIndex + 1}.`);
  };

  const syncDeck = (id: DeckId) => {
    const other: DeckId = id === "A" ? "B" : "A";
    if (!decks[other].trackId) {
      setStatus(`Load deck ${other} to use beat sync.`);
      return;
    }
    const targetBpm = decks[other].bpm * (1 + decks[other].pitch / 100);
    const pitch = clamp((targetBpm / decks[id].bpm - 1) * 100, -16, 16);
    updateDeckControl(id, "pitch", pitch);
    const otherBeat = beatLength(targetBpm);
    const phase = elementsRef.current?.[other].currentTime ?? 0;
    const nearestPhase = Math.round(phase / otherBeat) * otherBeat;
    const element = elementsRef.current?.[id];
    if (element) element.currentTime = clamp(nearestPhase, 0, Number.isFinite(element.duration) ? element.duration : nearestPhase);
    setStatus(`Deck ${id} synced to deck ${other} at ${targetBpm.toFixed(1)} BPM.`);
  };

  const keySyncDeck = (id: DeckId) => {
    const other: DeckId = id === "A" ? "B" : "A";
    if (!decks[other].trackId) {
      setStatus(`Load deck ${other} to use key sync.`);
      return;
    }
    updateDeckControl(id, "keyShift", decks[other].keyShift);
    setStatus(`Deck ${id} key shift matched deck ${other}.`);
  };

  const toggleTrackTag = (id: DeckId) => {
    const trackId = decks[id].trackId;
    if (!trackId) return;
    setTracks((current) => current.map((track) => track.id === trackId ? { ...track, tagged: !track.tagged } : track));
    const track = tracks.find((candidate) => candidate.id === trackId);
    setStatus(`${track ? displayTrackName(track.name) : `Deck ${id} track`} ${track?.tagged ? "removed from" : "added to"} the tag list.`);
  };

  const setSlipReverse = (id: DeckId, active: boolean) => {
    const element = elementsRef.current?.[id];
    const state = decks[id];
    if (!element || !state.trackId || state.slipReverse === active) return;
    if (active) {
      slipOperationRef.current[id] = { hiddenStart: element.currentTime, startedAt: performance.now(), wasPlaying: !element.paused };
      reverseTimerRef.current[id] = window.setInterval(() => {
        element.currentTime = clamp(element.currentTime - 0.16, 0, Number.isFinite(element.duration) ? element.duration : Number.MAX_SAFE_INTEGER);
      }, 55);
      setDecks((current) => ({ ...current, [id]: { ...current[id], slipReverse: true } }));
      setStatus(`Deck ${id} slip reverse engaged.`);
      return;
    }
    if (reverseTimerRef.current[id] !== null) window.clearInterval(reverseTimerRef.current[id]!);
    reverseTimerRef.current[id] = null;
    const slip = slipOperationRef.current[id];
    slipOperationRef.current[id] = null;
    if (slip && state.slipMode) {
      const elapsed = (performance.now() - slip.startedAt) / 1000;
      element.currentTime = clamp(slip.hiddenStart + elapsed * element.playbackRate, 0, Number.isFinite(element.duration) ? element.duration : Number.MAX_SAFE_INTEGER);
    }
    setDecks((current) => ({ ...current, [id]: { ...current[id], slipReverse: false } }));
    setStatus(`Deck ${id} slip reverse released${state.slipMode ? " onto the hidden playhead" : ""}.`);
  };

  const handleDeckAction = (id: DeckId, action: DeckAction, payload?: number) => {
    if (action === "play") { void toggleDeck(id); return; }
    if (action === "cue") { cueDeck(id); return; }
    if (action === "monitor") { void toggleDeckMonitor(id); return; }
    if (action === "sync") { syncDeck(id); return; }
    if (action === "keySync") { keySyncDeck(id); return; }
    if (action === "hotCue") { useHotCue(id, payload ?? 0); return; }
    if (action === "memory" || action === "memoryPrevious" || action === "memoryNext" || action === "memoryDelete") { useMemoryAction(id, action); return; }
    if (action === "loopFour" || action === "loopEight") { setDeckLoop(id, action === "loopFour" ? 4 : 8); return; }
    if (action === "loopHalf" || action === "loopDouble") { resizeDeckLoop(id, action === "loopHalf" ? 0.5 : 2); return; }
    if (action === "reloop") {
      if (decks[id].loopEnabled) exitDeckLoop(id);
      else if (decks[id].loopStart !== null && decks[id].loopEnd !== null) {
        setDecks((current) => ({ ...current, [id]: { ...current[id], loopEnabled: true } }));
        seekDeck(id, decks[id].loopStart!);
      } else setDeckLoop(id, 4);
      return;
    }
    if (action === "beatBack" || action === "beatForward") { jumpDeckByBeats(id, action === "beatBack" ? -1 : 1); return; }
    if (action === "tagTrack") { toggleTrackTag(id); return; }
    if (action === "shortcut") { setDecks((current) => ({ ...current, [id]: { ...current[id], shortcutOpen: !current[id].shortcutOpen } })); }
  };

  const updateMixer = <Key extends keyof MixerSettings>(key: Key, value: MixerSettings[Key]) => {
    setMixer((current) => {
      const next = { ...current, [key]: value };
      if (audioRef.current) applyMixerGraph(audioRef.current, next);
      return next;
    });
  };

  const changeCrossfade = (value: number) => {
    setCrossfade(value);
    if (audioRef.current) updateCrossfadeGraph(audioRef.current, value);
  };

  const changeMonitorMix = (value: number) => {
    setMonitorMix(value);
    if (audioRef.current) updateMonitorGraph(audioRef.current, cueDecks, value, monitorVolume);
  };

  const changeMonitorVolume = (value: number) => {
    setMonitorVolume(value);
    if (audioRef.current) updateMonitorGraph(audioRef.current, cueDecks, monitorMix, value);
  };

  const resetMix = () => {
    setMixer(defaultMixer);
    setCrossfade(0);
    setCueDecks({ ...defaultCueDecks });
    setMonitorMix(defaultMonitorMix);
    setMonitorVolume(defaultMonitorVolume);
    setDecks((current) => {
      const next = {
        A: { ...current.A, filter: 0, pitch: 0, trim: 74, low: 0, mid: 0, high: 0, channelLevel: 82, keyShift: 0 },
        B: { ...current.B, filter: 0, pitch: 0, trim: 74, low: 0, mid: 0, high: 0, channelLevel: 82, keyShift: 0 },
      };
      for (const id of deckIds) {
        applyDeckPlayback(id, next[id]);
        if (audioRef.current) updateDeckGraph(audioRef.current, id, next[id]);
      }
      return next;
    });
    if (audioRef.current) {
      applyMixerGraph(audioRef.current, defaultMixer);
      updateCrossfadeGraph(audioRef.current, 0);
      updateMonitorGraph(audioRef.current, defaultCueDecks, defaultMonitorMix, defaultMonitorVolume);
    }
    setStatus("Mixer controls reset. Playback was left running.");
  };

  const removeTrack = (track: LocalTrack) => {
    const nextCueDecks = { ...cueDecks };
    for (const id of deckIds) {
      if (decks[id].trackId !== track.id) continue;
      nextCueDecks[id] = false;
      const element = elementsRef.current?.[id];
      if (element) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      setDecks((current) => ({ ...current, [id]: makeDefaultDeckState() }));
    }
    setCueDecks(nextCueDecks);
    if (audioRef.current) updateMonitorGraph(audioRef.current, nextCueDecks, monitorMix, monitorVolume);
    setTracks((current) => current.filter((candidate) => candidate.id !== track.id));
    URL.revokeObjectURL(track.url);
    objectUrlsRef.current.delete(track.url);
    setStatus(`${displayTrackName(track.name)} removed from the session.`);
  };

  const toggleLibraryTag = (track: LocalTrack) => {
    setTracks((current) => current.map((candidate) => candidate.id === track.id ? { ...candidate, tagged: !candidate.tagged } : candidate));
    setStatus(`${displayTrackName(track.name)} ${track.tagged ? "removed from" : "added to"} the tag list.`);
  };

  const updateLibraryTrackBpm = (track: LocalTrack, bpm: number) => {
    setTracks((current) => current.map((candidate) => candidate.id === track.id ? { ...candidate, bpm } : candidate));
    setDecks((current) => {
      const next = { ...current };
      for (const id of deckIds) {
        if (current[id].trackId === track.id) next[id] = { ...current[id], bpm };
      }
      return next;
    });
  };

  const readAudioBands = useCallback((): AudioBands | null => {
    const runtime = audioRef.current;
    const data = frequencyDataRef.current;
    if (!runtime || !data || runtime.context.state !== "running") return null;
    runtime.analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
    const average = (start: number, end: number) => {
      let total = 0;
      const safeEnd = Math.min(data.length, end);
      for (let index = start; index < safeEnd; index += 1) total += data[index];
      return total / Math.max(1, safeEnd - start) / 255 * 0.64;
    };
    return { bass: average(1, 9), mids: average(9, 34), treble: average(34, data.length) };
  }, []);

  useEffect(() => {
    const elements = elementsRef.current;
    if (!elements) return;
    const cleanups: Array<() => void> = [];
    for (const id of deckIds) {
      const element = elements[id];
      const metadata = () => {
        const duration = Number.isFinite(element.duration) ? element.duration : 0;
        setDecks((current) => ({ ...current, [id]: { ...current[id], duration } }));
        const trackId = decks[id].trackId;
        if (trackId) setTracks((current) => current.map((track) => track.id === trackId ? { ...track, duration } : track));
      };
      const ended = () => setDecks((current) => ({ ...current, [id]: { ...current[id], playing: false, currentTime: 0 } }));
      element.addEventListener("loadedmetadata", metadata);
      element.addEventListener("ended", ended);
      cleanups.push(() => {
        element.removeEventListener("loadedmetadata", metadata);
        element.removeEventListener("ended", ended);
      });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [decks.A.trackId, decks.B.trackId]);

  useEffect(() => {
    if (!playing && !open) return;
    let frame = 0;
    let lastUpdate = 0;
    const update = (time: number) => {
      if (time - lastUpdate > 48) {
        lastUpdate = time;
        const nextMeters: Record<DeckId, number> = { A: 0, B: 0 };
        const runtime = audioRef.current;
        for (const id of deckIds) {
          const element = elementsRef.current?.[id];
          if (element) {
            setDecks((current) => {
              let nextTime = Number.isFinite(element.currentTime) ? element.currentTime : 0;
              const deck = current[id];
              if (deck.loopEnabled && deck.loopStart !== null && deck.loopEnd !== null && nextTime >= deck.loopEnd) {
                const loopLength = Math.max(0.015, deck.loopEnd - deck.loopStart);
                nextTime = deck.loopStart + (nextTime - deck.loopStart) % loopLength;
                element.currentTime = nextTime;
              }
              if (Math.abs(current[id].currentTime - nextTime) < 0.025) return current;
              return { ...current, [id]: { ...current[id], currentTime: nextTime } };
            });
          }
          const data = deckFrequencyDataRef.current[id];
          if (runtime && data) {
            runtime.deckAnalysers[id].getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
            let total = 0;
            for (let index = 0; index < data.length; index += 1) total += data[index];
            nextMeters[id] = Math.pow(total / Math.max(1, data.length) / 255, 0.72);
          }
        }
        setMeters(nextMeters);
      }
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [open, playing]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), reduceMotion ? 0 : 320);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, reduceMotion]);

  useEffect(() => {
    if (!open) return;
    void refreshNativeAudioOutputs();
    if (!navigator.mediaDevices) return;
    void refreshAudioOutputs();
    const refresh = () => { void refreshAudioOutputs(); };
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
  }, [open, refreshAudioOutputs, refreshNativeAudioOutputs]);

  useEffect(() => () => {
    for (const id of deckIds) {
      elementsRef.current?.[id].pause();
      if (reverseTimerRef.current[id] !== null) window.clearInterval(reverseTimerRef.current[id]!);
      if (brakeAnimationRef.current[id] !== null) window.cancelAnimationFrame(brakeAnimationRef.current[id]!);
      if (jogReturnAnimationRef.current[id] !== null) window.cancelAnimationFrame(jogReturnAnimationRef.current[id]!);
      if (jogReleaseTimerRef.current[id] !== null) window.clearTimeout(jogReleaseTimerRef.current[id]!);
    }
    if (monitorElementRef.current) {
      monitorElementRef.current.pause();
      monitorElementRef.current.srcObject = null;
    }
    if (masterElementRef.current) {
      masterElementRef.current.pause();
      masterElementRef.current.srcObject = null;
    }
    if (audioRef.current) {
      audioRef.current.lfo.stop();
      void audioRef.current.context.close();
    }
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const trackForDeck = (id: DeckId) => tracks.find((track) => track.id === decks[id].trackId) ?? null;
  const mixerSliders: Array<{ key: keyof Pick<MixerSettings, "color" | "echo" | "reverb" | "modulation" | "master">; label: string; min: number; max: number; value: string; accent?: boolean }> = [
    { key: "color", label: "DRIVE", min: 0, max: 100, value: `${mixer.color}%` },
    { key: "echo", label: "ECHO", min: 0, max: 100, value: `${mixer.echo}%`, accent: mixer.echo > 0 },
    { key: "reverb", label: "REVERB", min: 0, max: 100, value: `${mixer.reverb}%`, accent: mixer.reverb > 0 },
    { key: "modulation", label: "MOD", min: 0, max: 100, value: `${mixer.modulation}%`, accent: mixer.modulation > 0 },
    { key: "master", label: "MASTER", min: 0, max: 100, value: `${mixer.master}%`, accent: true },
  ];
  const connectedHeadphones = nativeAudioOutputs.filter((device) =>
    device.formFactor === "headphones"
    || device.formFactor === "headset"
    || /bluetooth|headphone|headset|earbud|jlab|airpod|buds/i.test(device.name),
  );
  const browserHeadphoneOutputs = audioOutputs.filter((device) =>
    device.deviceId
    && device.deviceId !== "default"
    && !connectedHeadphones.some((nativeDevice) => matchingBrowserOutput(nativeDevice.name, [device])),
  );
  const visibleTracks = tracks.filter((track) => {
    if (tagListOnly && !track.tagged) return false;
    if (trackFilterOpen && Math.abs(track.bpm - libraryBpm) > libraryBpmRange) return false;
    return true;
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`vibe-launch-button titlebar-button ${playing ? "is-live" : ""}`}
        aria-label={playing ? "Open Vibe mixer, audio is playing" : "Open Vibe mixer"}
        title="Vibe mixer"
      >
        <Music2 size={16} strokeWidth={1.7} />
        <span aria-hidden="true" />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
        onChange={handleFileInput}
        className="hidden"
        tabIndex={-1}
        aria-label="Add local audio tracks"
      />

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="vibe-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.48, ease: "easeOut" }}
          >
            <AudioReactiveFocusBackdrop active={playing} bandSource={readAudioBands} />
            <div className="vibe-overlay-shade" />
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label="Vibe DJ mixer"
              className="vibe-console"
              initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.975 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.52, ease: [0.22, 1, 0.36, 1] }}
            >
              <header className="vibe-console-header" data-tauri-drag-region>
                <div className="vibe-brand-lockup">
                  <span className="vibe-brand-mark"><Disc3 size={17} strokeWidth={1.7} /></span>
                  <div>
                    <h2>VIBE</h2>
                    <p>DUAL CHANNEL MIX CONSOLE</p>
                  </div>
                </div>
                <div className="vibe-session-state" aria-live="polite">
                  <span className={playing ? "is-live" : ""} />
                  {playing ? "LIVE AUDIO" : "LOCAL SESSION"}
                </div>
                <div className="vibe-header-actions">
                  <button type="button" className="vibe-reset-button" onClick={resetMix} title="Reset mixer controls">
                    <RotateCcw size={14} strokeWidth={1.8} /> RESET MIX
                  </button>
                  <button ref={closeButtonRef} type="button" className="vibe-close-button" onClick={() => setOpen(false)} aria-label="Minimize Vibe mixer" title="Minimize mixer">
                    <X size={17} strokeWidth={1.8} />
                  </button>
                </div>
              </header>

              <div className="vibe-console-body">
                <Deck
                  id="A"
                  state={decks.A}
                  track={trackForDeck("A")}
                  meter={meters.A}
                  onAction={(action, payload) => handleDeckAction("A", action, payload)}
                  onControl={(key, value) => updateDeckControl("A", key, value)}
                  onToggle={(key) => toggleDeckSetting("A", key)}
                  onSlipReverse={(active) => setSlipReverse("A", active)}
                  onSeek={(time) => seekDeck("A", time)}
                  onJog={(seconds) => jogDeck("A", seconds)}
                  onScrubStart={() => beginDeckScrub("A")}
                  onScrubEnd={() => void endDeckScrub("A")}
                  onBrowse={() => fileInputRef.current?.click()}
                />

                <section className="vibe-mixer-strip" aria-label="Two channel mixer">
                  <div className="vibe-mixer-title">
                    <span><Gauge size={14} strokeWidth={1.7} /> 2 CHANNEL MIXER</span>
                    <i>PRE-FADER CUE</i>
                  </div>
                  <div className="vibe-channel-pair">
                    <MixerChannel
                      id="A"
                      state={decks.A}
                      track={trackForDeck("A")}
                      meter={meters.A}
                      monitoring={cueDecks.A}
                      onMonitor={() => void toggleDeckMonitor("A")}
                      onControl={(key, value) => updateDeckControl("A", key, value)}
                    />
                    <MixerChannel
                      id="B"
                      state={decks.B}
                      track={trackForDeck("B")}
                      meter={meters.B}
                      monitoring={cueDecks.B}
                      onMonitor={() => void toggleDeckMonitor("B")}
                      onControl={(key, value) => updateDeckControl("B", key, value)}
                    />
                  </div>
                  <div className="vibe-master-effects">
                    <div className="vibe-master-effects-title">MASTER FX</div>
                    <div className="vibe-mixer-sliders">
                      {mixerSliders.map((control) => (
                        <ControlSlider
                          key={control.key}
                          label={control.label}
                          value={mixer[control.key]}
                          min={control.min}
                          max={control.max}
                          valueLabel={control.value}
                          accent={control.accent}
                          onChange={(value) => updateMixer(control.key, value)}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="vibe-mode-switch" aria-label="Modulation type">
                    {(["flanger", "phaser"] as ModulationMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={mixer.modulationMode === mode ? "is-selected" : ""}
                        onClick={() => updateMixer("modulationMode", mode)}
                      >
                        {mode.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="vibe-crossfader-block">
                    <div className="vibe-crossfader-copy">
                      <span>A</span>
                      <label htmlFor="vibe-crossfader">CROSSFADER</label>
                      <span>B</span>
                    </div>
                    <input
                      id="vibe-crossfader"
                      type="range"
                      min="-100"
                      max="100"
                      value={crossfade}
                      onChange={(event) => changeCrossfade(Number(event.target.value))}
                      className="vibe-crossfader"
                      aria-valuetext={crossfade === 0 ? "Centered" : crossfade < 0 ? `${Math.abs(crossfade)} percent toward deck A` : `${crossfade} percent toward deck B`}
                      style={{ "--cross-position": `${(crossfade + 100) / 2}%` } as CSSProperties}
                    />
                    <div className="vibe-crossfader-scale" aria-hidden="true">
                      {Array.from({ length: 11 }, (_, index) => <i key={index} />)}
                    </div>
                  </div>
                </section>

                <Deck
                  id="B"
                  state={decks.B}
                  track={trackForDeck("B")}
                  meter={meters.B}
                  onAction={(action, payload) => handleDeckAction("B", action, payload)}
                  onControl={(key, value) => updateDeckControl("B", key, value)}
                  onToggle={(key) => toggleDeckSetting("B", key)}
                  onSlipReverse={(active) => setSlipReverse("B", active)}
                  onSeek={(time) => seekDeck("B", time)}
                  onJog={(seconds) => jogDeck("B", seconds)}
                  onScrubStart={() => beginDeckScrub("B")}
                  onScrubEnd={() => void endDeckScrub("B")}
                  onBrowse={() => fileInputRef.current?.click()}
                />
              </div>

              <section className="vibe-monitor-strip" aria-label="Headphone cue monitor">
                <div className="vibe-monitor-identity">
                  <span className={`vibe-monitor-jack ${monitorReady ? "is-ready" : ""}`}><Headphones size={17} strokeWidth={1.7} /></span>
                  <div>
                    <strong>HEADPHONE MONITOR</strong>
                    <span>MASTER {masterOutputName}</span>
                    <small>PHONES {monitorReady ? selectedOutputName : "NOT ROUTED"}</small>
                  </div>
                </div>
                <div className="vibe-monitor-pfl-state" aria-live="polite">
                  {deckIds.map((id) => <span key={id} className={cueDecks[id] ? "is-selected" : ""}>PFL {id}</span>)}
                </div>
                <div className="vibe-monitor-faders">
                  <ControlSlider
                    label="CUE / MASTER"
                    value={monitorMix}
                    min={-100}
                    max={100}
                    valueLabel={monitorMix === -100 ? "CUE" : monitorMix === 100 ? "MASTER" : `${Math.round((100 - monitorMix) / 2)}C ${Math.round((100 + monitorMix) / 2)}M`}
                    accent
                    onChange={changeMonitorMix}
                  />
                  <ControlSlider
                    label="PHONES"
                    value={monitorVolume}
                    min={0}
                    max={100}
                    valueLabel={`${monitorVolume}%`}
                    accent={monitorReady}
                    onChange={changeMonitorVolume}
                  />
                </div>
                <div className="vibe-monitor-output">
                  <label htmlFor="vibe-monitor-output">HEADPHONE OUTPUT</label>
                  <div>
                    <select
                      id="vibe-monitor-output"
                      value={selectedOutputId}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value.startsWith("native:")) {
                          const device = connectedHeadphones.find((candidate) => `native:${candidate.name}` === value);
                          if (device) void routeNativeMonitorOutput(device);
                        } else if (value.startsWith("browser:")) {
                          const deviceId = value.slice("browser:".length);
                          const device = audioOutputs.find((candidate) => candidate.deviceId === deviceId);
                          if (device) void routeMonitorOutput(device.deviceId, device.label || "Selected headphone output", value);
                        }
                      }}
                      aria-label="Headphone audio output"
                    >
                      <option value="">Choose headphones</option>
                      {connectedHeadphones.length > 0 && (
                        <optgroup label="Connected Windows headphones">
                          {connectedHeadphones.map((device) => (
                            <option key={`${device.formFactor}:${device.name}`} value={`native:${device.name}`}>
                              {device.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {browserHeadphoneOutputs.length > 0 && (
                        <optgroup label="Other audio outputs">
                          {browserHeadphoneOutputs.map((device, index) => (
                            <option key={device.deviceId || `output-${index}`} value={`browser:${device.deviceId}`}>
                              {device.label || `Audio output ${index + 1}`}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button type="button" onClick={() => void chooseMonitorOutput()}>
                      SCAN
                    </button>
                  </div>
                </div>
              </section>

              <section
                className={`vibe-library ${dragging ? "is-dragging" : ""}`}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={handleDrop}
                aria-label="Local audio library"
              >
                <div className="vibe-library-heading">
                  <span><ListMusic size={14} strokeWidth={1.7} /> SESSION CRATE <b>{String(visibleTracks.length).padStart(2, "0")}/{String(tracks.length).padStart(2, "0")}</b></span>
                  <div className="vibe-library-tools">
                    <button type="button" className={trackFilterOpen ? "is-selected" : ""} onClick={() => setTrackFilterOpen((current) => !current)}>
                      <Search size={12} strokeWidth={1.8} /> TRACK FILTER / EDIT
                    </button>
                    <button type="button" className={tagListOnly ? "is-selected" : ""} onClick={() => setTagListOnly((current) => !current)}>
                      <Tag size={12} strokeWidth={1.8} /> TAG LIST
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>
                      <FolderPlus size={14} strokeWidth={1.8} /> ADD AUDIO
                    </button>
                  </div>
                </div>
                {trackFilterOpen && tracks.length > 0 && (
                  <div className="vibe-library-filter" aria-label="Track filter settings">
                    <ControlSlider label="TARGET BPM" value={libraryBpm} min={60} max={200} step={0.1} valueLabel={libraryBpm.toFixed(1)} accent onChange={setLibraryBpm} />
                    <ControlSlider label="BPM RANGE" value={libraryBpmRange} min={0} max={50} valueLabel={`+/- ${libraryBpmRange}`} onChange={setLibraryBpmRange} />
                  </div>
                )}
                {tracks.length === 0 ? (
                  <button type="button" className="vibe-dropzone" onClick={() => fileInputRef.current?.click()}>
                    <Headphones size={20} strokeWidth={1.5} />
                    <span>Drop MP3s here or choose local audio</span>
                    <small>Files stay on this device and clear when the app closes</small>
                  </button>
                ) : visibleTracks.length === 0 ? (
                  <div className="vibe-library-empty-filter">
                    No tracks match this filter. Adjust the BPM range or turn off TAG LIST.
                  </div>
                ) : (
                  <div className="vibe-track-list">
                    {visibleTracks.map((track, index) => (
                      <article key={track.id} className="vibe-library-track">
                        <span className="vibe-track-index">{String(index + 1).padStart(2, "0")}</span>
                        <div className="vibe-library-track-copy">
                          <strong title={track.name}>{displayTrackName(track.name)}</strong>
                          <span>{track.extension} / {formatBytes(track.size)}{track.duration ? ` / ${formatTime(track.duration)}` : ""}</span>
                          <label className="vibe-library-bpm">
                            <span>BPM</span>
                            <input type="range" min="60" max="200" step="0.1" value={track.bpm} onChange={(event) => updateLibraryTrackBpm(track, Number(event.target.value))} aria-label={`${displayTrackName(track.name)} BPM`} />
                            <output>{track.bpm.toFixed(1)}</output>
                          </label>
                        </div>
                        <div className="vibe-load-actions">
                          <button type="button" className={track.tagged ? "is-loaded" : ""} onClick={() => toggleLibraryTag(track)} aria-label={`${track.tagged ? "Remove" : "Add"} ${displayTrackName(track.name)} ${track.tagged ? "from" : "to"} tag list`}>
                            <Tag size={12} strokeWidth={1.8} />
                          </button>
                          {deckIds.map((id) => (
                            <button key={id} type="button" className={decks[id].trackId === track.id ? "is-loaded" : ""} onClick={() => loadTrack(id, track)}>
                              {id}
                            </button>
                          ))}
                          <button type="button" onClick={() => removeTrack(track)} aria-label={`Remove ${displayTrackName(track.name)}`}>
                            <Trash2 size={13} strokeWidth={1.7} />
                          </button>
                        </div>
                      </article>
                    ))}
                    <button type="button" className="vibe-inline-add" onClick={() => fileInputRef.current?.click()}>
                      <FolderPlus size={14} strokeWidth={1.8} /> ADD MORE
                    </button>
                  </div>
                )}
                {dragging && <div className="vibe-drop-scrim">RELEASE TO LOAD</div>}
              </section>

              <footer className="vibe-console-footer">
                <span className="vibe-status-light" />
                <p>{status}</p>
                <span>INTERACTIVE AUDIO / ZERO UPLOAD</span>
              </footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
