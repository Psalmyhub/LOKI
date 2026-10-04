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
export const LOKI_CHAIN_ID_HEX = "0xf22f";
export const LOKI_RPC = "https://studio.genlayer.com/api";

export type WalletProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
};

export type LokiWriteClient = ReturnType<typeof createClient>;

export const readClient = createClient({
  chain: studionet,
});

export async function ensureStudionet(provider: WalletProvider) {
  const chainId = String(await provider.request({ method: "eth_chainId" })).toLowerCase();

  if (chainId === LOKI_CHAIN_ID_HEX) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: LOKI_CHAIN_ID_HEX }],
    });
  } catch (error: any) {
    if (error?.code !== 4902) {
      throw new Error(
        `Please switch your wallet to GenLayer Studionet (chain 61999). ${error?.message || ""}`.trim(),
      );
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: LOKI_CHAIN_ID_HEX,
          chainName: "GenLayer Studionet",
          nativeCurrency: {
            name: "GEN",
            symbol: "GEN",
            decimals: 18,
          },
          rpcUrls: [LOKI_RPC],
        },
      ],
    });

    const verifiedChainId = String(
      await provider.request({ method: "eth_chainId" }),
    ).toLowerCase();

    if (verifiedChainId !== LOKI_CHAIN_ID_HEX) {
      throw new Error("Wallet did not switch to GenLayer Studionet.");
    }
  }
}

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

const LOKI_TX_POLL_INTERVAL_MS = 3000;
const LOKI_TX_POLL_RETRIES = 120;

export async function waitForLokiTransaction(
  client: LokiWriteClient,
  hash: Parameters<LokiWriteClient["waitForTransactionReceipt"]>[0]["hash"],
) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: LOKI_TX_POLL_INTERVAL_MS,
    retries: LOKI_TX_POLL_RETRIES,
  });

  let transaction = receipt;

  if (
    transaction.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN
  ) {
    return transaction;
  }

  if (
    transaction.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR
  ) {
    throw new Error(
      "GenLayer transaction finalized, but contract execution failed.",
    );
  }

  // FINALIZED only means consensus finality. On Studio, execution can still
  // report NOT_VOTED. Never resubmit the transaction in that state: poll the
  // existing transaction hash until GenLayer records its execution result.
  let lastError: unknown = null;

  for (let attempt = 0; attempt < LOKI_TX_POLL_RETRIES; attempt += 1) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, LOKI_TX_POLL_INTERVAL_MS),
    );

    try {
      transaction = await client.getTransaction({ hash });
      lastError = null;
    } catch (error) {
      lastError = error;
      continue;
    }

    if (
      transaction.txExecutionResultName ===
      ExecutionResult.FINISHED_WITH_RETURN
    ) {
      return transaction;
    }

    if (
      transaction.txExecutionResultName ===
      ExecutionResult.FINISHED_WITH_ERROR
    ) {
      throw new Error(
        "GenLayer transaction finalized, but contract execution failed.",
      );
    }
  }

  if (lastError) {
    throw new Error(
      `Timed out while polling the existing GenLayer transaction: ${String(lastError)}`,
    );
  }

  throw new Error(
    "Timed out waiting for GenLayer contract execution to complete. The existing transaction was not resubmitted.",
  );
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
