/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./public/index.html", "./src/client/**/*.{ts,js}"],
    theme: {
        extend: {
            fontFamily: {
                title: ["Cinzel", "serif"],
                body: ["Spectral", "serif"],
            },
            colors: {
                arcane: {
                    bg: "#09050f",
                    panel: "#1a0d2e",
                    panelLight: "#2d1b4e",
                    gold: "#d4af6a",
                    goldDark: "#a88a4a",
                    ink: "#e8dcc8",
                    purple: "#7d5fa3",
                    purpleLight: "#9873ba",
                    accent: "#c85fab",
                },
            },
            boxShadow: {
                glow: "0 0 35px rgba(201, 95, 171, 0.2)",
            },
        },
    },
};
