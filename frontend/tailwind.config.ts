import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // ShoeDZ Brand Colors - Modern Retail Cobalt & Obsidian
        primary: {
          DEFAULT: "#2563EB",
          50: "#EFF6FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#2563EB",
          600: "#1D4ED8",
          700: "#1E40AF",
          800: "#1E3A8A",
          900: "#0F172A",
          950: "#0A0F1D",
        },
        secondary: {
          DEFAULT: "#0284C7",
          light: "#E0F2FE",
          dark: "#0369A1",
        },
        accent: {
          DEFAULT: "#F97316",
          light: "#FFF7ED",
          dark: "#EA580C",
        },
        success: {
          DEFAULT: "#059669",
          light: "#ECFDF5",
        },
        danger: {
          DEFAULT: "#DC2626",
          light: "#FEF2F2",
        },
        warning: {
          DEFAULT: "#D97706",
          light: "#FFFBEB",
        },
        surface: "#F8FAFC",
        card: "#FFFFFF",
        border: "#E2E8F0",
        "text-primary": "#0F172A",
        "text-secondary": "#475569",
        "text-muted": "#64748B",
      },
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans"',
          '"Readex Pro"',
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        arabic: ['"Readex Pro"', "system-ui", "sans-serif"],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
        display: ['"Plus Jakarta Sans"', '"Readex Pro"', "sans-serif"],
      },
      fontSize: {
        "2xs": "0.625rem",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        card: "0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
        elevated: "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
      },
      screens: {
        xs: "480px",
      },
      animation: {
        "fade-in": "fadeIn 0.15s ease-in-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(4px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

