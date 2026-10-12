import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import { getCookie } from "./auth-cookies";

describe("getCookie", () => {
  it("returns the value for a single cookie", () => {
    assertEquals(getCookie("sb-access-token=abc123", "sb-access-token"), "abc123");
  });

  it("finds a cookie among many semicolon-separated cookies", () => {
    const header = "theme=dark; sb-access-token=jwt.value.here; sb-refresh-token=refresh";
    assertEquals(getCookie(header, "sb-access-token"), "jwt.value.here");
    assertEquals(getCookie(header, "sb-refresh-token"), "refresh");
    assertEquals(getCookie(header, "theme"), "dark");
  });

  it("handles leading/trailing whitespace around cookies", () => {
    const header = "  theme=dark  ;  sb-access-token=tok  ";
    assertEquals(getCookie(header, "sb-access-token"), "tok");
  });

  it("finds cookies when Deno Deploy mashes them with commas instead of semicolons", () => {
    // The load-bearing edge case: the edge strips ';', joining cookies with ','.
    const header = "theme=dark, sb-access-token=jwt.value, sb-refresh-token=refresh";
    assertEquals(getCookie(header, "sb-access-token"), "jwt.value");
    assertEquals(getCookie(header, "sb-refresh-token"), "refresh");
  });

  it("handles a mix of ',' and ';' separators", () => {
    const header = "a=1, b=2; c=3, d=4";
    assertEquals(getCookie(header, "a"), "1");
    assertEquals(getCookie(header, "b"), "2");
    assertEquals(getCookie(header, "c"), "3");
    assertEquals(getCookie(header, "d"), "4");
  });

  it("returns null when the cookie is absent", () => {
    assertEquals(getCookie("theme=dark", "sb-access-token"), null);
  });

  it("returns null for an empty header", () => {
    assertEquals(getCookie("", "sb-access-token"), null);
  });

  it("does not match a cookie whose name is a prefix of another", () => {
    // sb-access-token must not be returned when only sb-access-token-x exists.
    assertEquals(getCookie("sb-access-token-x=evil", "sb-access-token"), null);
  });

  it("returns the first match when a cookie name appears twice", () => {
    const header = "sb-access-token=first; sb-access-token=second";
    assertEquals(getCookie(header, "sb-access-token"), "first");
  });

  it("returns an empty string value (not null) for a present-but-empty cookie", () => {
    assertEquals(getCookie("sb-access-token=", "sb-access-token"), "");
  });
});
