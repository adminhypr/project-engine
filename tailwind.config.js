/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f2f7',
          100: '#dde1ec',
          200: '#b8bfd6',
          300: '#8e99ba',
          400: '#6b7a9e',
          500: '#4a5a80',
          600: '#374568',
          700: '#2e3f63',
          800: '#243252',
          900: '#1a2744',
          950: '#111a2e',
        },
        orange: {
          50:  '#fef5ee',
          100: '#fde8d4',
          200: '#faceaa',
          300: '#e89044',
          400: '#e89044',
          500: '#d4762c',
          600: '#b8632a',
          700: '#994e24',
          800: '#7a3f22',
          900: '#64351f',
        },
        priority: {
          red:    '#ef4444',
          orange: '#f97316',
          yellow: '#eab308',
          green:  '#22c55e',
        }
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'glass-shimmer': 'shimmer 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'count-up': 'countUp 0.6s ease-out',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'glass': '0 4px 30px rgba(26, 39, 68, 0.06)',
        'glass-lg': '0 8px 40px rgba(26, 39, 68, 0.1)',
        'glass-xl': '0 16px 60px rgba(26, 39, 68, 0.12)',
        'glow-orange': '0 0 20px rgba(212, 118, 44, 0.15)',
        'glow-green': '0 0 20px rgba(34, 197, 94, 0.2)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.2)',
      },
    }
  },
  plugins: []
}
