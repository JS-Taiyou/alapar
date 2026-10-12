import type { APIRoute } from "astro";

/**
 * POST /api/locale
 * Sets the `alapar-locale` cookie. Body: `{ locale: "es" | "en" }`.
 * The client reloads the page after a successful response so the SSR
 * re-renders in the new language.
 */
export const POST: APIRoute = (ctx) => {
  return ctx.request
    .json()
    .then((body: { locale?: string }) => {
      const locale = body.locale === "en" ? "en" : "es";
      const headers = new Headers();
      headers.append(
        "Set-Cookie",
        `alapar-locale=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
      );
      return Response.json({ ok: true, locale }, { headers });
    })
    .catch(() => Response.json({ error: "Invalid body" }, { status: 400 }));
};
