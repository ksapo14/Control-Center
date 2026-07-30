import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LoaderCircle, Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildSpeechCommandRegistry,
  collectRenderedSpeechCommands,
  normalizeSpeechPhrase,
  type SpeechCommandRegistry as Registry,
  type SpeechCommandTarget as SpeechTarget,
} from "../lib/speechCommands";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { useControlCenter } from "./ControlCenter";
import { useDashboardCustomization } from "./DashboardCustomization";
import { useProcessingOverlay } from "./LoadingOverlay";
import { TactileButton } from "./TactileButton";

const SPEECH_ENABLED_STORAGE_KEY = "control-panel.speech-mode-enabled";
const COMMAND_COOLDOWN_MS = 1_350;

type SpeechModeStatus = {
  active: boolean;
  phraseCount: number;
  recognizer: string | null;
};

type RecognitionEvent = {
  phrase: string;
  confidence: number;
};

function initialSpeechPreference() {
  try {
    return window.localStorage.getItem(SPEECH_ENABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function findActionElement(actionId: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-shortcut-id], button[data-speech-id]"))
    .find((button) => (button.dataset.speechId ?? button.dataset.shortcutId) === actionId);
}

/** Provides a lightweight, offline phrase-list listener and routes speech to stable dashboard actions. */
export function SpeechMode() {
  const {
    addNotification,
    appGroups,
    automationRules,
    focusEnabled,
    launchAppGroup,
    runAutomation,
    toggleFocusMode,
  } = useControlCenter();
  const { setTheme } = useDashboardCustomization();
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Speech Mode is off");
  const registryRef = useRef<Registry>({ commands: new Map(), phrases: [], conflicts: [] });
  const automationRulesRef = useRef(automationRules);
  const appGroupsRef = useRef(appGroups);
  const focusEnabledRef = useRef(focusEnabled);
  const lastRecognitionRef = useRef({ phrase: "", at: 0 });
  const conflictPhrasesRef = useRef<Set<string>>(new Set());
  const shouldListenRef = useRef(false);
  const updatingRegistryRef = useRef(false);
  const mountedRef = useRef(true);
  useProcessingOverlay(busy, listening ? "Stopping Speech Mode" : "Starting Speech Mode");

  useEffect(() => { automationRulesRef.current = automationRules; }, [automationRules]);
  useEffect(() => { appGroupsRef.current = appGroups; }, [appGroups]);
  useEffect(() => { focusEnabledRef.current = focusEnabled; }, [focusEnabled]);

  const refreshRegistry = useCallback(() => {
    const registry = buildSpeechCommandRegistry(collectRenderedSpeechCommands(), automationRulesRef.current, appGroupsRef.current);
    registryRef.current = registry;
    return registry;
  }, []);

  const storePreference = (enabled: boolean) => {
    try {
      window.localStorage.setItem(SPEECH_ENABLED_STORAGE_KEY, String(enabled));
    } catch {
      // The setting remains active for this session if local storage is unavailable.
    }
  };

  const stopListening = useCallback(async (remember = true) => {
    if (!isTauriRuntime()) return;
    shouldListenRef.current = false;
    setBusy(true);
    try {
      await invoke<SpeechModeStatus>("stop_speech_mode");
    } catch (error) {
      addNotification("Speech Mode", errorMessage(error), "warning");
    } finally {
      if (mountedRef.current) {
        setListening(false);
        setBusy(false);
        setStatus("Speech Mode is off");
      }
      if (remember) storePreference(false);
    }
  }, [addNotification]);

  const startListening = useCallback(async (remember = true) => {
    if (!isTauriRuntime()) {
      setStatus("Speech Mode is available in the installed desktop app");
      return;
    }
    if (shouldListenRef.current) return;
    shouldListenRef.current = true;
    const registry = refreshRegistry();
    setBusy(true);
    setStatus("Starting offline speech recognition…");
    try {
      const next = await invoke<SpeechModeStatus>("start_speech_mode", { phrases: registry.phrases });
      if (!mountedRef.current) return;
      setListening(next.active);
      shouldListenRef.current = next.active;
      setStatus(`Listening for ${next.phraseCount} phrases`);
      conflictPhrasesRef.current = new Set(registry.conflicts);
      if (remember) storePreference(true);
      if (registry.conflicts.length > 0) {
        addNotification("Speech phrase conflict", `${registry.conflicts.length} ambiguous phrase${registry.conflicts.length === 1 ? " was" : "s were"} disabled. Rename a quick link, scene, group, or automation phrase.`, "warning");
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const message = errorMessage(error);
      shouldListenRef.current = false;
      setListening(false);
      setStatus(message);
      storePreference(false);
      addNotification("Speech Mode could not start", message, "error");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [addNotification, refreshRegistry]);

  useEffect(() => {
    const startFromPhone = () => {
      if (!shouldListenRef.current) void startListening();
    };
    window.addEventListener("control-panel:start-speech-mode", startFromPhone);
    return () => window.removeEventListener("control-panel:start-speech-mode", startFromPhone);
  }, [startListening]);

  const executeTarget = useCallback(async (target: SpeechTarget, heardPhrase: string) => {
    const processing = Boolean(document.querySelector(".processing-overlay"));
    if (processing && target.kind !== "stop") {
      setStatus(`Wait for the current action before “${heardPhrase}”`);
      return;
    }
    const openDialog = document.querySelector<HTMLElement>("[aria-modal='true'], [role='dialog'], [role='alertdialog']");
    const environmentSectionChange = target.kind === "element"
      && target.actionId.startsWith("environment:view:")
      && openDialog?.classList.contains("environment-shell");
    const dialogSafe = target.kind === "theme" || target.kind === "spotify" || target.kind === "stop" || environmentSectionChange;
    if (openDialog && !dialogSafe) {
      setStatus(`Close the open panel before “${heardPhrase}”`);
      return;
    }

    if (target.kind === "stop") {
      await stopListening();
      return;
    }
    if (target.kind === "focus") {
      if (focusEnabledRef.current !== target.enabled) toggleFocusMode(target.enabled);
    } else if (target.kind === "theme") {
      setTheme(target.theme);
    } else if (target.kind === "group") {
      const group = appGroupsRef.current.find((candidate) => candidate.id === target.groupId);
      if (group) launchAppGroup(group);
    } else if (target.kind === "automation") {
      const rule = automationRulesRef.current.find((candidate) => candidate.id === target.ruleId);
      if (rule) await runAutomation(rule, "speech");
    } else if (target.kind === "pomodoro") {
      const button = findActionElement("pomodoro:toggle");
      const timerState = button?.dataset.speechState;
      const shouldClick = target.operation === "start" ? timerState === "paused" : timerState === "running";
      if (button && !button.disabled && shouldClick) button.click();
      if (button && target.operation === "start" && timerState === "completed") {
        button.click();
        window.setTimeout(() => {
          const resetButton = findActionElement("pomodoro:toggle");
          if (resetButton?.dataset.speechState === "paused" && !resetButton.disabled) resetButton.click();
        }, 120);
      }
    } else if (target.kind === "spotify") {
      const button = findActionElement("spotify:toggle");
      const buttonOperation = button?.getAttribute("aria-label")?.toLocaleLowerCase().startsWith("pause") ? "pause" : "play";
      if (button && !button.disabled && buttonOperation === target.operation) button.click();
    } else {
      const button = findActionElement(target.actionId);
      if (!button || button.disabled) {
        setStatus(`${target.label} is not available right now`);
        return;
      }
      button.click();
    }
    setStatus(`Heard “${heardPhrase}”`);
  }, [launchAppGroup, runAutomation, setTheme, stopListening, toggleFocusMode]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlistenRecognition: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    void listen<RecognitionEvent>("speech-command-recognized", (event) => {
      if (disposed) return;
      const phrase = normalizeSpeechPhrase(event.payload.phrase);
      const now = Date.now();
      if (lastRecognitionRef.current.phrase === phrase && now - lastRecognitionRef.current.at < COMMAND_COOLDOWN_MS) return;
      lastRecognitionRef.current = { phrase, at: now };
      const target = registryRef.current.commands.get(phrase);
      if (target) void executeTarget(target, phrase);
    }).then((dispose) => { unlistenRecognition = dispose; });
    void listen<string>("speech-mode-error", (event) => {
      if (disposed) return;
      const message = event.payload || "Windows Speech Recognition stopped unexpectedly";
      shouldListenRef.current = false;
      void invoke("stop_speech_mode");
      setListening(false);
      setStatus(message);
      storePreference(false);
      addNotification("Speech Mode stopped", message, "error");
    }).then((dispose) => { unlistenError = dispose; });
    return () => {
      disposed = true;
      unlistenRecognition?.();
      unlistenError?.();
    };
  }, [addNotification, executeTarget]);

  useEffect(() => {
    if (!listening) return;
    let fingerprint = registryRef.current.phrases.join("\0");
    const timer = window.setInterval(() => {
      const registry = refreshRegistry();
      const newConflicts = registry.conflicts.filter((phrase) => !conflictPhrasesRef.current.has(phrase));
      conflictPhrasesRef.current = new Set(registry.conflicts);
      if (newConflicts.length > 0) {
        const examples = newConflicts.slice(0, 2).map((phrase) => `“${phrase}”`).join(" and ");
        addNotification("Speech phrase conflict", `${examples}${newConflicts.length > 2 ? ` and ${newConflicts.length - 2} more` : ""} ${newConflicts.length === 1 ? "is" : "are"} ambiguous and disabled. Rename one of the matching actions.`, "warning");
      }
      const nextFingerprint = registry.phrases.join("\0");
      if (nextFingerprint === fingerprint) {
        if (updatingRegistryRef.current) return;
        void invoke<SpeechModeStatus>("get_speech_mode_status").then((current) => {
          if (current.active || !shouldListenRef.current) return;
          shouldListenRef.current = false;
          setListening(false);
          setStatus("Windows Speech Recognition stopped unexpectedly");
          storePreference(false);
          addNotification("Speech Mode stopped", "Windows Speech Recognition stopped unexpectedly.", "error");
        }).catch(() => {
          // A transient status-query failure does not stop an otherwise healthy listener.
        });
        return;
      }
      fingerprint = nextFingerprint;
      updatingRegistryRef.current = true;
      void invoke<SpeechModeStatus>("update_speech_mode_phrases", { phrases: registry.phrases })
        .catch((error) => {
          if (!shouldListenRef.current) return;
          const message = errorMessage(error);
          shouldListenRef.current = false;
          setListening(false);
          setStatus(message);
          storePreference(false);
          addNotification("Speech Mode stopped", message, "error");
        })
        .finally(() => { updatingRegistryRef.current = false; });
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [addNotification, listening, refreshRegistry]);

  useEffect(() => {
    const timer = initialSpeechPreference() ? window.setTimeout(() => void startListening(false), 650) : null;
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [startListening]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      shouldListenRef.current = false;
      if (isTauriRuntime()) void invoke("stop_speech_mode");
    };
  }, []);

  return (
    <>
      <TactileButton
        onClick={() => void (listening ? stopListening() : startListening())}
        disabled={busy}
        selected={listening}
        className="grid size-11 place-items-center p-0"
        aria-pressed={listening}
        aria-label={listening ? "Disable Speech Mode" : "Enable Speech Mode"}
        title={status}
      >
        <span>
          {busy ? <LoaderCircle size={17} className="animate-spin text-signal-300" /> : listening ? <Mic size={17} className="text-emerald-300" /> : <MicOff size={17} className="text-stone-500" />}
          <span className={`absolute bottom-2 right-2 size-1.5 rounded-full ${listening ? "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" : "bg-stone-700"}`} />
        </span>
      </TactileButton>
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
    </>
  );
}
