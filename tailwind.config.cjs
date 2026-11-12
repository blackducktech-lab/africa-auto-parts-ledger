module.exports = {
  content: ['./index.html', './assets/app.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'Noto Sans TC', 'system-ui', 'sans-serif'] },
      colors: { navy: { 800: '#1E3A8A', 900: '#172554' } },
      boxShadow: { xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
      backdropBlur: { xs: '2px' }
    }
  },
  plugins: []
};
