import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Match goonify's existing palette: gold + teal on dark
        gold: {
          DEFAULT: "#d4a55a",
          dim: "#8a6e3a",
        },
        teal: {
          DEFAULT: "#1a4a55",
          dim: "#0e2f37",
          glow: "#4ec5c5",
        },
        ink: {
          DEFAULT: "#0a0a0a",
          900: "#0a0a0a",
          800: "#141414",
          700: "#1f1f1f",
          600: "#2a2a2a",
        },
      },
      fontFamily: {
        // Match goonify's lowercase display font
        display: ["ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        body: ["ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
