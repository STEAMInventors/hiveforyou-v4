import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "var(--color-ink)",
          "2": "var(--color-ink-2)",
          "3": "var(--color-ink-3)",
          /** @deprecated UI-1c — use ink-2 */
          muted: "var(--color-ink-muted)",
          /** @deprecated UI-1c — use ink-3 */
          subtle: "var(--color-ink-subtle)",
        },
        line: {
          DEFAULT: "var(--color-line)",
          strong: "var(--color-line-strong)",
        },
        paper: "var(--color-paper)",
        canvas: "var(--color-canvas)",
        hover: "var(--color-hover)",
        blue: {
          DEFAULT: "var(--color-blue)",
          deep: "var(--color-blue-deep)",
          wash: "var(--color-blue-wash)",
        },
        coral: {
          DEFAULT: "var(--color-coral)",
          deep: "var(--color-coral-deep)",
          wash: "var(--color-coral-wash)",
          /** @deprecated UI-1c */
          border: "var(--color-coral-border)",
        },
        honey: {
          DEFAULT: "var(--color-honey)",
          deep: "var(--color-honey-deep)",
          wash: "var(--color-honey-wash)",
          /** @deprecated UI-1c — honey chip styles */
          chip: "var(--color-honey-chip)",
          "chip-border": "var(--color-honey-chip-border)",
          "chip-hover": "var(--color-honey-chip-hover)",
        },
        leaf: {
          DEFAULT: "var(--color-leaf)",
          deep: "var(--color-leaf-deep)",
          wash: "var(--color-leaf-wash)",
        },
        /** @deprecated UI-1c — use blue */
        "cell-blue": {
          DEFAULT: "var(--color-cell-blue)",
          deep: "var(--color-cell-blue-deep)",
          hover: "var(--color-cell-blue-hover)",
          wash: "var(--color-cell-blue-wash)",
          tint: "var(--color-cell-blue-tint)",
        },
        /** @deprecated UI-1c — use hover */
        mist: "var(--color-mist)",
        /** @deprecated UI-1c — use hover */
        "surface-hover": "var(--color-surface-hover)",
        /** @deprecated UI-1c — use ink-2 */
        graphite: "var(--graphite)",
        /** @deprecated UI-1c — use ink-3 */
        quiet: "var(--quiet)",
        needs: { bg: "var(--needs-bg)", fg: "var(--needs-fg)" },
        changed: { bg: "var(--changed-bg)", fg: "var(--changed-fg)" },
        missing: { bg: "var(--missing-bg)", fg: "var(--missing-fg)" },
        checked: { bg: "var(--checked-bg)", fg: "var(--checked-fg)" },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "var(--font-ui)"],
        brand: ["var(--font-outfit)", "var(--font-brand)"],
        quote: ["var(--font-source-serif)", "var(--font-quote)"],
        /** @deprecated UI-1c — code display only */
        mono: ["var(--font-jetbrains-mono)", "var(--font-ref)"],
      },
      fontSize: {
        title: ["30px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "title-sm": ["26px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        section: ["19px", { lineHeight: "1.3" }],
        item: ["15px", { lineHeight: "1.45" }],
        body: ["15px", { lineHeight: "1.6" }],
        meta: ["13px", { lineHeight: "1.5" }],
        label: ["12.5px", { lineHeight: "1.4" }],
        glance: ["20px", { lineHeight: "1.3" }],
        small: ["14px", { lineHeight: "1.5" }],
        caption: ["12.5px", { lineHeight: "1.4" }],
      },
      borderRadius: {
        control: "var(--r-control)",
        surface: "var(--r-surface)",
        chip: "var(--r-chip)",
        paper: "var(--r-paper)",
        /** @deprecated UI-1c */
        button: "var(--r-control)",
        /** @deprecated UI-1c */
        card: "var(--r-card)",
        pill: "var(--r-pill)",
        /** @deprecated UI-1c */
        composer: "var(--r-surface)",
      },
      boxShadow: {
        pop: "var(--shadow-pop)",
        composer: "var(--shadow-composer)",
        paper: "var(--shadow-paper)",
      },
      maxWidth: {
        "col-read": "760px",
        "col-wide": "1040px",
        rail: "240px",
        /** @deprecated UI-1c */
        hero: "880px",
        landing: "1180px",
        workspace: "1240px",
        hive: "1120px",
        prose: "68ch",
      },
      spacing: {
        rail: "240px",
      },
      width: {
        rail: "240px",
      },
      height: {
        top: "var(--top-h)",
        "top-sm": "var(--top-h-sm)",
      },
    },
  },
  plugins: [],
};

export default config;