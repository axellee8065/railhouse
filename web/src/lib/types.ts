/** Ledger currency code on the wire (API sandbox uses USD minor units for USDC PoC). */
export type LedgerCurrency = 'USD'

export interface Balance {
  currency: LedgerCurrency | string
  available: number
  reserved: number
  total?: number
  minor_unit: number
  updated_at?: string
  /** Display asset — PoC always USDC on Sui testnet. */
  asset?: 'USDC'
}

export interface ProvablyFairState {
  algorithm: string
  server_seed_hash: string
  client_seed: string
  next_nonce: number
  rotated_at: string | null
  previous_server_seed: string | null
  previous_server_seed_hash?: string | null
  new_server_seed_hash?: string
}

export interface LaunchSession {
  session_id: string
  launch_token: string
  launch_token_expires_at: string
  game_url: string
  balance: Balance
  provably_fair: {
    server_seed_hash: string
    nonce: number
    algorithm: string
  }
  env: 'sandbox'
}

export interface OutcomePreview {
  roll: number
  won: boolean
  multiplier: string
  payout: number
  digest_hex: string
  nonce: number
}

export interface BetPlaceResponse {
  bet_id: string
  round_id: string
  status: 'reserved'
  amount: number
  currency: string
  reservation_id: string
  balance_after: Pick<Balance, 'available' | 'reserved' | 'minor_unit'>
  provably_fair: {
    server_seed_hash: string
    client_seed: string
    nonce: number
    cursor: number
  }
  outcome_preview?: OutcomePreview
  created_at: string
  idempotency_replay: boolean
}

export interface BetSettleResponse {
  bet_id: string
  round_id: string
  status: 'settled'
  amount: number
  payout: number
  profit: number
  currency: string
  balance_after: Pick<Balance, 'available' | 'reserved' | 'minor_unit'>
  settled_at: string
  idempotency_replay: boolean
}

export interface RoundItem {
  round_id: string
  game_id: string
  status: string
  bets: Array<{
    bet_id: string
    amount: number
    payout: number
    status: string
  }>
  created_at: string
  settled_at?: string
}

export interface RailErrorBody {
  error: {
    code: string
    message: string
    request_id?: string
    details?: Record<string, unknown>
  }
}

export interface PlayerAccount {
  player_id: string
  display_name: string
  email: string
  chain: 'sui-testnet'
  custody: 'operator-self'
}

export interface DemoCredentials {
  client_id: string
  client_secret: string
  operator_id: string
  player_id: string
  scope?: string
  deposit?: {
    receive_address: string
    usdc_coin_type: string
    usdc_decimals: number
    graphql_url: string
    dry_run_enabled: boolean
    faucet_url: string
    custody: 'operator-self'
  }
}

export interface DepositAddressInfo {
  chain: string
  asset: string
  receive_address: string
  usdc_coin_type: string
  usdc_decimals: number
  ledger_minor_unit: number
  required_confirmations: number
  dry_run_enabled: boolean
  faucet_url: string
  explorer_account_url: string
  instructions: string[]
  conversion_note?: string
}

export interface DetectDepositResult {
  credited: boolean
  replay: boolean
  skipped?: 'unconfirmed'
  amount?: number
  balance?: Balance
  deposit?: {
    digest: string
    confirmations: number
    confirmed: boolean
    source: string
    dry_run: boolean
    amount_ledger_minor: number
  }
  note?: string
}
