/** @type {import('tailwindcss').Config} */
// `accent-*` resuelve por variables CSS — cada tab redefine la paleta
// (.theme-design/.theme-backend/.theme-fullstack en index.css) y toda
// la UI se recolorea sin tocar componentes.
const accent = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [
    s,
    `rgb(var(--a${s}) / <alpha-value>)`,
  ]),
);
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: { accent },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.55' },
        },
        'view-enter': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'float-soft': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
        'view-enter': 'view-enter .22s ease-out both',
        'float-soft': 'float-soft 3.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
