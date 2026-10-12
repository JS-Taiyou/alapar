/**
 * Compatibility shim: the Deno test suite was written against `@std/assert`
 * and `@std/testing/bdd`. Re-implementing those assertion helpers on top of
 * Vitest's `expect` lets the ported tests keep their original bodies — the
 * value of the suite is in the scenarios and expected values, not in which
 * assertion library spelled them out.
 *
 * New tests should use `expect` / `describe` / `it` directly.
 */
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vite-plus/test";

export { afterEach, beforeEach, describe, expect, it, test, vi };

export function assert(cond: unknown, msg?: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

export function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  expect(actual, msg).toEqual(expected);
}

export function assertNotEquals(actual: unknown, expected: unknown, msg?: string): void {
  expect(actual, msg).not.toEqual(expected);
}

export function assertStrictEquals(actual: unknown, expected: unknown, msg?: string): void {
  expect(actual, msg).toBe(expected);
}

export function assertAlmostEquals(
  actual: number,
  expected: number,
  tolerance = 1e-7,
  msg?: string,
): void {
  expect(Math.abs(actual - expected), msg).toBeLessThanOrEqual(tolerance);
}

export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  expect(actual, msg).toContain(expected);
}

export function assertArrayIncludes(actual: unknown[], expected: unknown[], msg?: string): void {
  for (const e of expected) expect(actual, msg).toContainEqual(e);
}

export function assertExists(actual: unknown, msg?: string): void {
  expect(actual === null || actual === undefined, msg).toBe(false);
}

export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  expect(actual, msg).toMatch(expected);
}

export function assertInstanceOf(
  actual: unknown,
  // deno-lint-ignore no-explicit-any
  expectedType: new (...args: any[]) => unknown,
  msg?: string,
): void {
  expect(actual, msg).toBeInstanceOf(expectedType);
}

// deno-lint-ignore no-explicit-any
type ErrorClass = new (...args: any[]) => Error;

function checkThrown(caught: unknown, errorClass?: ErrorClass, msgIncludes?: string): Error {
  assertExists(caught, "Expected function to throw, but it returned normally");
  if (errorClass) expect(caught).toBeInstanceOf(errorClass);
  if (msgIncludes) {
    expect(String((caught as Error)?.message ?? caught)).toContain(msgIncludes);
  }
  return caught as Error;
}

export function assertThrows(
  fn: () => unknown,
  errorClass?: ErrorClass,
  msgIncludes?: string,
): Error {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  return checkThrown(caught, errorClass, msgIncludes);
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  errorClass?: ErrorClass,
  msgIncludes?: string,
): Promise<Error> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  return checkThrown(caught, errorClass, msgIncludes);
}
