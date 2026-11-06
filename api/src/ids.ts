import { randomBytes } from "node:crypto";

function ulidish(prefix: string): string {
  const ts = Date.now().toString(36);
  const rnd = randomBytes(8).toString("hex");
  return `${prefix}_${ts}${rnd}`;
}

export const ids = {
  session: () => ulidish("sess"),
  bet: () => ulidish("bet"),
  reservation: () => ulidish("rsv"),
  ledger: () => ulidish("le"),
  webhook: () => ulidish("wh"),
  event: () => ulidish("evt"),
  delivery: () => ulidish("del"),
  request: () => ulidish("req"),
  withdrawal: () => ulidish("wd"),
  payoutIntent: () => ulidish("poi"),
  audit: () => ulidish("aud"),
  reconRun: () => ulidish("rr"),
  reconTicket: () => ulidish("rt"),
  reconInject: () => ulidish("ri"),
  jti: () => randomBytes(12).toString("hex"),
};
