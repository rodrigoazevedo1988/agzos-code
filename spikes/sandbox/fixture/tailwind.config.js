/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef7ff', 500: '#1f6feb', 900: '#0b2a5b' },
        agz: '#ff5a1f',
      },
      spacing: { 18: '4.5rem' },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
