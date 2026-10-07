import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0c1118",
        foreground: "#e8eef7",
        card: "#121a26",
        border: "#243044",
        muted: "#93a0b4",
        accent: "#5eead4",
        success: "#4ade80",
        warning: "#f59e0b",
        danger: "#f87171",
        info: "#38bdf8"
      },
      fontFamily: {
        display: ["\"IBM Plex Sans\"", "Segoe UI", "sans-serif"],
        mono: ["\"IBM Plex Mono\"", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        panel: "0 12px 30px rgba(0, 0, 0, 0.28)"
      }
    }
  },
  plugins: []
} satisfies Config;
