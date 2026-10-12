import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  // Astro 7 changed the default to 'jsx' (JSX-style whitespace stripping);
  // keep the previous HTML-aware compression so inline-element spacing in
  // existing templates renders unchanged.
  compressHTML: true,
  adapter: netlify(),
  integrations: [preact({ compat: false })],
  vite: {
    plugins: [tailwindcss()],
  },
});
