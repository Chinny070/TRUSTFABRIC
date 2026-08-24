import pytest


CONTRACT = "contracts/TrustFabric.py"
HASH = "b" * 64


def setup_case_context(contract, subject="wallet:0xcase", permission="grant premium marketplace access"):
    policy_id = contract.create_policy(permission, "Premium access", "Permit qualified marketplace access", ["Identity is independently verified"])
    contract.freeze_policy(policy_id)
    evidence_id = contract.register_evidence(subject, "https://example.com/" + subject.replace(":", "-"), HASH, "IDENTITY", "Evidence")
    return policy_id, evidence_id


def test_valid_case_creation_sequential_ids_and_creator_attribution(direct_deploy, direct_owner):
    contract = direct_deploy(CONTRACT)
    policy_id, evidence_id = setup_case_context(contract)
    first = contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])
    second = contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])
    trust_case = contract.get_case(first)
    assert first == "case-1"
    assert second == "case-2"
    assert str(trust_case.creator).lower() == "0x" + direct_owner.hex()
    assert trust_case.status == "OPEN"
    assert trust_case.policy_id == policy_id
    assert contract.get_creator_case_count(trust_case.creator) == 2


def test_unfrozen_or_nonexistent_policy_rejected(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id = contract.create_policy("grant access", "Access", "Permit access", ["One criterion"])
    evidence_id = contract.register_evidence("subject", "https://example.com/source", HASH, "IDENTITY", "")
    with direct_vm.expect_revert("Policy must be frozen before case creation"):
        contract.create_case("subject", policy_id, "grant access", [evidence_id])
    with direct_vm.expect_revert("Policy does not exist"):
        contract.create_case("subject", "policy-404", "grant access", [evidence_id])


def test_evidence_set_validation_and_order(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id, first = setup_case_context(contract)
    second = contract.register_evidence("wallet:0xcase", "https://example.com/second", HASH, "PUBLIC_RECORD", "")
    case_id = contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [second, first])
    assert contract.get_case_evidence_id(case_id, 0) == second
    assert contract.get_case_evidence_id(case_id, 1) == first
    with direct_vm.expect_revert("Evidence does not exist"):
        contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", ["evidence-404"])
    with direct_vm.expect_revert("Duplicate evidence ID in case"):
        contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [first, first])
    with direct_vm.expect_revert("Evidence subject does not match case subject"):
        contract.create_case("wrong-subject", policy_id, "grant premium marketplace access", [first])


def test_case_evidence_minimum_and_maximum(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id, first = setup_case_context(contract)
    with direct_vm.expect_revert("Invalid case evidence count"):
        contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [])
    evidence_ids = [first]
    for index in range(7):
        evidence_ids.append(contract.register_evidence("wallet:0xcase", "https://example.com/more-" + str(index), HASH, "CUSTOM", ""))
    assert contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", evidence_ids) == "case-1"
    with direct_vm.expect_revert("Invalid case evidence count"):
        contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", evidence_ids + ["evidence-1"])


def test_subject_bounds_and_permission_match(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id, evidence_id = setup_case_context(contract, subject="s" * 160)
    assert contract.create_case("s" * 160, policy_id, "grant premium marketplace access", [evidence_id]) == "case-1"
    with direct_vm.expect_revert("Case subject exceeds maximum length"):
        contract.create_case("s" * 161, policy_id, "grant premium marketplace access", [evidence_id])
    with direct_vm.expect_revert("Case permission must exactly match frozen policy permission"):
        contract.create_case("s" * 160, policy_id, "different permission", [evidence_id])


def test_creator_case_cap(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id, evidence_id = setup_case_context(contract)
    for index in range(20):
        contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])
    with direct_vm.expect_revert("Creator trust case capacity reached"):
        contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])

def test_global_case_cap(direct_deploy, direct_vm, direct_accounts):
    contract = direct_deploy(CONTRACT)
    policy_id, evidence_id = setup_case_context(contract)
    for index in range(100):
        with direct_vm.prank(direct_accounts[index % 10]):
            contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])
    with direct_vm.prank(direct_accounts[0]):
        with direct_vm.expect_revert("Trust case registry capacity reached"):
            contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])


def test_case_immutability_and_cross_stage_state_invariants(direct_deploy):
    contract = direct_deploy(CONTRACT)
    policy_id, evidence_id = setup_case_context(contract)
    policy_before = contract.get_policy(policy_id)
    evidence_before = contract.get_evidence(evidence_id)
    case_id = contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])
    trust_case = contract.get_case(case_id)
    assert trust_case.subject == "wallet:0xcase"
    assert trust_case.permission == policy_before.permission
    assert contract.get_case_evidence_id(case_id, 0) == evidence_id
    assert contract.get_policy(policy_id).is_frozen is True
    assert contract.get_policy(policy_id).name == policy_before.name
    evidence_after = contract.get_evidence(evidence_id)
    assert evidence_after.subject == evidence_before.subject
    assert evidence_after.submitter == evidence_before.submitter
    assert contract.get_evidence_count() == 1


def test_case_pagination_and_nonexistent_case_reads(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id, evidence_id = setup_case_context(contract)
    for index in range(3):
        contract.create_case("wallet:0xcase", policy_id, "grant premium marketplace access", [evidence_id])
    assert [record.status for record in contract.get_case_page(1, 2)] == ["OPEN", "OPEN"]
    assert contract.get_case_id_at(2) == "case-3"
    with direct_vm.expect_revert("Invalid case page size"):
        contract.get_case_page(0, 0)
    with direct_vm.expect_revert("Invalid case page size"):
        contract.get_case_page(0, 26)
    with direct_vm.expect_revert("Case page start out of range"):
        contract.get_case_page(3, 1)
    with direct_vm.expect_revert("Trust case does not exist"):
        contract.get_case("case-404")
    with direct_vm.expect_revert("Case evidence index out of range"):
        contract.get_case_evidence_id("case-1", 1)
