# Quizambig

Quizambig is a free semantic quiz platform built on GenLayer.

## Core architecture

Quizambig deliberately separates ordinary quiz operations from AI judgment.

### Frontend + blockchain

The frontend orchestrates normal blockchain transactions for:
- creating a quiz;
- preparing all questions;
- storing one master-answer commitment per question;
- storing a duration for every question;
- publishing the complete quiz once;
- automatically following the blockchain question schedule;
- recording player submissions and submission speed;
- refreshing leaderboard data.

The Quiz Master does not manually publish, start, close, reveal, or evaluate individual questions.

### GenLayer

GenLayer is used only to judge answers.

It receives the master answer and the player's answer and applies an Equivalence Principle: the answer is judged by equivalent meaning or principle, not by exact wording.

There is no frontend answer-criteria field.

GenLayer correctness is separate from speed. Submission time is recorded by the blockchain; GenLayer does not decide speed or leaderboard ordering.

## Automatic question schedule

Publishing records one blockchain start timestamp.

Each question has its own immutable duration. The contract derives the active question from blockchain time:

Q1 → duration 1  
Q2 → duration 2  
Q3 → duration 3  
…  

The frontend automatically changes to the next question when its scheduled time arrives.

A slow GenLayer judgment never blocks the quiz. A submission can remain pending while players continue to the next question.

## Leaderboard

After each question, the frontend displays the leaderboard.

Ordering is based on deterministic facts:
1. correct answers first;
2. faster submission time breaks ties.

If GenLayer has not finished judging an answer, the player appears as Judging… and the leaderboard refreshes when the authoritative judgment arrives.

## Answer protection

Master answers are committed with SHA-256 and are not exposed as plaintext during the active question.

The current automation implementation retains the master answer and salt in the Quiz Master's browser session so the Quiz Master frontend can automatically trigger post-question GenLayer evaluations. This means the Quiz Master automation page needs to remain open during the quiz.

## Current deployment note

The source contract now contains the automatic lifecycle and new evaluation interface. The existing deployed contract address must be replaced with a deployment of this updated contract before the new frontend can operate against it.

## Project layout

- contracts/ — GenLayer Intelligent Contract
- app/ — Next.js frontend
- lib/ — blockchain client helpers
- tests/ — contract tests
- docs/ — technical specification
