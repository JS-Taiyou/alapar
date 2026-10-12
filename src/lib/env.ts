/**
 * Single accessor for server-side env vars. Astro/Vite exposes .env through
 * import.meta.env during dev and build; the Netlify runtime exposes real
 * process.env. Check both so server code works identically in all three.
 */
export function env(name: string): string | undefined {
  const fromVite = (import.meta.env as Record<string, string | undefined>)[
    name
  ];
  return fromVite ?? process.env[name];
}

export const isDev = import.meta.env.DEV;
