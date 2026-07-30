import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { restoreProductivityData } from "../lib/productivity";
import { TactileButton } from "./TactileButton";
import { useProcessingOverlay } from "./LoadingOverlay";
import { useControlCenter } from "./ControlCenter";
import { useDashboardCustomization } from "./DashboardCustomization";

type PhoneModeSession = {
  url: string;
  pairingCode: string;
  port: number;
  paired: boolean;
};

type PhoneModeContext = {
  launchers: Array<{ id: string; label: string }>;
  groups: Array<{ id: string; name: string }>;
  scenes: Array<{ id: string; name: string }>;
  theme: "black" | "tan" | "green" | "blue" | "white";
};

type PhoneControlAction = {
  type: "launcher" | "group" | "scene" | "capture" | "open_workspace" | "speech";
  value?: string | null;
};

/** Reads the currently rendered quick-launch controls without exposing their native targets. */
function collectLaunchers() {
  const entries = Array.from(document.querySelectorAll<HTMLElement>("[data-launcher-id]"))
    .flatMap((element) => {
      const id = element.dataset.launcherId;
      const label = element.dataset.launcherLabel;
      return id && label ? [{ id, label }] : [];
    });
  return Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
}

/** Activates an existing dashboard control through the same guarded path used by local input. */
function clickDashboardControl(selector: string) {
  const control = document.querySelector<HTMLButtonElement>(selector);
  if (!control || control.disabled) return false;
  control.click();
  return true;
}

function PhoneGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="5.25" y="2.25" width="9.5" height="15.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.2 4.75h3.6M8.8 15.15h2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Hosts the temporary paired LAN remote and keeps its allowlisted controls synchronized. */
export function PhoneMode() {
  const { appGroups, launchAppGroup } = useControlCenter();
  const { theme } = useDashboardCustomization();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<PhoneModeSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<"url" | "code" | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useProcessingOverlay(busy, session ? "Stopping Phone Mode" : "Starting Phone Mode");

  const buildContext = useCallback((): PhoneModeContext => ({
    launchers: collectLaunchers(),
    groups: appGroups.map(({ id, name }) => ({ id, name })),
    scenes: restoreProductivityData().scenes.map(({ id, name }) => ({ id, name })),
    theme,
  }), [appGroups, theme]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const start = useCallback(async () => {
    setOpen(true);
    setMessage("");
    setBusy(true);
    try {
      if (!isTauriRuntime()) throw new Error("Phone Mode is available in the desktop app, not the browser preview.");
      const next = await invoke<PhoneModeSession>("start_phone_mode", { context: buildContext() });
      setSession(next);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [buildContext]);

  const stop = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      if (isTauriRuntime()) await invoke("stop_phone_mode");
      setSession(null);
      closeDialog();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [closeDialog]);

  const copyValue = async (kind: "url" | "code", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1_600);
    } catch {
      setMessage("Copy is unavailable here. Select the value and copy it manually.");
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    void invoke<PhoneModeSession | null>("get_phone_mode_status")
      .then((current) => {
        if (!disposed) setSession(current);
      })
      .catch(() => undefined);

    void listen("phone-mode-paired", () => {
      setSession((current) => current ? { ...current, paired: true } : current);
    }).then((unlisten) => disposed ? unlisten() : cleanups.push(unlisten));

    void listen("phone-mode-stopped", () => {
      setSession(null);
      setMessage("");
    }).then((unlisten) => disposed ? unlisten() : cleanups.push(unlisten));

    void listen<PhoneControlAction>("phone-control-action", ({ payload }) => {
      if (payload.type === "launcher" && payload.value) {
        clickDashboardControl(`[data-launcher-id="${CSS.escape(payload.value)}"]`);
        return;
      }
      if (payload.type === "group" && payload.value) {
        const group = appGroups.find((candidate) => candidate.id === payload.value);
        if (group) launchAppGroup(group);
        return;
      }
      if (payload.type === "open_workspace") {
        clickDashboardControl("[data-control-action='open-apps']");
        return;
      }
      if (payload.type === "speech") {
        window.dispatchEvent(new Event("control-panel:start-speech-mode"));
        return;
      }
      if (payload.type === "scene" && payload.value) {
        window.dispatchEvent(new CustomEvent("control-panel:productivity-scene", { detail: { sceneId: payload.value } }));
        return;
      }
      if (payload.type === "capture" && payload.value) {
        window.dispatchEvent(new CustomEvent("control-panel:productivity-capture", { detail: { text: payload.value } }));
      }
    }).then((unlisten) => disposed ? unlisten() : cleanups.push(unlisten));

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [appGroups, launchAppGroup]);

  useEffect(() => {
    if (!session || !isTauriRuntime()) return;
    const sync = () => {
      void invoke("update_phone_mode_context", { context: buildContext() }).catch(() => undefined);
    };
    sync();
    const timer = window.setInterval(sync, 3_000);
    return () => window.clearInterval(timer);
  }, [buildContext, session]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 70);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [closeDialog, open]);

  return (
    <>
      <TactileButton
        ref={triggerRef}
        onClick={() => session ? setOpen(true) : void start()}
        selected={Boolean(session)}
        className="grid size-11 shrink-0 place-items-center p-0"
        aria-haspopup="dialog"
        aria-label="Open Phone Mode"
        title="Phone Mode"
        data-shortcut-combo="Control+Alt+Shift+KeyM"
        data-shortcut-id="control:phone-mode"
        data-shortcut-label="Open Phone Mode"
        data-shortcut-detail="Control this computer from a paired phone on the local network"
        data-shortcut-group="Control panel"
        data-shortcut-order="0"
      >
        <span className="text-signal-300">
          <PhoneGlyph />
          {session ? <span className="absolute bottom-2 right-2 size-1.5 rounded-full bg-emerald-300" aria-hidden="true" /> : null}
        </span>
      </TactileButton>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => event.currentTarget === event.target && closeDialog()}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="phone-mode-title"
            className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101210] text-stone-100"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-signal-300">Local remote</p>
                <h2 id="phone-mode-title" className="mt-1 text-xl font-semibold tracking-[-0.03em]">Phone Mode</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-stone-500">Same network, temporary session, paired access.</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDialog}
                className="grid size-9 place-items-center rounded-lg text-stone-500 hover:bg-white/[0.04] hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                aria-label="Close Phone Mode dialog"
              >
                <CloseGlyph />
              </button>
            </header>

            <div className="px-5 py-5 sm:px-6 sm:py-6">
              {!session ? (
                <div className="rounded-xl border border-white/[0.07] bg-black/15 p-5">
                  <p className="text-sm font-semibold">Start a paired LAN session</p>
                  <p className="mt-2 text-xs leading-relaxed text-stone-500">
                    Your phone and computer must be on the same trusted Wi-Fi or Ethernet network. The desktop hides only after the phone pairs.
                  </p>
                  <TactileButton onClick={() => void start()} disabled={busy} className="mt-5 h-11 w-full text-[11px] font-semibold uppercase tracking-[0.09em]">
                    {busy ? "Starting…" : "Start Phone Mode"}
                  </TactileButton>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-xs text-stone-400">
                    <span className={`size-2 rounded-full ${session.paired ? "bg-emerald-300" : "bg-signal-300"}`} />
                    {session.paired ? "Phone paired · desktop hidden" : "Waiting for your phone"}
                  </div>

                  <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/15 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-stone-600">1 · Open this address in Safari</p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 select-all overflow-hidden text-ellipsis whitespace-nowrap text-sm text-stone-200">{session.url}</code>
                      <button type="button" onClick={() => void copyValue("url", session.url)} className="h-8 rounded-lg border border-white/[0.08] px-3 text-[10px] font-semibold text-stone-400 hover:text-stone-100">
                        {copied === "url" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/15 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-stone-600">2 · Enter this pairing code</p>
                    <div className="mt-2 flex items-center gap-3">
                      <code className="flex-1 select-all text-3xl font-semibold tracking-[0.23em] text-signal-300">{session.pairingCode}</code>
                      <button type="button" onClick={() => void copyValue("code", session.pairingCode)} className="h-8 rounded-lg border border-white/[0.08] px-3 text-[10px] font-semibold text-stone-400 hover:text-stone-100">
                        {copied === "code" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 text-[11px] leading-relaxed text-stone-600">
                    After pairing, use Safari’s Share menu → Add to Home Screen. The address stays bookmarkable on this network; the six-digit code and access token are replaced each time Phone Mode starts.
                  </p>

                  <button
                    type="button"
                    onClick={() => void stop()}
                    disabled={busy}
                    className="mt-5 h-11 w-full rounded-xl border border-red-400/25 bg-red-950/20 text-[11px] font-semibold uppercase tracking-[0.09em] text-red-200 hover:bg-red-950/30 disabled:opacity-50"
                  >
                    {busy ? "Stopping…" : "Stop Phone Mode"}
                  </button>
                </>
              )}

              {message ? <p className="mt-4 text-center text-xs leading-relaxed text-red-300" role="alert">{message}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
