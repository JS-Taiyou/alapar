import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import { PUSH_COOLDOWN, shouldSendPush } from "./push";

describe("shouldSendPush", () => {
  it("allows the first-ever push (now is large, lastPush = 0)", () => {
    // In production lastPushAt.get(key) ?? 0 starts at 0, and Date.now() is a
    // large epoch ms — so the first push is always well past the cooldown.
    assertEquals(shouldSendPush(1_700_000_000_000, 0), true);
  });

  it("allows the first-ever push regardless of how small now is", () => {
    // 0 is the map's "never pushed" marker, not epoch 0 — eligibility for a
    // key with no history doesn't depend on the clock.
    assertEquals(shouldSendPush(1000, 0), true);
  });

  it("blocks a push within the cooldown window", () => {
    const last = 10_000;
    assertEquals(shouldSendPush(last + PUSH_COOLDOWN - 1, last), false);
  });

  it("allows a push exactly at the cooldown boundary", () => {
    const last = 10_000;
    assertEquals(shouldSendPush(last + PUSH_COOLDOWN, last), true);
  });

  it("allows a push after the cooldown has elapsed", () => {
    const last = 10_000;
    assertEquals(shouldSendPush(last + PUSH_COOLDOWN + 5_000, last), true);
  });

  it("respects a custom cooldown argument", () => {
    // With a 5s cooldown, a push 6s after the last is allowed.
    assertEquals(shouldSendPush(6_000, 0, 5_000), true);
    // 4s after the last is not.
    assertEquals(shouldSendPush(9_000, 5_000, 5_000), false);
  });

  it("treats equal now and lastPush as at-boundary (allowed) when cooldown is 0", () => {
    assertEquals(shouldSendPush(5_000, 5_000, 0), true);
  });
});
