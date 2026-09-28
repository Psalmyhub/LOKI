"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  addQuestion,
  connectWallet,
  createQuiz,
  evaluateSubmission,
  generateSalt,
  generateAccessToken,
  hashAccessToken,
  getCurrentQuestion,
  getEvaluation,
  getNextQuizId,
  getQuestionId,
  getPlayer,
  getPlayerCount,
  getQuestion,
  getQuiz,
  publishQuiz,
  type Question,
  type Quiz,
} from "../../lib/quizambig";

type DraftQuestion = {
  text: string;
  answer: string;
  mode: "TEXT" | "NUMERIC";
  duration: string;
};

type Secret = { answer: string; salt: string };

const blankQuestion = (): DraftQuestion => ({
  text: "",
  answer: "",
  mode: "TEXT",
  duration: "60",
});

export default function MasterPage() {
  const [wallet, setWallet] = useState("");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [title, setTitle] = useState("");
  const [startDateTime, setStartDateTime] = useState("");
  const [minStartDateTime, setMinStartDateTime] = useState("");
  const [accessLink, setAccessLink] = useState("");
  const [drafts, setDrafts] = useState<DraftQuestion[]>([blankQuestion()]);
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const secretsRef = useRef<Record<string, Secret>>({});
  const evaluatedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMinStartDateTime(new Date(Date.now() + 60000).toISOString().slice(0, 16));
  }, []);

  async function connect() {
    try {
      setWallet(await connectWallet());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function updateDraft(index: number, patch: Partial<DraftQuestion>) {
    setDrafts(current => current.map((d, i) => i === index ? { ...d, ...patch } : d));
  }

  function addDraftQuestion() {
    setDrafts(current => [...current, blankQuestion()]);
  }

  function removeDraftQuestion(index: number) {
    if (drafts.length === 1) return;
    setDrafts(current => current.filter((_, i) => i !== index));
  }

  async function create() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (!title.trim()) throw new Error("Quiz title is required.");
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        const seconds = Number(d.duration);
        if (!d.text.trim()) throw new Error(`Question ${i + 1} is missing its question text.`);
        if (!d.answer.trim()) throw new Error(`Question ${i + 1} is missing its master answer.`);
        if (!Number.isInteger(seconds) || seconds < 1) throw new Error(`Question ${i + 1} needs a duration of at least 1 second.`);
      }

      const id = await getNextQuizId();
      await createQuiz(title.trim(), drafts.length);

      const secrets: Record<string, Secret> = {};
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        const salt = generateSalt();
        await addQuestion(id, d.text.trim(), d.answer.trim(), salt, d.mode, Number(d.duration));
        secrets[String(i)] = { answer: d.answer.trim(), salt };
      }

      secretsRef.current = secrets;
      sessionStorage.setItem(`quizambig:secrets:${id}`, JSON.stringify(secrets));
      setQuiz(await getQuiz(id));
      setMessage(`Quiz #${id} prepared. Publish once when every question is ready.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function publish() {
    if (!quiz) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!startDateTime) throw new Error("Choose the quiz start date and time.");
      const startTime = Math.floor(new Date(startDateTime).getTime() / 1000);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(startTime) || startTime < now) throw new Error("Quiz start time must be now or in the future.");
      const token = generateAccessToken();
      const accessCommitment = await hashAccessToken(token);
      await publishQuiz(quiz.id, startTime, accessCommitment);
      const link = `${window.location.origin}/quiz/${quiz.id}?access=${token}`;
      sessionStorage.setItem(`quizambig:access:${quiz.id}`, token);
      setAccessLink(link);
      setQuiz(await getQuiz(quiz.id));
      setMessage("Quiz committed on-chain and scheduled. Share the private link with your audience.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function automateEvaluations() {
    if (!quiz || !wallet || wallet.toLowerCase() !== quiz.master.toLowerCase()) return;
    let secrets = secretsRef.current;
    if (Object.keys(secrets).length === 0) {
      const raw = sessionStorage.getItem(`quizambig:secrets:${quiz.id}`);
      if (raw) secrets = JSON.parse(raw) as Record<string, Secret>;
      secretsRef.current = secrets;
    }

    const playerCount = await getPlayerCount(quiz.id);
    for (let index = 0; index < quiz.question_count; index++) {
      const q = await getQuestion(await getQuestionId(quiz.id, index));
      if (q.status !== "ACTIVE" && q.status !== "CLOSED") continue;
      const secret = secrets[String(index)];
      if (!secret) continue;

      for (let p = 0; p < playerCount; p++) {
        const player = (await getPlayer(quiz.id, p)) as `0x${string}`;
        const key = `${q.id}:${player.toLowerCase()}`;
        if (evaluatedRef.current.has(key)) continue;
        try {
          const existing = await getEvaluation(q.id, player);
          if (existing.status === "FINALIZED") {
            evaluatedRef.current.add(key);
            continue;
          }
        } catch {
          continue;
        }
        evaluatedRef.current.add(key);
        try {
          await evaluateSubmission(q.id, player, secret.answer, secret.salt);
        } catch {
          evaluatedRef.current.delete(key);
        }
      }
    }
  }

  useEffect(() => {
    if (!quiz || quiz.status === "DRAFT") return;
    const refreshQuiz = async () => { try { setQuiz(await getQuiz(quiz.id)); } catch {} };
    void refreshQuiz();
    const timer = window.setInterval(() => { void refreshQuiz(); }, 3000);
    return () => window.clearInterval(timer);
  }, [quiz?.id]);

  useEffect(() => {
    if (!quiz || quiz.status !== "ACTIVE" || !wallet) return;

    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Quizambig is running. Keep this browser tab open so pending GenLayer judgments can be submitted automatically.";
    };

    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [quiz, wallet]);

  useEffect(() => {
    if (!quiz || quiz.status !== "ACTIVE" || !wallet) return;
    const run = async () => {
      try {
        const current = await getCurrentQuestion(quiz.id);
        setActiveQuestion(current);
      } catch {
        // The quiz can be between scheduled questions or already completed.
      }
      try {
        await automateEvaluations();
      } catch {
        // A slow or temporarily unavailable GenLayer evaluation must never stop the quiz schedule.
      }
    };
    void run();
    const timer = window.setInterval(() => { void run(); }, 3000);
    return () => window.clearInterval(timer);
  }, [quiz, wallet]);

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

      {!quiz ? (
        <>
          <section className="hero">
            <div className="eyebrow">Quiz Master</div>
            <h1>Prepare the whole quiz once.</h1>
            <p>Add every question, its answer, and its duration. Then publish once. The blockchain schedule takes over automatically.</p>
          </section>

          <section className="card">
            <div className="field">
              <label>Quiz title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. General Knowledge" />
            </div>
            <div className="field">
              <label>Start date and time</label>
              <input type="datetime-local" value={startDateTime} min={minStartDateTime} onChange={e => setStartDateTime(e.target.value)} />
              <span className="small">Your local time. The blockchain stores the resulting UTC timestamp.</span>
            </div>
          </section>

          <section className="section">
            <div className="sectionHeading">
              <div><div className="stepLabel">Questions</div><h2>Prepare every question</h2></div>
              <span className="badge">{drafts.length} prepared</span>
            </div>

            <div className="draftList">
              {drafts.map((draft, index) => (
                <article className="card draftCard" key={index}>
                  <div className="draftHeader">
                    <div><span className="eyebrow">Question {index + 1}</span><h3>{draft.text || "New question"}</h3></div>
                    {drafts.length > 1 && <button className="iconButton" type="button" onClick={() => removeDraftQuestion(index)}>×</button>}
                  </div>

                  <div className="field">
                    <label>Question</label>
                    <textarea value={draft.text} onChange={e => updateDraft(index, { text: e.target.value })} placeholder="Write the question players will answer." />
                  </div>

                  <div className="field">
                    <label>Master answer</label>
                    <input value={draft.answer} onChange={e => updateDraft(index, { answer: e.target.value })} placeholder="Authoritative answer" />
                  </div>

                  <div className="formRow">
                    <div className="field">
                      <label>Answer mode</label>
                      <select value={draft.mode} onChange={e => updateDraft(index, { mode: e.target.value as "TEXT" | "NUMERIC" })}>
                        <option value="TEXT">TEXT</option>
                        <option value="NUMERIC">NUMERIC</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Duration (seconds)</label>
                      <input type="number" min="1" value={draft.duration} onChange={e => updateDraft(index, { duration: e.target.value })} />
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <button className="addButton" type="button" onClick={addDraftQuestion}><span className="plusIcon">+</span>Add another question</button>

            <div className="publishPanel card">
              <div>
                <div className="stepLabel">Final step</div>
                <h3>{drafts.length} questions ready</h3>
                <p className="muted">Create the complete quiz on-chain first. Then choose the start time and publish once.</p>
              </div>
              <button className="primary" disabled={busy} onClick={create}>{busy ? "Preparing…" : "Create quiz on-chain"}</button>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="quizHeader">
            <div className="eyebrow">Quiz Master · Quiz #{quiz.id}</div>
            <h1>{quiz.title}</h1>
            <div className="meta"><span className="badge">{quiz.question_count} questions</span><span className="badge">{quiz.status}</span></div>
          </section>

          {quiz.status === "DRAFT" && (
            <section className="card">
              <h2>Schedule quiz</h2>
              <p className="muted">All questions are already committed on-chain. The quiz remains scheduled until the selected start time.</p>
              <div className="field"><label>Start date and time</label><input type="datetime-local" value={startDateTime} min={minStartDateTime} onChange={e => setStartDateTime(e.target.value)} /></div>
              <button className="primary" disabled={busy} onClick={publish}>{busy ? "Scheduling…" : "Schedule and publish"}</button>
            </section>
          )}

          {accessLink && (quiz.status === "SCHEDULED" || quiz.status === "ACTIVE" || quiz.status === "COMPLETED") && (
            <section className="card"><h2>Private quiz link</h2><p className="muted">Only people with this link can open the quiz through Quizambig.</p><input readOnly value={accessLink} onFocus={e => e.currentTarget.select()} /><div className="actions"><button className="secondary" type="button" onClick={() => void navigator.clipboard.writeText(accessLink)}>Copy link</button></div></section>
          )}

          {quiz.status === "SCHEDULED" && (
            <section className="card"><h2>Quiz scheduled</h2><p className="muted">The quiz is committed on-chain and will become active at the selected time.</p><div className="badge">{new Date(quiz.start_at * 1000).toLocaleString()}</div></section>
          )}

          {quiz.status === "ACTIVE" && (
            <>
              <div className="masterKeepOpen" role="status">
                <div className="masterKeepOpenIcon">!</div>
                <div>
                  <strong>Keep this Quiz Master tab open</strong>
                  <p>
                    Quizambig uses this browser session to securely supply master answers to GenLayer
                    and process pending judgments automatically. Do not close this tab until the quiz
                    and pending judgments are finished.
                  </p>
                </div>
              </div>

              <section className="card">
              <h2>Quiz running automatically</h2>
              {activeQuestion ? (
                <>
                  <div className="meta"><span className="badge">Question {activeQuestion.index + 1}</span><span className="badge">{activeQuestion.duration}s</span><span className="badge">{activeQuestion.status}</span></div>
                  <div className="question">{activeQuestion.question_text}</div>
                  <p className="muted">No start, close, reveal, or evaluation button is required. This page automatically triggers pending GenLayer judgments as soon as submissions exist.</p>
                </>
              ) : <p className="muted">Waiting for the blockchain schedule…</p>}
              <div className="actions"><Link className="secondary" href={accessLink || `/quiz/${quiz.id}`}>Open player view</Link></div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
