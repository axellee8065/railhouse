import { Link } from 'react-router-dom'

export function Lobby() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-brand">
        <p className="hero-kicker">Own-brand sandbox on Casino Rail</p>
        <h1 id="hero-brand">Railhouse</h1>
        <p>
          A lean lobby for the Casino Rail PoC — in-house Provably Fair tiles plus an
          RGS mock, wired to the sandbox bet/settle API with USDC on Sui testnet.
        </p>
        <div className="cta-row">
          <Link className="btn btn-primary" to="/play/limbo">
            Play Horizon Limbo
          </Link>
          <Link className="btn btn-ghost" to="/wallet">
            Open wallet
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading">On the floor</h2>
        <p>
          Original Provably Fair mini-games and a placeholder RGS embed — same wallet,
          Idempotency-Key place → settle.
        </p>
        <div className="game-rail">
          <Link className="game-tile" to="/play/hello-dice">
            <span className="tag">Original · Provably Fair</span>
            <h3>Hello Dice</h3>
            <p>Roll over or under a target. Place and settle through the rail with Idempotency-Key.</p>
          </Link>
          <Link className="game-tile limbo" to="/play/limbo">
            <span className="tag">Original · Provably Fair</span>
            <h3>Horizon Limbo</h3>
            <p>Set a target multiplier. Flight clears the line or busts — PF outcome via HMAC.</p>
          </Link>
          <Link className="game-tile flip" to="/play/coin-flip">
            <span className="tag">Original · Provably Fair</span>
            <h3>Twin Face</h3>
            <p>Heads or tails at ~1.98×. Same fairness seeds as the rest of the floor.</p>
          </Link>
          <Link className="game-tile rgs" to="/play/rgs-mock">
            <span className="tag">RGS mock</span>
            <h3>Neon Switch</h3>
            <p>Simulated third-party frame. Same session wallet — no external keys leave the operator.</p>
          </Link>
        </div>
      </section>
    </>
  )
}
