/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Inter', 'sans-serif'],
      },
      colors: {
        ink: {
          900: '#0b0b0f',
          800: '#131319',
          700: '#1b1b24',
          600: '#26262f',
          500: '#3a3a48',
          400: '#5a5a6a',
          300: '#9a9aa5',
          200: '#c8c8d2',
          100: '#f5f5f7',
        },
        saffron: {
          50: '#fff7ed',
          100: '#ffedd5',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          900: '#7c2d12',
        },
        emerald2: { 400: '#34d399', 500: '#10b981', 600: '#059669' },
        rose2: { 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48' },
        amber2: { 400: '#fbbf24', 500: '#f59e0b' },
        sky2: { 400: '#38bdf8', 500: '#0ea5e9' },
      },
      boxShadow: {
        glow: '0 0 24px -6px rgba(234, 88, 12, 0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.04), 0 12px 32px -16px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
