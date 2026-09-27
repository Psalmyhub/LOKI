# Quizambig — Automatic Quiz Lifecycle

Quizambig separates ordinary blockchain quiz operations from GenLayer semantic judgment.

## Quiz Master workflow

The Quiz Master:
1. enters the quiz title;
2. prepares all questions before publishing;
3. supplies one master answer for each question;
4. chooses TEXT or NUMERIC mode;
5. chooses a duration for each question;
6. publishes the complete quiz once.

There is no per-question publish, start, close, reveal, or evaluate button.

## Blockchain responsibility

Normal deterministic contract logic owns:
- quiz creation;
- question storage;
- per-question durations;
- the single publish timestamp;
- automatic question schedule;
- player registration;
- answer submissions;
- submission timestamps and response times;
- leaderboard facts.

The current question is derived from blockchain time and the stored cumulative durations. Q1 starts at publish time; Q2 starts after Q1 duration; Q3 starts after Q1 + Q2 durations; and so on.

The frontend continuously reads the current question and automatically moves the player interface to the next question when the blockchain schedule changes. The contract rejects submissions for questions that are not currently active.

## GenLayer responsibility

GenLayer is used only for semantic answer judgment.

It receives:
- the Quiz Master's master answer;
- the player's answer;
- the answer mode.

There is no Quiz Master evaluation-criteria field.

The evaluator applies the Equivalence Principle: it judges whether the player's answer expresses the same essential meaning or principle as the master answer, rather than requiring identical wording.

Equivalent wording, synonyms, grammar differences, different sentence structure, and equivalent numeric forms may be accepted. Contradictory, irrelevant, or materially different meaning should be rejected.

Speed is never used as a reason for semantic correctness.

TEXT answers use the 60% semantic-score boundary. NUMERIC answers use the 90% semantic-score boundary.

## Asynchronous judging

GenLayer evaluation is asynchronous from the quiz schedule.

A question ending does not wait for GenLayer. The frontend can immediately move players to the next scheduled question while prior submissions remain pending.

The Quiz Master frontend automatically triggers pending evaluations as soon as a submission exists using the locally retained master answer/salt needed to verify the commitment.

Leaderboard rows therefore support a Judging… state. Once GenLayer finalizes a judgment, the leaderboard refreshes without interrupting the current question.

## Leaderboard

Leaderboard ordering is deterministic from recorded facts:
1. correct answers are ranked ahead of incorrect answers;
2. among players with the same correctness state, faster submission time ranks ahead.

The contract records submission time and response time. GenLayer supplies only the semantic correctness judgment.

Pending GenLayer judgments never block question progression.

## Answer protection

The contract stores a SHA-256 commitment for each master answer. The Quiz Master frontend retains the answer and salt locally so it can automatically trigger asynchronous evaluation.

The current architecture therefore requires the Quiz Master automation page to remain available during the quiz for autonomous evaluation triggering. This is an orchestration requirement, not a GenLayer requirement.

## Phase status

Implemented in source:
- automatic time-derived question progression;
- one-time quiz publication;
- per-question duration;
- no answer-criteria field;
- GenLayer-only semantic judgment;
- asynchronous pending evaluation;
- submission speed recording;
- leaderboard data retrieval.

The new contract source must be deployed before the existing contract address can expose these new methods.
