import type { Balance } from './types'

/** Default matches Casino Rail sandbox (USD minor units standing in for USDC). */
export const DISPLAY_ASSET = 'USDC'
export const DEFAULT_MINOR_UNIT = 2

export function formatUsdc(amountMinor: number, minorUnit = DEFAULT_MINOR_UNIT): string {
  const value = amountMinor / 10 ** minorUnit
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.min(minorUnit, 6),
  })
}

export function usdcLabel(balance: Pick<Balance, 'available' | 'minor_unit'>): string {
  return `${formatUsdc(balance.available, balance.minor_unit)} ${DISPLAY_ASSET}`
}

export function toMinor(display: number, minorUnit = DEFAULT_MINOR_UNIT): number {
  return Math.round(display * 10 ** minorUnit)
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
}
