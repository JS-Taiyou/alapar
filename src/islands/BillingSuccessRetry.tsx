import { useEffect } from "preact/hooks";

/**
 * Auto-retry for /billing/success's pending state.
 *
 * The page is rendered once server-side; when Polar's webhook lags behind the
 * browser redirect it shows "Processing payment…" and would stay that way
 * until the user manually reloads. This island reloads the page a bounded
 * number of times (the handler re-queries Polar on every render), then gives
 * up quietly — the entitlement itself still arrives via the webhook.
 *
 * The counter lives in sessionStorage so a reload loop stays bounded per tab
 * and never survives the user navigating away.
 */

const RETRY_KEY = "billingSuccessRetries";
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

export default function BillingSuccessRetry(
  props: { activated: boolean },
) {
  useEffect(() => {
    if (props.activated) {
      sessionStorage.removeItem(RETRY_KEY);
      return;
    }
    const tries = Number(sessionStorage.getItem(RETRY_KEY) ?? "0");
    if (tries >= MAX_RETRIES) return;
    sessionStorage.setItem(RETRY_KEY, String(tries + 1));
    const timer = setTimeout(
      () => globalThis.location.reload(),
      RETRY_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [props.activated]);

  return null;
}
