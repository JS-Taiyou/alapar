import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import { sanitizeDecimal, sanitizeInteger } from "./format";

describe("sanitizeDecimal", () => {
  it("strips non-numeric characters", () => {
    assertEquals(sanitizeDecimal("abc12.34def"), "12.34");
    assertEquals(sanitizeDecimal("$1,000.50"), "1000.50");
    assertEquals(sanitizeDecimal("1-2+3"), "123");
  });

  it("keeps a single decimal point", () => {
    assertEquals(sanitizeDecimal("1.2.3"), "1.23");
    assertEquals(sanitizeDecimal("1..2"), "1.2");
  });

  it("truncates to two decimal places", () => {
    assertEquals(sanitizeDecimal("12.3456"), "12.34");
    assertEquals(sanitizeDecimal("0.999"), "0.99");
  });

  it("preserves integers unchanged", () => {
    assertEquals(sanitizeDecimal("42"), "42");
  });

  it("handles a leading decimal point", () => {
    assertEquals(sanitizeDecimal(".5"), ".5");
    assertEquals(sanitizeDecimal(".567"), ".56");
  });

  it("returns an empty string for input with no digits", () => {
    assertEquals(sanitizeDecimal("abc"), "");
    assertEquals(sanitizeDecimal(""), "");
  });

  it("keeps a trailing dot", () => {
    // The truncation only shortens fractional digits; a lone dot is allowed.
    assertEquals(sanitizeDecimal("12."), "12.");
  });
});

describe("sanitizeInteger", () => {
  it("keeps digits only", () => {
    assertEquals(sanitizeInteger("1a2b3c"), "123");
    assertEquals(sanitizeInteger("12-345"), "12345");
  });

  it("drops decimal points and other punctuation", () => {
    assertEquals(sanitizeInteger("12.34"), "1234");
    assertEquals(sanitizeInteger("$1,000"), "1000");
  });

  it("returns an empty string for input with no digits", () => {
    assertEquals(sanitizeInteger("abc"), "");
    assertEquals(sanitizeInteger(""), "");
  });

  it("preserves a pure digit string unchanged", () => {
    assertEquals(sanitizeInteger("007"), "007");
  });
});
