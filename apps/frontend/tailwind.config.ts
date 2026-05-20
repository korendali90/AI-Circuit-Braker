import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EEEDFE',
          500: '#7F77DD',
          700: '#534AB7',
          900: '#26215C',
        },
      },
    },
  },
  plugins: [],
}

export default config
