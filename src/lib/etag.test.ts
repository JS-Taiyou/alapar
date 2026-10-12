import { assert, assertEquals, assertNotEquals, assertThrows } from "@test/compat";
import { describe, it } from "@test/compat";
import { generateETag } from "./etag";

describe("generateETag", () => {
  it("is deterministic for the same input", () => {
    assertEquals(generateETag({ a: 1 }), generateETag({ a: 1 }));
  });

  it("returns a quoted string", () => {
    const tag = generateETag({ x: 1 });
    assert(tag.startsWith('"') && tag.endsWith('"'), `expected quoted tag, got: ${tag}`);
  });

  it("differs for different object contents", () => {
    assertNotEquals(generateETag({ a: 1 }), generateETag({ a: 2 }));
  });

  it("is sensitive to key order (JSON serialization order)", () => {
    // generateETag serializes via JSON.stringify, which is insertion-order
    // sensitive for string keys — locking this behavior down explicitly.
    assertNotEquals(generateETag({ a: 1, b: 2 }), generateETag({ b: 2, a: 1 }));
  });

  it("treats numbers and strings distinctly", () => {
    assertNotEquals(generateETag(1), generateETag("1"));
  });

  it("produces a stable value for primitives", () => {
    assertEquals(generateETag("hello"), generateETag("hello"));
    assertEquals(generateETag(42), generateETag(42));
  });

  it("handles null and empty containers without throwing", () => {
    assertEquals(typeof generateETag(null), "string"); // JSON.stringify(null) -> "null"
    assertEquals(typeof generateETag({}), "string");
    assertEquals(typeof generateETag([]), "string");
    assertEquals(typeof generateETag(""), "string");
  });

  it("does NOT support undefined (JSON.stringify returns undefined, not a string)", () => {
    // Documented limitation: in production generateETag is always called with
    // a real payload object (dashboard/transaction data), never undefined.
    // Pinning this so a future caller doesn't silently pass undefined through.
    assertThrows(() => generateETag(undefined), TypeError);
  });

  it("does not contain the raw serialized payload (it is a hash)", () => {
    // The ETag must be short, not a verbatim echo of sensitive data.
    const tag = generateETag({ secret: "super-long-secret-value-12345" });
    assert(!tag.includes("secret"), "ETag leaked input data");
    assert(tag.length < 32, `ETag unexpectedly long: ${tag.length}`);
  });
});
