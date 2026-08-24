import pytest


CONTRACT = "contracts/TrustFabric.py"
HASH = "d" * 64


def llm(verdict):
    return '{"source_independence":"PASS","criteria":[{"index":0,"verdict":"' + verdict + '","used_evidence_ids":[]}],"summary":"compact"}'


def setup_policy(contract, permission="grant access"):
    policy_id = contract.create_policy(permission, "Access", "Permit access", ["Identity is verified"])
    contract.freeze_policy(policy_id)
    return policy_id


def create_case(contract, policy_id, subject, source_suffix):
    evidence_id = contract.register_evidence(subject, "https://example.com/" + source_suffix, HASH, "IDENTITY", "")
    return contract.create_case(subject, policy_id, "grant access", [evidence_id])


def finalize(contract, direct_vm, case_id, verdict):
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.com", {"status": 200, "body": "Evidence"})
    direct_vm.mock_llm(r".*", llm(verdict))
    return contract.adjudicate_case(case_id)


def test_finalization_creates_passport_and_decision_registry(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id = setup_policy(contract)
    case_id = create_case(contract, policy_id, "subject-a", "a")
    assert finalize(contract, direct_vm, case_id, "PASS") == "TRUST_GRANTED"
    passport = contract.get_passport("subject-a")
    decision = contract.get_decision(case_id)
    assert passport.decision_count == 1
    assert passport.granted_count == 1
    assert passport.denied_count == 0
    assert passport.insufficient_count == 0
    assert passport.latest_case_id == case_id
    assert decision.case_id == case_id
    assert decision.subject == "subject-a"
    assert decision.policy_id == policy_id
    assert decision.outcome == "TRUST_GRANTED"
    assert contract.get_latest_policy_decision("subject-a", policy_id) == "TRUST_GRANTED"


def test_passport_keeps_history_and_latest_policy_decision_supersedes(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id = setup_policy(contract)
    granted_case = create_case(contract, policy_id, "subject-a", "grant")
    assert finalize(contract, direct_vm, granted_case, "PASS") == "TRUST_GRANTED"
    denied_case = create_case(contract, policy_id, "subject-a", "deny")
    assert finalize(contract, direct_vm, denied_case, "FAIL") == "TRUST_DENIED"
    passport = contract.get_passport("subject-a")
    assert passport.decision_count == 2
    assert passport.granted_count == 1
    assert passport.denied_count == 1
    assert contract.get_subject_decision_case_id("subject-a", 0) == granted_case
    assert contract.get_subject_decision_case_id("subject-a", 1) == denied_case
    assert contract.get_latest_policy_decision("subject-a", policy_id) == "TRUST_DENIED"
    assert contract.get_decision(granted_case).outcome == "TRUST_GRANTED"


def test_insufficient_and_multiple_policies_are_separate(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    first_policy = setup_policy(contract)
    second_policy = contract.create_policy("grant premium access", "Premium", "Permit premium access", ["Identity is verified"])
    contract.freeze_policy(second_policy)
    first_case = create_case(contract, first_policy, "subject-a", "unknown")
    assert finalize(contract, direct_vm, first_case, "UNKNOWN") == "INSUFFICIENT_EVIDENCE"
    evidence_id = contract.register_evidence("subject-a", "https://example.com/premium", HASH, "IDENTITY", "")
    second_case = contract.create_case("subject-a", second_policy, "grant premium access", [evidence_id])
    # The Stage 4 mock uses evidence-1 in its response, so use an empty used list
    # for this second policy's decision while retaining a PASS verdict.
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.com", {"status": 200, "body": "Evidence"})
    direct_vm.mock_llm(r".*", '{"source_independence":"PASS","criteria":[{"index":0,"verdict":"PASS","used_evidence_ids":[]}],"summary":"compact"}')
    assert contract.adjudicate_case(second_case) == "TRUST_GRANTED"
    passport = contract.get_passport("subject-a")
    assert passport.insufficient_count == 1
    assert passport.granted_count == 1
    assert contract.get_latest_policy_decision("subject-a", first_policy) == "INSUFFICIENT_EVIDENCE"
    assert contract.get_latest_policy_decision("subject-a", second_policy) == "TRUST_GRANTED"


def test_subject_isolation_pages_empty_passport_and_no_manual_mutation(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    empty = contract.get_passport("nobody")
    assert empty.decision_count == 0
    assert contract.get_subject_decision_page("nobody", 0, 1) == []
    assert not hasattr(contract, "create_passport")
    assert not hasattr(contract, "update_passport")
    policy_id = setup_policy(contract)
    case_id = create_case(contract, policy_id, "subject-a", "a")
    finalize(contract, direct_vm, case_id, "PASS")
    assert contract.get_passport("subject-b").decision_count == 0
    with direct_vm.expect_revert("Trust decision does not exist"):
        contract.get_decision("case-404")
    with direct_vm.expect_revert("Subject decision index out of range"):
        contract.get_subject_decision_case_id("subject-a", 1)


def test_failed_or_repeated_adjudication_never_changes_passport(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id = setup_policy(contract)
    case_id = create_case(contract, policy_id, "subject-a", "a")
    direct_vm.mock_web(r"example\.com", {"status": 503, "body": "Unavailable"})
    with direct_vm.expect_revert("TRANSIENT:EVIDENCE_SOURCE_UNAVAILABLE"):
        contract.adjudicate_case(case_id)
    assert contract.get_passport("subject-a").decision_count == 0
    assert finalize(contract, direct_vm, case_id, "PASS") == "TRUST_GRANTED"
    with direct_vm.expect_revert("EXPECTED:CASE_NOT_OPEN"):
        contract.adjudicate_case(case_id)
    assert contract.get_passport("subject-a").decision_count == 1


def test_subject_decision_pagination(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id = setup_policy(contract)
    for suffix in ["one", "two", "three"]:
        case_id = create_case(contract, policy_id, "subject-a", suffix)
        finalize(contract, direct_vm, case_id, "PASS")
    assert len(contract.get_subject_decision_page("subject-a", 1, 2)) == 2
    with direct_vm.expect_revert("Invalid decision page size"):
        contract.get_subject_decision_page("subject-a", 0, 0)
    with direct_vm.expect_revert("Subject decision page start out of range"):
        contract.get_subject_decision_page("subject-a", 3, 1)
