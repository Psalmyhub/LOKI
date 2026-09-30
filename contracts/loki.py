# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json

from genlayer import *


PLATFORM_FEE_BPS = 100
BPS_DENOMINATOR = 10_000
MIN_CHOICES = 2
MAX_CHOICES = 64
MAX_LABEL_LENGTH = 120


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _text(value: str, name: str, maximum: int = MAX_LABEL_LENGTH) -> str:
    if not isinstance(value, str):
        raise gl.vm.UserError(f"[EXPECTED] {name} must be text")
    if not value.strip() or "\x00" in value or len(value) > maximum:
        raise gl.vm.UserError(f"[EXPECTED] invalid {name}")
    return value.strip()


def _choices(value: list[str]) -> list[str]:
    if not isinstance(value, list) or not MIN_CHOICES <= len(value) <= MAX_CHOICES:
        raise gl.vm.UserError("[EXPECTED] choices must contain 2..64 options")

    normalized: list[str] = []
    seen: set[str] = set()

    for choice in value:
        item = _text(choice, "choice")
        key = item.casefold()
        if key in seen:
            raise gl.vm.UserError("[EXPECTED] choices must be unique")
        seen.add(key)
        normalized.append(item)

    return normalized


class Loki(gl.Contract):
    lokis: TreeMap[str, str]
    loki_ids: DynArray[str]
    entries: TreeMap[str, str]
    entry_ids: DynArray[str]
    next_loki_id: u256
    next_entry_id: u256
    platform_fees: u256
    claimable: TreeMap[Address, u256]

    def __init__(self):
        self.next_loki_id = u256(1)
        self.next_entry_id = u256(1)
        self.platform_fees = u256(0)

    def _loki(self, loki_id: str) -> dict:
        if loki_id not in self.lokis:
            raise gl.vm.UserError("[EXPECTED] LOKI not found")
        return json.loads(self.lokis[loki_id])

    def _entry(self, entry_id: str) -> dict:
        if entry_id not in self.entries:
            raise gl.vm.UserError("[EXPECTED] entry not found")
        return json.loads(self.entries[entry_id])

    def _save_loki(self, loki: dict) -> None:
        self.lokis[loki["id"]] = _json(loki)

    def _save_entry(self, entry: dict) -> None:
        self.entries[entry["id"]] = _json(entry)

    def _choice_exists(self, loki: dict, choice: str) -> bool:
        key = choice.casefold()
        return any(item.casefold() == key for item in loki["choices"])

    def _gross_pool(self, loki: dict) -> int:
        return int(loki["entry_amount"]) * int(loki["participant_count"])

    def _fee(self, gross_pool: int) -> int:
        return gross_pool * PLATFORM_FEE_BPS // BPS_DENOMINATOR

    @gl.public.write
    def create_loki(
        self,
        title: str,
        category: str,
        choices: list[str],
        entry_amount: u256,
        closes_at: u256,
    ) -> str:
        title = _text(title, "title")
        category = _text(category, "category")
        choices = _choices(choices)

        amount = int(entry_amount)
        if amount <= 0:
            raise gl.vm.UserError("[EXPECTED] entry amount must be greater than zero")

        now = int(gl.message_raw["datetime"])
        close_time = int(closes_at)
        if close_time <= now:
            raise gl.vm.UserError("[EXPECTED] closing time must be in the future")

        loki_id = "loki-" + str(int(self.next_loki_id))
        self.next_loki_id = u256(int(self.next_loki_id) + 1)

        loki = {
            "id": loki_id,
            "publisher": str(gl.message.sender_address),
            "title": title,
            "category": category,
            "choices": choices,
            "entry_amount": str(amount),
            "closes_at": str(close_time),
            "status": "OPEN",
            "participant_count": "0",
            "total_pool": "0",
            "random_choice": "",
            "randomness_verified": False,
            "randomness_input_hash": "",
            "randomness_entropy": "",
            "randomness_consensus": "",
            "winner_count": "0",
            "platform_fee": "0",
            "prize_pool": "0",
            "refund_pool": "0",
            "settled": False,
        }

        self._save_loki(loki)
        self.loki_ids.append(loki_id)
        return loki_id

    @gl.public.write.payable
    def enter_loki(self, loki_id: str, choice_commitment: str) -> str:
        loki = self._loki(loki_id)

        if loki["status"] != "OPEN":
            raise gl.vm.UserError("[EXPECTED] LOKI is not open")

        if int(gl.message_raw["datetime"]) >= int(loki["closes_at"]):
            raise gl.vm.UserError("[EXPECTED] LOKI is closed")

        payment = int(gl.message.value)
        if payment != int(loki["entry_amount"]):
            raise gl.vm.UserError("[EXPECTED] exact entry amount is required")

        sender = str(gl.message.sender_address)

        for entry_id in loki["entry_ids"] if "entry_ids" in loki else []:
            entry = self._entry(entry_id)
            if entry["player"].lower() == sender.lower():
                raise gl.vm.UserError("[EXPECTED] wallet already entered this LOKI")

        if not isinstance(choice_commitment, str) or len(choice_commitment) != 64:
            raise gl.vm.UserError("[EXPECTED] commitment must be a SHA-256 digest")

        entry_id = "entry-" + str(int(self.next_entry_id))
        self.next_entry_id = u256(int(self.next_entry_id) + 1)

        entry = {
            "id": entry_id,
            "loki_id": loki_id,
            "player": sender,
            "commitment": choice_commitment.lower(),
            "choice": "",
            "revealed": False,
            "is_winner": False,
            "settlement": "PENDING",
        }

        self._save_entry(entry)
        self.entry_ids.append(entry_id)

        loki["participant_count"] = str(int(loki["participant_count"]) + 1)
        loki["total_pool"] = str(self._gross_pool(loki))
        loki.setdefault("entry_ids", []).append(entry_id)
        self._save_loki(loki)

        return entry_id

    @gl.public.write
    def reveal_choice(self, entry_id: str, choice: str, nonce: str) -> None:
        entry = self._entry(entry_id)
        loki = self._loki(entry["loki_id"])

        if entry["player"].lower() != str(gl.message.sender_address).lower():
            raise gl.vm.UserError("[EXPECTED] only the player can reveal")

        if loki["status"] != "CLOSED":
            raise gl.vm.UserError("[EXPECTED] LOKI must be closed before reveal")

        if entry["revealed"]:
            raise gl.vm.UserError("[EXPECTED] choice already revealed")

        choice = _text(choice, "choice")
        nonce = _text(nonce, "nonce", 256)

        if not self._choice_exists(loki, choice):
            raise gl.vm.UserError("[EXPECTED] choice is not in the published set")

        expected = _digest(_json({
            "version": "loki-v1",
            "loki_id": entry["loki_id"],
            "player": entry["player"].lower(),
            "choice": choice,
            "nonce": nonce,
        }))

        if expected != entry["commitment"]:
            raise gl.vm.UserError("[EXPECTED] reveal does not match commitment")

        entry["choice"] = choice
        entry["revealed"] = True
        self._save_entry(entry)

    def _randomness_input_hash(self, loki: dict) -> str:
        snapshot = []
        for entry_id in loki.get("entry_ids", []):
            entry = self._entry(entry_id)
            snapshot.append({
                "id": entry["id"],
                "player": entry["player"].lower(),
                "commitment": entry["commitment"],
            })

        payload = {
            "version": "loki-random-v1",
            "loki_id": loki["id"],
            "choices": loki["choices"],
            "entry_amount": loki["entry_amount"],
            "closes_at": loki["closes_at"],
            "participant_count": loki["participant_count"],
            "entries": snapshot,
        }
        return _digest(_json(payload))

    @gl.public.write
    def close_loki(self, loki_id: str) -> None:
        loki = self._loki(loki_id)

        if loki["status"] != "OPEN":
            raise gl.vm.UserError("[EXPECTED] LOKI is not open")

        if int(gl.message_raw["datetime"]) < int(loki["closes_at"]):
            raise gl.vm.UserError("[EXPECTED] closing time has not arrived")

        # Freeze the complete game snapshot BEFORE randomness is sampled.
        # The caller/finalizer is intentionally excluded from this snapshot.
        loki["randomness_input_hash"] = self._randomness_input_hash(loki)
        randomness_input_hash = loki["randomness_input_hash"]
        choices = list(loki["choices"])

        def get_transaction_seed() -> bytes:
            # GenLayer documents stdin as a transaction-bound seed source.
            # It is read inside the nondeterministic block so every validator
            # evaluates the same transaction-specific entropy independently.
            import os

            stream = os.fdopen(0, "rb", buffering=0, closefd=False)
            stream.seek(0)
            digest = hashlib.sha256()
            while True:
                chunk = stream.read(8192)
                if not chunk:
                    return digest.digest()
                digest.update(chunk)

        def leader_fn() -> dict:
            seed = get_transaction_seed()
            material = (
                b"LOKI/randomness/v1|"
                + randomness_input_hash.encode("utf-8")
                + b"|"
                + seed
            )
            digest = hashlib.sha256(material).hexdigest()
            index = int(digest, 16) % len(choices)
            return {
                "version": "loki-random-v1",
                "input_hash": randomness_input_hash,
                "seed_hash": hashlib.sha256(seed).hexdigest(),
                "digest": digest,
                "index": index,
                "choice": choices[index],
            }

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False

            proposed = leader_result.calldata
            if not isinstance(proposed, dict):
                return False
            if proposed.get("version") != "loki-random-v1":
                return False
            if proposed.get("input_hash") != randomness_input_hash:
                return False

            seed = get_transaction_seed()
            material = (
                b"LOKI/randomness/v1|"
                + randomness_input_hash.encode("utf-8")
                + b"|"
                + seed
            )
            digest = hashlib.sha256(material).hexdigest()
            index = int(digest, 16) % len(choices)

            # The validator independently derives the candidate from the same
            # immutable transaction seed and frozen game snapshot. It does not
            # merely accept the leader's proposed winner.
            return (
                proposed.get("seed_hash") == hashlib.sha256(seed).hexdigest()
                and proposed.get("digest") == digest
                and proposed.get("index") == index
                and proposed.get("choice") == choices[index]
            )

        result = gl.vm.run_nondet(leader_fn, validator_fn)

        if not isinstance(result, dict):
            raise gl.vm.UserError("[EXPECTED] randomness consensus failed")

        # Only the consensus-agreed result crosses back into deterministic
        # execution. The finalizer cannot supply or alter any randomness input.
        loki["random_choice"] = result["choice"]
        loki["randomness_entropy"] = result["seed_hash"]
        loki["randomness_consensus"] = result["digest"]
        loki["randomness_verified"] = True
        loki["status"] = "RANDOMIZED"
        self._save_loki(loki)

    @gl.public.write
    def resolve_randomness(self, loki_id: str) -> None:
        # Randomness is deliberately resolved during close_loki, using the
        # close transaction's immutable transaction-bound seed. A later
        # finalizer must never receive a second chance to supply/grind entropy.
        loki = self._loki(loki_id)

        if loki["status"] == "RANDOMIZED":
            raise gl.vm.UserError("[EXPECTED] randomness already resolved")

        raise gl.vm.UserError(
            "[EXPECTED] randomness resolves atomically with close_loki; "
            "caller-supplied randomness is forbidden"
        )

    @gl.public.write
    def settle_loki(self, loki_id: str) -> None:
        loki = self._loki(loki_id)

        if loki["status"] != "RANDOMIZED":
            raise gl.vm.UserError("[EXPECTED] accepted randomness is required")

        if loki["settled"]:
            raise gl.vm.UserError("[EXPECTED] LOKI already settled")

        if not loki["randomness_verified"]:
            raise gl.vm.UserError("[EXPECTED] randomness is not verified")

        winners: list[str] = []

        for entry_id in loki.get("entry_ids", []):
            entry = self._entry(entry_id)
            if not entry["revealed"]:
                entry["settlement"] = "REFUND"
                self._save_entry(entry)
                continue

            entry["is_winner"] = (
                entry["choice"].casefold() == loki["random_choice"].casefold()
            )
            if entry["is_winner"]:
                winners.append(entry_id)

            self._save_entry(entry)

        gross = self._gross_pool(loki)
        fee = self._fee(gross)
        distributable = gross - fee

        loki["platform_fee"] = str(fee)
        loki["winner_count"] = str(len(winners))
        loki["prize_pool"] = str(distributable if winners else 0)
        loki["refund_pool"] = str(distributable if not winners else 0)

        if winners:
            share = distributable // len(winners)
            remainder = distributable - share * len(winners)

            for index, entry_id in enumerate(winners):
                entry = self._entry(entry_id)
                amount = share + (remainder if index == 0 else 0)
                account = Address(entry["player"])
                current = int(self.claimable[account]) if account in self.claimable else 0
                self.claimable[account] = u256(current + amount)
                entry["settlement"] = "WIN"
                self._save_entry(entry)
        else:
            participants = []
            for entry_id in loki.get("entry_ids", []):
                entry = self._entry(entry_id)
                participants.append(entry)

            if participants:
                refund_share = distributable // len(participants)
                remainder = distributable - refund_share * len(participants)

                for index, entry in enumerate(participants):
                    amount = refund_share + (remainder if index == 0 else 0)
                    account = Address(entry["player"])
                    current = int(self.claimable[account]) if account in self.claimable else 0
                    self.claimable[account] = u256(current + amount)
                    entry["settlement"] = "REFUND"
                    self._save_entry(entry)

        self.platform_fees = u256(int(self.platform_fees) + fee)
        loki["settled"] = True
        loki["status"] = "SETTLED"
        self._save_loki(loki)

    @gl.public.write
    def claim(self) -> u256:
        account = gl.message.sender_address
        amount = int(self.claimable[account]) if account in self.claimable else 0
        if amount <= 0:
            raise gl.vm.UserError("[EXPECTED] nothing to claim")

        self.claimable[account] = u256(0)
        gl.message.transfer(account, amount)
        return u256(amount)

    @gl.public.view
    def get_loki(self, loki_id: str) -> dict:
        return self._loki(loki_id)

    @gl.public.view
    def get_entry(self, entry_id: str) -> dict:
        return self._entry(entry_id)

    @gl.public.view
    def get_platform_fees(self) -> u256:
        return self.platform_fees
