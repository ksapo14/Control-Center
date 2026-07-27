import { invoke } from "@tauri-apps/api/core";
import { Activity, Cpu, MemoryStick, Microchip } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { errorMessage, isTauriRuntime } from "../lib/runtime";
import { WidgetFrame } from "./WidgetFrame";

type SystemMetrics = {
  cpu: number;
  ram: number;
  gpu: number | null;
};

type GaugeProps = {
  label: string;
  value: number | null;
  icon: ReactNode;
};

function InstrumentGauge({ label, value, icon }: GaugeProps) {
  const safeValue = value ?? 0;
  const angle = -122 + safeValue * 2.44;

  return (
    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
      <div
        className="instrument-dial relative size-[112px] shrink-0 rounded-full sm:size-[126px]"
        style={{ "--needle-angle": `${angle}deg` } as CSSProperties}
      >
        <div className="absolute inset-[13px] rounded-full border border-white/[0.055] bg-[#080908] shadow-well" />
        <span className="absolute left-1/2 top-1/2 h-[37%] w-px origin-bottom -translate-x-1/2 -translate-y-full rotate-[var(--needle-angle)] bg-signal-300 shadow-[0_0_5px_rgba(218,166,75,0.48)] transition-transform duration-700 ease-tactile" />
        <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#5f4a28] bg-signal-400 shadow-skeuo-bevel" />
        <div className="absolute inset-x-0 bottom-[19px] text-center">
          <span className="font-mono text-[20px] font-semibold tabular-nums text-stone-100">
            {value === null ? "N/A" : String(value).padStart(2, "0")}
          </span>
          {value !== null && <span className="ml-0.5 font-mono text-[10px] text-stone-600">%</span>}
        </div>
      </div>

      <div className="min-w-0">
        <span className="text-signal-300/85">{icon}</span>
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.13em] text-stone-300">{label}</p>
        <p className="mt-1 font-mono text-[9px] text-stone-600">
          {value === null ? "Counter unavailable" : value < 50 ? "Nominal load" : value < 80 ? "Working load" : "High load"}
        </p>
      </div>
    </div>
  );
}

export function SystemVitalsWidget() {
  const [metrics, setMetrics] = useState<SystemMetrics>({ cpu: 24, ram: 48, gpu: 12 });
  const [status, setStatus] = useState("Live Windows counters");

  useEffect(() => {
    if (!isTauriRuntime()) {
      setStatus("Preview counters");
      return;
    }

    let active = true;
    const refresh = () => {
      void invoke<SystemMetrics>("get_system_metrics")
        .then((next) => {
          if (!active) return;
          setMetrics(next);
          setStatus("Live Windows counters");
        })
        .catch((error: unknown) => {
          if (active) setStatus(errorMessage(error));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 4_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <WidgetFrame
      title="System vitals"
      icon={<Activity size={16} strokeWidth={1.7} />}
      className="md:col-span-2 lg:col-span-9"
    >
      <span className="sr-only" aria-live="polite">{status}</span>
      <div className="grid h-full min-h-[172px] grid-cols-1 gap-5 px-5 py-4 sm:grid-cols-3 sm:gap-3 lg:px-8">
        <InstrumentGauge label="Processor" value={metrics.cpu} icon={<Cpu size={17} strokeWidth={1.6} />} />
        <InstrumentGauge label="Memory" value={metrics.ram} icon={<MemoryStick size={17} strokeWidth={1.6} />} />
        <InstrumentGauge label="Graphics" value={metrics.gpu} icon={<Microchip size={17} strokeWidth={1.6} />} />
      </div>
    </WidgetFrame>
  );
}
