import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "shoedz-theme";

function getSystemPreference(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Directly synchronizes the document root class, CSS color-scheme property,
 * and Electron nativeTheme with the given theme mode.
 */
export function applyThemeToDom(mode: ThemeMode): ResolvedTheme {
  const isDark = mode === "dark" || (mode === "system" && getSystemPreference() === "dark");
  const resolved: ResolvedTheme = isDark ? "dark" : "light";

  if (typeof document !== "undefined") {
    if (isDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    }
  }

  // Notify Electron if running inside desktop shell
  if (typeof window !== "undefined" && window.electronAPI?.setTheme) {
    window.electronAPI.setTheme(mode).catch(() => {});
  }

  return resolved;
}

/**
 * React hook for accessing and controlling the application theme.
 * Supports "light", "dark", and "system" (auto OS preference).
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || "system";
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const isDark = theme === "dark" || (theme === "system" && getSystemPreference() === "dark");
    return isDark ? "dark" : "light";
  });

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {}
    const resolved = applyThemeToDom(newTheme);
    setResolvedTheme(resolved);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark");
  }, [theme, setTheme]);

  useEffect(() => {
    const resolved = applyThemeToDom(theme);
    setResolvedTheme(resolved);

    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentResolved = applyThemeToDom("system");
      setResolvedTheme(currentResolved);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isDark: resolvedTheme === "dark",
  };
}

