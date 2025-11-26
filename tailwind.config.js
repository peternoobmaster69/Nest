/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#020617", // slate-950
          bgSoft: "#020617", // tweak if needed
          primary: "#22c55e", // emerald-500
          accent: "#0ea5e9",  // sky-500
          danger: "#f43f5e",  // rose-500
        },
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 10px 25px rgba(15,23,42,0.35)", // slate-ish
      },
      fontFamily: {
        sans: ["system-ui", "ui-sans-serif", "sans-serif"],
      },
    },
  },
  plugins: [],
};
