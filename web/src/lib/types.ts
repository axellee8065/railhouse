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
  /** Dice / flip roll, or limbo result echoed for shared clients. */
  roll: number
  won: boolean
  multiplier: string
  payout: number
  digest_hex: string
  nonce: number
  cursor?: number
  target?: number
  condition?: string
  result?: number
  target_multiplier?: number
  side?: string
  landed?: string
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

export type WithdrawalStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'policy_denied'

export interface UnsignedPayoutIntent {
  intent_id: string
  withdrawal_id: string
  operator_id: string
  player_id: string
  to_address: string
  amount: number
  currency: string
  asset: 'USDC'
  chain: 'sui-testnet'
  usdc_coin_type: string
  usdc_decimals: number
  ledger_minor_unit: number
  signing: 'operator_self_custody'
  signed: false
  broadcast: false
  created_at: string
}

export interface Withdrawal {
  id: string
  operator_id: string
  player_id: string
  amount: number
  currency: string
  asset: string
  chain: string
  to_address: string
  status: WithdrawalStatus
  fail_reason?: string | null
  fail_codes?: string[]
  unsigned_payout_intent?: UnsignedPayoutIntent | null
  requested_at: string
  decided_at?: string | null
  decided_by?: string | null
  decision_note?: string | null
  note?: string
  balance?: Balance
  rail_signs?: boolean
  sandbox?: boolean
}

export interface WithdrawPolicyInfo {
  operator_id: string
  player_id: string
  kyc_status: string | null
  rg_daily_limit_minor: number | null
  rg_weekly_limit_minor: number | null
  self_excluded: boolean | null
  withdrawn_today_minor: number
  withdrawn_this_week_minor: number
  min_amount_minor: number
  max_amount_minor: number
  chain: string
  asset: string
  usdc_coin_type: string
  fail_closed: boolean
  rail_signs: boolean
  custody: string
  sandbox: boolean
}

export type AuditAction =
  | 'withdraw.request'
  | 'withdraw.policy_deny'
  | 'withdraw.approve'
  | 'withdraw.reject'
  | 'policy.update'
  | string

export interface AuditEvent {
  id: string
  operator_id: string
  actor_type: 'player' | 'admin' | 'system'
  actor_id: string
  action: AuditAction
  entity_type: string
  entity_id: string
  payload: Record<string, unknown>
  created_at: string
}

export interface AdminDashboard {
  sandbox: boolean
  label: string
  brand: string
  operator_id: string
  chain: string
  asset: string
  counts: {
    players: number
    bets: number
    rounds: number
    deposits: number
    withdrawals: number
    withdrawals_pending: number
    audit_events: number
  }
  balances: {
    available: number
    reserved: number
    total: number
    currency: string
    minor_unit: number
    asset: string
  }
  recent_audit: AuditEvent[]
  append_only_audit: boolean
}

export interface AdminPlayer {
  operator_id: string
  player_id: string
  currency: string
  asset: string
  balance: Balance
  updated_at: string
  policy: {
    kyc_status: string | null
    rg_daily_limit_minor: number | null
    rg_weekly_limit_minor: number | null
    self_excluded: boolean
    withdrawn_today_minor: number
    withdrawn_this_week_minor: number
    updated_at: string
  } | null
}

export interface AdminBet {
  bet_id: string
  session_id: string
  operator_id: string
  player_id: string
  game_id: string
  round_id: string
  status: string
  amount: number
  currency: string
  bet_type: string | null
  payout: number | null
  profit: number | null
  created_at: string
  settled_at: string | null
}

export interface AdminRound {
  round_id: string
  session_id: string
  operator_id: string
  game_id: string
  status: string
  bet_ids: string[]
  created_at: string
  settled_at: string | null
}

export interface AdminDeposit {
  entry_id: string
  operator_id: string
  tx_id: string
  player_id: string | null
  amount: number
  currency: string
  entry_type: string
  posted_at: string
  idempotency_key: string
}
