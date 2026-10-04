import { createClient, isSuccessful } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

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

export async function waitForLokiTransaction(
  client: LokiWriteClient,
  hash: Parameters<LokiWriteClient["waitForFinalization"]>[0]["hash"],
) {
  const receipt = await client.waitForFinalization({
    hash,
    interval: 3000,
    retries: 120,
  });

  if (!isSuccessful(receipt)) {
    throw new Error(
      `GenLayer transaction did not succeed: ${receipt.statusName || "UNKNOWN"} / ${receipt.txExecutionResultName || "UNKNOWN"}`,
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
