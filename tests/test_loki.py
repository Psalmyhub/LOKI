import hashlib
import json
from pprint import pprint

import pytest

from gltest import get_contract_factory
from gltest.assertions import tx_execution_failed, tx_execution_succeeded
from gltest.types import TransactionHashVariant, TransactionStatus


BEFORE_CLOSE = "2030-01-01T00:00:00Z"
AFTER_CLOSE = "2030-01-01T00:01:00Z"
CLOSES_AT = 1_893_456_001
ENTRY_AMOUNT = 100


def commitment(loki_id, player, choice, nonce):
    payload = {
        "version": "loki-v1",
        "loki_id": loki_id,
        "player": player.lower(),
        "choice": choice,
        "nonce": nonce,
    }
    return hashlib.sha256(
        json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


def deploy(account):
    factory = get_contract_factory(contract_file_path="loki.py")
    return factory.deploy(
        account=account,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )


def create_loki(contract, choices=None, entry_amount=ENTRY_AMOUNT):
    choices = choices or ["red", "blue", "green"]
    tx = contract.create_loki(
        args=[
            "Loki integration test",
            "color",
            choices,
            entry_amount,
            CLOSES_AT,
        ]
    ).transact(transaction_context={"genvm_datetime": BEFORE_CLOSE})
    assert tx_execution_succeeded(tx)
    # Each test deploys a fresh Loki instance, so the first ID is deterministic.
    return "loki-1"


def test_initial_state(default_account):
    contract = deploy(default_account)
    assert contract.get_platform_fees().call() == 0


def test_create_loki_stores_immutable_rules(default_account):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    loki = contract.get_loki(args=[loki_id]).call()

    assert loki["title"] == "Loki integration test"
    assert loki["category"] == "color"
    assert loki["choices"] == ["red", "blue", "green"]
    assert loki["entry_amount"] == "100"
    assert loki["status"] == "OPEN"
    assert loki["randomness_input_hash"] == ""


def test_duplicate_choices_rejected(default_account):
    contract = deploy(default_account)

    tx = contract.create_loki(
        args=[
            "Bad Loki",
            "color",
            ["red", "RED"],
            ENTRY_AMOUNT,
            CLOSES_AT,
        ]
    ).transact(transaction_context={"genvm_datetime": BEFORE_CLOSE})
    assert tx_execution_failed(tx)


def test_exact_payment_and_one_wallet_one_entry(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])
    c = commitment(loki_id, accounts[0].address, "red", "nonce-1")

    tx = player.enter_loki(args=[loki_id, c]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_succeeded(tx)

    tx = player.enter_loki(args=[loki_id, c]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_failed(tx)


def test_wrong_payment_rejected(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])
    c = commitment(loki_id, accounts[0].address, "red", "nonce-1")

    tx = player.enter_loki(args=[loki_id, c]).transact(
        value=ENTRY_AMOUNT - 1,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_failed(tx)


def test_reveal_requires_matching_commitment(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])
    c = commitment(loki_id, accounts[0].address, "red", "nonce-1")

    tx = player.enter_loki(args=[loki_id, c]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_succeeded(tx)

    tx = player.reveal_choice(
        args=["entry-1", "blue", "nonce-1"]
    ).transact(transaction_context={"genvm_datetime": AFTER_CLOSE})
    assert tx_execution_failed(tx)


def test_close_uses_transaction_bound_randomness_and_freezes_input(default_account):
    contract = deploy(default_account)
    loki_id = create_loki(contract)

    tx = contract.close_loki(args=[loki_id]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED,
        wait_interval=3000,
        wait_retries=60,
        transaction_context={"genvm_datetime": AFTER_CLOSE},
    )

    print("\n===== CLOSE TRANSACTION (FINALIZED) =====")
    pprint(tx)

    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(args=[loki_id]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
    )

    print("\n===== FINAL LOKI STATE =====")
    pprint(loki)

    assert loki["status"] == "RANDOMIZED"
    assert loki["randomness_verified"] is True
    assert len(loki["randomness_input_hash"]) == 64
    assert len(loki["randomness_entropy"]) == 64
    assert len(loki["randomness_consensus"]) == 64
    assert loki["random_choice"] in loki["choices"]

    tx = contract.resolve_randomness(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_failed(tx)


def test_reveal_is_allowed_after_randomization(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])
    c = commitment(loki_id, accounts[0].address, "red", "nonce-1")

    tx = player.enter_loki(args=[loki_id, c]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_succeeded(tx)

    tx = contract.close_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    tx = player.reveal_choice(
        args=["entry-1", "red", "nonce-1"]
    ).transact(transaction_context={"genvm_datetime": AFTER_CLOSE})
    assert tx_execution_succeeded(tx)

    entry = contract.get_entry(args=["entry-1"]).call()
    assert entry["revealed"] is True
    assert entry["choice"] == "red"


def test_settlement_applies_one_percent_platform_fee(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract, choices=["red", "blue"])

    player = contract.connect(accounts[0])
    c = commitment(loki_id, accounts[0].address, "red", "nonce-1")

    tx = player.enter_loki(args=[loki_id, c]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_succeeded(tx)

    tx = contract.close_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    tx = player.reveal_choice(
        args=["entry-1", "red", "nonce-1"]
    ).transact(transaction_context={"genvm_datetime": AFTER_CLOSE})
    assert tx_execution_succeeded(tx)

    tx = contract.settle_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(args=[loki_id]).call()
    assert loki["platform_fee"] == "1"
    assert contract.get_platform_fees().call() == 1
