"use client";

import { useEffect, useState } from "react";
import {
  LOKI_CONTRACT_ADDRESS,
  createWriteClient,
  extractContractReturnValue,
  ensureStudionet,
  type WalletProvider,
} from "../../lib/genlayer";
import {
  closeLoki,
  createLoki,
  getLoki,
  settleLoki,
  type LokiState,
} from "../../lib/loki";

const ADMIN_WALLET =
  "0xB41f7CcF919515a4741C7AAd43cFfCd56A20Ee31";

const DURATION_OPTIONS = [
  { label: "1 minute", seconds: 60 },
  { label: "5 minutes", seconds: 300 },
  { label: "10 minutes", seconds: 600 },
  { label: "30 minutes", seconds: 1800 },
  { label: "1 hour", seconds: 3600 },
];

type EthereumProvider = WalletProvider;

function formatRemaining(closesAt: string) {
  const seconds = Math.max(
    0,
    Math.floor(Number(closesAt) - Date.now() / 1000),
  );

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${secs}s`;
  }

  return `${minutes}m ${secs}s`;
}

export default function AdminPage() {
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [choices, setChoices] = useState("RED\nBLUE");
  const [entryAmount, setEntryAmount] = useState("1");
  const [duration, setDuration] = useState(300);

  const [lokiId, setLokiId] = useState("");
  const [loki, setLoki] = useState<LokiState | null>(null);
  const [remaining, setRemaining] = useState("");
  const [status, setStatus] = useState(
    "Connect the publisher wallet to continue.",
  );
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const [copyState, setCopyState] = useState("Copy share link");

  const authorized =
    account?.toLowerCase() === ADMIN_WALLET.toLowerCase();

  async function connect() {
    const ethereum = window.ethereum;

    if (!ethereum) {
      setStatus("No injected wallet found.");
      return;
    }

    try {
      setStatus("Connecting publisher wallet and checking GenLayer Studionet...");
      await ensureStudionet(ethereum);

      const addresses = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      const address = addresses[0];
      if (!address) throw new Error("No wallet account returned.");

      setProvider(ethereum);
      setAccount(address);

      if (address.toLowerCase() !== ADMIN_WALLET.toLowerCase()) {
        setStatus("Connected wallet is not authorized for publisher controls.");
        return;
      }

      setStatus("Publisher wallet authorized on GenLayer Studionet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
          // Some injected wallets do not implement EIP-2255.
        }
      }
    } finally {
      setProvider(null);
      setAccount(null);
      setStatus("Wallet disconnected.");
    }
  }

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? accounts[0] : undefined;
      setAccount(typeof next === "string" && next ? next : null);
      if (typeof next === "string" && next) {
        setStatus(
          next.toLowerCase() === ADMIN_WALLET.toLowerCase()
            ? "Publisher wallet authorized."
            : "Connected wallet is not authorized for publisher controls.",
        );
      } else {
        setProvider(null);
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

  async function loadLoki(id = lokiId) {
    if (!id) return;

    try {
      const result = await getLoki(id);
      setLoki(result);
      setLokiId(result.id);
      setStatus(`Loaded ${result.id}.`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  useEffect(() => {
    if (!loki) return;

    const update = () => {
      setRemaining(formatRemaining(loki.closes_at));
    };

    update();
    const timer = window.setInterval(update, 1000);

    return () => window.clearInterval(timer);
  }, [loki]);

    async function create() {
    if (!provider || !account) {
      setStatus("Connect the publisher wallet first.");
      return;
    }

    if (!authorized) {
      setStatus("This wallet is not authorized.");
      return;
    }

    const choiceList = choices
      .split("\n")
      .map((choice) => choice.trim())
      .filter(Boolean);

    if (choiceList.length < 2) {
      setStatus("At least two choices are required.");
      return;
    }

    if (!title.trim() || !category.trim()) {
      setStatus("Title and category are required.");
      return;
    }

    setBusy(true);

    try {
      const writeClient = createWriteClient(
        account as `0x${string}`,
        provider,
      );

      const closesAt =
        BigInt(Math.floor(Date.now() / 1000)) + BigInt(duration);

      setStatus("Creating LOKI...");

      const receipt = await createLoki(
        writeClient,
        title.trim(),
        category.trim(),
        choiceList,
        BigInt(entryAmount),
        closesAt,
      );

      const createdId = extractContractReturnValue(receipt);

      if (!createdId) {
        throw new Error(
          "LOKI creation finalized, but the contract return value did not contain a LOKI ID.",
        );
      }

      setLokiId(createdId);
      setStatus(`LOKI ${createdId} created. Loading state...`);

      await loadLoki(createdId);

      setStatus(`LOKI ${createdId} created and loaded successfully.`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!provider || !account || !authorized || !loki) return;

    setBusy(true);

    try {
      const writeClient = createWriteClient(
        account as `0x${string}`,
        provider,
      );

      setStatus("Submitting close_loki()...");

      await closeLoki(writeClient, loki.id);

      setStatus(
        "Closing transaction finalized. Randomness consensus completed.",
      );

      await loadLoki(loki.id);
    } catch (error) {
      setStatus(String(error));
      await loadLoki(loki.id);
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    if (!provider || !account || !authorized || !loki) return;

    setBusy(true);

    try {
      const writeClient = createWriteClient(
        account as `0x${string}`,
        provider,
      );

      setStatus("Submitting settlement...");

      await settleLoki(writeClient, loki.id);

      setStatus("Settlement finalized.");
      await loadLoki(loki.id);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  /*
   * Automatic close trigger.
   *
   * The timestamp stored by the contract remains authoritative.
   * This timer merely submits close_loki() once the deadline arrives.
   *
   * If the browser is closed, another wallet/keeper can still call
   * close_loki() after the deadline because the contract is permissionless.
   */
  useEffect(() => {
    if (!authorized || !provider || !loki) return;
    if (loki.status !== "OPEN") return;

    const check = async () => {
      if (loki.status === "OPEN") {
        if (Date.now() / 1000 < Number(loki.closes_at)) return;
        await close();
        return;
      }

      if (loki.status === "RANDOMIZED" && !loki.settled && !busy) {
        await settle();
      }
    };

    const timer = window.setInterval(() => {
      void check();
    }, 1000);

    void check();

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, provider, loki?.id, loki?.status, loki?.closes_at]);

  if (!authorized) {
    return (
      <main>
        <header className="site-header">
          <div>
            <div className="brand">LOKI</div>
            <p className="muted">Publisher dashboard</p>
          </div>

          <a className="secondary-link" href="/">
            Player page
          </a>
        </header>

        <section className="card admin-gate">
          <p className="eyebrow">PUBLISHER ACCESS</p>
          <h1>Authorized wallet required</h1>

          <p className="muted">
            Only the configured publisher wallet can use LOKI creation,
            closing, and settlement controls.
          </p>

          <button onClick={connect}>
            {account ? "Wrong wallet" : "Connect publisher wallet"}
          </button>

          {account && (
            <p className="mono muted">
              Connected: {account}
            </p>
          )}

          <div className="status">{status}</div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="site-header">
        <div>
          <div className="brand">LOKI</div>
          <p className="muted">Publisher dashboard</p>
        </div>

        <div className="header-actions">
          <a className="secondary-link" href="/">
            Player page
          </a>
          <span className="wallet-chip">Publisher authorized</span>
          <button className="secondary" onClick={disconnect}>
            Disconnect wallet
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">ADMIN</p>
        <h1>Publish and monitor LOKIs.</h1>
        <p className="hero-copy">
          The contract controls the deadline and randomness. This dashboard
          only submits authorized transactions.
        </p>
      </section>

      {published && loki && (
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PUBLISHED</p>
              <h2>LOKI PUBLISHED</h2>
            </div>
            <button className="secondary" onClick={() => void copyShareLink(loki.id)}>
              {copyState}
            </button>
          </div>
          <p className="muted">
            Your LOKI is now published and available for participants to join.
          </p>

          <div className="stack">
            <div className="admin-status">
              <div>
                <span>LOKI ID</span>
                <strong>{loki.id}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{loki.status}</strong>
              </div>
            </div>

            <div className="actions">
              <a className="secondary-link" href={shareUrl(loki.id)}>
                Open player page
              </a>
            </div>
          </div>
        </section>
      )}

      <div className="admin-grid">
        <section className="card">
          <p className="eyebrow">CREATE</p>
          <h2>Create LOKI</h2>

          <div className="stack">
            <label>
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Weekend prediction"
              />
            </label>

            <label>
              Category
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="Sports"
              />
            </label>

            <label>
              Choices — one per line
              <textarea
                value={choices}
                onChange={(event) => setChoices(event.target.value)}
              />
            </label>

            <label>
              Entry amount
              <input
                value={entryAmount}
                onChange={(event) =>
                  setEntryAmount(event.target.value)
                }
                inputMode="numeric"
              />
            </label>

            <label>
              Closing time
              <select
                value={duration}
                onChange={(event) =>
                  setDuration(Number(event.target.value))
                }
              >
                {DURATION_OPTIONS.map((option) => (
                  <option
                    key={option.seconds}
                    value={option.seconds}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button onClick={create} disabled={busy}>
              {busy ? "Processing..." : "Create LOKI"}
            </button>
          </div>
        </section>

        <section className="card">
          <p className="eyebrow">MONITOR</p>
          <h2>LOKI status</h2>

          <div className="stack">
            <label>
              LOKI ID
              <input
                value={lokiId}
                onChange={(event) => setLokiId(event.target.value)}
                placeholder="loki-1"
              />
            </label>

            <div className="actions">
              <button
                className="secondary"
                onClick={() => loadLoki()}
                disabled={!lokiId || busy}
              >
                Refresh
              </button>
            </div>

            {loki && (
              <>
                <div className="admin-status">
                  <div>
                    <span>Status</span>
                    <strong>{loki.status}</strong>
                  </div>

                  <div>
                    <span>Participants</span>
                    <strong>{loki.participant_count}</strong>
                  </div>

                  <div>
                    <span>Closing</span>
                    <strong>
                      {loki.status === "OPEN"
                        ? `in ${remaining}`
                        : loki.status === "RANDOMIZED"
                          ? "Randomness verified — settling"
                          : "Winners finalized"}
                    </strong>
                  </div>
                </div>

                <div className="actions">
                  <button
                    onClick={close}
                    disabled={
                      busy ||
                      loki.status !== "OPEN" ||
                      Date.now() / 1000 < Number(loki.closes_at)
                    }
                  >
                    Close + randomize
                  </button>

                  <button
                    className="secondary"
                    onClick={settle}
                    disabled={
                      busy ||
                      loki.status !== "RANDOMIZED" ||
                      loki.settled
                    }
                  >
                    Settle
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {loki && (
        <section className="card">
          <p className="eyebrow">LOKI SYSTEM</p>
          <h2>Close → Randomness → Winners</h2>

          <div className="verification">
            <div>
              <span>Verified</span>
              <strong>
                {loki.randomness_verified ? "YES" : "NO"}
              </strong>
            </div>

            <div>
              <span>Selected choice</span>
              <strong>{loki.random_choice || "—"}</strong>
            </div>

            <div>
              <span>Input hash</span>
              <code>{loki.randomness_input_hash || "—"}</code>
            </div>

            <div>
              <span>Entropy</span>
              <code>{loki.randomness_entropy || "—"}</code>
            </div>

            <div>
              <span>Consensus</span>
              <code>{loki.randomness_consensus || "—"}</code>
            </div>
          </div>
        </section>
      )}

      <section className="card status-card">
        <p className="eyebrow">SYSTEM STATUS</p>
        <div className="status">{status}</div>

        <p className="muted">
          The browser automatically attempts close_loki() when the on-chain
          deadline arrives. The contract itself remains authoritative and
          permissionless: if this browser is closed, another caller can
          trigger close_loki() after the deadline.
        </p>

        <p className="mono muted">
          Admin wallet: {ADMIN_WALLET}
        </p>
      </section>

      <footer>
        <span>Studionet · Chain 61999</span>
        <code>{LOKI_CONTRACT_ADDRESS}</code>
      </footer>
    </main>
  );
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
