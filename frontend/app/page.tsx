"use client";

import { useEffect, useMemo, useState } from "react";
import { LOKI_CONTRACT_ADDRESS, readClient } from "../lib/genlayer";
import {
  enterLoki,
  getEntry,
  getLoki,
  claim,
  extractContractReturnValue,
  type LokiEntry,
  type LokiState,
} from "../lib/loki";
import { createWriteClient } from "../lib/genlayer";

const CONTRACT = LOKI_CONTRACT_ADDRESS;

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
};

const formatRemaining = (closesAt: string) => {
  const seconds = Math.max(
    0,
    Math.floor(Number(closesAt) - Date.now() / 1000),
  );

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  return `${minutes}m ${secs}s`;
};

export default function Home() {
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [lokiId, setLokiId] = useState("loki-1");
  const [loki, setLoki] = useState<LokiState | null>(null);
  const [entry, setEntry] = useState<LokiEntry | null>(null);
  const [selectedChoice, setSelectedChoice] = useState("");
  const [entryId, setEntryId] = useState("");
  const [entries, setEntries] = useState<LokiEntry[]>([]);
  const [status, setStatus] = useState("Connect your wallet to participate.");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState("");
  const [claimed, setClaimed] = useState(false);

  const isClosed = useMemo(() => {
    if (!loki) return false;
    return Date.now() / 1000 >= Number(loki.closes_at);
  }, [loki, remaining]);

  async function connect() {
    const ethereum = window.ethereum;

    if (!ethereum) {
      setStatus("No injected wallet found. Install or enable your wallet.");
      return;
    }

    try {
      const addresses = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!addresses[0]) throw new Error("No wallet account returned.");

      setProvider(ethereum);
      setAccount(addresses[0]);
      setClaimed(false);
      setStatus(`Connected: ${addresses[0]}`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function disconnect() {
    try {
      if (provider) {
        try {
          await provider.request({
            method: "wallet_revokePermissions",
            params: [{ eth_accounts: {} }],
          });
        } catch {
          // Some injected wallets do not implement EIP-2255. Local logout
          // still disconnects this dapp session.
        }
      }
    } finally {
      setProvider(null);
      setAccount(null);
      setClaimed(false);
      setStatus("Wallet disconnected.");
    }
  }

  async function refresh(options: { silent?: boolean } = {}) {
    try {
      const result = await getLoki(lokiId);
      setLoki(result);
      await loadEntries(result);

      if (result.choices.length > 0 && !selectedChoice) {
        setSelectedChoice(result.choices[0]);
      }

      if (!options.silent) {
        setStatus(`Loaded ${lokiId}.`);
      }
    } catch (error) {
      if (!options.silent) {
        setLoki(null);
        setStatus(`Unable to load ${lokiId}: ${String(error)}`);
      }
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lokiId]);

  useEffect(() => {
    if (!loki) return;

    const update = () => {
      setRemaining(formatRemaining(loki.closes_at));
    };

    update();
    const timer = window.setInterval(update, 1000);

    return () => window.clearInterval(timer);
  }, [loki]);

  useEffect(() => {
    if (!loki) return;

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 4000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lokiId, loki?.status, loki?.closes_at]);

  async function participate() {
    if (!provider || !account) { setStatus("Connect your wallet first."); return; }
    if (!loki) { setStatus("Load a LOKI first."); return; }
    if (!selectedChoice) { setStatus("Select an option."); return; }
    if (Date.now() / 1000 >= Number(loki.closes_at)) { setStatus("This LOKI has closed."); return; }

    setBusy(true);
    try {
      const writeClient = createWriteClient(account as `0x${string}`, provider);
      setStatus(`Submitting entry for ${selectedChoice}...`);

      const receipt = await enterLoki(
        writeClient,
        loki.id,
        selectedChoice,
        BigInt(loki.entry_amount),
      );

      const createdEntryId = extractContractReturnValue(receipt);
      if (createdEntryId) {
        setEntryId(createdEntryId);
        const createdEntry = await getEntry(createdEntryId);
        setEntry(createdEntry);
        setEntries((current) => [
          ...current.filter((item) => item.id !== createdEntry.id),
          createdEntry,
        ]);
      }

      setStatus(
        `Entry confirmed. Your public choice is ${selectedChoice} and is now on-chain.`,
      );
      await refresh({ silent: true });
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadEntries(currentLoki: LokiState) {
    if (!currentLoki.entry_ids?.length) {
      setEntries([]);
      return;
    }

    const results = await Promise.all(
      currentLoki.entry_ids.map(async (id) => {
        try {
          return await getEntry(id);
        } catch {
          return null;
        }
      }),
    );

    setEntries(results.filter((item): item is LokiEntry => item !== null));
  }

  async function doClaim() {
    if (!provider || !account) {
      setStatus("Connect your wallet first.");
      return;
    }

    setBusy(true);

    try {
      const writeClient = createWriteClient(
        account as `0x${string}`,
        provider,
      );

      const receipt = await claim(writeClient);

      setClaimed(true);
      setStatus(
        `Reward claimed: ${String(receipt?.hash || receipt)}`,
      );
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <div>
          <div className="brand">LOKI</div>
          <p className="muted">
            Permissionless prediction markets powered by GenLayer.
          </p>
        </div>

        <div className="header-actions">
          {account && (
            <a className="secondary-link" href="/admin">
              Publisher dashboard
            </a>
          )}

          <button onClick={account ? disconnect : connect}>
            {account ? "Disconnect wallet" : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">PLAYER</p>
        <h1>Choose your outcome.</h1>
        <p className="hero-copy">
          Enter an open LOKI, choose publicly on-chain, and follow the verified result.
        </p>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LOKI</p>
            <h2>Open a LOKI</h2>
          </div>

          <button
            className="secondary"
            onClick={refresh}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

        <div className="lookup-row">
          <input
            value={lokiId}
            onChange={(event) => setLokiId(event.target.value)}
            placeholder="loki-1"
          />
        </div>
      </section>

      {loki && (
        <>
          <section className="card loki-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{loki.category}</p>
                <h2>{loki.title}</h2>
              </div>

              <span className={`badge ${loki.status.toLowerCase()}`}>
                {loki.status}
              </span>
            </div>

            <div className="stats">
              <div>
                <span>Participants</span>
                <strong>{loki.participant_count}</strong>
              </div>

              <div>
                <span>Entry</span>
                <strong>{loki.entry_amount}</strong>
              </div>

              <div>
                <span>Closing</span>
                <strong>
                  {loki.status === "OPEN" && !isClosed
                    ? `Closes in ${remaining}`
                    : loki.status === "OPEN"
                      ? "LOKI closed — waiting for randomness"
                      : loki.status === "RANDOMIZED"
                        ? `Randomness verified — ${loki.random_choice}`
                        : "Winners finalized"}
                </strong>
              </div>
            </div>

            <div className="choices">
              {loki.choices.map((choice) => (
                <button
                  key={choice}
                  className={
                    selectedChoice === choice ? "choice selected" : "choice"
                  }
                  disabled={isClosed || loki.status !== "OPEN" || busy}
                  onClick={() => setSelectedChoice(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>

            <div className="actions">
              <button
                onClick={participate}
                disabled={
                  busy ||
                  !account ||
                  loki.status !== "OPEN" ||
                  isClosed
                }
              >
                Enter LOKI
              </button>
            </div>
          </section>

          <section className="card">
            <p className="eyebrow">LOKI SYSTEM</p>
            <h2>Live progress</h2>
            <div className="verification">
              <div>
                <span>1. LOKI</span>
                <strong>{loki.status === "OPEN" ? "OPEN" : "CLOSED"}</strong>
              </div>
              <div>
                <span>2. Randomness</span>
                <strong>
                  {loki.status === "OPEN"
                    ? isClosed
                      ? "CLOSING — CONSENSUS PENDING"
                      : "WAITING FOR CLOSE"
                    : "VERIFIED"}
                </strong>
              </div>
              <div>
                <span>3. Random choice</span>
                <strong>{loki.random_choice || "Pending GenLayer judgment"}</strong>
              </div>
              <div>
                <span>4. Winners review</span>
                <strong>
                  {loki.status === "SETTLED"
                    ? "COMPLETE"
                    : loki.status === "RANDOMIZED"
                      ? "READY"
                      : "WAITING FOR RANDOMNESS"}
                </strong>
              </div>
              <div>
                <span>5. Winners</span>
                <strong>
                  {loki.status === "SETTLED"
                    ? `${loki.winner_count} winner(s)`
                    : "Waiting for settlement"}
                </strong>
              </div>
            </div>
            <p className="muted">
              The page checks the on-chain LOKI state every 4 seconds, so you can
              watch the transition without manually refreshing.
            </p>
          </section>

          {loki.status === "RANDOMIZED" && (
            <section className="card result-card">
              <p className="eyebrow">VERIFIED RESULT</p>
              <h2>{loki.random_choice || "Awaiting result"}</h2>

              <div className="verification">
                <div>
                  <span>Randomness</span>
                  <strong>
                    {loki.randomness_verified ? "Verified" : "Pending"}
                  </strong>
                </div>

                <div>
                  <span>Consensus digest</span>
                  <code>{loki.randomness_consensus || "—"}</code>
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ENTRIES</p>
                <h2>Public participation</h2>
              </div>
            </div>
            {entries.length === 0 ? (
              <p className="muted">No entries yet.</p>
            ) : (
              <div className="entry-list">
                {entries.map((item) => (
                  <div className="entry-result" key={item.id}>
                    <p><strong>User:</strong> <code>{item.player}</code></p>
                    <p><strong>Choice:</strong> {item.choice}</p>
                    <p><strong>Entered:</strong> {new Date(Number(item.entered_at) * 1000).toLocaleString()}</p>
                    {loki.status === "SETTLED" && (
                      <p>
                        <strong>Result:</strong>{" "}
                        {item.settlement === "NO_WINNER_SHARE"
                          ? "No winning choice — participant share"
                          : item.is_winner
                            ? "Winner"
                            : "Not selected"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {loki.status === "SETTLED" && entry && (
            entry.is_winner || entry.settlement === "NO_WINNER_SHARE"
          ) && (
            <section className="card result-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">REWARD</p>
                  <h2>{claimed ? "Reward claimed" : "Claim reward"}</h2>
                </div>
              </div>
              <p className="muted">
                {entry.settlement === "NO_WINNER_SHARE"
                  ? "There was no matching winning choice. Your share of the post-fee participant pool is available."
                  : "Your choice matched the verified random choice. Your winner reward is available."}
              </p>
              {!claimed && (
                <button onClick={doClaim} disabled={busy || !account}>
                  Claim reward
                </button>
              )}
            </section>
          )}
        </>
      )}

      <section className="card status-card">
        <p className="eyebrow">SYSTEM STATUS</p>
        <div className="status">{status}</div>
        <p className="muted">
          LOKI randomness is never generated by the frontend. The frontend
          only submits contract transactions. Randomness is resolved by the
          deployed LOKI contract using the protocol transaction seed and
          GenLayer consensus.
        </p>
      </section>

      <footer>
        <span>Studionet · Chain 61999</span>
        <code>{CONTRACT}</code>
      </footer>
    </main>
  );
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
