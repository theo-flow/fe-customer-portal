import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          deep: '#0D1F16',
          mid:  '#1A3D2B',
          light:'#2D6A4F',
        },
        accent:  '#22C55E',
        emerald: '#10B981',
        cloud:   '#F8FAFC',
        slate:   '#64748B',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body:    ['var(--font-body)',    'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)',    'monospace'],
      },
      keyframes: {
        'spin-slow': {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.4)' },
          '50%':      { boxShadow: '0 0 0 8px rgba(34,197,94,0)' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%':      { opacity: '0.8', transform: 'scale(1.08)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-12px)' },
        },
      },
      animation: {
        'spin-slow':   'spin-slow 3s linear infinite',
        glow:          'glow 2s ease-in-out infinite',
        'pulse-slow':  'pulse-slow 6s ease-in-out infinite',
        'float':       'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
export default config
