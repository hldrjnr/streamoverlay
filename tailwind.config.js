/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        overlay: {
          bg: "rgba(0, 0, 0, 0.7)",
          surface: "rgba(255, 255, 255, 0.08)",
          border: "rgba(255, 255, 255, 0.12)",
          hover: "rgba(255, 255, 255, 0.15)",
        },
      },
    },
  },
  plugins: [],
};
