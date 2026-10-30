import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "cell-blue": {
          DEFAULT: "var(--color-cell-blue)",
          deep: "var(--color-cell-blue-deep)",
          wash: "var(--color-cell-blue-wash)",
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
        },
        leaf: {
          DEFAULT: "var(--color-leaf)",
          deep: "var(--color-leaf-deep)",
        },
        paper: "var(--color-paper)",
        mist: "var(--color-mist)",
        ink: {
          DEFAULT: "var(--color-ink)",
          muted: "var(--color-ink-muted)",
        },
        line: {
          DEFAULT: "var(--color-line)",
          strong: "var(--color-line-strong)",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        brand: ["var(--font-outfit)", "system-ui", "sans-serif"],
        quote: ["var(--font-source-serif)", "Georgia", "serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
