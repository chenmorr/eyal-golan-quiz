/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Heebo', 'system-ui', 'sans-serif'] },
      colors: {
        // לילה של הופעה: שחור עמוק, זהב במה, בורדו קטיפה
        night: { DEFAULT: '#0b0708', soft: '#151011', line: '#2a1f21' },
        gold: { DEFAULT: '#e5b567', bright: '#f7d38a', deep: '#a87c35' },
        wine: { DEFAULT: '#7d1d33', soft: '#a8324c' },
      },
      animation: {
        'fade-up': 'fadeUp 260ms ease-out',
        'pop': 'pop 180ms ease-out',
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'none' } },
        pop: { '0%': { transform: 'scale(0.96)' }, '60%': { transform: 'scale(1.02)' }, '100%': { transform: 'scale(1)' } },
      },
    },
  },
  plugins: [],
}
