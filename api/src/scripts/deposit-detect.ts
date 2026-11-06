/**
 * One-shot Sui testnet USDC deposit detect + ledger credit.
 *
 * Usage:
 *   npx tsx api/src/scripts/deposit-detect.ts --digest <digest> [--dry-run]
 *   npx tsx api/src/scripts/deposit-detect.ts --fixture
 */
import { config } from "../config.js";
import { seedDemoData } from "../seed.js";
import { creditFromDetection, serializeDeposit } from "../services/sui/credit.js";
import { detectUsdcDepositToReceiveAddress } from "../services/sui/detect.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) {
    return process.argv[i + 1];
  }
  return undefined;
}

async function main() {
  seedDemoData();
  const useFixture = process.argv.includes("--fixture");
  const dryRun = process.argv.includes("--dry-run") || useFixture || config.sui.dryRun;
  const digest =
    arg("--digest") ??
    (useFixture ? "dryrun_B5F7Be1srK6nARNzB9YqnipvYnEq5XCZW12WSTi2BjJj" : undefined);

  if (!digest) {
    console.error("Usage: deposit-detect.ts --digest <tx> [--dry-run] | --fixture");
    process.exit(2);
  }

  const detected = await detectUsdcDepositToReceiveAddress(digest, { dryRun });
  const result = creditFromDetection(detected, {
    operatorId: config.sui.defaultOperatorId,
    playerId: config.sui.defaultPlayerId,
    requireConfirmed: true,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        deposit: serializeDeposit(result.deposit),
        receive_address: config.sui.receiveAddress,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
