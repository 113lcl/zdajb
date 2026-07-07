/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          950: "#1E1E22",
          900: "#26262B",
          850: "#2A2A30",
          800: "#2E2E34"
        },
        accent: "#4FA8E8",
        success: "#4CAF7D",
        danger: "#E55A5A"
      },
      borderRadius: {
        button: "12px",
        card: "16px",
        panel: "22px"
      },
      boxShadow: {
        soft: "0 18px 60px rgba(0, 0, 0, 0.22)",
        lift: "0 12px 34px rgba(0, 0, 0, 0.18)"
      },
      fontFamily: {
        sans: ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
