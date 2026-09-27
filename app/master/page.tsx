"use client";

import Link from "next/link";
import { useState } from "react";
import {
  addQuestion,
  closeQuestion,
  connectWallet,
  createQuiz,
  evaluateSubmission,
  generateSalt,
  getNextQuestionId,
  getNextQuizId,
  getQuestion,
  getQuiz,
  publishQuiz,
  revealMasterAnswer,
  startQuestion,
  type Question,
  type Quiz,
} from "../../lib/quizambig";

type DraftQuestion = {
  text: string;
  answer: string;
  mode: "TEXT" | "NUMERIC";
  criteria: string;
  duration: string;
};

const blankQuestion = (): DraftQuestion => ({
  text: "",
  answer: "",
  mode: "TEXT",
  criteria: "",
  duration: "60",
});

export default function MasterPage() {
  const [wallet, setWallet] = useState("");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<DraftQuestion[]>([blankQuestion()]);
  const [q, setQ] = useState<DraftQuestion>(blankQuestion());
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [masterAnswer, setMasterAnswer] = useState("");
  const [masterSalt, setMasterSalt] = useState("");
  const [player, setPlayer] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function connect() {
    try {
      setWallet(await connectWallet());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function updateDraft(index: number, patch: Partial<DraftQuestion>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  function addDraftQuestion() {
    setDrafts((current) => [...current, blankQuestion()]);
    setMessage("New question added to the quiz plan.");
    setError("");
  }

  function removeDraftQuestion(index: number) {
    if (drafts.length === 1) return;
    setDrafts((current) => current.filter((_, i) => i !== index));
  }

  async function create() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (!title.trim()) throw new Error("Quiz title is required.");
      if (drafts.length < 1) throw new Error("Add at least one question.");

      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i];
        if (!draft.text.trim()) throw new Error(`Question ${i + 1} is missing its question text.`);
        if (!draft.answer.trim()) throw new Error(`Question ${i + 1} is missing its master answer.`);
        if (!draft.criteria.trim()) throw new Error(`Question ${i + 1} is missing evaluation criteria.`);
        const seconds = Number(draft.duration);
        if (!Number.isInteger(seconds) || seconds < 1) {
          throw new Error(`Question ${i + 1} must have a duration of at least 1 second.`);
        }
      }

      const id = await getNextQuizId();

      // The current deployed contract still requires a quiz-level duration.
      // Use the sum of prepared question durations only as compatibility data;
      // the UI treats duration as belonging to each question.
      const compatibilityDuration = drafts.reduce(
        (total, draft) => total + Number(draft.duration),
        0,
      );

      await createQuiz(title.trim(), "", drafts.length, compatibilityDuration);

      for (const draft of drafts) {
        const salt = generateSalt();
        await addQuestion(
          id,
          draft.text.trim(),
          draft.answer.trim(),
          salt,
          draft.mode,
          draft.criteria.trim(),
          Number(draft.duration),
          true,
        );
      }

      setQuiz(await getQuiz(id));
      setMessage(
        `Quiz #${id} prepared on-chain with ${drafts.length} question${drafts.length === 1 ? "" : "s"}. Review it before publishing.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadActiveQuestion() {
    if (!quiz) return;
    setBusy(true);
    setError("");
    try {
      const next = await getNextQuestionId();
      for (let id = 1; id < next; id++) {
        try {
          const candidate = await getQuestion(id);
          if (Number(candidate.quiz_id) === quiz.id) {
            setActiveQuestion(candidate);
            return;
          }
        } catch {}
      }
      throw new Error("No question found for this quiz.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function masterAction(action: "start" | "close" | "reveal" | "evaluate") {
    if (!activeQuestion) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "start") await startQuestion(activeQuestion.id);
      if (action === "close") await closeQuestion(activeQuestion.id);
      if (action === "reveal") {
        if (!masterAnswer.trim() || !masterSalt.trim()) {
          throw new Error("Master answer and original salt are required for verified reveal.");
        }
        await revealMasterAnswer(activeQuestion.id, masterAnswer, masterSalt);
      }
      if (action === "evaluate") {
        if (!player.trim()) throw new Error("Enter the player's wallet address.");
        await evaluateSubmission(activeQuestion.id, player.trim() as `0x${string}`);
      }
      await loadActiveQuestion();
      setMessage("Transaction confirmed by GenLayer.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!quiz) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await publishQuiz(quiz.id);
      setQuiz({ ...quiz, status: "PUBLISHED" });
      setMessage(
        "Quiz published on-chain. The current contract publishes all prepared questions together; sequential question publishing will follow the contract upgrade.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
            <h1>Prepare your quiz.</h1>
            <p>Build every question and its timing first. Nothing is published until you are ready.</p>
          </section>

          <section className="card">
            <div className="sectionHeading">
              <div>
                <div className="stepLabel">Quiz setup</div>
                <h2>{title || "Untitled quiz"}</h2>
              </div>
              <span className="badge">Draft</span>
            </div>

            <div className="field">
              <label>Quiz title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. General Knowledge"
              />
            </div>
          </section>

          <section className="section">
            <div className="sectionHeading">
              <div>
                <div className="stepLabel">Questions</div>
                <h2>Prepare every question</h2>
              </div>
              <span className="badge">{drafts.length} prepared</span>
            </div>

            <div className="draftList">
              {drafts.map((draft, index) => (
                <article className="card draftCard" key={index}>
                  <div className="draftHeader">
                    <div>
                      <span className="eyebrow">Question {index + 1}</span>
                      <h3>{draft.text || "New question"}</h3>
                    </div>
                    {drafts.length > 1 && (
                      <button
                        className="iconButton"
                        type="button"
                        onClick={() => removeDraftQuestion(index)}
                        aria-label={`Remove question ${index + 1}`}
                        title="Remove question"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div className="field">
                    <label>Question</label>
                    <textarea
                      value={draft.text}
                      onChange={(e) => updateDraft(index, { text: e.target.value })}
                      placeholder="Write the question players will answer."
                    />
                  </div>

                  <div className="field">
                    <label>Master answer</label>
                    <input
                      value={draft.answer}
                      onChange={(e) => updateDraft(index, { answer: e.target.value })}
                      placeholder="Authoritative answer"
                    />
                    <span className="small">
                      This is the answer committed for authoritative semantic evaluation.
                    </span>
                  </div>

                  <div className="formRow">
                    <div className="field">
                      <label>Answer mode</label>
                      <select
                        value={draft.mode}
                        onChange={(e) =>
                          updateDraft(index, { mode: e.target.value as "TEXT" | "NUMERIC" })
                        }
                      >
                        <option value="TEXT">TEXT</option>
                        <option value="NUMERIC">NUMERIC</option>
                      </select>
                    </div>

                    <div className="field">
                      <label>Duration for this question (seconds)</label>
                      <input
                        type="number"
                        min="1"
                        value={draft.duration}
                        onChange={(e) => updateDraft(index, { duration: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="field">
                    <label>Evaluation criteria</label>
                    <textarea
                      value={draft.criteria}
                      onChange={(e) => updateDraft(index, { criteria: e.target.value })}
                      placeholder="What meaning must a correct answer express?"
                    />
                  </div>

                  <div className="readyRow">
                    <span className="readyDot" />
                    <span>
                      {draft.text.trim() && draft.answer.trim() && draft.criteria.trim()
                        ? `Question ${index + 1} is ready`
                        : `Complete Question ${index + 1} before publishing`}
                    </span>
                  </div>
                </article>
              ))}
            </div>

            <button className="addButton" type="button" onClick={addDraftQuestion}>
              <span className="plusIcon">+</span>
              Add another question
            </button>

            <div className="publishPanel card">
              <div>
                <div className="stepLabel">Ready to publish?</div>
                <h3>{drafts.length} question{drafts.length === 1 ? "" : "s"} prepared</h3>
                <p className="muted">
                  Review all questions before sending the quiz configuration on-chain.
                </p>
              </div>
              <button className="primary" disabled={busy} onClick={create}>
                {busy ? "Preparing on-chain…" : "Create quiz on-chain"}
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="quizHeader">
            <div className="eyebrow">Quiz Master · Quiz #{quiz.id}</div>
            <h1>{quiz.title || "Untitled quiz"}</h1>
            <div className="meta">
              <span className="badge">{quiz.question_count} questions</span>
              <span className="badge">{quiz.status}</span>
            </div>
          </section>

          {quiz.status === "DRAFT" && (
            <section className="section card">
              <div className="sectionHeading">
                <div>
                  <div className="stepLabel">Preparation complete</div>
                  <h2>Review before publishing</h2>
                </div>
                <span className="badge">Ready</span>
              </div>
              <p className="muted">
                All prepared questions are now stored on-chain. Publishing is a normal
                contract state change and does not require semantic evaluation.
              </p>
              <button className="primary" disabled={busy} onClick={publish}>
                {busy ? "Publishing…" : "Publish quiz"}
              </button>
            </section>
          )}

          {quiz.status === "PUBLISHED" && (
            <section className="section card">
              <h2>Question control</h2>
              <p className="muted">
                Load the current question to manage its lifecycle. Question timing is
                configured per question.
              </p>
              <button className="secondary" disabled={busy} onClick={loadActiveQuestion}>
                {busy ? "Loading…" : "Load question"}
              </button>

              {activeQuestion && (
                <div className="section">
                  <div className="meta">
                    <span className="badge">Question #{activeQuestion.id}</span>
                    <span className="badge">{activeQuestion.status}</span>
                    <span className="badge">{activeQuestion.final_time}s</span>
                    {activeQuestion.answer_revealed && <span className="badge">Answer revealed</span>}
                  </div>
                  <div className="question">{activeQuestion.question_text}</div>

                  {activeQuestion.status === "PUBLISHED" && (
                    <button className="primary" disabled={busy} onClick={() => void masterAction("start")}>
                      Start question
                    </button>
                  )}

                  {activeQuestion.status === "ACTIVE" && (
                    <button className="primary" disabled={busy} onClick={() => void masterAction("close")}>
                      Close question
                    </button>
                  )}

                  {activeQuestion.status === "CLOSED" && !activeQuestion.answer_revealed && (
                    <>
                      <div className="field">
                        <label>Master answer</label>
                        <input value={masterAnswer} onChange={(e) => setMasterAnswer(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Original salt</label>
                        <input value={masterSalt} onChange={(e) => setMasterSalt(e.target.value)} />
                      </div>
                      <button className="primary" disabled={busy} onClick={() => void masterAction("reveal")}>
                        Verify & reveal answer
                      </button>
                    </>
                  )}

                  {activeQuestion.answer_revealed && (
                    <>
                      <div className="field">
                        <label>Player wallet to evaluate</label>
                        <input
                          value={player}
                          onChange={(e) => setPlayer(e.target.value)}
                          placeholder="0x…"
                        />
                      </div>
                      <button
                        className="primary"
                        disabled={busy || !player.trim()}
                        onClick={() => void masterAction("evaluate")}
                      >
                        Run GenLayer evaluation
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="actions">
                <Link className="secondary" href={"/quiz/" + quiz.id}>Open player view</Link>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
