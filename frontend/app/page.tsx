"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LOKI_CONTRACT_ADDRESS, extractContractReturnValue, ensureStudionet, type WalletProvider } from "../lib/genlayer";
import {
  enterLoki,
  getEntry,
  getLoki,
  closeLoki,
  settleLoki,
  claim,
  type LokiEntry,
  type LokiState,
} from "../lib/loki";
import { createWriteClient } from "../lib/genlayer";

const CONTRACT = LOKI_CONTRACT_ADDRESS;
const ADMIN_WALLET = "0xB41f7CcF919515a4741C7AAd43cFfCd56A20Ee31";

type EthereumProvider = WalletProvider;

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
  const [lokiId, setLokiId] = useState("");
  const [availableLokis, setAvailableLokis] = useState<LokiState[]>([]);
  const [loki, setLoki] = useState<LokiState | null>(null);
  const [entry, setEntry] = useState<LokiEntry | null>(null);
  const [selectedChoice, setSelectedChoice] = useState("");
  const [entryId, setEntryId] = useState("");
  const [entries, setEntries] = useState<LokiEntry[]>([]);
  const [status, setStatus] = useState("Connect your wallet to participate.");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [copyState, setCopyState] = useState("Copy share link");
  const [lokiFilter, setLokiFilter] = useState<"current" | "ended" | "my">("current");
  const [myLokiIds, setMyLokiIds] = useState<string[]>([]);
  const progressInFlight = useRef(false);

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
      setStatus("Connecting wallet and checking GenLayer Studionet...");
      await ensureStudionet(ethereum);
      const addresses = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      if (!addresses[0]) throw new Error("No wallet account returned.");
      setProvider(ethereum);
      setAccount(addresses[0]);
      setClaimed(false);
      setStatus(`Connected to GenLayer Studionet: ${addresses[0]}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function disconnect() {
    const activeProvider = provider;

    setProvider(null);
    setAccount(null);
    setEntry(null);
    setEntryId("");
    setClaimed(false);
    setStatus("Wallet disconnected. Connect wallet to sign in again.");

    if (activeProvider) {
      try {
        await activeProvider.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // Wallets without EIP-2255 still get a complete local dapp logout.
      }
    }
  }

  async function discoverLokis() {
    // LOKI IDs are sequential. Scan the known range and merge results so a
    // transient RPC failure never clears LOKIs already displayed to users.
    const ids = Array.from({ length: 100 }, (_, index) => `loki-${index + 1}`);
    const results = await Promise.all(ids.map(async (id) => {
      try { return await getLoki(id); } catch { return null; }
    }));
    const discovered = results.filter((item): item is LokiState => item !== null);
    const merged = new Map(availableLokis.map((item) => [item.id, item]));
    for (const item of discovered) merged.set(item.id, item);
    const published = Array.from(merged.values())
      .sort((a, b) => {
        const aOpen = a.status === "OPEN" && Number(a.closes_at) > Date.now() / 1000;
        const bOpen = b.status === "OPEN" && Number(b.closes_at) > Date.now() / 1000;
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        return Number(b.id.replace("loki-", "")) - Number(a.id.replace("loki-", ""));
      });
    setAvailableLokis(published);
    return published;
  }

  async function refreshMyLokis(published: LokiState[], wallet: string | null): Promise<string[]> {
    if (!wallet) {
      setMyLokiIds([]);
      return [];
    }

    const mine = await Promise.all(
      published.map(async (item) => {
        if (!item.entry_ids?.length) return null;

        const found = await Promise.all(
          item.entry_ids.map(async (id) => {
            try {
              const itemEntry = await getEntry(id);
              return itemEntry.player.toLowerCase() === wallet.toLowerCase();
            } catch {
              return false;
            }
          }),
        );

        return found.some(Boolean) ? item.id : null;
      }),
    );

    const ids = mine.filter((id): id is string => id !== null);
    setMyLokiIds(ids);
    return ids;
  }

  function filteredLokis() {
    const now = Date.now() / 1000;

    if (lokiFilter === "current") {
      return availableLokis.filter(
        (item) => item.status === "OPEN" && Number(item.closes_at) > now,
      );
    }

    if (lokiFilter === "ended") {
      return availableLokis.filter(
        (item) => item.status !== "OPEN" || Number(item.closes_at) <= now,
      );
    }

    return availableLokis.filter((item) => myLokiIds.includes(item.id));
  }

  async function refresh(options: { silent?: boolean } = {}) {
    if (!lokiId) {
      const published = await discoverLokis();
      await refreshMyLokis(published, account);
      const first = published.find((item) =>
        lokiFilter === "current"
          ? item.status === "OPEN" && Number(item.closes_at) > Date.now() / 1000
          : lokiFilter === "ended"
            ? item.status !== "OPEN" || Number(item.closes_at) <= Date.now() / 1000
            : myLokiIds.includes(item.id),
      );
      if (first) {
        setLokiId(first.id);
        setLoki(first);
        setSelectedChoice("");
        await loadEntries(first);
        if (!options.silent) setStatus(`Loaded ${first.id}.`);
      } else if (!options.silent) {
        setLoki(null);
        setStatus("No published LOKIs are currently available.");
      }
      return;
    }
    try {
      const result = await getLoki(lokiId);
      setLoki(result);
      await loadEntries(result);
      if (!options.silent) setStatus(`Loaded ${lokiId}.`);
    } catch (error) {
      if (!options.silent) {
        setLoki(null);
        setStatus(`Unable to load ${lokiId}: ${String(error)}`);
      }
    }
  }

  function shareUrl(id: string) {
    if (typeof window === "undefined") return `/?loki=${encodeURIComponent(id)}`;
    return `${window.location.origin}/?loki=${encodeURIComponent(id)}`;
  }

  async function copyShareLink(id: string) {
    const url = shareUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("Link copied");
      window.setTimeout(() => setCopyState("Copy share link"), 1800);
    } catch {
      setCopyState("Copy failed — copy the link from your browser");
    }
  }

  useEffect(() => {
    const sharedId = new URLSearchParams(window.location.search).get("loki");
    if (sharedId) {
      setLokiId(sharedId);
      void getLoki(sharedId).then((result) => {
        setLoki(result);
        setSelectedChoice("");
        void loadEntries(result);
      }).catch(() => {
        setStatus(`Unable to load shared ${sharedId}.`);
      });
      return;
    }

    void discoverLokis().then((published) => {
      const first = published[0];
      if (first) {
        setLokiId(first.id);
        setLoki(first);
        setSelectedChoice("");
        void loadEntries(first);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Keep discovering published LOKIs even when the page starts with none
    // loaded. This makes a newly published LOKI appear without a manual refresh.
    const timer = window.setInterval(() => {
      void (async () => {
        const published = await discoverLokis();
        await refreshMyLokis(published, account);
        await refresh({ silent: true });
      })();
    }, 4000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lokiId, loki?.status, loki?.closes_at, account, lokiFilter]);

  useEffect(() => {
    const sync = async () => {
      const published = await discoverLokis();
      await refreshMyLokis(published, account);
    };

    void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  useEffect(() => {
    if (!loki) return;

    // Player pages are read-only monitors. Connecting a wallet must never
    // submit close_loki() or settle_loki() on the user's behalf.
    // Those are state-changing transactions and therefore require an
    // explicit caller/keeper action rather than a wallet connection.
    if (loki.status === "SETTLED") {
      setStatus(
        `Winners finalized: ${loki.winner_count}. Settlement is complete.`,
      );
    } else if (loki.status === "RANDOMIZED" && loki.random_choice) {
      setStatus(
        `Randomness verified: ${loki.random_choice}. Settlement pending.`,
      );
    } else if (
      loki.status === "OPEN" &&
      Date.now() / 1000 >= Number(loki.closes_at)
    ) {
      setStatus("LOKI closed. Waiting for the permissionless close/randomness transaction.");
    }
  }, [
    loki?.status,
    loki?.random_choice,
    loki?.winner_count,
    loki?.closes_at,
  ]);

  // Detect an already-connected wallet on page load without opening a prompt
  // or submitting any transaction. This lets the publisher see the Admin link.
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    void ethereum.request({ method: "eth_accounts" }).then((value) => {
      const addresses = Array.isArray(value) ? value : [];
      const next = addresses[0];
      if (typeof next === "string" && next) {
        setProvider(ethereum);
        setAccount(next);
      }
    }).catch(() => {
      // The user can still connect explicitly using the wallet button.
    });
  }, []);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof next === "string" && next) {
        setAccount(next);
        setClaimed(false);
        setStatus(`Wallet account changed: ${next}`);
      } else {
        setProvider(null);
        setAccount(null);
        setStatus("Wallet disconnected.");
      }
    };

    const handleChainChanged = (chainId: unknown) => {
      if (String(chainId).toLowerCase() !== "0xf22f") {
        setProvider(null);
        setAccount(null);
        setStatus("Wallet network changed. Please reconnect to GenLayer Studionet (chain 61999).");
      }
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  async function selectFilter(filter: "current" | "ended" | "my") {
    setLokiFilter(filter);

    const published = await discoverLokis();
    const myIds = await refreshMyLokis(published, account);

    const now = Date.now() / 1000;
    const next = filter === "current"
      ? published.filter((item) => item.status === "OPEN" && Number(item.closes_at) > now)
      : filter === "ended"
        ? published.filter((item) => item.status !== "OPEN" || Number(item.closes_at) <= now)
        : published.filter((item) => myIds.includes(item.id));

    if (!next.length) {
      setLoki(null);
      setLokiId("");
      setSelectedChoice("");
      setStatus(
        filter === "my"
          ? "You have not entered a LOKI yet."
          : filter === "ended"
            ? "No ended LOKIs are available."
            : "No current LOKIs are available.",
      );
      return;
    }

    const nextLoki = next[0];
    setLokiId(nextLoki.id);
    setLoki(nextLoki);
    setSelectedChoice("");
    await loadEntries(nextLoki);
  }

  async function participate() {
    if (!provider || !account) { setStatus("Connect your wallet first."); return; }
    if (!loki) { setStatus("Select an available LOKI first."); return; }
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

    const loadedEntries = results.filter(
      (item): item is LokiEntry => item !== null,
    );
    setEntries(loadedEntries);

    if (account) {
      const mine = loadedEntries.find(
        (item) => item.player.toLowerCase() === account.toLowerCase(),
      );
      setEntry(mine ?? null);
      setEntryId(mine?.id ?? "");
    }
  }

  useEffect(() => {
    if (account) {
      void refresh({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

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
          {account?.toLowerCase() === ADMIN_WALLET.toLowerCase() && (
            <a className="secondary" href="/admin">Admin Dashboard</a>
          )}
          <button onClick={account ? disconnect : connect}>
            {account ? "Disconnect wallet" : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">WELCOME TO LOKI</p>
        <h1>Predict. Participate. Follow the verified outcome.</h1>
        <p className="hero-copy">
          LOKI is a permissionless prediction market powered by GenLayer.
          A publisher creates a LOKI with a fixed entry amount and a closing
          time. Participants choose one published outcome, that choice is
          recorded publicly on-chain, and GenLayer verifies the random outcome
          after the LOKI closes.
        </p>
      </section>

      <section className="card landing-card">
        <div className="landing-grid">
          <div>
            <p className="eyebrow">HOW LOKI WORKS</p>
            <h2>One simple flow.</h2>
          </div>
          <div className="landing-points">
            <p><strong>1. Enter</strong><br />Connect your wallet and choose an outcome before the deadline.</p>
            <p><strong>2. Close</strong><br />When the deadline arrives, the LOKI closes and GenLayer verifies the random outcome.</p>
            <p><strong>3. Settle</strong><br />Matching participants share the prize pool after the 1% platform fee. If nobody matches, the 99% net pool is shared by all participants.</p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PUBLISHED LOKIS</p>
            <h2>LOKI market</h2>
          </div>
          <button className="secondary" onClick={() => void refresh()} disabled={busy}>Refresh</button>
        </div>

        <div className="filter-row">
          {(["current", "ended", "my"] as const).map((filter) => (
            <button
              key={filter}
              className={lokiFilter === filter ? "secondary filter-button active" : "secondary filter-button"}
              onClick={() => void selectFilter(filter)}
            >
              {filter === "current" ? "Current LOKI" : filter === "ended" ? "Ended LOKI" : "My LOKI"}
            </button>
          ))}
        </div>

        {filteredLokis().length === 0 ? (
          <p className="muted">
            {lokiFilter === "my"
              ? "You have not entered a LOKI yet."
              : lokiFilter === "ended"
                ? "No ended LOKIs are available."
                : "No current LOKIs are available."}
          </p>
        ) : (
          <div className="choices">
            {filteredLokis().map((item) => (
              <button key={item.id} className={lokiId === item.id ? "choice selected" : "choice"} onClick={() => {
                setLokiId(item.id);
                setLoki(item);
                setSelectedChoice("");
                void loadEntries(item);
              }}>
                <strong>{item.title}</strong>
                <span>{item.category} · {item.id} · {item.status} · {item.participant_count} participant(s)</span>
              </button>
            ))}
          </div>
        )}
        <p className="muted">Published LOKIs remain visible after closing and settlement. Only OPEN LOKIs can accept new entries; finalized LOKIs remain viewable while newer LOKIs are published.</p>
      </section>

      {loki && (
        <>
          <section className="card loki-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{loki.category}</p>
                <h2>{loki.title}</h2>
              </div>

              <div className="header-actions">
                <span className={`badge ${loki.status.toLowerCase()}`}>
                  {loki.status}
                </span>
                <button
                  className="secondary"
                  onClick={() => void copyShareLink(loki.id)}
                >
                  {copyState}
                </button>
              </div>
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

            {!selectedChoice && !isClosed && loki.status === "OPEN" && (
              <div className="choice-prompt">
                Choose one of the published outcomes below before submitting your entry.
                Your selected choice will be recorded publicly on-chain.
              </div>
            )}

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
                  !selectedChoice ||
                  loki.status !== "OPEN" ||
                  isClosed
                }
              >
                {selectedChoice ? "Enter LOKI" : "Choose an outcome first"}
              </button>
            </div>
          </section>

          <section className="card">
            <p className="eyebrow">LOKI SYSTEM</p>
            <h2>Live progress</h2>
            <div className="current-state">
              <span>Current state</span>
              <strong>
                {loki.status === "OPEN" && !isClosed
                  ? `OPEN — accepting entries · closes in ${remaining}`
                  : loki.status === "OPEN"
                    ? "CLOSED — randomness pending"
                    : loki.status === "RANDOMIZED"
                      ? `RANDOMNESS VERIFIED — ${loki.random_choice}`
                      : `SETTLED — ${loki.winner_count} winner(s)`}
              </strong>
            </div>
            <p className="muted">
              Only the state the LOKI is currently in is displayed. The next state
              appears only after the on-chain state reaches it.
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
