/**
 * Tests for the pure decision functions exported from `lib/realtime.ts`.
 *
 * The full async recovery loop touches `fetch`, WebSocket internals, and
 * Supabase client state — those are integration-test territory. Here we lock
 * down the recovery *policy*: which statuses trigger recovery, how many
 * attempts, and the backoff schedule.
 */
import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import {
  channelStatusAction,
  MAX_RECOVERY_ATTEMPTS,
  RECOVERABLE_STATUSES,
  RECOVERY_BACKOFF_MS,
  shouldRecover,
} from "./realtime";

describe("shouldRecover", () => {
  it("returns true for CHANNEL_ERROR", () => {
    assertEquals(shouldRecover("CHANNEL_ERROR"), true);
  });

  it("returns true for TIMED_OUT", () => {
    assertEquals(shouldRecover("TIMED_OUT"), true);
  });

  it("returns false for CLOSED (SDK fires it during normal lifecycle)", () => {
    // CLOSED is excluded to avoid fighting the SDK's own auto-reconnection.
    assertEquals(shouldRecover("CLOSED"), false);
  });

  it("returns false for SUBSCRIBED (healthy state)", () => {
    assertEquals(shouldRecover("SUBSCRIBED"), false);
  });

  it("returns false for unknown statuses", () => {
    assertEquals(shouldRecover("UNKNOWN"), false);
    assertEquals(shouldRecover(""), false);
  });

  it("RECOVERABLE_STATUSES matches the documented set", () => {
    assertEquals(RECOVERABLE_STATUSES, new Set(["CHANNEL_ERROR", "TIMED_OUT"]));
  });
});

describe("channelStatusAction", () => {
  it("maps SUBSCRIBED to resync (events may have been missed while dead)", () => {
    assertEquals(channelStatusAction("SUBSCRIBED"), "resync");
  });

  it("maps recoverable errors to recover", () => {
    assertEquals(channelStatusAction("CHANNEL_ERROR"), "recover");
    assertEquals(channelStatusAction("TIMED_OUT"), "recover");
  });

  it("maps CLOSED and unknown statuses to ignore (SDK handles them)", () => {
    assertEquals(channelStatusAction("CLOSED"), "ignore");
    assertEquals(channelStatusAction("UNKNOWN"), "ignore");
    assertEquals(channelStatusAction(""), "ignore");
  });
});

describe("recovery policy constants", () => {
  it("allows up to 3 recovery attempts", () => {
    assertEquals(MAX_RECOVERY_ATTEMPTS, 3);
  });

  it("has a backoff schedule with exponential growth", () => {
    assertEquals(RECOVERY_BACKOFF_MS.length, 3);
    assertEquals(RECOVERY_BACKOFF_MS[0], 1000);
    assertEquals(RECOVERY_BACKOFF_MS[1], 2000);
    assertEquals(RECOVERY_BACKOFF_MS[2], 4000);
    // Each delay is strictly greater than the previous (backoff grows).
    for (let i = 1; i < RECOVERY_BACKOFF_MS.length; i++) {
      assertEquals(
        RECOVERY_BACKOFF_MS[i] > RECOVERY_BACKOFF_MS[i - 1],
        true,
        "backoff must increase",
      );
    }
  });

  it("has at least as many backoff entries as max attempts", () => {
    assertEquals(RECOVERY_BACKOFF_MS.length >= MAX_RECOVERY_ATTEMPTS, true);
  });
});
