/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Base16 color scheme - will be overridden by CSS variables
        base: {
          '00': 'var(--base00)',
          '01': 'var(--base01)',
          '02': 'var(--base02)',
          '03': 'var(--base03)',
          '04': 'var(--base04)',
          '05': 'var(--base05)',
          '06': 'var(--base06)',
          '07': 'var(--base07)',
          '08': 'var(--base08)',
          '09': 'var(--base09)',
          '0A': 'var(--base0A)',
          '0B': 'var(--base0B)',
          '0C': 'var(--base0C)',
          '0D': 'var(--base0D)',
          '0E': 'var(--base0E)',
          '0F': 'var(--base0F)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
