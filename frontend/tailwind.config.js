export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1B5E7B', light: '#2980B9', dark: '#0D3349' },
        accent: { DEFAULT: '#E67E22', light: '#F39C12' },
        success: '#27AE60',
        surface: '#F8F9FA',
      },
    },
  },
  plugins: [],
};
