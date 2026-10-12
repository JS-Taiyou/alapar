import { describe, expect, it } from "vite-plus/test";
import { csrfForbidden } from "./csrf";

const page = new URL("https://app.example/api/transactions");

describe("csrfForbidden", () => {
  it("allows GET requests regardless of origin", () => {
    expect(csrfForbidden("GET", "https://evil.example", page)).toBe(false);
  });

  it("allows requests without an Origin header (non-browser clients)", () => {
    expect(csrfForbidden("POST", null, page)).toBe(false);
  });

  it("allows a same-origin POST", () => {
    expect(csrfForbidden("POST", "https://app.example", page)).toBe(false);
  });

  it("rejects a cross-origin POST", () => {
    expect(csrfForbidden("POST", "https://evil.example", page)).toBe(true);
  });

  it("rejects a cross-origin PUT/PATCH/DELETE as well", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect(csrfForbidden(method, "https://evil.example", page)).toBe(true);
    }
  });

  it("exempts the Polar webhook (authenticity via Standard Webhooks HMAC)", () => {
    const webhook = new URL("https://app.example/api/webhooks/polar");
    expect(csrfForbidden("POST", "https://hooks.polar.sh", webhook)).toBe(false);
  });

  it("does not exempt lookalike webhook paths", () => {
    const lookalike = new URL("https://app.example/api/webhooks/polarx");
    expect(csrfForbidden("POST", "https://evil.example", lookalike)).toBe(true);
  });

  it("compares full origins, not suffixes", () => {
    expect(csrfForbidden("POST", "https://app.example.evil.com", page)).toBe(true);
  });
});
