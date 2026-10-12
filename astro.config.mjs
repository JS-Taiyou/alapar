import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import preact from "@astrojs/preact";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  // Astro 7 changed the default to 'jsx' (JSX-style whitespace stripping);
  // keep the previous HTML-aware compression so inline-element spacing in
  // existing templates renders unchanged.
  compressHTML: true,
  adapter: netlify(),
  // Preact and React coexist during the Preact→React migration. JSX renderers
  // are disambiguated by path: files still on Preact live under src/islands/,
  // ported React files land under src/components/. The preact integration (and
  // the islands/ folder) is removed once every island is ported.
  integrations: [
    preact({ compat: false, include: ["**/islands/**"] }),
    react({ include: ["**/components/**"] }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
