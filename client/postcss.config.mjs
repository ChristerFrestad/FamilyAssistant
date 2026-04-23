// PostCSS config (ESM — matches client/'s module: ESNext).
// Referanse: https://tailwindcss.com/docs/installation/using-postcss

export default {
  plugins: {
    tailwindcss: { config: './client/tailwind.config.ts' },
    autoprefixer: {},
  },
};
