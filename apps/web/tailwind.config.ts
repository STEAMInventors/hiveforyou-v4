import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "cell-blue": {
          DEFAULT: "var(--color-cell-blue)",
          deep: "var(--color-cell-blue-deep)",
          hover: "var(--color-cell-blue-hover)",
          wash: "var(--color-cell-blue-wash)",
          tint: "var(--color-cell-blue-tint)",
        },
        coral: {
          DEFAULT: "var(--color-coral)",
          deep: "var(--color-coral-deep)",
          wash: "var(--color-coral-wash)",
        },
        honey: {
          DEFAULT: "var(--color-honey)",
          deep: "var(--color-honey-deep)",
          wash: "var(--color-honey-wash)",
          chip: "var(--color-honey-chip)",
          "chip-border": "var(--color-honey-chip-border)",
          "chip-hover": "var(--color-honey-chip-hover)",
        },
        leaf: {
          DEFAULT: "var(--color-leaf)",
          deep: "var(--color-leaf-deep)",
          wash: "var(--color-leaf-wash)",
        },
        paper: "var(--color-paper)",
        mist: "var(--color-mist)",
        "surface-hover": "var(--color-surface-hover)",
        ink: {
          DEFAULT: "var(--color-ink)",
          muted: "var(--color-ink-muted)",
          subtle: "var(--color-ink-subtle)",
        },
        line: {
          DEFAULT: "var(--color-line)",
          strong: "var(--color-line-strong)",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "Helvetica Neue", "Arial", "sans-serif"],
        brand: ["var(--font-outfit)", "Helvetica Neue", "Arial", "sans-serif"],
        quote: ["var(--font-source-serif)", "Georgia", "serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        chip: "7px",
        control: "10px",
        button: "12px",
        card: "20px",
        composer: "22px",
      },
      maxWidth: {
        hero: "880px",
        landing: "1180px",
        workspace: "1240px",
      },
    },
  },
  plugins: [],
};

export default config;
