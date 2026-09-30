import hashlib
import json

import pytest

from gltest import direct_deploy


def commitment(loki_id, player, choice, nonce):
    payload = {
        "version": "loki-v1",
        "loki_id": loki_id,
        "player": player.lower(),
        "choice": choice,
        "nonce": nonce,
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()


def test_initial_state():
    contract = direct_deploy("contracts/loki.py")
    assert contract.get_platform_fees() == 0


def test_create_loki_stores_immutable_rules():
    contract = direct_deploy("contracts/loki.py")

    loki_id = contract.create_loki(
        args=[
            "Guess the Color",
            "color",
            ["orange", "pink", "red", "blue", "green"],
            10,
            2_000_000_000,
        ]
    )

    loki = contract.get_loki(args=[loki_id])

    assert loki["title"] == "Guess the Color"
    assert loki["category"] == "color"
    assert loki["choices"] == ["orange", "pink", "red", "blue", "green"]
    assert loki["entry_amount"] == "10"
    assert loki["status"] == "OPEN"


def test_duplicate_choices_rejected():
    contract = direct_deploy("contracts/loki.py")

    with pytest.raises(Exception):
        contract.create_loki(
            args=[
                "Bad LOKI",
                "color",
                ["red", "RED"],
                10,
                2_000_000_000,
            ]
        )


def test_randomness_cannot_be_caller_supplied():
    contract = direct_deploy("contracts/loki.py")

    loki_id = contract.create_loki(
        args=[
            "Guess",
            "color",
            ["red", "blue"],
            10,
            2_000_000_000,
        ]
    )

    with pytest.raises(Exception):
        contract.resolve_randomness(args=[loki_id])
