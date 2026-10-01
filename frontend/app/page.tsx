"use client";

import { useMemo, useState } from "react";
import {
  LOKI_CONTRACT_ADDRESS,
  createWriteClient,
  readClient,
} from "../lib/genlayer";

const CONTRACT = LOKI_CONTRACT_ADDRESS;

type Loki = {
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

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [client, setClient] = useState<any>(null);
  const [lokiId, setLokiId] = useState("loki-1");
  const [loki, setLoki] = useState<Loki | null>(null);
  const [title, setTitle] = useState("LOKI Studio Randomness Test");
  const [category, setCategory] = useState("Randomness");
  const [choices, setChoices] = useState("RED\nBLUE");
  const [entryAmount, setEntryAmount] = useState("1");
  const [closesAt, setClosesAt] = useState("");
  const [commitment, setCommitment] = useState("");
  const [entryId, setEntryId] = useState("");
  const [revealChoice, setRevealChoice] = useState("RED");
  const [nonce, setNonce] = useState("");
  const [status, setStatus] = useState("Disconnected.");

  const choiceList = useMemo(
    () => choices.split("\n").map((x) => x.trim()).filter(Boolean),
    [choices],
  );

  async function connect() {
    if (!window.ethereum) {
      setStatus("No injected wallet found. Install/enable your wallet.");
      return;
    }

    const ethereum = window.ethereum;
    const addresses = (await ethereum.request({
      method: "eth_requestAccounts",
    })) as string[];

    const address = addresses[0] as `0x${string}`;
    const c = createWriteClient(address, ethereum);

    setAccount(address);
    setClient(c);
    setStatus(`Connected: ${address}\nStudionet: 61999`);
  }

  async function readLoki() {
    try {
      const result = await readClient.readContract({
        address: CONTRACT,
        functionName: "get_loki",
        args: [lokiId],
      });
      setLoki(result as Loki);
      setStatus("Read completed.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function send(functionName: string, args: unknown[], value?: string) {
    if (!client) throw new Error("Connect wallet first.");

    const tx = await client.writeContract({
      address: CONTRACT,
      functionName,
      args,
      value,
    });

    setStatus(`${functionName} submitted: ${tx}`);
    return tx;
  }

  async function createLoki() {
    if (!closesAt) return setStatus("Enter a future Unix timestamp.");
    try {
      const id = await send("create_loki", [
        title,
        category,
        choiceList,
        BigInt(entryAmount),
        BigInt(closesAt),
      ]);
      setLokiId(String(id));
      setStatus(`create_loki result: ${id}`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function enter() {
    try {
      const id = await send("enter_loki", [lokiId, commitment], entryAmount);
      setEntryId(String(id));
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function close() {
    try {
      await send("close_loki", [lokiId]);
      await readLoki();
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function reveal() {
    try {
      await send("reveal_choice", [entryId, revealChoice, nonce]);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function settle() {
    try {
      await send("settle_loki", [lokiId]);
      await readLoki();
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function claim() {
    try {
      await send("claim", []);
    } catch (error) {
      setStatus(String(error));
    }
  }

  return (
    <main>
      <header>
        <div>
          <h1>LOKI</h1>
          <p className="muted">
            GenLayer peer-to-peer prediction protocol · Studionet
          </p>
          <p className="mono muted">{CONTRACT}</p>
        </div>
        <button onClick={connect}>{account ? "Connected" : "Connect wallet"}</button>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Create LOKI</h2>
          <div className="stack">
            <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Category<input value={category} onChange={(e) => setCategory(e.target.value)} /></label>
            <label>Choices (one per line)<textarea value={choices} onChange={(e) => setChoices(e.target.value)} /></label>
            <label>Entry amount (native units)<input value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} /></label>
            <label>Closes at (Unix timestamp)<input value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>
            <button onClick={createLoki}>Create</button>
          </div>
        </section>

        <section className="card">
          <h2>LOKI state</h2>
          <div className="stack">
            <label>LOKI ID<input value={lokiId} onChange={(e) => setLokiId(e.target.value)} /></label>
            <div className="actions">
              <button className="secondary" onClick={readLoki}>Refresh</button>
              <button onClick={close}>Close + randomize</button>
              <button className="secondary" onClick={settle}>Settle</button>
              <button className="secondary" onClick={claim}>Claim</button>
            </div>
            {loki && <pre>{JSON.stringify(loki, null, 2)}</pre>}
          </div>
        </section>

        <section className="card">
          <h2>Enter</h2>
          <div className="stack">
            <label>SHA-256 commitment<input value={commitment} onChange={(e) => setCommitment(e.target.value)} /></label>
            <button onClick={enter}>Enter LOKI</button>
            <p className="muted mono">Entry result: {entryId || "—"}</p>
          </div>
        </section>

        <section className="card">
          <h2>Reveal</h2>
          <div className="stack">
            <label>Entry ID<input value={entryId} onChange={(e) => setEntryId(e.target.value)} /></label>
            <label>Choice<input value={revealChoice} onChange={(e) => setRevealChoice(e.target.value)} /></label>
            <label>Nonce<input value={nonce} onChange={(e) => setNonce(e.target.value)} /></label>
            <button onClick={reveal}>Reveal choice</button>
          </div>
        </section>

        <section className="card full">
          <h2>Status</h2>
          <div className="status">{status}</div>
          <p className="muted">
            Randomness is never generated by this frontend. The frontend only
            invokes the deployed contract; the contract performs its own
            randomness/consensus operation.
          </p>
        </section>
      </div>
    </main>
  );
}

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<any>;
    };
  }
}
