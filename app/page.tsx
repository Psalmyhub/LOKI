"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { connectWallet, QUIZAMBIG_CONTRACT_ADDRESS } from "../lib/quizambig";

export default function HomePage() {
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState("");

  async function connect() {
    try {
      setError("");
      setWallet(await connectWallet());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Quizambig
        </Link>

        <div className="navRight">
          <Link className="secondary" href="/master">
            Quiz Master
          </Link>

          {wallet && (
            <span className="wallet">
              {wallet.slice(0, 6)}…{wallet.slice(-4)}
            </span>
          )}

          <button className="primary" onClick={connect}>
            {wallet ? "Wallet connected" : "Connect wallet"}
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="eyebrow">Semantic quiz · GenLayer</div>

        <h1>Answer naturally. Let GenLayer judge meaning.</h1>

        <p>
          Quizambig stores quiz state on-chain and uses GenLayer consensus for
          semantic evaluation. The frontend displays contract results; it does
          not decide correctness.
        </p>

        <div className="actions">
          <Link className="primary" href="/master">
            Create a quiz
          </Link>

          <span className="small">
            Contract: {QUIZAMBIG_CONTRACT_ADDRESS}
          </span>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="section">
        <div className="card"><h2>Private quizzes</h2><p className="muted">Quizambig does not publish a public quiz directory. A Quiz Master shares a private access link with the intended audience.</p></div>
      </section>
    </main>
  );
}
