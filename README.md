# Loki

Loki is a GenLayer-based peer-to-peer virtual prediction protocol.

## Core protocol

1. A publisher creates a LOKI with an immutable choice set and entry amount.
2. The entry amount is fixed for that LOKI once it opens.
3. Every participant must pay exactly that amount and may enter only once.
4. A participant commits their single choice onchain.
5. After the LOKI closes, choices are revealed and bound to their original commitments.
6. A GenLayer-supported randomness mechanism determines exactly one system choice.
7. GenLayer validators verify the randomness result and compare the accepted system choice with each user's committed prediction.
8. Every exact match is a winner.
9. The platform takes a 1% fee from the gross pool.
10. If there are winners, the remaining 99% is divided equally among them.
11. If there are no winners, the remaining 99% is returned equally to participants.

## Security invariants

- No admin can supply the winning choice.
- No participant can supply the winning choice.
- The frontend is never trusted for randomness or settlement.
- The choice set is fixed for the lifetime of a LOKI.
- The entry amount is fixed for the lifetime of a LOKI once participation opens.
- Each wallet can enter a LOKI only once.
- A player cannot change a committed choice.
- User participation counts must not be used as weights for the random choice.
- The platform fee is exactly 1% of the gross pool.
- Randomness must come from a verified GenLayer-supported primitive; Loki must never accept a caller-supplied random result.

## Current implementation status

The deterministic economic and commitment foundation is being built first.

The randomness boundary is intentionally blocked until the exact current GenLayer-supported application-level randomness API is verified. GenLayer documents randomness as a nondeterministic operation and distinguishes this from its protocol ECVRF seed used for validator/leader/committee selection. We will not substitute an LLM, frontend RNG, admin seed, block timestamp, or caller-provided value.

## Payment asset

The first contract skeleton uses the native payable value path. The final production payment asset (native GEN versus a supported token such as a stablecoin) must be explicitly selected before deployment.

## Development rule

Prolly is a completely separate project and is not part of Loki.
