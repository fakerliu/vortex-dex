import type { Config } from "tailwindcss";

/**
 * VORTEX DEX 内部后台（Analytics Center）设计 token。
 * 复用品牌色，后台默认深色主题以区分用户端。
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          900: "#172B3A",
          800: "#203B4E",
          700: "#31556B",
          600: "#426D83",
          DEFAULT: "#172B3A",
        },
        accent: {
          500: "#2F7CF6",
          400: "#5594F7",
          DEFAULT: "#2F7CF6",
        },
        success: "#16A36A",
        danger: "#E05252",
        warning: "#E5A33A",
        gray: {
          950: "#151A21",
          800: "#333B46",
          700: "#586270",
          600: "#77818D",
          500: "#9AA3AE",
          400: "#C1C8D0",
          300: "#DDE2E8",
          200: "#EBEEF2",
          100: "#F5F7F9",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
