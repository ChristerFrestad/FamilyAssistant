// PostCSS config (ESM — matches client/'s module: ESNext).
// Referanse: https://tailwindcss.com/docs/installation/using-postcss
//
// The `config` path is relative to process.cwd() (the directory
// where `npm run build:client` was invoked, i.e. the repo root —
// NOT this file's directory and NOT Vite's `root`). So it must
// include the leading `client/` segment.

export default {
  plugins: {
    tailwindcss: { config: './client/tailwind.config.ts' },
    autoprefixer: {},
  },
};
