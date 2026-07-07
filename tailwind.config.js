/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          dark: '#080512',
          card: '#120d2b',
          pink: '#ff007f',
          cyan: '#00f0ff',
          purple: '#9d4edd',
          green: '#39ff14',
          yellow: '#fefe00',
          blue: '#1f51ff',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      animation: {
        blink: 'blink 1s step-end infinite',
        'pulse-glow': 'pulse-glow 2s infinite alternate',
        'cyber-border': 'cyber-border 4s linear infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'pulse-glow': {
          '0%': { boxShadow: '0 0 5px rgba(0, 240, 255, 0.4), 0 0 10px rgba(0, 240, 255, 0.2)' },
          '100%': { boxShadow: '0 0 15px rgba(255, 0, 127, 0.8), 0 0 25px rgba(255, 0, 127, 0.4)' },
        }
      }
    },
  },
  plugins: [],
}
