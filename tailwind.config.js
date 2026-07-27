/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#060706",
          900: "#0a0c0b",
          800: "#101210",
          700: "#171a18",
        },
        signal: {
          300: "#f2c772",
          400: "#daa64b",
          500: "#bd8331",
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
          "0 0 8px rgba(218,166,75,0.75), inset 0 1px 1px rgba(255,255,255,0.8)",
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
