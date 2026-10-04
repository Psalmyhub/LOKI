# LOKI

LOKI is a GenLayer-based public-choice prediction protocol.

## Core protocol

1. A publisher creates a LOKI with a fixed title, category, published choice set, fixed entry amount, and closing time.
2. The LOKI opens immediately for public participation.
3. Each wallet can enter once and must pay exactly the fixed entry amount.
4. A participant selects one published choice and that choice is stored publicly on-chain with their wallet and entry timestamp.
5. There is no commit/reveal flow and participants are never asked to reveal their choice later.
6. After the closing time, `close_loki()` verifies the deadline and atomically starts protocol transaction-bound randomness.
7. GenLayer consensus verifies the random selection. The random result is always one of the LOKI's published choices.
8. Every participant whose stored choice matches the verified random choice is a winner.
9. The platform takes exactly a 1% fee from the gross pool.
10. If there are winners, the remaining 99% is divided equally among all winners.
11. If there are no winners, the remaining 99% is divided equally among all participants as `NO_WINNER_SHARE`.
12. Participants claim their recorded settlement through `claim()`.

## Security invariants

- No participant can supply the winning choice.
- The frontend is never trusted for randomness or settlement.
- The published choice set is fixed for the lifetime of a LOKI.
- The entry amount is fixed for the lifetime of a LOKI.
- Each wallet can enter a LOKI only once.
- A player cannot change a stored public choice.
- Random selection is over the published choices, not over participant wallets.
- The platform fee is exactly 1% of the gross pool.
- Randomness uses the protocol transaction seed and GenLayer consensus; the frontend never supplies randomness.
- `resolve_randomness()` is a compatibility endpoint that deliberately rejects caller-driven randomness; randomness is performed atomically by `close_loki()`.

## Current network

- Studionet chain ID: `61999`
- RPC: `https://studio.genlayer.com/api`
- Active deployed LOKI contract: `0x8bbC34e492b5f9c3DA16Eb49ecbd2a99268F368F`
- Publisher wallet configured by the frontend: `0xB41f7CcF919515a4741C7AAd43cFfCd56A20Ee31`

## Important deployment note

The deployed contract address above is immutable. If contract logic is changed, a new deployment is required and the frontend must be pointed to the new address.

## Payment asset

LOKI currently uses the native payable value path exposed by the GenLayer contract.

## Project separation

LOKI is separate from Prolly and must not share contract, frontend, or deployment assumptions with Prolly.
