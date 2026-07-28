/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "rgb(var(--graphite-950) / <alpha-value>)",
          900: "rgb(var(--graphite-900) / <alpha-value>)",
          800: "rgb(var(--graphite-800) / <alpha-value>)",
          700: "rgb(var(--graphite-700) / <alpha-value>)",
        },
        signal: {
          300: "rgb(var(--signal-300) / <alpha-value>)",
          400: "rgb(var(--signal-400) / <alpha-value>)",
          500: "rgb(var(--signal-500) / <alpha-value>)",
        },
      },
      boxShadow: {
        "skeuo-raised":
          "6px 7px 14px rgba(0,0,0,0.62), -3px -3px 8px rgba(255,255,255,0.025)",
        "skeuo-pressed":
          "inset 3px 3px 6px rgba(0,0,0,0.5), inset -3px -3px 6px rgba(255,255,255,0.05)",
        "skeuo-bevel":
          "inset 0 1px 1px rgba(255,255,255,0.25), 0 4px 10px rgba(0,0,0,0.3)",
        "panel":
          "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.72), 14px 16px 30px rgba(0,0,0,0.5), -5px -5px 18px rgba(255,255,255,0.012)",
        "well":
          "inset 4px 4px 10px rgba(0,0,0,0.58), inset -2px -2px 6px rgba(255,255,255,0.035)",
        "amber-led":
          "0 0 8px rgb(var(--signal-400) / 0.75), inset 0 1px 1px rgba(255,255,255,0.8)",
      },
      fontFamily: {
        display: ["Aptos Display", "Segoe UI Variable Display", "Segoe UI", "sans-serif"],
        mono: ["Cascadia Code", "JetBrains Mono", "Consolas", "monospace"],
      },
      transitionTimingFunction: {
        tactile: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
