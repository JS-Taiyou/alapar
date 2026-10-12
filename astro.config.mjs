import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  // Astro 7 changed the default to 'jsx' (JSX-style whitespace stripping);
  // keep the previous HTML-aware compression so inline-element spacing in
  // existing templates renders unchanged.
  compressHTML: true,
  // platformProxy simulates the Workers runtime (bindings from wrangler.toml
  // + secrets from .dev.vars) on `astro dev` via wrangler's getPlatformProxy.
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
