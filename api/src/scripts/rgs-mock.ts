/**
 * RGS mock adapter: simulates an external game server calling
 * auth → launch(rgs_mock_slots) → place → settle against the local sandbox.
 *
 * Usage: npm run rgs-mock
 * Requires the API to be running (npm run dev).
 */
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

const BASE = process.env.RAIL_BASE ?? `http://127.0.0.1:${config.port}/v1`;
const headers = {
  "Content-Type": "application/json",
  "X-Rail-Env": "sandbox",
};

async function json(res: Response) {
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  console.log(`[rgs-mock] targeting ${BASE}`);

  const tokenRes = await fetch(`${BASE}/auth/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.demo.clientId,
      client_secret: config.demo.clientSecret,
      scope: config.demo.scope,
    }),
  });
  const { access_token } = (await json(tokenRes)) as { access_token: string };

  const launchRes = await fetch(`${BASE}/sessions/launch`, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `Bearer ${access_token}`,
      "Idempotency-Key": randomUUID(),
      "X-Operator-Id": config.demo.operatorId,
    },
    body: JSON.stringify({
      player_id: config.demo.playerId,
      game_id: config.games.rgsMock,
      currency: "USD",
      locale: "ko",
      meta: { outcome_mode: "studio", rgs: "mock" },
    }),
  });
  const launch = (await launchRes.json()) as {
    session_id: string;
    balance: { available: number };
  };
  if (!launchRes.ok) throw new Error(JSON.stringify(launch));

  const sessionId = launch.session_id;
  const amount = 500;
  const roundId = `rgs_round_${Date.now()}`;

  const placeRes = await fetch(`${BASE}/sessions/${sessionId}/bets`, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `Bearer ${access_token}`,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      game_id: config.games.rgsMock,
      round_id: roundId,
      amount,
      currency: "USD",
      bet_type: "spin",
      payload: { lines: 20, bet_per_line: 25 },
    }),
  });
  const placed = (await placeRes.json()) as {
    bet_id: string;
    balance_after: { available: number; reserved: number };
  };
  if (!placeRes.ok) throw new Error(JSON.stringify(placed));

  // Mock RGS RNG: 30% win at 2x
  const won = Math.random() < 0.3;
  const payout = won ? amount * 2 : 0;

  const settleRes = await fetch(
    `${BASE}/sessions/${sessionId}/bets/${placed.bet_id}/settle`,
    {
      method: "POST",
      headers: {
        ...headers,
        Authorization: `Bearer ${access_token}`,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        payout,
        outcome: {
          symbols: won ? ["A", "A", "A"] : ["A", "K", "Q"],
          won,
          multiplier: won ? "2.0000" : "0.0000",
        },
      }),
    },
  );
  const settled = await settleRes.json();
  if (!settleRes.ok) throw new Error(JSON.stringify(settled));

  console.log(
    JSON.stringify(
      {
        game_id: config.games.rgsMock,
        session_id: sessionId,
        bet_id: placed.bet_id,
        amount,
        payout,
        settled,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[rgs-mock] failed:", err);
  process.exit(1);
});
