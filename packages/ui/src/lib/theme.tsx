import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

export type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem("codra-theme");
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

let themeTransitionPauseTimer: number | undefined;

function pauseThemeTransitions(root: HTMLElement) {
  if (typeof window === "undefined") return;

  root.classList.add("theme-changing");

  if (themeTransitionPauseTimer !== undefined) {
    window.clearTimeout(themeTransitionPauseTimer);
  }

  themeTransitionPauseTimer = window.setTimeout(() => {
    root.classList.remove("theme-changing");
    themeTransitionPauseTimer = undefined;
  }, 180);
}

function applyTheme(
  theme: Theme,
  options: { pauseTransitions?: boolean } = {},
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (options.pauseTransitions) pauseThemeTransitions(root);
  root.classList.toggle("dark", theme === "dark");
  root.setAttribute("data-theme", theme);
  // Mirror the theme onto `data-mode` too, for any CSS keyed off it.
  root.setAttribute("data-mode", theme);
  try {
    localStorage.setItem("codra-theme", theme);
  } catch {
    // ignore
  }
}

// Initial application to prevent flash
const initial = getStoredTheme() ?? getSystemTheme();
applyTheme(initial);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => getStoredTheme() ?? getSystemTheme(),
  );

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme, { pauseTransitions: true });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme, setTheme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (!getStoredTheme()) {
        setThemeState(media.matches ? "dark" : "light");
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
