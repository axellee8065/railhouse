/** Client-side helpers for demo verify UX (HMAC digest check is server-side in PoC). */

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function rollFromDigest(digestHex: string): number {
  const slice = digestHex.slice(0, 8)
  const int = Number.parseInt(slice, 16)
  return Math.floor((int % 10001) / 100) + (int % 100) / 100
}

export function winChanceFromTarget(target: number, condition: 'over' | 'under'): number {
  return condition === 'over' ? 100 - target : target
}

export function calcMultiplier(target: number, condition: 'over' | 'under'): string {
  const winChance = winChanceFromTarget(target, condition)
  const edge = 0.01
  const mult = (100 * (1 - edge)) / Math.max(winChance, 0.01)
  return mult.toFixed(4)
}

export function computePayout(amount: number, multiplier: string, won: boolean): number {
  if (!won) return 0
  return Math.floor(amount * Number(multiplier))
}
