import { useEffect, useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  const tickMarks = useMemo(() => Array.from({ length: 12 }, (_, index) => index), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  const timeParts = timeFormatter.formatToParts(now);
  const primaryTime = timeParts
    .filter((part) => part.type === "hour" || part.type === "minute" || part.type === "literal")
    .slice(0, 3)
    .map((part) => part.value)
    .join("");
  const period = timeParts.find((part) => part.type === "dayPeriod")?.value;

  return (
    <WidgetFrame
      title="Local time"
      icon={<Clock3 size={16} strokeWidth={1.7} />}
      className="lg:col-span-3"
    >
      <div className="grid h-full min-h-[250px] grid-cols-1 items-center gap-3 p-4 sm:min-h-[186px] sm:grid-cols-[104px_1fr] sm:gap-3">
        <div className="clock-bezel mx-auto grid size-24 place-items-center rounded-full sm:size-[104px]">
          <div className="clock-face relative size-[88%] rounded-full" aria-hidden="true">
            {tickMarks.map((mark) => (
              <span
                key={mark}
                className="absolute left-1/2 top-1/2 h-[42%] w-px origin-bottom -translate-x-1/2 -translate-y-full"
                style={{ transform: `translate(-50%, -100%) rotate(${mark * 30}deg)` }}
              >
                <span className="block h-1.5 w-px bg-stone-400/70" />
              </span>
            ))}
            <span
              className="clock-hand absolute bottom-1/2 left-1/2 h-[25%] w-[3px] origin-bottom rounded-full bg-stone-200"
              style={{ transform: `translateX(-50%) rotate(${hours * 30}deg)` }}
            />
            <span
              className="clock-hand absolute bottom-1/2 left-1/2 h-[35%] w-[2px] origin-bottom rounded-full bg-stone-300"
              style={{ transform: `translateX(-50%) rotate(${minutes * 6}deg)` }}
            />
            <span
              className="clock-hand absolute bottom-1/2 left-1/2 h-[38%] w-px origin-bottom bg-signal-300"
              style={{ transform: `translateX(-50%) rotate(${seconds * 6}deg)` }}
            />
            <span className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/70 bg-signal-300 shadow-amber-led" />
          </div>
        </div>

        <div className="min-w-0">
          <div className="display-well rounded-xl border border-black/50 px-3 py-4 shadow-well">
            <time
              dateTime={now.toISOString()}
              className="block whitespace-nowrap font-mono text-[clamp(1.75rem,3vw,2.6rem)] font-medium leading-none tracking-[-0.06em] text-stone-100"
            >
              {primaryTime}
              <span className="ml-2 text-[12px] tracking-[0.08em] text-signal-300">{period}</span>
            </time>
            <p className="mt-3 truncate text-xs font-medium text-stone-400">{dateFormatter.format(now)}</p>
          </div>
        </div>
      </div>
    </WidgetFrame>
  );
}
