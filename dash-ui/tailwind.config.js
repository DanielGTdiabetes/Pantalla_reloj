/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./public/index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Share Tech Mono"', 'monospace'],
        display: ['"Orbitron"', 'sans-serif'],
        sans: ['"Inter"', 'sans-serif']
      },
      colors: {
        cyber: {
          DEFAULT: '#0ff',
          glow: '#38f9ff'
        },
        crt: {
          DEFAULT: '#8aff7a',
          amber: '#ffbf00'
        }
      },
      boxShadow: {
        neon: '0 0 20px rgba(0, 255, 255, 0.45)',
        glow: '0 0 30px rgba(56, 249, 255, 0.3)'
      }
    }
  },
  plugins: []
};
