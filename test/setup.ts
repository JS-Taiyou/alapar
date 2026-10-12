import { vi } from "vite-plus/test";

/**
 * Global test setup: every module that imports `@/lib/db` (directly or
 * transitively, including via relative `./db` imports inside src/lib) gets
 * the controllable stub instead of a live pg.Pool — vi.mock keys by resolved
 * module id, so one registration covers all import specifiers. This mirrors
 * the Deno import-map remap ("./lib/db.ts" -> test/fixtures/db_stub.ts).
 */
vi.mock("@/lib/db", () => import("./fixtures/db_stub"));
