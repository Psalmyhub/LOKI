import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  ExecutionResult,
  TransactionStatus,
} from "genlayer-js/types";

export const LOKI_CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_LOKI_CONTRACT_ADDRESS ||
    "0x5F14155aE0779b9a82D599e5E660483714A332b5") as `0x${string}`;

export const LOKI_CHAIN = studionet;
export const LOKI_CHAIN_ID = 61999;
export const LOKI_RPC = "https://studio.genlayer.com/api";

export type WalletProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
};

export type LokiWriteClient = ReturnType<typeof createClient>;

export const readClient = createClient({
  chain: studionet,
});

export function createWriteClient(
  walletAddress: `0x${string}`,
  provider: WalletProvider,
) {
  return createClient({
    chain: studionet,
    account: walletAddress,
    provider,
  });
}

export async function waitForLokiTransaction(
  client: LokiWriteClient,
  hash: Parameters<LokiWriteClient["waitForTransactionReceipt"]>[0]["hash"],
) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 3000,
    retries: 120,
  });

  if (
    receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN
  ) {
    const execution =
      receipt.txExecutionResultName || ExecutionResult.NOT_VOTED;
    throw new Error(
      `GenLayer transaction finalized with execution result: ${execution}`,
    );
  }

  return receipt;
}
