import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: netlify(),
  integrations: [preact({ compat: false })],
  vite: {
    plugins: [tailwindcss()],
  },
});
