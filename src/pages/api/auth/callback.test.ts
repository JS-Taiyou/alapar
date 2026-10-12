/**
 * Tests for the auth callback route handler (S9).
 *
 * Only the pre-Supabase validation branches run here: the token-validation
 * path calls the real Supabase API, which isn't reachable from tests.
 */
import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import * as handler from "./callback";
import { jsonRequest, makeCtx } from "@test/helpers";

const URL = "https://test.local/api/auth/callback";

describe("auth callback POST", () => {
  it("rejects a non-JSON content type with 400", async () => {
    const ctx = makeCtx({
      req: new Request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "accessToken=a&refreshToken=b",
      }),
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects an invalid JSON body with 400", async () => {
    const ctx = makeCtx({
      req: new Request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects missing tokens with 400", async () => {
    const ctx = makeCtx({ req: jsonRequest(URL, {}) });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a missing refresh token with 400", async () => {
    const ctx = makeCtx({ req: jsonRequest(URL, { accessToken: "a" }) });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });
});
