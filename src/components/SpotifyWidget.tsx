import { invoke } from "@tauri-apps/api/core";
import { Disc3, Link2, LogOut, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { WidgetFrame } from "./WidgetFrame";

const playlists = [
  {
    title: "Pure Bliss",
    subtitle: "Spotify playlist",
    uri: "spotify:playlist:1mvmRPMGpSQ6pS9k1K3QHN",
    cover: "cover-bliss",
  },
  {
    title: "Ethereal Mountain Cruisin'",
    subtitle: "Spotify playlist",
    uri: "spotify:playlist:37i9dQZF1FwOSSdYQOO5Is",
    cover: "cover-ethereal",
  },
  {
    title: "Latino",
    subtitle: "Spotify playlist",
    uri: "spotify:playlist:7sk61fA1j4t4ES5rj3mHbw",
    cover: "cover-latino",
  },
];

type SpotifyStatus = {
  configured: boolean;
  connected: boolean;
};

type SpotifyPlayback = {
  connected: boolean;
  isPlaying: boolean;
  trackName: string | null;
  artists: string | null;
  albumName: string | null;
  deviceName: string | null;
  progressMs: number;
  durationMs: number;
};

type PlaybackAction = "play" | "pause" | "next" | "previous";

const emptyPlayback: SpotifyPlayback = {
  connected: false,
  isPlaying: false,
  trackName: null,
  artists: null,
  albumName: null,
  deviceName: null,
  progressMs: 0,
  durationMs: 0,
};

const previewPlayback: SpotifyPlayback = {
  connected: true,
  isPlaying: false,
  trackName: "Pure Bliss",
  artists: "Spotify Connect preview",
  albumName: "Control Panel",
  deviceName: "Desktop",
  progressMs: 48_000,
  durationMs: 214_000,
};

/**
 * Coordinates Spotify authorization, playlists, playback state, and transport controls.
 * @returns A Spotify dashboard deck with setup and connected states.
 * @remarks Side effects: persists authorization through native commands and controls active playback.
 */
export function SpotifyWidget() {
  // --- Connection and Playback State ---
  const [selected, setSelected] = useState(0);
  const [connection, setConnection] = useState<SpotifyStatus>({ configured: false, connected: false });
  const [playback, setPlayback] = useState<SpotifyPlayback>(emptyPlayback);
  const [clientId, setClientId] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("Checking Spotify connection");

  // --- Playback Synchronization ---

  /**
   * Synchronizes the UI with the active Spotify Connect device.
   * @returns The latest playback snapshot, or `null` when the read fails.
   * @remarks Side effects: reads Spotify state and updates playback feedback.
   */
  const refreshPlayback = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const next = await invoke<SpotifyPlayback>("get_spotify_playback");
      setPlayback(next);
      if (!next.trackName) setNotice("Open Spotify on a device to begin playback");
      return next;
    } catch (error) {
      setNotice(errorMessage(error));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!isTauriRuntime()) {
        setConnection({ configured: true, connected: true });
        setPlayback(previewPlayback);
        setNotice("Spotify Connect preview");
        setLoaded(true);
        return;
      }
      try {
        const next = await invoke<SpotifyStatus>("get_spotify_status");
        if (cancelled) return;
        setConnection(next);
        setNotice(
          next.connected
            ? "Spotify connected"
            : next.configured
              ? "Connect your Spotify account"
              : "Enter your Spotify Client ID",
        );
      } catch (error) {
        if (!cancelled) setNotice(errorMessage(error));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connection.connected || !isTauriRuntime()) return;
    void refreshPlayback();
    const interval = window.setInterval(() => void refreshPlayback(), 4_000);
    return () => window.clearInterval(interval);
  }, [connection.connected, refreshPlayback]);

  const progress = useMemo(
    () => (playback.durationMs > 0 ? Math.min(100, (playback.progressMs / playback.durationMs) * 100) : 0),
    [playback.durationMs, playback.progressMs],
  );

  // --- Authorization Actions ---

  /**
   * Starts Spotify's browser authorization flow using the saved client ID.
   * @returns A promise that resolves after connection state is updated.
   * @remarks Side effects: opens the system browser and stores OAuth tokens in the desktop runtime.
   */
  const connect = async () => {
    if (!isTauriRuntime()) return;
    setBusy(true);
    setNotice("Complete Spotify authorization in your browser");
    try {
      const next = await invoke<SpotifyStatus>("connect_spotify");
      setConnection(next);
      setConfiguring(false);
      setNotice("Spotify connected");
      await refreshPlayback();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Validates and saves a client ID before continuing into authorization.
   * @returns A promise that resolves after configuration and the connection attempt.
   * @remarks Side effects: replaces saved Spotify configuration and may open browser authorization.
   */
  const configureAndConnect = async () => {
    const trimmed = clientId.trim();
    if (!trimmed) {
      setNotice("Paste the Client ID from your Spotify developer app");
      return;
    }
    if (!isTauriRuntime()) return;
    setBusy(true);
    setNotice("Saving Spotify Client ID");
    try {
      const next = await invoke<SpotifyStatus>("configure_spotify", { clientId: trimmed });
      setConnection(next);
      setClientId("");
      setNotice("Client ID saved. Opening Spotify authorization");
    } catch (error) {
      setNotice(errorMessage(error));
      setBusy(false);
      return;
    }
    setBusy(false);
    await connect();
  };

  /**
   * Removes the locally stored Spotify session and resets playback state.
   * @returns A promise that resolves after disconnection is reflected in the UI.
   * @remarks Side effects: deletes persisted Spotify OAuth tokens.
   */
  const disconnect = async () => {
    if (!isTauriRuntime()) return;
    setBusy(true);
    try {
      const next = await invoke<SpotifyStatus>("disconnect_spotify");
      setConnection(next);
      setPlayback(emptyPlayback);
      setNotice("Spotify disconnected");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  // --- Playback Actions ---

  /**
   * Starts a curated playlist on the active Spotify Connect device.
   * @param index - The selected playlist's index in the curated configuration.
   * @returns A promise that resolves after playback is started or an error is shown.
   * @remarks Side effects: changes Spotify playback and the selected playlist state.
   */
  const openPlaylist = async (index: number) => {
    setSelected(index);
    if (!connection.connected) {
      setNotice("Connect Spotify before starting a playlist");
      return;
    }
    try {
      if (isTauriRuntime()) {
        await invoke("spotify_play_context", { contextUri: playlists[index].uri });
        await refreshPlayback();
      } else {
        setPlayback((current) => ({ ...current, trackName: playlists[index].title, isPlaying: true }));
      }
      setNotice(`${playlists[index].title} started on Spotify`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  /**
   * Sends a transport command and confirms Spotify has applied stateful actions.
   * @param action - The supported playback operation.
   * @returns A promise that resolves after playback has been reconciled.
   * @remarks Side effects: changes playback on the active Spotify device.
   */
  const controlPlayback = async (action: PlaybackAction) => {
    if (!connection.connected) {
      setNotice("Connect Spotify before using playback controls");
      return;
    }
    if (controlBusy) return;
    setControlBusy(true);
    setNotice(`${action === "play" ? "Resuming" : action === "pause" ? "Pausing" : "Changing track on"} Spotify…`);
    try {
      if (isTauriRuntime()) {
        await invoke("spotify_playback_action", { action });
        const expectedPlaying = action === "play" ? true : action === "pause" ? false : null;
        let latest: SpotifyPlayback | null = null;
        // Spotify acknowledges commands before device state converges, so poll briefly for confirmation.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 650 : 350));
          latest = await invoke<SpotifyPlayback>("get_spotify_playback");
          setPlayback(latest);
          if (expectedPlaying === null || latest.isPlaying === expectedPlaying) break;
        }
        if (expectedPlaying !== null && latest?.isPlaying !== expectedPlaying) {
          throw new Error("Spotify accepted the command, but the active device did not change. Make sure that device is controllable and your account has Premium.");
        }
      }
      setNotice(action === "play" ? "Playback resumed" : action === "pause" ? "Playback paused" : "Track changed");
    } catch (error) {
      setNotice(errorMessage(error));
      await refreshPlayback();
    } finally {
      setControlBusy(false);
    }
  };

  // --- Widget Rendering ---
  const showSetup = loaded && (!connection.configured || configuring);

  return (
    <WidgetFrame
      title="Spotify deck"
      icon={<Disc3 size={16} strokeWidth={1.7} />}
      className="md:col-span-2 lg:col-span-7"
    >
      <div className="flex h-full min-h-[250px] flex-col p-3.5">
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-2.5">
          {playlists.map((playlist, index) => (
            <button
              type="button"
              key={playlist.title}
              onClick={() => void openPlaylist(index)}
              disabled={busy}
              className={cn(
                "group min-w-0 rounded-xl border border-black/70 bg-[#090a09] p-2 text-left shadow-well transition duration-200 ease-tactile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/80 disabled:cursor-wait disabled:opacity-55",
                selected === index && "border-signal-500/30 bg-signal-500/[0.025]",
              )}
              aria-label={`Play ${playlist.title} on Spotify`}
            >
              <span className={cn("playlist-cover relative block aspect-[2/1] overflow-hidden rounded-[9px]", playlist.cover)}>
                <span className="absolute inset-0 bg-gradient-to-br from-white/[0.055] via-transparent to-[#050605]/65" />
                <span className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full border border-black/70 bg-[#c79b51] text-graphite-950 shadow-skeuo-bevel transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
                  <Play size={12} fill="currentColor" strokeWidth={1.6} />
                </span>
              </span>
              <span className="mt-2 block truncate text-[12px] font-semibold text-stone-200">{playlist.title}</span>
              <span className="mt-0.5 block truncate text-[9px] text-stone-700">{playlist.subtitle}</span>
            </button>
          ))}
        </div>

        {showSetup ? (
          <div className="mt-2.5 rounded-xl border border-black/70 bg-[#080908] px-3 py-2 shadow-well">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void configureAndConnect();
                }}
                autoComplete="off"
                spellCheck={false}
                aria-label="Spotify Client ID"
                placeholder="Paste Spotify Client ID"
                className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/45 px-3 py-2 font-mono text-[10px] text-stone-200 outline-none placeholder:text-stone-700 focus:border-signal-400/45 focus:ring-1 focus:ring-signal-400/25"
              />
              <TactileButton
                onClick={() => void configureAndConnect()}
                disabled={busy || !clientId.trim()}
                className="flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-[9px] uppercase tracking-[0.12em]"
              >
                {busy ? "Waiting" : "Connect"}
              </TactileButton>
            </div>
            <p className="mt-1.5 truncate font-mono text-[9px] text-stone-700" title={notice}>
              Client ID only. No client secret. {notice}
            </p>
          </div>
        ) : !connection.connected ? (
          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-black/70 bg-[#080908] px-3 py-2 shadow-well">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-stone-300">Spotify authorization required</p>
              <p className="mt-0.5 truncate font-mono text-[9px] text-stone-700" title={notice}>{notice}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={() => setConfiguring(true)} className="deck-button px-2 text-[9px]" aria-label="Change Spotify Client ID">
                ID
              </button>
              <TactileButton onClick={() => void connect()} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[9px] uppercase tracking-[0.12em]">
                <Link2 size={13} strokeWidth={1.7} />
                {busy ? "Waiting" : "Connect"}
              </TactileButton>
            </div>
          </div>
        ) : (
          <div className="mt-2.5 rounded-xl border border-black/70 bg-[#080908] px-3 py-2 shadow-well">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-stone-300">{playback.trackName ?? "Spotify ready"}</p>
                <p className="mt-0.5 truncate font-mono text-[9px] text-stone-700" title={`${playback.artists ? `${playback.artists} · ` : ""}${notice}`}>
                  {playback.artists ? `${playback.artists} · ${notice}` : notice}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button type="button" aria-label="Previous Spotify track" onClick={() => void controlPlayback("previous")} disabled={controlBusy} className="deck-button spotify-transport-button disabled:cursor-wait disabled:opacity-40">
                  <SkipBack size={19} fill="currentColor" strokeWidth={1.5} />
                </button>
                <TactileButton
                  aria-label={playback.isPlaying ? "Pause Spotify" : "Play Spotify"}
                  onClick={() => void controlPlayback(playback.isPlaying ? "pause" : "play")}
                  disabled={controlBusy}
                  className="mx-1 grid size-12 place-items-center rounded-full"
                >
                  {playback.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-px" />}
                </TactileButton>
                <button type="button" aria-label="Next Spotify track" onClick={() => void controlPlayback("next")} disabled={controlBusy} className="deck-button spotify-transport-button disabled:cursor-wait disabled:opacity-40">
                  <SkipForward size={19} fill="currentColor" strokeWidth={1.5} />
                </button>
              </div>

              <div className="flex min-w-0 items-center justify-end gap-1.5">
                <span className="truncate font-mono text-[9px] text-stone-700" title={playback.deviceName ?? "No active device"}>
                  {playback.deviceName ?? "No device"}
                </span>
                <button type="button" onClick={() => void disconnect()} disabled={busy} className="deck-button" aria-label="Disconnect Spotify">
                  <LogOut size={13} strokeWidth={1.6} />
                </button>
              </div>
            </div>
            <div className="mt-2 h-px overflow-hidden bg-white/[0.05]" aria-hidden="true">
              <div className="h-full bg-signal-400/70 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}
