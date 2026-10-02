import { LOKI_CONTRACT_ADDRESS, readClient, waitForLokiTransaction, type LokiWriteClient } from "./genlayer";

export type LokiState = {
  id: string;
  publisher: string;
  title: string;
  category: string;
  choices: string[];
  entry_amount: string;
  closes_at: string;
  status: string;
  participant_count: string;
  total_pool: string;
  random_choice: string;
  randomness_verified: boolean;
  randomness_input_hash: string;
  randomness_entropy: string;
  randomness_consensus: string;
  winner_count: string;
  platform_fee: string;
  prize_pool: string;
  refund_pool: string;
  settled: boolean;
  entry_ids?: string[];
};

export type LokiEntry = {
  id: string;
  loki_id: string;
  player: string;
  commitment: string;
  choice: string;
  revealed: boolean;
  is_winner: boolean;
  settlement: string;
};

export const LOKI_METHODS = {
  create_loki: ["title", "category", "choices", "entry_amount", "closes_at"],
  enter_loki: ["loki_id", "choice_commitment"],
  reveal_choice: ["entry_id", "choice", "nonce"],
  close_loki: ["loki_id"],
  settle_loki: ["loki_id"],
  claim: [],
  get_loki: ["loki_id"],
  get_entry: ["entry_id"],
  get_platform_fees: [],
} as const;

export async function getLoki(lokiId: string): Promise<LokiState> {
  return (await readClient.readContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "get_loki",
    args: [lokiId],
  })) as LokiState;
}

export async function getEntry(entryId: string): Promise<LokiEntry> {
  return (await readClient.readContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "get_entry",
    args: [entryId],
  })) as LokiEntry;
}

export async function createLoki(
  client: LokiWriteClient,
  title: string,
  category: string,
  choices: string[],
  entryAmount: bigint,
  closesAt: bigint,
) {
  const hash = await client.writeContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "create_loki",
    args: [title, category, choices, entryAmount, closesAt],
    value: 0n,
  });
  return waitForLokiTransaction(client, hash);
}

export async function enterLoki(
  client: LokiWriteClient,
  lokiId: string,
  commitment: string,
  entryAmount: bigint,
) {
  const hash = await client.writeContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "enter_loki",
    args: [lokiId, commitment],
    value: entryAmount,
  });
  return waitForLokiTransaction(client, hash);
}

export async function revealChoice(
  client: LokiWriteClient,
  entryId: string,
  choice: string,
  nonce: string,
) {
  const hash = await client.writeContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "reveal_choice",
    args: [entryId, choice, nonce],
    value: 0n,
  });
  return waitForLokiTransaction(client, hash);
}

export async function closeLoki(client: LokiWriteClient, lokiId: string) {
  const hash = await client.writeContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "close_loki",
    args: [lokiId],
    value: 0n,
  });
  return waitForLokiTransaction(client, hash);
}

export async function settleLoki(client: LokiWriteClient, lokiId: string) {
  const hash = await client.writeContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "settle_loki",
    args: [lokiId],
    value: 0n,
  });
  return waitForLokiTransaction(client, hash);
}

export async function claim(client: LokiWriteClient) {
  const hash = await client.writeContract({
    address: LOKI_CONTRACT_ADDRESS,
    functionName: "claim",
    args: [],
    value: 0n,
  });
  return waitForLokiTransaction(client, hash);
}
