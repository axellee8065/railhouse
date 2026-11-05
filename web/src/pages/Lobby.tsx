import { Link } from 'react-router-dom'

export function Lobby() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-brand">
        <p className="hero-kicker">Own-brand sandbox on Casino Rail</p>
        <h1 id="hero-brand">Railhouse</h1>
        <p>
          A lean lobby for the Casino Rail PoC — in-house Hello Dice plus an RGS mock
          tile, wired to the sandbox bet/settle API with USDC on Sui testnet.
        </p>
        <div className="cta-row">
          <Link className="btn btn-primary" to="/play/hello-dice">
            Play Hello Dice
          </Link>
          <Link className="btn btn-ghost" to="/wallet">
            Open wallet
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading">On the floor</h2>
        <p>Two launch paths: original Provably Fair mini-game and a placeholder RGS embed.</p>
        <div className="game-rail">
          <Link className="game-tile" to="/play/hello-dice">
            <span className="tag">Original · Provably Fair</span>
            <h3>Hello Dice</h3>
            <p>Roll over or under a target. Place and settle through the rail with Idempotency-Key.</p>
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
