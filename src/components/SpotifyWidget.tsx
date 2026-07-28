import { invoke } from "@tauri-apps/api/core";
import { Disc3, Link2, LogOut, Pause, Play, Plus, SkipBack, SkipForward, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { WidgetFrame } from "./WidgetFrame";

type Playlist = {
  id: string;
  title: string;
  subtitle: string;
  uri: string;
  cover: string;
  custom?: boolean;
};

const CUSTOM_PLAYLISTS_STORAGE_KEY = "control-panel.custom-spotify-playlists";
const playlists: Playlist[] = [
  {
    id: "pure-bliss",
    title: "Pure Bliss",
    subtitle: "Spotify playlist",
    uri: "spotify:playlist:1mvmRPMGpSQ6pS9k1K3QHN",
    cover: "cover-bliss",
  },
  {
    id: "ethereal",
    title: "Ethereal Mountain Cruisin'",
    subtitle: "Spotify playlist",
    uri: "spotify:playlist:37i9dQZF1FwOSSdYQOO5Is",
    cover: "cover-ethereal",
  },
  {
    id: "latino",
    title: "Latino",
    subtitle: "Spotify playlist",
    uri: "spotify:playlist:7sk61fA1j4t4ES5rj3mHbw",
    cover: "cover-latino",
  },
];

/**
 * Converts a Spotify playlist URI or public playlist URL into an API context URI.
 * @param value - User-entered Spotify playlist reference.
 * @returns A canonical playlist URI, or `null` for unsupported input.
 */
function normalizePlaylistUri(value: string) {
  const trimmed = value.trim();
  if (/^spotify:playlist:[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "open.spotify.com" && parts[0] === "playlist" && /^[A-Za-z0-9]+$/.test(parts[1] ?? "")) {
      return `spotify:playlist:${parts[1]}`;
    }
  } catch {
    // The caller surfaces one consistent validation message for URLs and Spotify URIs.
  }
  return null;
}

/**
 * Restores user-created Spotify playlists from local preferences.
 * @returns Valid custom playlists with generated cover styling.
 */
function initialCustomPlaylists(): Playlist[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CUSTOM_PLAYLISTS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item: Partial<Playlist>) => {
      if (
        typeof item.id !== "string" ||
        typeof item.title !== "string" ||
        typeof item.uri !== "string" ||
        !normalizePlaylistUri(item.uri)
      ) {
        return [];
      }
      return [{
        id: item.id,
        title: item.title,
        subtitle: "Custom playlist",
        uri: item.uri,
        cover: "cover-custom",
        custom: true,
      }];
    });
  } catch {
    return [];
  }
}

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
  const [selected, setSelected] = useState(playlists[0].id);
  const [connection, setConnection] = useState<SpotifyStatus>({ configured: false, connected: false });
  const [playback, setPlayback] = useState<SpotifyPlayback>(emptyPlayback);
  const [clientId, setClientId] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("Checking Spotify connection");
  const [customPlaylists, setCustomPlaylists] = useState<Playlist[]>(initialCustomPlaylists);
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState("");
  const [playlistReference, setPlaylistReference] = useState("");

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_PLAYLISTS_STORAGE_KEY, JSON.stringify(customPlaylists));
    } catch {
      setNotice("Custom playlists work for this session but could not be saved");
    }
  }, [customPlaylists]);

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
   * @param playlist - The selected built-in or user-created playlist.
   * @returns A promise that resolves after playback is started or an error is shown.
   * @remarks Side effects: changes Spotify playback and the selected playlist state.
   */
  const openPlaylist = async (playlist: Playlist) => {
    setSelected(playlist.id);
    if (!connection.connected) {
      setNotice("Connect Spotify before starting a playlist");
      return;
    }
    try {
      if (isTauriRuntime()) {
        await invoke("spotify_play_context", { contextUri: playlist.uri });
        await refreshPlayback();
      } else {
        setPlayback((current) => ({ ...current, trackName: playlist.title, isPlaying: true }));
      }
      setNotice(`${playlist.title} started on Spotify`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  /**
   * Validates and persists a custom Spotify playlist.
   * @returns Nothing.
   * @remarks Side effects: updates the playlist collection and local storage.
   */
  const addPlaylist = () => {
    const title = playlistTitle.trim();
    const uri = normalizePlaylistUri(playlistReference);
    if (!title) {
      setNotice("Add a playlist name first");
      return;
    }
    if (!uri) {
      setNotice("Paste a Spotify playlist link or spotify:playlist URI");
      return;
    }
    if ([...playlists, ...customPlaylists].some((playlist) => playlist.uri === uri)) {
      setNotice("That playlist is already in the deck");
      return;
    }

    const playlist: Playlist = {
      id: `custom-${crypto.randomUUID()}`,
      title: title.slice(0, 60),
      subtitle: "Custom playlist",
      uri,
      cover: "cover-custom",
      custom: true,
    };
    setCustomPlaylists((current) => [...current, playlist]);
    setSelected(playlist.id);
    setPlaylistTitle("");
    setPlaylistReference("");
    setAddingPlaylist(false);
    setNotice(`${playlist.title} added to the Spotify deck`);
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
  const allPlaylists = [...playlists, ...customPlaylists];

  return (
    <WidgetFrame
      widgetId="spotify"
      title="Spotify deck"
      icon={<Disc3 size={16} strokeWidth={1.7} />}
      className="md:col-span-2 lg:col-span-7"
    >
      <div className="relative flex h-full min-h-[250px] flex-col p-3.5">
        <div className="horizontal-collection flex min-h-0 flex-1 gap-2.5 overflow-x-auto pb-1">
          {allPlaylists.map((playlist) => (
            <div key={playlist.id} className="group relative min-w-[150px] shrink-0 basis-[calc((100%-1.25rem)/3)]">
              <button
                type="button"
                onClick={() => void openPlaylist(playlist)}
                disabled={busy}
                className={cn(
                  "size-full min-w-0 rounded-xl border border-black/70 bg-[#090a09] p-2 text-left shadow-well transition duration-200 ease-tactile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/80 disabled:cursor-wait disabled:opacity-55",
                  selected === playlist.id && "border-signal-500/30 bg-signal-500/[0.025]",
                )}
                aria-label={`Play ${playlist.title} on Spotify`}
              >
                <span className={cn("playlist-cover relative block aspect-[2/1] overflow-hidden rounded-[9px]", playlist.cover)}>
                  <span className="absolute inset-0 bg-gradient-to-br from-white/[0.055] via-transparent to-[#050605]/65" />
                  <span className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full border border-black/70 bg-signal-400 text-graphite-950 shadow-skeuo-bevel transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
                    <Play size={12} fill="currentColor" strokeWidth={1.6} />
                  </span>
                </span>
                <span className="mt-2 block truncate text-[12px] font-semibold text-stone-200">{playlist.title}</span>
                <span className="mt-0.5 block truncate text-[9px] text-stone-700">{playlist.subtitle}</span>
              </button>
              {playlist.custom && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomPlaylists((current) => current.filter((item) => item.id !== playlist.id));
                    if (selected === playlist.id) setSelected(playlists[0].id);
                    setNotice(`${playlist.title} removed from the Spotify deck`);
                  }}
                  className="absolute left-3 top-3 grid size-6 place-items-center rounded-full bg-black/75 text-stone-500 opacity-0 transition hover:text-red-300 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                  aria-label={`Remove ${playlist.title}`}
                  title={`Remove ${playlist.title}`}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAddingPlaylist(true)}
            className="grid min-w-[150px] shrink-0 basis-[calc((100%-1.25rem)/3)] place-items-center rounded-xl border border-dashed border-white/[0.08] bg-black/10 text-stone-600 transition hover:border-signal-400/35 hover:text-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
          >
            <span className="flex flex-col items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.11em]">
              <Plus size={20} className="text-signal-400" /> Add playlist
            </span>
          </button>
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
                <button type="button" aria-label="Previous Spotify track" data-shortcut-combo="Control+Alt+KeyJ" data-shortcut-label="Previous Spotify track" data-shortcut-detail="Transport backward" data-shortcut-group="Spotify" data-shortcut-order="0" onClick={() => void controlPlayback("previous")} disabled={controlBusy} className="deck-button spotify-transport-button disabled:cursor-wait disabled:opacity-40">
                  <SkipBack size={19} fill="currentColor" strokeWidth={1.5} />
                </button>
                <TactileButton
                  aria-label={playback.isPlaying ? "Pause Spotify" : "Play Spotify"}
                  data-shortcut-combo="Control+Alt+KeyK"
                  data-shortcut-label="Play / pause Spotify"
                  data-shortcut-detail="Toggles current playback"
                  data-shortcut-group="Spotify"
                  data-shortcut-order="1"
                  onClick={() => void controlPlayback(playback.isPlaying ? "pause" : "play")}
                  disabled={controlBusy}
                  className="mx-1 grid size-12 place-items-center rounded-full"
                >
                  {playback.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-px" />}
                </TactileButton>
                <button type="button" aria-label="Next Spotify track" data-shortcut-combo="Control+Alt+KeyL" data-shortcut-label="Next Spotify track" data-shortcut-detail="Transport forward" data-shortcut-group="Spotify" data-shortcut-order="2" onClick={() => void controlPlayback("next")} disabled={controlBusy} className="deck-button spotify-transport-button disabled:cursor-wait disabled:opacity-40">
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

        {addingPlaylist && (
          <div className="absolute inset-2 z-30 flex flex-col rounded-xl border border-white/[0.08] bg-graphite-900/95 p-3 shadow-panel backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-stone-200">Add Spotify playlist</p>
                <p className="mt-0.5 text-[9px] text-stone-600">Use a public playlist link or Spotify URI</p>
              </div>
              <button type="button" onClick={() => setAddingPlaylist(false)} className="deck-button" aria-label="Close add playlist">
                <X size={15} />
              </button>
            </div>
            <input
              value={playlistTitle}
              onChange={(event) => setPlaylistTitle(event.target.value)}
              placeholder="Playlist name"
              maxLength={60}
              className="mt-4 rounded-lg border border-white/[0.07] bg-black/35 px-3 py-2 text-xs text-stone-200 outline-none placeholder:text-stone-700 focus:border-signal-400/50"
            />
            <input
              value={playlistReference}
              onChange={(event) => setPlaylistReference(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addPlaylist();
              }}
              placeholder="https://open.spotify.com/playlist/…"
              className="mt-2 rounded-lg border border-white/[0.07] bg-black/35 px-3 py-2 font-mono text-[10px] text-stone-200 outline-none placeholder:text-stone-700 focus:border-signal-400/50"
            />
            <TactileButton onClick={addPlaylist} className="mt-auto h-9 text-[10px] font-semibold uppercase tracking-[0.1em]">
              Add to Spotify deck
            </TactileButton>
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}
