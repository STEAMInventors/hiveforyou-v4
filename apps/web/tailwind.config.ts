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
          border: "var(--color-coral-border)",
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
        needs: { bg: "var(--needs-bg)", fg: "var(--needs-fg)" },
        changed: { bg: "var(--changed-bg)", fg: "var(--changed-fg)" },
        missing: { bg: "var(--missing-bg)", fg: "var(--missing-fg)" },
        checked: { bg: "var(--checked-bg)", fg: "var(--checked-fg)" },
        paper: "var(--color-paper)",
        mist: "var(--color-mist)",
        "surface-hover": "var(--color-surface-hover)",
        ink: {
          DEFAULT: "var(--color-ink)",
          muted: "var(--color-ink-muted)",
          subtle: "var(--color-ink-subtle)",
        },
        graphite: "var(--graphite)",
        quiet: "var(--quiet)",
        line: {
          DEFAULT: "var(--color-line)",
          strong: "var(--color-line-strong)",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "var(--font-ui)"],
        brand: ["var(--font-outfit)", "var(--font-brand)"],
        quote: ["var(--font-source-serif)", "var(--font-quote)"],
        mono: ["var(--font-jetbrains-mono)", "var(--font-ref)"],
      },
      fontSize: {
        title: ["30px", { lineHeight: "1.2" }],
        section: ["21px", { lineHeight: "1.3" }],
        body: ["16px", { lineHeight: "1.55" }],
        small: ["14px", { lineHeight: "1.5" }],
        caption: ["12.5px", { lineHeight: "1.4" }],
      },
      borderRadius: {
        chip: "var(--r-chip)",
        control: "var(--r-control)",
        button: "var(--r-control)",
        card: "var(--r-card)",
        pill: "var(--r-pill)",
        composer: "22px",
      },
      maxWidth: {
        hero: "880px",
        landing: "1180px",
        workspace: "1240px",
        prose: "68ch",
      },
    },
  },
  plugins: [],
};

export default config;
