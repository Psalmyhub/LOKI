"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  connectWallet,
  getEvaluation,
  getPlayer,
  getPlayerCount,
  getPlayerStatus,
  getQuestion,
  getQuestionId,
  getCurrentQuestion,
  getQuiz,
  joinQuiz,
  submitAnswer,
  type Evaluation,
  type Question,
  type Quiz,
} from "../../../lib/quizambig";

type Row = {
  player: string;
  correct: boolean;
  pending: boolean;
  response: number;
};

export default function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [wallet, setWallet] = useState("");
  const [joined, setJoined] = useState(false);
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [leaderboard, setLeaderboard] = useState<Row[]>([]);
  const [leaderboardQuestion, setLeaderboardQuestion] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const { id } = await params;
        const quizId = Number(id);
        if (!Number.isInteger(quizId) || quizId < 1) throw new Error("Invalid quiz id.");
        const q = await getQuiz(quizId);
        setQuiz(q);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [params]);

  useEffect(() => {
    if (!quiz) return;
    const timer = window.setInterval(() => {
      setSecondsLeft(value => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [quiz]);

  async function refreshWalletStatus() {
    if (!quiz || !wallet) return;
    try {
      const status = await getPlayerStatus(quiz.id, wallet as `0x${string}`);
      setJoined(status.joined);
    } catch {}
  }

  async function refreshQuestion() {
    if (!quiz) return null;
    try {
      const q = await getCurrentQuestion(quiz.id);
      setQuestion(previous => {
        if (previous?.id !== q.id) {
          setAnswer("");
          setSubmitted(false);
          setEvaluation(null);
        }
        return q;
      });
      setSecondsLeft(Math.max(0, q.deadline - Math.floor(Date.now() / 1000)));
      return q;
    } catch {
      setQuestion(null);
      return null;
    }
  }

  async function refreshLeaderboard(target: Question) {
    if (!quiz) return;
    const count = await getPlayerCount(quiz.id);
    const rows: Row[] = [];

    for (let i = 0; i < count; i++) {
      const player = (await getPlayer(quiz.id, i)) as `0x${string}`;
      try {
        const result = await getEvaluation(target.id, player);
        rows.push({
          player,
          correct: result.correct,
          pending: result.status !== "FINALIZED",
          response: result.response_time_seconds,
        });
      } catch {
        // Players who have not submitted this question are not leaderboard rows.
      }
    }

    rows.sort((a, b) => {
      if (a.pending !== b.pending && a.pending) return 1;
      if (a.pending !== b.pending && b.pending) return -1;
      if (a.correct !== b.correct) return a.correct ? -1 : 1;
      return a.response - b.response;
    });

    setLeaderboard(rows);
    setLeaderboardQuestion(target);
  }

  async function refreshEvaluation(target: Question) {
    if (!wallet) return;
    try {
      const result = await getEvaluation(target.id, wallet as `0x${string}`);
      setEvaluation(result);
      setSubmitted(true);
    } catch {}
  }

  async function refresh() {
    if (!quiz) return;
    const current = await refreshQuestion();
    if (!current) {
      const completedIndex = quiz.question_count - 1;
      if (quiz.status === "COMPLETED" && completedIndex >= 0) {
        try {
          const finalQuestion = await getQuestion(await getQuestionId(quiz.id, completedIndex));
          await refreshLeaderboard(finalQuestion);
          if (wallet) await refreshEvaluation(finalQuestion);
        } catch {}
      }
      return;
    }

    const leaderboardIndex = Math.max(0, current.index - 1);
    try {
      const targetId = await getQuestionId(quiz.id, leaderboardIndex);
      const target = await getQuestion(targetId);
      await refreshLeaderboard(target);
      if (target.id === current.id) await refreshEvaluation(current);
    } catch {}
  }

  useEffect(() => {
    if (!quiz) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [quiz, wallet]);

  async function connect() {
    try {
      const address = await connectWallet();
      setWallet(address);
      if (quiz) {
        const status = await getPlayerStatus(quiz.id, address);
        setJoined(status.joined);
      }
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
      setMessage("Joined on-chain.");
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
      setAnswer("");
      setMessage("Answer recorded. The next scheduled question does not wait for GenLayer.");
      await refreshEvaluation(question);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const isQuestionOpen = Boolean(question && secondsLeft > 0);
  const myRow = useMemo(
    () => leaderboard.find(r => r.player.toLowerCase() === wallet.toLowerCase()),
    [leaderboard, wallet],
  );

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
            <h1>{quiz.title}</h1>
            <div className="meta">
              <span className="badge">{quiz.question_count} questions</span>
              {question && <span className="badge">Question {question.index + 1}</span>}
            </div>
          </section>

          {!joined && quiz.status === "ACTIVE" && (
            <section className="card">
              <h2>Join this quiz</h2>
              <p className="muted">Join once. The blockchain schedule controls every question automatically.</p>
              <button className="primary" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join quiz"}</button>
            </section>
          )}

          {joined && question && (
            <section className="card">
              <div className="meta">
                <span className="badge">Question {question.index + 1}</span>
                <span className="badge">{question.duration}s</span>
                <span className="badge">{question.answer_mode}</span>
              </div>
              <div className="timer">{secondsLeft}s</div>
              <div className="question">{question.question_text}</div>
              <div className="field">
                <label htmlFor="answer">Your answer</label>
                <textarea
                  id="answer"
                  className="answerBox"
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  disabled={!isQuestionOpen || submitted}
                />
              </div>
              <button className="primary" disabled={busy || !isQuestionOpen || submitted || !answer.trim()} onClick={submit}>
                {submitted ? "Submitted" : busy ? "Submitting…" : "Submit answer"}
              </button>
              {evaluation && evaluation.question_id === question.id && (
                <div className="result">
                  <div className="small">GenLayer judgment</div>
                  <div className="score">{evaluation.correct ? "Correct" : "Incorrect"}</div>
                  <span className="muted">Semantic score: {evaluation.semantic_score}% · response: {evaluation.response_time_seconds}s</span>
                </div>
              )}
            </section>
          )}

          {joined && !question && quiz.status === "COMPLETED" && (
            <section className="card">
              <h2>Quiz complete</h2>
              <p className="muted">Final GenLayer judgments may continue arriving after the quiz has ended.</p>
            </section>
          )}

          {joined && (
            <section className="section card">
              <div className="sectionHeading">
                <div>
                  <div className="stepLabel">Leaderboard</div>
                  <h2>{leaderboardQuestion ? `Question ${leaderboardQuestion.index + 1} results` : "Results"}</h2>
                </div>
                {myRow && <span className="badge">{myRow.pending ? "Judging…" : myRow.correct ? "Correct" : "Incorrect"}</span>}
              </div>
              <p className="muted">
                {leaderboardQuestion && question && leaderboardQuestion.id !== question.id
                  ? `Question ${leaderboardQuestion.index + 1} is the latest completed question. Results continue updating while the next question is active.`
                  : "Correct answers are ordered first; faster submission time breaks ties. Pending GenLayer judgments never stop the quiz."}
              </p>
              {leaderboard.length === 0 ? <p className="muted">Waiting for submissions…</p> : (
                <div className="draftList">
                  {leaderboard.map((row, index) => (
                    <div className="card" key={row.player}>
                      <div className="sectionHeading">
                        <strong>#{index + 1} {row.player.slice(0, 8)}…{row.player.slice(-6)}</strong>
                        <span className="badge">{row.pending ? "Judging…" : row.correct ? "Correct" : "Incorrect"}</span>
                      </div>
                      <span className="muted">{row.pending ? "GenLayer review pending" : `${row.response}s response time`}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {wallet && quiz && wallet.toLowerCase() === quiz.master.toLowerCase() && (
            <p className="small">Quiz Master automation is running while this page is open. It does not control question timing or player progression.</p>
          )}
        </>
      )}
    </main>
  );
}
