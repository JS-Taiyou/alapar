export function sanitizeDecimal(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, "");
  const dotIdx = v.indexOf(".");
  if (dotIdx !== -1) {
    v = v.slice(0, dotIdx + 1) + v.slice(dotIdx + 1).replace(/\./g, "");
    const parts = v.split(".");
    if (parts[1] && parts[1].length > 2) {
      parts[1] = parts[1].slice(0, 2);
      v = parts.join(".");
    }
  }
  return v;
}

export function sanitizeInteger(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/**
 * Canonical money rendering: always two decimals, en-US grouping. Callers
 * prefix the `$` (and any sign) so compose contexts like `-$${formatMoney(x)}`
 * stay explicit at the use site.
 */
export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Up-to-two uppercase initials for avatar chips, e.g. "Ana Lucía" → "AL". */
export function initials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").substring(0, 2)
    .toUpperCase();
}
