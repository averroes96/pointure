export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? "https://app.shodz.dz") + "/api/v1";

export const C = {
  // Brand
  primary: "#1e40af",
  primaryMid: "#2563eb",
  primaryLight: "#3b82f6",
  primaryBg: "#eff6ff",
  primaryBorder: "#bfdbfe",

  // Semantic
  success: "#059669",
  successBg: "#ecfdf5",
  successBorder: "#a7f3d0",

  warning: "#d97706",
  warningBg: "#fffbeb",
  warningBorder: "#fde68a",

  danger: "#dc2626",
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",

  // Text
  text: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",

  // Surfaces
  white: "#ffffff",
  surface: "#f8fafc",
  surfaceAlt: "#f1f5f9",
  border: "#e2e8f0",
  borderLight: "#f1f5f9",
  black: "#000000",

  // Radius
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 999,
  },

  // Spacing
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  // Shadow
  shadow: {
    sm: {
      shadowColor: "#0f172a",
      shadowOpacity: 0.06,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    md: {
      shadowColor: "#0f172a",
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
  },
};
