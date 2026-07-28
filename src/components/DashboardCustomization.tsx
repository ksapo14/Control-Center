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
export type WidgetSize = "compact" | "standard" | "wide";

type DashboardCustomizationValue = {
  theme: DashboardTheme;
  hiddenWidgets: ReadonlySet<WidgetId>;
  widgetOrder: readonly WidgetId[];
  widgetSizes: Readonly<Record<WidgetId, WidgetSize>>;
  editMode: boolean;
  setTheme: (theme: DashboardTheme) => void;
  setWidgetHidden: (widgetId: WidgetId, hidden: boolean) => void;
  setEditMode: (enabled: boolean) => void;
  moveWidget: (widgetId: WidgetId, direction: -1 | 1) => void;
  cycleWidgetSize: (widgetId: WidgetId) => void;
  resetDashboardLayout: () => void;
};

const THEME_STORAGE_KEY = "control-panel.theme";
const HIDDEN_WIDGETS_STORAGE_KEY = "control-panel.hidden-widgets";
const WIDGET_ORDER_STORAGE_KEY = "control-panel.widget-order";
const WIDGET_SIZES_STORAGE_KEY = "control-panel.widget-sizes";
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
const defaultWidgetOrder = [...widgetIds];
const defaultWidgetSizes: Record<WidgetId, WidgetSize> = {
  clock: "standard",
  volume: "standard",
  bluetooth: "standard",
  "quick-links": "standard",
  spotify: "standard",
  "system-vitals": "standard",
  pomodoro: "standard",
};

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
 * Restores a complete widget order while tolerating preferences from older app versions.
 * @returns Every known widget exactly once in its persisted order.
 */
function initialWidgetOrder(): WidgetId[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WIDGET_ORDER_STORAGE_KEY) ?? "[]");
    if (Array.isArray(stored)) {
      const valid = stored.filter(
        (value, index): value is WidgetId =>
          widgetIds.has(value) && stored.indexOf(value) === index,
      );
      return [...valid, ...defaultWidgetOrder.filter((widgetId) => !valid.includes(widgetId))];
    }
  } catch {
    // A corrupt layout falls back independently without discarding other preferences.
  }
  return [...defaultWidgetOrder];
}

/**
 * Restores per-widget size choices and fills missing entries with safe defaults.
 * @returns A complete map of validated widget sizes.
 */
function initialWidgetSizes(): Record<WidgetId, WidgetSize> {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(WIDGET_SIZES_STORAGE_KEY) ?? "{}",
    ) as Partial<Record<WidgetId, WidgetSize>>;
    return Object.fromEntries(
      defaultWidgetOrder.map((widgetId) => [
        widgetId,
        ["compact", "standard", "wide"].includes(stored[widgetId] ?? "")
          ? stored[widgetId]
          : "standard",
      ]),
    ) as Record<WidgetId, WidgetSize>;
  } catch {
    return { ...defaultWidgetSizes };
  }
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
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(initialWidgetOrder);
  const [widgetSizes, setWidgetSizes] =
    useState<Record<WidgetId, WidgetSize>>(initialWidgetSizes);
  const [editMode, setEditMode] = useState(false);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDGET_ORDER_STORAGE_KEY, JSON.stringify(widgetOrder));
      window.localStorage.setItem(WIDGET_SIZES_STORAGE_KEY, JSON.stringify(widgetSizes));
    } catch {
      // Layout editing remains available for the current session without storage.
    }
  }, [widgetOrder, widgetSizes]);

  const value = useMemo<DashboardCustomizationValue>(
    () => ({
      theme,
      hiddenWidgets,
      widgetOrder,
      widgetSizes,
      editMode,
      setTheme,
      setEditMode,
      setWidgetHidden: (widgetId, hidden) => {
        setHiddenWidgets((current) => {
          const next = new Set(current);
          if (hidden) next.add(widgetId);
          else next.delete(widgetId);
          return next;
        });
      },
      moveWidget: (widgetId, direction) => {
        setWidgetOrder((current) => {
          const sourceIndex = current.indexOf(widgetId);
          const targetIndex = sourceIndex + direction;
          if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
          const next = [...current];
          [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
          return next;
        });
      },
      cycleWidgetSize: (widgetId) => {
        const sizes: WidgetSize[] = ["compact", "standard", "wide"];
        setWidgetSizes((current) => ({
          ...current,
          [widgetId]: sizes[(sizes.indexOf(current[widgetId]) + 1) % sizes.length],
        }));
      },
      resetDashboardLayout: () => {
        setWidgetOrder([...defaultWidgetOrder]);
        setWidgetSizes({ ...defaultWidgetSizes });
        setHiddenWidgets(new Set());
      },
    }),
    [editMode, hiddenWidgets, theme, widgetOrder, widgetSizes],
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
