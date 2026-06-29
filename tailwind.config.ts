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
        bg: { DEFAULT: "var(--color-bg)", subtle: "var(--color-bg-subtle)", elev: "var(--color-bg-elev)" },
        bd: { DEFAULT: "var(--color-bd)", subtle: "var(--color-bd-subtle)" },
        fg: { DEFAULT: "var(--color-fg)", muted: "var(--color-fg-muted)", dim: "var(--color-fg-dim)" },
        accent: { DEFAULT: "var(--color-accent)", soft: "var(--color-accent-soft)" },
        ok: "var(--color-ok)",
        warn: "var(--color-warn)",
        err: "var(--color-err)",
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
