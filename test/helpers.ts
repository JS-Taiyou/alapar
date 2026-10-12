/**
 * Test helpers for API-endpoint tests.
 *
 * Astro endpoints are plain functions: `POST(ctx) -> Response`. They can be
 * invoked directly without starting a server. These helpers build the minimal
 * fake `APIContext` the endpoints read from (`locals`, `request`, `params`,
 * `url`, `redirect`).
 *
 * Under `vp test`, every import of `@/lib/db` (and anything else transitively
 * pulling it in) gets the stubbed `query()` from test/setup.ts, so endpoint
 * logic that reaches a store function is testable too.
 */
import type { APIContext } from "astro";

/**
 * A minimal Astro endpoint context. Cast to `APIContext` at the call site —
 * the real context carries framework internals the endpoints never touch.
 */
export interface FakeCtx {
  locals: Partial<App.Locals>;
  request: Request;
  params: Record<string, string>;
  url: URL;
  redirect: (url: string, status?: number) => Response;
}

/** Default empty locals; tests override the fields they care about. */
function defaultLocals(): Partial<App.Locals> {
  return {
    user: null,
    activeRegistry: null,
    registries: [],
    registryUsers: [],
    entities: [],
    participants: [],
    supabaseAuthId: null,
    accessToken: null,
    isOwner: false,
    ownerRegistryIds: new Set<string>(),
    activeRegistryPlan: null,
  };
}

/**
 * Build a fake ctx. Pass `locals` partials to override defaults (e.g.
 * `{ user: { id: "u1", ... }, isOwner: true }`), and/or a `params` object.
 */
export function makeCtx(
  opts: {
    locals?: Partial<App.Locals>;
    req?: Request;
    params?: Record<string, string>;
  } = {},
): FakeCtx {
  const request = opts.req ?? new Request("https://test.local/");
  return {
    locals: { ...defaultLocals(), ...opts.locals },
    request,
    params: opts.params ?? {},
    url: new URL(request.url),
    redirect: (url: string, status = 302) =>
      Response.redirect(new URL(url, "https://test.local"), status),
  };
}

/** Cast helper for call sites: the fake only implements what endpoints read. */
export function asApiContext(ctx: FakeCtx): APIContext {
  return ctx as unknown as APIContext;
}

/** Build a JSON POST request with the given body. */
export function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Build a JSON DELETE request. */
export function jsonDelete(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Build a JSON PATCH request. */
export function jsonPatch(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Build a multipart/form-data request from a flat record. */
export function formRequest(
  url: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(url, { method: "POST", headers, body: form });
}

/** Read a JSON response body (for assertions). */
export async function jsonBody(res: Response): Promise<unknown> {
  return await res.json();
}

/** A minimal user/participant object for locals overrides. */
function user(id: string, name = id) {
  return {
    id,
    name,
    color: "#000",
    email: `${id}@x`,
    supabaseAuthId: null,
    createdAt: new Date(),
  };
}
export const mkUser = user;
export const mkParticipant = (id: string, name = id) => ({
  id,
  name,
  color: "#000",
});
