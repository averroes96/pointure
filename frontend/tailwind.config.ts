import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // ShoeDZ Brand Colors
        primary: {
          DEFAULT: "#1A4A8A",
          50: "#EBF0FA",
          100: "#C2D3F0",
          200: "#99B6E6",
          300: "#7099DC",
          400: "#4770C8",
          500: "#1A4A8A",
          600: "#153C72",
          700: "#102D5A",
          800: "#0B1F42",
          900: "#06102A",
        },
        secondary: "#2E6FBF",
        accent: {
          DEFAULT: "#E8700A",
          light: "#FFF3E0",
        },
        success: {
          DEFAULT: "#1B5E20",
          light: "#E8F5E9",
        },
        danger: {
          DEFAULT: "#CC0000",
          light: "#FFEBEE",
        },
        warning: {
          DEFAULT: "#E65100",
          light: "#FFF8E1",
        },
        surface: "#F8F9FC",
        card: "#FFFFFF",
        border: "#E2E8F0",
        "text-primary": "#1A202C",
        "text-muted": "#64748B",
      },
      fontFamily: {
        sans: [
          "IBM Plex Sans Arabic",
          "IBM Plex Sans",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": "0.625rem",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
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
