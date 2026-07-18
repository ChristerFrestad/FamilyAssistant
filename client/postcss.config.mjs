// PostCSS config (ESM — matches client/'s module: ESNext).
// Tailwind v4 splits the PostCSS integration into @tailwindcss/postcss.
// Config file is referenced via @config in globals.css — not here.

export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
