import { assert, assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import {
  base64url,
  base64urlToBytes,
  concatUint8Arrays,
  encodeLength,
  urlBase64ToUint8Array,
} from "./encoding";

describe("base64url", () => {
  it("encodes a string to base64url (no +, /, or padding)", () => {
    // "Hello" -> btoa -> "SGVsbG8=" -> base64url "SGVsbG8"
    assertEquals(base64url("Hello"), "SGVsbG8");
  });

  it("replaces + with - and / with _", () => {
    // bytes [0xfb, 0xff, 0xbf] encode to "+/+/" in standard base64,
    // which base64url maps to "-_-" ... actual: "-_-_"
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    assertEquals(base64url(bytes), "-_-_");
    // Confirm no +, /, or = appears in any base64url output.
    assert(!base64url(bytes).match(/[+/=]/));
  });

  it("strips trailing '=' padding", () => {
    assertEquals(base64url("Hel"), "SGVs");
  });
});

describe("base64urlToBytes", () => {
  it("round-trips base64url -> bytes -> base64url", () => {
    for (const input of ["Hello", "test payload", "", "a"]) {
      const encoded = base64url(input);
      const decoded = base64urlToBytes(encoded);
      const text = String.fromCharCode(...decoded);
      assertEquals(text, input);
    }
  });

  it("handles url-safe chars (- and _)", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const encoded = "-_-_";
    assertEquals(base64urlToBytes(encoded), bytes);
  });

  it("accepts input without padding", () => {
    // "SGVsbG8" (no padding) decodes to "Hello"
    const decoded = base64urlToBytes("SGVsbG8");
    assertEquals(String.fromCharCode(...decoded), "Hello");
  });

  it("decodes to an empty array for empty input", () => {
    assertEquals(base64urlToBytes(""), new Uint8Array([]));
  });
});

describe("urlBase64ToUint8Array (alias of base64urlToBytes)", () => {
  it("behaves identically to base64urlToBytes", () => {
    const encoded = "SGVsbG8";
    assertEquals(urlBase64ToUint8Array(encoded), base64urlToBytes(encoded));
  });
});

describe("concatUint8Arrays", () => {
  it("concatenates arrays in order", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const c = new Uint8Array([6]);
    assertEquals(concatUint8Arrays(a, b, c), new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it("returns an empty array when given no inputs", () => {
    assertEquals(concatUint8Arrays(), new Uint8Array([]));
  });

  it("returns the single array unchanged when given one input", () => {
    const a = new Uint8Array([9, 9]);
    assertEquals(concatUint8Arrays(a), a);
  });

  it("handles empty arrays in the middle", () => {
    assertEquals(
      concatUint8Arrays(new Uint8Array([1]), new Uint8Array([]), new Uint8Array([2])),
      new Uint8Array([1, 2]),
    );
  });
});

describe("encodeLength", () => {
  it("prepends a 2-byte big-endian length", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43]); // length 3
    assertEquals(encodeLength(data), new Uint8Array([0, 3, 0x41, 0x42, 0x43]));
  });

  it("prefixes [0,0] for empty data", () => {
    assertEquals(encodeLength(new Uint8Array([])), new Uint8Array([0, 0]));
  });

  it("encodes a length of exactly 255 (single high byte)", () => {
    const data = new Uint8Array(255);
    const result = encodeLength(data);
    assertEquals(result[0], 0);
    assertEquals(result[1], 255);
    assertEquals(result.length, 257);
  });
});
