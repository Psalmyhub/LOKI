import pytest

from gltest import get_contract_factory
from gltest.assertions import tx_execution_failed, tx_execution_succeeded
from gltest.types import TransactionHashVariant, TransactionStatus


BEFORE_CLOSE = "2030-01-01T00:00:00Z"
AFTER_CLOSE = "2030-01-01T00:01:00Z"
CLOSES_AT = 1_893_456_001
ENTRY_AMOUNT = 100


def deploy(account):
    factory = get_contract_factory(contract_file_path="loki.py")
    return factory.deploy(
        account=account,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )


def create_loki(contract, choices=None, entry_amount=ENTRY_AMOUNT):
    choices = choices or ["RED", "BLUE", "GREEN"]
    tx = contract.create_loki(
        args=["Loki integration test", "color", choices, entry_amount, CLOSES_AT]
    ).transact(transaction_context={"genvm_datetime": BEFORE_CLOSE})
    assert tx_execution_succeeded(tx)
    return "loki-1"


def enter(contract, player, loki_id, choice):
    tx = player.enter_loki(args=[loki_id, choice]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_succeeded(tx)


def test_initial_state(default_account):
    contract = deploy(default_account)
    assert contract.get_platform_fees().call() == 0


def test_create_loki_publishes_open_loki(default_account):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    loki = contract.get_loki(args=[loki_id]).call()

    assert loki["choices"] == ["RED", "BLUE", "GREEN"]
    assert loki["entry_amount"] == "100"
    assert loki["status"] == "OPEN"
    assert loki["participant_count"] == "0"
    assert loki["entry_ids"] == []


def test_duplicate_choices_rejected(default_account):
    contract = deploy(default_account)
    tx = contract.create_loki(
        args=["Bad Loki", "color", ["red", "RED"], ENTRY_AMOUNT, CLOSES_AT]
    ).transact(transaction_context={"genvm_datetime": BEFORE_CLOSE})
    assert tx_execution_failed(tx)


def test_entry_stores_public_choice_and_timestamp(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])

    enter(contract, player, loki_id, "RED")

    entry = contract.get_entry(args=["entry-1"]).call()
    loki = contract.get_loki(args=[loki_id]).call()

    assert entry["player"].lower() == accounts[0].address.lower()
    assert entry["choice"] == "RED"
    assert int(entry["entered_at"]) > 0
    assert entry["is_winner"] is False
    assert entry["settlement"] == "PENDING"
    assert loki["participant_count"] == "1"
    assert loki["total_pool"] == "100"


def test_invalid_choice_rejected(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])

    tx = player.enter_loki(args=[loki_id, "PURPLE"]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_failed(tx)


def test_exact_payment_and_one_wallet_one_entry(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])

    enter(contract, player, loki_id, "RED")

    tx = player.enter_loki(args=[loki_id, "BLUE"]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_failed(tx)


def test_wrong_payment_rejected(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])

    tx = player.enter_loki(args=[loki_id, "RED"]).transact(
        value=ENTRY_AMOUNT - 1,
        transaction_context={"genvm_datetime": BEFORE_CLOSE},
    )
    assert tx_execution_failed(tx)


def test_entry_after_closing_time_rejected(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)
    player = contract.connect(accounts[0])

    tx = player.enter_loki(args=[loki_id, "RED"]).transact(
        value=ENTRY_AMOUNT,
        transaction_context={"genvm_datetime": AFTER_CLOSE},
    )
    assert tx_execution_failed(tx)


def test_close_randomizes_from_published_choices(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)

    enter(contract, contract.connect(accounts[0]), loki_id, "RED")
    enter(contract, contract.connect(accounts[1]), loki_id, "BLUE")

    tx = contract.close_loki(args=[loki_id]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED,
        wait_interval=3000,
        wait_retries=60,
        transaction_context={"genvm_datetime": AFTER_CLOSE},
    )
    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(
        args=[loki_id],
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
    ).call()

    assert loki["status"] == "RANDOMIZED"
    assert loki["randomness_verified"] is True
    assert loki["random_choice"] in loki["choices"]
    assert len(loki["randomness_input_hash"]) == 64
    assert len(loki["randomness_entropy"]) == 64
    assert len(loki["randomness_consensus"]) == 64


def test_full_matching_flow_winners_are_every_matching_choice(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract)

    enter(contract, contract.connect(accounts[0]), loki_id, "RED")
    enter(contract, contract.connect(accounts[1]), loki_id, "BLUE")
    enter(contract, contract.connect(accounts[2]), loki_id, "RED")
    enter(contract, contract.connect(accounts[3]), loki_id, "GREEN")

    tx = contract.close_loki(args=[loki_id]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED,
        wait_interval=3000,
        wait_retries=60,
        transaction_context={"genvm_datetime": AFTER_CLOSE},
    )
    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(args=[loki_id]).call()
    random_choice = loki["random_choice"]

    tx = contract.settle_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(args=[loki_id]).call()
    assert loki["status"] == "SETTLED"
    assert loki["refund_pool"] == "0"

    for index, choice in enumerate(["RED", "BLUE", "RED", "GREEN"], start=1):
        entry = contract.get_entry(args=[f"entry-{index}"]).call()
        assert entry["choice"] == choice
        assert entry["is_winner"] is (choice.casefold() == random_choice.casefold())
        assert entry["settlement"] == ("WIN" if entry["is_winner"] else "LOSE")

    expected_winners = sum(
        choice.casefold() == random_choice.casefold()
        for choice in ["RED", "BLUE", "RED", "GREEN"]
    )
    assert int(loki["winner_count"]) == expected_winners
    assert int(loki["platform_fee"]) == 4


def test_no_winner_distributes_net_pool_to_all_participants(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract, choices=["RED", "BLUE"])

    enter(contract, contract.connect(accounts[0]), loki_id, "BLUE")
    enter(contract, contract.connect(accounts[1]), loki_id, "BLUE")

    tx = contract.close_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(args=[loki_id]).call()
    if loki["random_choice"] == "BLUE":
        pytest.skip("Random selection matched the selected choice")

    tx = contract.settle_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(args=[loki_id]).call()
    assert loki["winner_count"] == "0"
    assert loki["platform_fee"] == "2"
    assert loki["prize_pool"] == "198"
    assert loki["refund_pool"] == "0"
    assert loki["unmatched_pool"] == "0"

    for index in (1, 2):
        entry = contract.get_entry(args=[f"entry-{index}"]).call()
        assert entry["settlement"] == "NO_WINNER_SHARE"
        assert entry["is_winner"] is False


def test_resolve_randomness_cannot_be_called_directly(default_account):
    contract = deploy(default_account)
    loki_id = create_loki(contract)

    tx = contract.resolve_randomness(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_failed(tx)


def test_settlement_applies_one_percent_platform_fee(default_account, accounts):
    contract = deploy(default_account)
    loki_id = create_loki(contract, choices=["RED", "BLUE"])

    enter(contract, contract.connect(accounts[0]), loki_id, "RED")

    tx = contract.close_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    tx = contract.settle_loki(args=[loki_id]).transact(
        transaction_context={"genvm_datetime": AFTER_CLOSE}
    )
    assert tx_execution_succeeded(tx)

    loki = contract.get_loki(args=[loki_id]).call()
    assert loki["platform_fee"] == "1"
    assert contract.get_platform_fees().call() == 1
