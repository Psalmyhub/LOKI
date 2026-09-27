"""Unit-level invariants for the automatic Quizambig architecture."""


def test_no_answer_criteria_is_part_of_the_model():
    contract_source = open("contracts/quizambig.py", encoding="utf-8").read()
    assert "question_criteria" not in contract_source
    assert "criteria" not in contract_source.lower()


def test_automatic_lifecycle_has_no_manual_question_controls():
    contract_source = open("contracts/quizambig.py", encoding="utf-8").read()
    for name in ("start_question", "close_question", "reveal_master_answer"):
        assert f"def {name}" not in contract_source


def test_evaluation_can_start_without_waiting_for_question_close():
    contract_source = open("contracts/quizambig.py", encoding="utf-8").read()
    assert 'in ("ACTIVE", "CLOSED")' in contract_source


def test_evaluation_records_a_semantic_score_and_correctness():
    contract_source = open("contracts/quizambig.py", encoding="utf-8").read()
    assert "semantic_score" in contract_source
    assert "evaluation_correct" in contract_source
    assert '"FINALIZED"' in contract_source


def test_evaluation_prompt_uses_equivalent_meaning():
    contract_source = open("contracts/quizambig.py", encoding="utf-8").read()
    assert "equivalent in meaning or principle" in contract_source
    assert "Do not use speed" in contract_source


def test_player_records_submission_speed_on_chain():
    contract_source = open("contracts/quizambig.py", encoding="utf-8").read()
    assert "submission_time" in contract_source
    assert "submission_response_time" in contract_source


def test_frontend_keeps_master_secret_out_of_player_page():
    master_source = open("app/master/page.tsx", encoding="utf-8").read()
    player_source = open("app/quiz/[id]/page.tsx", encoding="utf-8").read()
    assert "sessionStorage" in master_source
    assert "masterAnswer" not in player_source
    assert "secret.answer" not in player_source
