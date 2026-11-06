/** Normalize a Sui address to lowercase 0x + 64 hex. */
export function normalizeSuiAddress(addr: string): string {
  const hex = String(addr ?? "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex) || hex.length > 64) {
    throw new Error(`invalid Sui address: ${addr}`);
  }
  return `0x${hex.padStart(64, "0")}`;
}

export function sameSuiAddress(a: string, b: string): boolean {
  try {
    return normalizeSuiAddress(a) === normalizeSuiAddress(b);
  } catch {
    return false;
  }
}

/** Normalize Move type string for comparison (package id padding). */
export function normalizeCoinType(coinType: string): string {
  const raw = String(coinType ?? "").trim();
  const [pkg, ...rest] = raw.split("::");
  if (!pkg || rest.length < 2) return raw.toLowerCase();
  try {
    return `${normalizeSuiAddress(pkg)}::${rest.join("::")}`;
  } catch {
    return raw.toLowerCase();
  }
}

export function sameCoinType(a: string, b: string): boolean {
  return normalizeCoinType(a) === normalizeCoinType(b);
}
