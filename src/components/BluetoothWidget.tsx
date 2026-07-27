import { invoke } from "@tauri-apps/api/core";
import { Bluetooth, Headphones, Radio, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { TactileButton } from "./TactileButton";
import { WidgetFrame } from "./WidgetFrame";

type ConnectionState = "disconnected" | "connecting" | "connected" | "disconnecting";

const stateLabel: Record<ConnectionState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  disconnecting: "Disconnecting",
};

/**
 * Manages the connection lifecycle for the dashboard's configured Bluetooth headset.
 * @returns A Bluetooth status card with connect and disconnect controls.
 * @remarks Side effects: polls and changes the device's Windows audio endpoint state.
 */
export function BluetoothWidget() {
  // --- Connection State and Polling ---
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [detail, setDetail] = useState("Ready for quick-connect");
  const previewTimer = useRef<number>();
  const connectionRef = useRef(connection);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return () => {
        if (previewTimer.current) window.clearTimeout(previewTimer.current);
      };
    }

    let active = true;
    const refresh = () => {
      void invoke<boolean>("get_bluetooth_device_status", { deviceName: "JLab GO Pop+" })
        .then((connected) => {
          if (!active || connectionRef.current === "connecting" || connectionRef.current === "disconnecting") return;
          setConnection(connected ? "connected" : "disconnected");
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 8_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, []);

  // --- Connection Actions ---

  /**
   * Requests a Bluetooth audio connection unless another transition is active.
   * @returns A promise that resolves after the UI reflects the connection result.
   * @remarks Side effects: changes the native device connection or simulates it in preview mode.
   */
  const connect = async () => {
    if (connection === "connecting" || connection === "disconnecting") return;
    setConnection("connecting");
    setDetail("Requesting Windows audio link");

    if (!isTauriRuntime()) {
      previewTimer.current = window.setTimeout(() => {
        setConnection("connected");
        setDetail("Preview connection");
      }, 850);
      return;
    }

    try {
      await invoke("connect_bluetooth_device", { deviceName: "JLab GO Pop+" });
      setConnection("connected");
      setDetail("Bluetooth audio is ready");
    } catch (error) {
      setConnection("disconnected");
      setDetail(errorMessage(error));
    }
  };

  /**
   * Releases the active Bluetooth audio connection.
   * @returns A promise that resolves after the UI reflects the disconnection result.
   * @remarks Side effects: changes the native device connection or simulates it in preview mode.
   */
  const disconnect = async () => {
    if (connection !== "connected") return;
    setConnection("disconnecting");
    setDetail("Releasing Windows audio link");

    if (!isTauriRuntime()) {
      previewTimer.current = window.setTimeout(() => {
        setConnection("disconnected");
        setDetail("Preview disconnection");
      }, 650);
      return;
    }

    try {
      await invoke("disconnect_bluetooth_device", { deviceName: "JLab GO Pop+" });
      setConnection("disconnected");
      setDetail("Bluetooth audio disconnected");
    } catch (error) {
      setConnection("connected");
      setDetail(errorMessage(error));
    }
  };

  // --- Widget Rendering ---
  const transitioning = connection === "connecting" || connection === "disconnecting";

  return (
    <WidgetFrame
      title="Bluetooth audio"
      icon={<Bluetooth size={16} strokeWidth={1.7} />}
      className="md:col-span-2 lg:col-span-4"
    >
      <div className="flex h-full min-h-[186px] flex-col justify-between p-4">
        <div className="flex items-center gap-3.5">
          <div className="grid size-14 shrink-0 place-items-center rounded-full border border-black/70 bg-gradient-to-br from-[#202321] to-[#0b0c0b] text-stone-400 shadow-skeuo-raised">
            <Headphones size={25} strokeWidth={1.45} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tracking-tight text-stone-100">JLab GO Pop+</p>
            <div className="mt-1 flex items-center gap-2">
              <Radio size={11} strokeWidth={1.8} className="text-signal-300" />
              <span className="text-[12px] font-medium text-stone-500" aria-live="polite">
                {stateLabel[connection]}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-2.5">
            <TactileButton
              onClick={() => void connect()}
              disabled={transitioning}
              selected={connection === "connected"}
              className="flex h-10 items-center justify-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.09em]"
            >
              <Bluetooth size={14} strokeWidth={1.8} />
              {connection === "connecting" ? "Connecting" : "Connect"}
            </TactileButton>
            <TactileButton
              onClick={() => void disconnect()}
              disabled={connection !== "connected"}
              className="flex h-10 items-center justify-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.09em]"
            >
              <Unplug size={14} strokeWidth={1.8} />
              {connection === "disconnecting" ? "Disconnecting" : "Disconnect"}
            </TactileButton>
          </div>
          <p className="mt-1.5 truncate text-center text-[10px] text-stone-700" title={detail}>
            {detail}
          </p>
        </div>
      </div>
    </WidgetFrame>
  );
}
