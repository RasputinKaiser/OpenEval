import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#0a0a0b", subtle: "#111113", elev: "#16161a" },
        bd: { DEFAULT: "#26262b", subtle: "#1d1d22" },
        fg: { DEFAULT: "#e8e8ea", muted: "#8b8b94", dim: "#5a5a63" },
        accent: { DEFAULT: "#7c5cff", soft: "#a78bff" },
        ok: "#3fb950",
        warn: "#d29922",
        err: "#f85149",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
