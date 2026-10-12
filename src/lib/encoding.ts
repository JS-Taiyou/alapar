/**
 * Pure encoding helpers for base64url and binary marshalling.
 *
 * Consolidated from `lib/notifications.ts` (`urlBase64ToUint8Array`) and
 * `lib/push.ts` (`base64url`, `base64urlToBytes`, `concatUint8Arrays`,
 * `encodeLength`). No I/O, no globals beyond `btoa`/`atob` — extracted so the
 * fiddly padding/replacement math is unit-testable.
 */

/**
 * Encode a string or byte array as base64url (RFC 4648 §5): `+`→`-`,
 * `/`→`_`, trailing `=` stripped.
 */
export function base64url(input: string | Uint8Array): string {
  const str = typeof input === "string" ? input : String.fromCharCode(...input);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url string into bytes. Handles missing padding and the
 * url-safe alphabet (`-`→`+`, `_`→`/`).
 */
export function base64urlToBytes(base64: string): Uint8Array {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  return Uint8Array.from(binary.split("").map((c) => c.charCodeAt(0)));
}

/**
 * Alias for {@link base64urlToBytes}; kept for parity with the legacy
 * `urlBase64ToUint8Array` name in `notifications.ts`.
 */
export const urlBase64ToUint8Array = base64urlToBytes;

/** Concatenate multiple `Uint8Array`s in order into a single buffer. */
export function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Prepend a 2-byte big-endian length to `data` (used in the aes128gcm record
 * format per RFC 8188).
 */
export function encodeLength(data: Uint8Array): Uint8Array {
  const len = new Uint8Array(2 + data.length);
  len[0] = 0;
  len[1] = data.length;
  len.set(data, 2);
  return len;
}
