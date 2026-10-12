import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import { isPublicPath, needsFullState, routeGuard } from "./routing";

// ===========================================================================
// needsFullState
// ===========================================================================

describe("needsFullState", () => {
  describe("full-state paths (true)", () => {
    const fullStatePaths = [
      "/dashboard",
      "/api/billing",
      "/api/billing/checkout",
      "/api/billing/portal",
      "/api/billing/cancel",
      "/dashboard/history",
      "/dashboard/history/abc-123",
      "/api/registries",
      "/api/registries/new",
      "/api/registries/default-split",
      "/api/registries/abc-123",
      "/api/transactions",
      "/api/transactions/abc-123",
      "/api/entities",
      "/api/entities/abc-123",
      "/api/invitations",
      "/api/invitations/join",
      "/api/exercises",
      "/api/exercises/carry-forward",
      "/api/default-split", // legacy entry, kept for backward compat
      "/api/dashboard",
    ];

    for (const path of fullStatePaths) {
      it(`returns true for ${path}`, () => {
        assertEquals(needsFullState(path), true);
      });
    }
  });

  describe("lightweight paths (false)", () => {
    const lightweightPaths = [
      "/",
      "/api/stamp/abc-123",
      "/api/push/public-key",
      "/api/push/subscribe",
      "/api/push/unsubscribe",
      "/api/auth/callback",
      "/api/auth/logout",
      "/login",
      "/signup",
      "/join/ABCDEF",
      "/favicon.ico",
    ];

    for (const path of lightweightPaths) {
      it(`returns false for ${path}`, () => {
        assertEquals(needsFullState(path), false);
      });
    }
  });

  it("treats '/' as lightweight (avoids full-state resolution before redirect)", () => {
    // "/" is excluded from needsFullState so it doesn't run the 4-query
    // resolveUserState just to redirect to /dashboard. The middleware does a
    // single cheap membership-existence check instead.
    assertEquals(needsFullState("/"), false);
  });

  it("does not treat arbitrary paths starting with '/' as full-state", () => {
    assertEquals(needsFullState("/something-random"), false);
  });

  it("matches segment-wise: extensions of full-state prefixes stay lightweight", () => {
    // N16: same footgun class as isPublicPath — "/dashboardfoo" is not "/dashboard".
    assertEquals(needsFullState("/dashboardfoo"), false);
    assertEquals(needsFullState("/api/registriesevil"), false);
    assertEquals(needsFullState("/api/transactionsx"), false);
  });

  it("documents that /api/registries/default-split is covered by the /api/registries prefix", () => {
    // Guard against the latent fragility noted in routing.ts: even if the
    // redundant "/api/default-split" entry were removed, this real route must
    // still resolve to full-state.
    assertEquals(needsFullState("/api/registries/default-split"), true);
  });
});

// ===========================================================================
// isPublicPath
// ===========================================================================

describe("isPublicPath", () => {
  const publicPaths = [
    "/login",
    "/signup",
    "/join",
    "/join/ABCDEF",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/api/auth/callback",
    "/api/auth/logout",
    "/api/locale",
    "/pricing",
    "/demo",
  ];

  for (const path of publicPaths) {
    it(`returns true for ${path}`, () => {
      assertEquals(isPublicPath(path), true);
    });
  }

  it("returns false for protected pages", () => {
    assertEquals(isPublicPath("/dashboard"), false);
    assertEquals(isPublicPath("/api/transactions"), false);
    assertEquals(isPublicPath("/api/registries/new"), false);
  });

  it("matches segment-wise: a bare startsWith must not make paths public", () => {
    // N16: "/joinville" starts with "/join" but is NOT the public /join page.
    assertEquals(isPublicPath("/joinville"), false);
    assertEquals(isPublicPath("/loginx"), false);
    assertEquals(isPublicPath("/demolition"), false);
    assertEquals(isPublicPath("/api/auth/callbackevil"), false);
  });
});

// ===========================================================================
// routeGuard
// ===========================================================================

describe("routeGuard", () => {
  describe("anonymous visitor (no user)", () => {
    it("redirects to login with a redirect param for protected pages", () => {
      assertEquals(
        routeGuard("/dashboard", { hasUser: false, hasRegistry: false }),
        "/login?redirect=%2Fdashboard",
      );
    });

    it("URL-encodes the original path", () => {
      assertEquals(
        routeGuard("/dashboard/history/x y", {
          hasUser: false,
          hasRegistry: false,
        }),
        "/login?redirect=%2Fdashboard%2Fhistory%2Fx%20y",
      );
    });

    it("returns null (pass through) for public paths", () => {
      assertEquals(routeGuard("/login", { hasUser: false, hasRegistry: false }), null);
      assertEquals(routeGuard("/join/CODE", { hasUser: false, hasRegistry: false }), null);
      assertEquals(
        routeGuard("/api/auth/callback", {
          hasUser: false,
          hasRegistry: false,
        }),
        null,
      );
    });
  });

  describe("signed-in user", () => {
    it("bounces authed users off /login, /signup, /forgot-password → /", () => {
      assertEquals(routeGuard("/login", { hasUser: true, hasRegistry: false }), "/");
      assertEquals(routeGuard("/signup", { hasUser: true, hasRegistry: false }), "/");
      assertEquals(routeGuard("/forgot-password", { hasUser: true, hasRegistry: false }), "/");
    });

    it("redirects to / when a user without a registry hits /dashboard", () => {
      assertEquals(routeGuard("/dashboard", { hasUser: true, hasRegistry: false }), "/");
      assertEquals(
        routeGuard("/dashboard/history/123", {
          hasUser: true,
          hasRegistry: false,
        }),
        "/",
      );
    });

    it("redirects to /dashboard when a user with a registry lands on /", () => {
      assertEquals(routeGuard("/", { hasUser: true, hasRegistry: true }), "/dashboard");
    });

    it("passes through protected API routes for a user with a registry", () => {
      assertEquals(routeGuard("/api/transactions", { hasUser: true, hasRegistry: true }), null);
      assertEquals(routeGuard("/dashboard", { hasUser: true, hasRegistry: true }), null);
    });

    it("still allows a user with a registry to visit /reset-password (not in AUTH_PAGES)", () => {
      // /reset-password is public but NOT in the bounce list, so it passes.
      assertEquals(routeGuard("/reset-password", { hasUser: true, hasRegistry: true }), null);
    });
  });

  describe("pass-through cases (null)", () => {
    const passThroughCases: Array<[string, { hasUser: boolean; hasRegistry: boolean }]> = [
      ["/login", { hasUser: false, hasRegistry: false }],
      ["/signup", { hasUser: false, hasRegistry: false }],
      ["/join/CODE", { hasUser: false, hasRegistry: false }],
      ["/api/transactions", { hasUser: true, hasRegistry: true }],
      ["/dashboard/history", { hasUser: true, hasRegistry: true }],
      ["/reset-password", { hasUser: true, hasRegistry: true }],
    ];
    for (const [path, opts] of passThroughCases) {
      it(`passes through ${JSON.stringify(path)} with ${JSON.stringify(opts)}`, () => {
        assertEquals(routeGuard(path, opts), null);
      });
    }
  });
});
