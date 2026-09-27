"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  connectWallet,
  getEvaluation,
  getNextQuestionId,
  getPlayerStatus,
  getQuestion,
  getQuiz,
  joinQuiz,
  submitAnswer,
  QUIZAMBIG_OWNER,
  type Evaluation,
  type Question,
  type Quiz,
} from "../../../lib/quizambig";

export default function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [wallet, setWallet] = useState("");
  const [joined, setJoined] = useState(false);
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const { id } = await params;
        const quizId = Number(id);
        if (!Number.isInteger(quizId) || quizId < 1) throw new Error("Invalid quiz id.");
        const q = await getQuiz(quizId);
        setQuiz(q);
        if (window.ethereum) {
          const address = await connectWallet().catch(() => "");
          if (address) {
            setWallet(address);
            const status = await getPlayerStatus(quizId, address);
            setJoined(status.joined);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [params]);

  async function connect() {
    if (!quiz) return;
    try {
      const address = await connectWallet();
      setWallet(address);
      const status = await getPlayerStatus(quiz.id, address);
      setJoined(status.joined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function join() {
    if (!quiz) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await joinQuiz(quiz.id);
      setJoined(true);
      setQuiz({ ...quiz, status: "ACTIVE" });
      setMessage("Joined on-chain.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function loadQuestion() {
    if (!quiz) return;
    setBusy(true); setError("");
    try {
      const next = await getNextQuestionId();
      for (let id = 1; id < next; id++) {
        try {
          const q = await getQuestion(id);
          if (Number(q.quiz_id) === quiz.id && (q.status === "ACTIVE" || q.status === "PUBLISHED")) {
            setQuestion(q);
            return;
          }
        } catch {}
      }
      throw new Error("No active question is available yet. The Quiz Master must start a question.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!question || !answer.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await submitAnswer(question.id, answer.trim());
      setSubmitted(true);
      setMessage("Answer submitted on-chain. The authoritative evaluation becomes available after the question is closed and the master answer is revealed.");
      if (wallet) {
        const poll = window.setInterval(async () => {
          try {
            const result = await getEvaluation(question.id, wallet as `0x${string}`);
            setEvaluation(result);
            if (result.status === "FINALIZED") window.clearInterval(poll);
          } catch {}
        }, 5000);
        window.setTimeout(() => window.clearInterval(poll), 120000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const isQuizMaster = Boolean(wallet && quiz && wallet.toLowerCase() === quiz.master.toLowerCase());
  const isLockedOwner = Boolean(wallet && wallet.toLowerCase() === QUIZAMBIG_OWNER.toLowerCase());

  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">Quizambig</Link>
        <div className="navRight">
          {wallet && <span className="wallet">{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>}
          <button className="primary" onClick={connect}>Connect wallet</button>
        </div>
      </nav>

      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      {!quiz ? <div className="center">Loading quiz…</div> : (
        <>
          <section className="quizHeader">
            <div className="eyebrow">{quiz.status} · Quiz #{quiz.id}</div>
            <h1>{quiz.title || "Untitled quiz"}</h1>
            <div className="meta">
              <span className="badge">{quiz.question_count} questions</span>
              <span className="badge">Master {quiz.master.slice(0, 8)}…</span>
            </div>
          </section>

          <section className="card">
            {!joined && quiz.status === "PUBLISHED" && (
              <>
                <h2>Join this quiz</h2>
                <p className="muted">Your wallet will be recorded on-chain. You cannot submit until you have joined.</p>
                <button className="primary" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join quiz"}</button>
              </>
            )}

            {joined && (
              <>
                <h2>Player area</h2>
                <p className="muted">You are registered for this quiz.</p>
                <button className="secondary" disabled={busy} onClick={loadQuestion}>{busy ? "Loading…" : "Load active question"}</button>
              </>
            )}

            {question && (
              <>
                <div className="question">
                  <div className="small">Question</div>
                  {question.question_text}
                </div>
                <div className="meta">
                  <span className="badge">Question #{question.id}</span>
                  <span className="badge">{question.answer_mode}</span>
                  <span className="badge">{question.final_time}s</span>
                  <span className="badge">{question.status}</span>
                </div>
                <div className="field">
                  <label htmlFor="answer">Your answer</label>
                  <textarea id="answer" className="answerBox" value={answer} onChange={e => setAnswer(e.target.value)} disabled={submitted} />
                </div>
                <button className="primary" disabled={busy || submitted || !answer.trim()} onClick={submit}>
                  {busy ? "Submitting…" : submitted ? "Submitted" : "Submit answer"}
                </button>
              </>
            )}

            {evaluation && (
              <div className="result">
                <div className="small">Authoritative contract result</div>
                <div className="score">{evaluation.semantic_score}%</div>
                <strong>{evaluation.correct ? "Correct" : "Incorrect"}</strong>
                <span className="muted">Status: {evaluation.status}</span>
              </div>
            )}
          </section>

          {isQuizMaster && (
            <section className="section card">
              <h2>Quiz Master</h2>
              <p className="muted">This wallet is the Quiz Master recorded on-chain.</p>
            </section>
          )}

          {isLockedOwner && !isQuizMaster && (
            <p className="small">Connected wallet matches the locked deployment owner address.</p>
          )}
        </>
      )}
    </main>
  );
}
