import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  ExecutionResult,
  TransactionStatus,
} from "genlayer-js/types";

export const LOKI_CONTRACT_ADDRESS =
  "0x8bbC34e492b5f9c3DA16Eb49ecbd2a99268F368F" as `0x${string}`;

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

export function extractContractReturnValue(
  receipt: unknown,
): string | null {
  const tx = receipt as {
    consensus_data?: {
      leader_receipt?: Array<{
        result?: unknown;
      }>;
    };
  };

  const leaderResult = tx.consensus_data?.leader_receipt?.[0]?.result;

  if (!leaderResult) {
    return null;
  }

  if (typeof leaderResult === "string") {
    try {
      const parsed = JSON.parse(leaderResult);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return leaderResult;
    }
  }

  if (
    typeof leaderResult === "object" &&
    leaderResult !== null
  ) {
    const result = leaderResult as {
      status?: unknown;
      payload?: unknown;
    };

    if (result.status !== "return") {
      return null;
    }

    if (
      typeof result.payload === "object" &&
      result.payload !== null
    ) {
      const payload = result.payload as {
        readable?: unknown;
      };

      if (typeof payload.readable === "string") {
        try {
          const parsed = JSON.parse(payload.readable);
          return typeof parsed === "string"
            ? parsed
            : payload.readable;
        } catch {
          return payload.readable;
        }
      }
    }
  }

  return null;
}
