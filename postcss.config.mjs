/**
 * Tailwind CSS 4 PostCSS eklentisi.
 *
 * Tailwind 4'te ayrı bir `tailwind.config.js` şart değildir; tema ve
 * içerik taraması `src/app/globals.css` içindeki `@import "tailwindcss"`
 * üzerinden yürür. Eklenti adı `node_modules/@tailwindcss/postcss`
 * paketinin README'sinden doğrulanmıştır (@tailwindcss/postcss 4.3.3).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
