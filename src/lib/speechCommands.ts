export type RenderedSpeechCommand = {
  phrase: string;
  actionId: string;
  label: string;
};

export type SpeechTheme = "black" | "tan" | "green" | "blue" | "white";

export type SpeechCommandTarget =
  | { kind: "element"; actionId: string; label: string }
  | { kind: "automation"; ruleId: string; label: string }
  | { kind: "group"; groupId: string; label: string }
  | { kind: "focus"; enabled: boolean; label: string }
  | { kind: "theme"; theme: SpeechTheme; label: string }
  | { kind: "pomodoro"; operation: "start" | "pause"; label: string }
  | { kind: "spotify"; operation: "play" | "pause"; label: string }
  | { kind: "stop"; label: string };

export type SpeechCommandRegistry = {
  commands: Map<string, SpeechCommandTarget>;
  phrases: string[];
  conflicts: string[];
};

export type SpeechCommandReference = {
  id: string;
  label: string;
  phrases: string[];
};

export const BUILT_IN_SPEECH_ALIASES: Record<string, string[]> = {
  "control:planning": ["planning", "open planning"],
  "control:quick-schedule": ["schedule", "quick schedule", "open schedule"],
  "control:tasks-habits": ["tasks", "habits", "tasks and habits"],
  "control:open-apps": ["workspace", "open workspace"],
  "control:phone-mode": ["phone mode", "open phone mode"],
  "control:environment": ["productivity", "productivity environment"],
  "control:command-bar": ["command bar"],
  "control:center": ["control center"],
  "control:automations": ["automations"],
  "control:notifications": ["notifications"],
  "control:settings": ["settings"],
  "control:keyboard-shortcuts": ["keyboard shortcuts"],
  "environment:view:today": ["today timeline"],
  "environment:view:scenes": ["project scenes"],
  "environment:view:capture": ["quick capture"],
  "environment:view:meetings": ["meetings"],
  "environment:view:sessions": ["sessions"],
  "environment:view:extensions": ["extensions"],
  "environment:view:attention": ["attention center"],
  "spotify:previous": ["previous spotify", "previous spotify track"],
  "spotify:next": ["next spotify", "next spotify track"],
  "media:previous": ["previous media", "previous track"],
  "media:toggle": ["toggle media", "play pause media"],
  "media:next": ["next media", "next track"],
  "volume:mute": ["mute computer", "mute volume"],
  "bluetooth:connect": ["connect headphones"],
  "bluetooth:disconnect": ["disconnect headphones"],
};

const SPECIAL_SPEECH_PHRASES: Record<string, string> = {
  pomodoro: "Start Pomodoro",
  "start pomodoro": "Start Pomodoro",
  "pause pomodoro": "Pause Pomodoro",
  "play spotify": "Play Spotify",
  "pause spotify": "Pause Spotify",
  "start focus": "Start Focus Mode",
  "end focus": "End Focus Mode",
  "stop listening": "Speech Mode",
  "speech off": "Speech Mode",
  "black theme": "Black theme",
  "tan theme": "Tan theme",
  "green theme": "Green theme",
  "blue theme": "Blue theme",
  "white theme": "White theme",
};

/** Converts spoken and user-entered text to the exact form used for matching. */
export function normalizeSpeechPhrase(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Validates an optional user-defined automation phrase without accepting risky fragments. */
export function validateAutomationSpeechPhrase(value: string) {
  if (!value.trim()) return null;
  const phrase = normalizeSpeechPhrase(value);
  const words = phrase.split(" ").filter(Boolean);
  if (phrase.length < 4) return "Use at least four characters.";
  if (phrase.length > 64) return "Keep the phrase to 64 characters or fewer.";
  if (words.length < 2) return "Use at least two words to reduce accidental triggers.";
  if (words.length > 8) return "Keep the phrase to eight words or fewer.";
  return null;
}

function targetKey(target: SpeechCommandTarget) {
  if (target.kind === "element") return `element:${target.actionId}`;
  if (target.kind === "automation") return `automation:${target.ruleId}`;
  if (target.kind === "group") return `group:${target.groupId}`;
  if (target.kind === "focus") return `focus:${target.enabled}`;
  if (target.kind === "theme") return `theme:${target.theme}`;
  if (target.kind === "pomodoro" || target.kind === "spotify") return `${target.kind}:${target.operation}`;
  return target.kind;
}

function addRegistryCommand(
  registry: Map<string, SpeechCommandTarget>,
  conflicts: Set<string>,
  phraseValue: string,
  target: SpeechCommandTarget,
) {
  const phrase = normalizeSpeechPhrase(phraseValue);
  if (!phrase || conflicts.has(phrase)) return;
  const existing = registry.get(phrase);
  if (existing && targetKey(existing) !== targetKey(target)) {
    registry.delete(phrase);
    conflicts.add(phrase);
    return;
  }
  registry.set(phrase, target);
}

/** Builds the single resolved command set used by recognition and the shortcut reference. */
export function buildSpeechCommandRegistry(
  rendered: RenderedSpeechCommand[],
  automationRules: Array<{ id: string; name: string; speechPhrase: string }>,
  appGroups: Array<{ id: string; name: string }>,
): SpeechCommandRegistry {
  const commands = new Map<string, SpeechCommandTarget>();
  const conflicts = new Set<string>();
  for (const command of rendered) {
    addRegistryCommand(commands, conflicts, command.phrase, {
      kind: "element",
      actionId: command.actionId,
      label: command.label,
    });
  }

  addRegistryCommand(commands, conflicts, "pomodoro", { kind: "pomodoro", operation: "start", label: "Start Pomodoro" });
  addRegistryCommand(commands, conflicts, "start pomodoro", { kind: "pomodoro", operation: "start", label: "Start Pomodoro" });
  addRegistryCommand(commands, conflicts, "pause pomodoro", { kind: "pomodoro", operation: "pause", label: "Pause Pomodoro" });
  addRegistryCommand(commands, conflicts, "play spotify", { kind: "spotify", operation: "play", label: "Play Spotify" });
  addRegistryCommand(commands, conflicts, "pause spotify", { kind: "spotify", operation: "pause", label: "Pause Spotify" });
  addRegistryCommand(commands, conflicts, "start focus", { kind: "focus", enabled: true, label: "Start Focus Mode" });
  addRegistryCommand(commands, conflicts, "end focus", { kind: "focus", enabled: false, label: "End Focus Mode" });
  addRegistryCommand(commands, conflicts, "stop listening", { kind: "stop", label: "Stop listening" });
  addRegistryCommand(commands, conflicts, "speech off", { kind: "stop", label: "Stop listening" });

  for (const theme of ["black", "tan", "green", "blue", "white"] as SpeechTheme[]) {
    addRegistryCommand(commands, conflicts, `${theme} theme`, {
      kind: "theme",
      theme,
      label: `${theme[0].toUpperCase()}${theme.slice(1)} theme`,
    });
  }
  for (const group of appGroups) {
    addRegistryCommand(commands, conflicts, `launch ${group.name}`, { kind: "group", groupId: group.id, label: `Launch ${group.name}` });
  }
  for (const rule of automationRules) {
    if (!rule.speechPhrase) continue;
    addRegistryCommand(commands, conflicts, rule.speechPhrase, { kind: "automation", ruleId: rule.id, label: rule.name });
  }

  return { commands, phrases: [...commands.keys()].sort(), conflicts: [...conflicts].sort() };
}

/** Groups every active spoken phrase by the action it will run for display in the UI. */
export function speechCommandReference(registry: SpeechCommandRegistry): SpeechCommandReference[] {
  const entries = new Map<string, SpeechCommandReference>();
  for (const [phrase, target] of registry.commands) {
    const id = targetKey(target);
    const entry = entries.get(id) ?? { id, label: target.label, phrases: [] };
    entry.phrases.push(phrase);
    entries.set(id, entry);
  }
  return [...entries.values()]
    .map((entry) => ({ ...entry, phrases: entry.phrases.sort((left, right) => left.localeCompare(right)) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** Reads stable speech/shortcut metadata from currently mounted safe dashboard actions. */
export function collectRenderedSpeechCommands(): RenderedSpeechCommand[] {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-shortcut-id], [data-speech-id]"));
  const commands = elements.flatMap((element) => {
    const actionId = element.dataset.speechId ?? element.dataset.shortcutId;
    const label = element.dataset.speechLabel ?? element.dataset.shortcutLabel ?? element.getAttribute("aria-label") ?? "";
    if (!actionId || !label) return [];
    const explicit = (element.dataset.speechPhrase ?? "").split("|").filter(Boolean);
    const aliases = BUILT_IN_SPEECH_ALIASES[actionId] ?? [];
    const phrases = new Set([...aliases, ...explicit, label]);
    return [...phrases].flatMap((value) => {
      const phrase = normalizeSpeechPhrase(value);
      return phrase ? [{ phrase, actionId, label }] : [];
    });
  });
  return Array.from(new Map(commands.map((command) => [`${command.phrase}\0${command.actionId}`, command])).values());
}

/** Finds a mounted built-in/dynamic command that already owns a normalized phrase. */
export function renderedSpeechPhraseOwner(phrase: string) {
  const normalized = normalizeSpeechPhrase(phrase);
  return collectRenderedSpeechCommands().find((command) => command.phrase === normalized)?.label ?? null;
}

/** Finds a fixed phrase whose meaning cannot be reassigned to a user automation. */
export function builtInSpeechPhraseOwner(phrase: string) {
  const normalized = normalizeSpeechPhrase(phrase);
  const specialOwner = SPECIAL_SPEECH_PHRASES[normalized];
  if (specialOwner) return specialOwner;
  for (const [actionId, aliases] of Object.entries(BUILT_IN_SPEECH_ALIASES)) {
    if (aliases.some((alias) => normalizeSpeechPhrase(alias) === normalized)) {
      return collectRenderedSpeechCommands().find((command) => command.actionId === actionId)?.label ?? actionId;
    }
  }
  return null;
}
