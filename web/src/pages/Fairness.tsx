import { useEffect, useState } from 'react'
import { useSession } from '../context/SessionContext'
import { api, RailApiError } from '../lib/api/client'
import { sha256Hex } from '../lib/fairness'
import type { ProvablyFairState } from '../lib/types'

export function Fairness() {
  const { session, ensureSession } = useSession()
  const [state, setState] = useState<ProvablyFairState | null>(null)
  const [clientSeed, setClientSeed] = useState('')
  const [verifyNote, setVerifyNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const sess = session ?? (await ensureSession())
    const fair = await api.fairness(sess.session_id, sess.launch_token)
    setState(fair)
    setClientSeed(fair.client_seed)
  }

  useEffect(() => {
    void load().catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load fairness')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_id])

  async function saveSeed() {
    setBusy(true)
    setError(null)
    try {
      const sess = session ?? (await ensureSession())
      const fair = await api.setClientSeed(sess.session_id, sess.launch_token, clientSeed)
      setState(fair)
      setVerifyNote('Client seed updated.')
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    setBusy(true)
    setError(null)
    setVerifyNote(null)
    try {
      const sess = session ?? (await ensureSession())
      const fair = await api.rotateFairness(sess.session_id, sess.launch_token)
      setState(fair)
      if (fair.previous_server_seed) {
        const hash = await sha256Hex(fair.previous_server_seed)
        const ok = hash === fair.previous_server_seed_hash
        setVerifyNote(
          ok
            ? `Rotate OK — SHA-256(previous seed) matches published hash.`
            : `Rotate returned a seed whose hash did not match (unexpected).`,
        )
      }
    } catch (e) {
      if (e instanceof RailApiError) setError(`${e.code}: ${e.message}`)
      else setError(e instanceof Error ? e.message : 'Rotate failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section" aria-labelledby="fair-title">
      <h2 id="fair-title">Provably Fair</h2>
      <p>
        Server seed hash is published before play. Rotate to reveal the previous seed and
        verify locally with SHA-256.
      </p>

      <div className="panel stack">
        <div className="field">
          <label>Algorithm</label>
          <span className="mono">{state?.algorithm ?? '—'}</span>
        </div>
        <div className="field">
          <label>Server seed hash</label>
          <span className="mono">{state?.server_seed_hash ?? '—'}</span>
        </div>
        <div className="field">
          <label>Next nonce</label>
          <span className="mono">{state?.next_nonce ?? '—'}</span>
        </div>
        <div className="field">
          <label htmlFor="client-seed">Client seed</label>
          <input
            id="client-seed"
            value={clientSeed}
            onChange={(e) => setClientSeed(e.target.value)}
          />
        </div>
        {state?.previous_server_seed ? (
          <div className="field">
            <label>Previous server seed (revealed)</label>
            <span className="mono">{state.previous_server_seed}</span>
          </div>
        ) : null}

        <div className="cta-row">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={saveSeed}>
            Save client seed
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={rotate}>
            Rotate &amp; reveal
          </button>
        </div>

        {verifyNote ? <p className="ok-note">{verifyNote}</p> : null}
        {error ? <p className="alert">{error}</p> : null}
      </div>
    </section>
  )
}
