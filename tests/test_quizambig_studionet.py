"""Live Studionet integration test for the finalized automatic Quizambig flow.

Run explicitly:
    gltest --network studionet tests/test_quizambig_studionet.py -v -s
"""

import hashlib
import time

from gltest.assertions import tx_execution_succeeded
from gltest.contracts.contract_factory import get_contract_factory


EXPECTED_OWNER = "0xB41f7CcF919515a4741C7AAd43cFfCd56A20Ee31"


def make_commitment(answer: str, salt: str, answer_mode: str) -> str:
    return hashlib.sha256(
        f"{answer}:{salt}:{answer_mode}".encode("utf-8")
    ).hexdigest()


def assert_success(receipt, step: str):
    if not tx_execution_succeeded(receipt):
        print(f"\n[FAIL] {step}")
        print("TRANSACTION RECEIPT:", receipt)
        raise AssertionError(f"Studionet transaction failed: {step}")
    print(f"[PASS] {step}")


def test_quizambig_automatic_async_evaluation(default_account, accounts):
    assert len(accounts) >= 2

    master = next(
        (account for account in accounts
         if account.address.lower() == EXPECTED_OWNER.lower()),
        None,
    )
    assert master is not None, (
        f"EXPECTED_OWNER is not configured: {EXPECTED_OWNER}"
    )

    player = next(
        account for account in accounts
        if account.address.lower() != master.address.lower()
    )

    factory = get_contract_factory(contract_file_path="quizambig.py")
    contract = factory.deploy(account=master, consensus_max_rotations=5)
    player_contract = contract.connect(player)

    quiz_id = contract.get_next_quiz_id().call()
    create_receipt = contract.create_quiz(
        args=["Automatic async evaluation", 2]
    ).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=100
    )
    assert_success(create_receipt, "create_quiz")

    answer1, salt1, mode1 = "Paris", "salt-q1", "TEXT"
    answer2, salt2, mode2 = "4", "salt-q2", "NUMERIC"

    q1_id = contract.get_next_question_id().call()
    receipt = contract.add_question(
        args=[
            quiz_id, "What is the capital of France?",
            make_commitment(answer1, salt1, mode1), len(answer1), mode1, 8
        ]
    ).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=100
    )
    assert_success(receipt, "add_question_q1")

    q2_id = contract.get_next_question_id().call()
    receipt = contract.add_question(
        args=[
            quiz_id, "What is 2 + 2?",
            make_commitment(answer2, salt2, mode2), len(answer2), mode2, 8
        ]
    ).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=100
    )
    assert_success(receipt, "add_question_q2")
    assert q2_id == q1_id + 1

    receipt = contract.publish_quiz(args=[quiz_id]).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=100
    )
    assert_success(receipt, "publish_quiz")

    receipt = player_contract.join_quiz(args=[quiz_id]).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=100
    )
    assert_success(receipt, "join_quiz")

    # Submit Q1 and immediately request GenLayer evaluation. The contract
    # must not require the question to be manually closed first.
    receipt = player_contract.submit_answer(args=[q1_id, "Paris"]).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=100
    )
    assert_success(receipt, "submit_q1")

    receipt = contract.evaluate_submission(
        args=[q1_id, player.address, answer1, salt1]
    ).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=200
    )
    assert_success(receipt, "evaluate_q1_while_active")

    evaluation = contract.get_evaluation(args=[q1_id, player.address]).call()
    assert evaluation["status"] == "FINALIZED"
    assert evaluation["correct"] is True

    # The schedule remains independent of the GenLayer judgment. Wait until
    # Q2 is active and prove the same player can submit without any close/start
    # transaction.
    time.sleep(9)
    current = contract.get_current_question(quiz_id).call()
    assert current["id"] == q2_id

    receipt = player_contract.submit_answer(args=[q2_id, "four"]).transact(
        consensus_max_rotations=5, wait_interval=3000, wait_retries=100
    )
    assert_success(receipt, "submit_q2")

    print("===== QUIZAMBIG ASYNC STUDIONET TEST PASSED =====")
