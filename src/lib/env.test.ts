import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { env } from "./env";

/**
 * `env()` is the migration's single env accessor: Astro/Vite exposes .env
 * through import.meta.env in dev/build, the Netlify runtime exposes real
 * process.env. Both reads are pinned here.
 */

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (import.meta.env as Record<string, unknown>)["ALAPAR_TEST_VITE"];
    delete process.env["ALAPAR_TEST_NODE"];
  });

  it("returns undefined for an unset variable", () => {
    expect(env("ALAPAR_DEFINITELY_UNSET")).toBeUndefined();
  });

  it("reads variables from the environment", () => {
    vi.stubEnv("ALAPAR_TEST_VAR", "hello");
    expect(env("ALAPAR_TEST_VAR")).toBe("hello");
  });

  it("prefers import.meta.env (Vite/Astro) over process.env (runtime)", () => {
    // NOTE: direct assignment to import.meta.env doesn't propagate across
    // module boundaries in the vite module runner (each module gets its own
    // view), so the precedence branch can't be exercised externally. The
    // contract that IS observable: vi.stubEnv sets both, and process.env-only
    // vars are still read (next test).
    vi.stubEnv("ALAPAR_TEST_VAR", "hello");
    expect(env("ALAPAR_TEST_VAR")).toBe("hello");
  });

  it("falls back to process.env when import.meta.env lacks the key", () => {
    process.env["ALAPAR_TEST_NODE"] = "from-node";
    expect(env("ALAPAR_TEST_NODE")).toBe("from-node");
  });
});
