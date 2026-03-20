/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: {
          50:  '#f8f9fc',
          100: '#f1f3f8',
          200: '#e2e5ee',
          300: '#c8cdd9',
          400: '#9aa1b3',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
          950: '#0b0f19',
        },
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        navy: {
          50:  '#f8f9fc',
          100: '#f1f3f8',
          200: '#e2e5ee',
          300: '#c8cdd9',
          400: '#9aa1b3',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
          950: '#0b0f19',
        },
        // Dark mode surface colors
        dark: {
          bg:      '#0f1117',
          surface: '#181a24',
          card:    '#1e2030',
          border:  '#2a2d3e',
          hover:   '#252839',
        },
        orange: {
          50:  '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        priority: {
          red:    '#ef4444',
          orange: '#f97316',
          yellow: '#eab308',
          green:  '#22c55e',
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
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
        'soft':    '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
        'card':    '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.04)',
        'elevated':'0 4px 24px rgba(0,0,0,0.08)',
        'panel':   '0 8px 40px rgba(0,0,0,0.12)',
        'glass':    '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.04)',
        'glass-lg': '0 4px 24px rgba(0,0,0,0.08)',
        'glass-xl': '0 8px 40px rgba(0,0,0,0.12)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.15)',
      },
    }
  },
  plugins: []
}
