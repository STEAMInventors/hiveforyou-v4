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
        },
        line: {
          DEFAULT: "var(--color-line)",
          strong: "var(--color-line-strong)",
        },
        paper: "var(--color-paper)",
        hover: "var(--color-hover)",
        "page-warm": "var(--color-page-warm)",
        cite: {
          DEFAULT: "var(--color-cite)",
          ring: "var(--color-cite-ring)",
        },
        blue: {
          DEFAULT: "var(--color-blue)",
          deep: "var(--color-blue-deep)",
          wash: "var(--color-blue-wash)",
          press: "var(--color-blue-press)",
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
        mist: "var(--color-mist)",
        needs: { bg: "var(--needs-bg)", fg: "var(--needs-fg)" },
        changed: { bg: "var(--changed-bg)", fg: "var(--changed-fg)" },
        missing: { bg: "var(--missing-bg)", fg: "var(--missing-fg)" },
        checked: { bg: "var(--checked-bg)", fg: "var(--checked-fg)" },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "var(--font-ui)"],
        brand: ["var(--font-outfit)", "var(--font-brand)"],
        quote: ["var(--font-source-serif)", "var(--font-quote)"],
        mono: ["var(--font-jetbrains-mono)", "var(--font-ref)"],
      },
      fontSize: {
        title: ["28px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "title-sm": ["24px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        state: ["23px", { lineHeight: "1.35", letterSpacing: "-0.02em" }],
        evidence: ["21px", { lineHeight: "1.4" }],
        section: ["17px", { lineHeight: "1.3", letterSpacing: "-0.015em" }],
        topic: ["13.5px", { lineHeight: "1.4" }],
        item: ["14.5px", { lineHeight: "1.45" }],
        body: ["14.5px", { lineHeight: "1.55" }],
        message: ["14px", { lineHeight: "1.55" }],
        meta: ["12.5px", { lineHeight: "1.5" }],
        label: ["12.5px", { lineHeight: "1.4" }],
        small: ["14px", { lineHeight: "1.55" }],
        caption: ["12.5px", { lineHeight: "1.4" }],
      },
      borderRadius: {
        control: "var(--r-control)",
        button: "var(--r-button)",
        surface: "var(--r-surface)",
        input: "var(--r-input)",
        popover: "var(--r-popover)",
        chip: "var(--r-chip)",
        ref: "var(--r-ref)",
        tag: "var(--r-tag)",
        sheet: "var(--r-sheet)",
        paper: "var(--r-paper)",
        page: "var(--r-page)",
        pill: "var(--r-pill)",
      },
      boxShadow: {
        lift: "var(--shadow-lift)",
        pop: "var(--shadow-pop)",
        focus: "var(--shadow-focus)",
        rest: "var(--shadow-rest)",
        paper: "var(--shadow-paper)",
      },
      maxWidth: {
        content: "1240px",
        "col-read": "760px",
        "col-wide": "1040px",
        convo: "400px",
        prose: "68ch",
      },
      width: {
        convo: "400px",
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