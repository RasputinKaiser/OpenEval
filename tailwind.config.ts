import type { Config } from "tailwindcss";

// Tailwind can only emit opacity modifiers for colors that expose an
// alpha-capable value. The dashboard theme is runtime-switched via CSS
// variables, so keep the public hex variables for inline styles and expose
// parallel RGB channels for classes such as `bg-accent/10`.
const token = (name: string) => `rgb(var(--color-${name}-rgb) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: token("bg"), subtle: token("bg-subtle"), elev: token("bg-elev") },
        bd: { DEFAULT: token("bd"), subtle: token("bd-subtle") },
        fg: { DEFAULT: token("fg"), muted: token("fg-muted"), dim: token("fg-dim") },
        accent: { DEFAULT: token("accent"), soft: token("accent-soft") },
        ok: token("ok"),
        warn: token("warn"),
        err: token("err"),
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
