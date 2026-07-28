import { Check } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type DashboardTheme = "black" | "tan" | "green" | "blue" | "white";
export type WidgetId =
  | "clock"
  | "volume"
  | "bluetooth"
  | "quick-links"
  | "spotify"
  | "system-vitals"
  | "pomodoro";

type DashboardCustomizationValue = {
  theme: DashboardTheme;
  hiddenWidgets: ReadonlySet<WidgetId>;
  setTheme: (theme: DashboardTheme) => void;
  setWidgetHidden: (widgetId: WidgetId, hidden: boolean) => void;
};

const THEME_STORAGE_KEY = "control-panel.theme";
const HIDDEN_WIDGETS_STORAGE_KEY = "control-panel.hidden-widgets";
const themes: Array<{ id: DashboardTheme; label: string; color: string }> = [
  { id: "black", label: "Black", color: "#282b29" },
  { id: "tan", label: "Tan", color: "#daa64b" },
  { id: "green", label: "Green", color: "#49b978" },
  { id: "blue", label: "Blue", color: "#5b9ee8" },
  { id: "white", label: "White", color: "#e7e7e2" },
];
const widgetIds = new Set<WidgetId>([
  "clock",
  "volume",
  "bluetooth",
  "quick-links",
  "spotify",
  "system-vitals",
  "pomodoro",
]);

const DashboardCustomizationContext = createContext<DashboardCustomizationValue | null>(null);

/**
 * Reads a stored theme while rejecting values from older or malformed preferences.
 * @returns A supported theme, defaulting to the original tan palette.
 */
function initialTheme(): DashboardTheme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (themes.some((theme) => theme.id === stored)) return stored as DashboardTheme;
  } catch {
    // Storage can be unavailable in hardened webviews; the in-memory preference still works.
  }
  return "tan";
}

/**
 * Reads the persisted hidden-widget list and discards unknown tile identifiers.
 * @returns A validated set of hidden dashboard widgets.
 */
function initialHiddenWidgets(): Set<WidgetId> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(HIDDEN_WIDGETS_STORAGE_KEY) ?? "[]");
    if (Array.isArray(stored)) {
      return new Set(stored.filter((value): value is WidgetId => widgetIds.has(value)));
    }
  } catch {
    // Invalid preferences should never prevent the dashboard from rendering.
  }
  return new Set();
}

/**
 * Owns persistent appearance and visibility preferences for every dashboard tile.
 * @param props - Dashboard content that consumes customization state.
 * @returns A shared customization context provider.
 * @remarks Side effects: updates local storage and the document theme attribute.
 */
export function DashboardCustomizationProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<DashboardTheme>(initialTheme);
  const [hiddenWidgets, setHiddenWidgets] = useState<Set<WidgetId>>(initialHiddenWidgets);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme remains active for this session when persistence is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_WIDGETS_STORAGE_KEY, JSON.stringify([...hiddenWidgets]));
    } catch {
      // Visibility remains usable in memory when persistence is unavailable.
    }
  }, [hiddenWidgets]);

  const value = useMemo<DashboardCustomizationValue>(
    () => ({
      theme,
      hiddenWidgets,
      setTheme,
      setWidgetHidden: (widgetId, hidden) => {
        setHiddenWidgets((current) => {
          const next = new Set(current);
          if (hidden) next.add(widgetId);
          else next.delete(widgetId);
          return next;
        });
      },
    }),
    [hiddenWidgets, theme],
  );

  return (
    <DashboardCustomizationContext.Provider value={value}>
      {children}
    </DashboardCustomizationContext.Provider>
  );
}

/**
 * Provides the active dashboard customization state to tiles and controls.
 * @returns The nearest dashboard customization context.
 * @throws When called outside `DashboardCustomizationProvider`.
 */
export function useDashboardCustomization() {
  const context = useContext(DashboardCustomizationContext);
  if (!context) throw new Error("Dashboard customization requires its provider");
  return context;
}

/**
 * Renders compact palette controls suitable for the draggable title bar.
 * @returns Five accessible color-scheme selectors.
 */
export function ThemePicker() {
  const { theme: selectedTheme, setTheme } = useDashboardCustomization();

  return (
    <div
      className="theme-picker flex items-center gap-1.5 rounded-full border border-black/45 bg-black/15 px-2 py-1.5 shadow-well"
      aria-label="Color scheme"
      role="group"
      data-tauri-drag-region="false"
    >
      {themes.map((theme) => {
        const selected = theme.id === selectedTheme;
        return (
          <button
            key={theme.id}
            type="button"
            className="relative grid size-4 place-items-center rounded-full border border-white/20 transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-300"
            style={{ backgroundColor: theme.color }}
            onClick={() => setTheme(theme.id)}
            aria-label={`Use ${theme.label} color scheme`}
            aria-pressed={selected}
            title={`${theme.label} color scheme`}
            data-tauri-drag-region="false"
          >
            {selected && (
              <Check
                size={9}
                strokeWidth={3}
                className={theme.id === "white" ? "text-black" : "text-white"}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
