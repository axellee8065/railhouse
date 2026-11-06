import { config } from "../../config.js";

export type GraphqlBalanceChange = {
  amount: string;
  coinType: { repr: string } | null;
  owner: { address: string } | null;
};

export type GraphqlTransaction = {
  digest: string;
  sender?: { address: string } | null;
  effects: {
    status: string;
    timestamp?: string | null;
    checkpoint?: { sequenceNumber: number | string } | null;
    balanceChanges: { nodes: GraphqlBalanceChange[] };
  } | null;
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export async function graphqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(config.sui.graphqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: init?.signal,
  });
  if (!res.ok) {
    throw new Error(`Sui GraphQL HTTP ${res.status}`);
  }
  const body = (await res.json()) as GraphqlResponse<T>;
  if (body.errors?.length) {
    throw new Error(`Sui GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) {
    throw new Error("Sui GraphQL: empty data");
  }
  return body.data;
}

export async function fetchLatestCheckpoint(signal?: AbortSignal): Promise<number> {
  const data = await graphqlQuery<{ checkpoint: { sequenceNumber: number | string } }>(
    `{ checkpoint { sequenceNumber } }`,
    undefined,
    { signal },
  );
  return Number(data.checkpoint.sequenceNumber);
}

export async function fetchTransactionByDigest(
  digest: string,
  signal?: AbortSignal,
): Promise<GraphqlTransaction | null> {
  const data = await graphqlQuery<{ transaction: GraphqlTransaction | null }>(
    `query ($digest: String!) {
      transaction(digest: $digest) {
        digest
        sender { address }
        effects {
          status
          timestamp
          checkpoint { sequenceNumber }
          balanceChanges {
            nodes {
              amount
              coinType { repr }
              owner { address }
            }
          }
        }
      }
    }`,
    { digest },
    { signal },
  );
  return data.transaction;
}

export async function fetchAffectedTransactions(
  address: string,
  opts: { first?: number; after?: string | null; signal?: AbortSignal } = {},
): Promise<{
  nodes: GraphqlTransaction[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
}> {
  const first = opts.first ?? 25;
  const data = await graphqlQuery<{
    transactions: {
      nodes: GraphqlTransaction[];
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
    };
  }>(
    `query ($addr: SuiAddress!, $first: Int!, $after: String) {
      transactions(first: $first, after: $after, filter: { affectedAddress: $addr }) {
        pageInfo { endCursor hasNextPage }
        nodes {
          digest
          sender { address }
          effects {
            status
            timestamp
            checkpoint { sequenceNumber }
            balanceChanges {
              nodes {
                amount
                coinType { repr }
                owner { address }
              }
            }
          }
        }
      }
    }`,
    { addr: address, first, after: opts.after ?? null },
    { signal: opts.signal },
  );
  return data.transactions;
}
