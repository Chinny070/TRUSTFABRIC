import pytest


CONTRACT = "contracts/TrustFabric.py"


def create_policy(contract, permission="access premium marketplace", name="Premium seller", purpose="Permit verified sellers to list high-value goods", criteria=None):
    if criteria is None:
        criteria = ["Identity is verified by an independent source"]
    return contract.create_policy(permission, name, purpose, criteria)


def test_valid_policy_creation_and_creator_attribution(direct_deploy, direct_owner):
    contract = direct_deploy(CONTRACT)
    policy_id = create_policy(contract)

    policy = contract.get_policy(policy_id)
    assert policy_id == "policy-1"
    assert str(policy.creator).lower() == "0x" + direct_owner.hex()
    assert policy.permission == "access premium marketplace"
    assert policy.name == "Premium seller"
    assert policy.is_frozen is False
    assert contract.get_policy_count() == 1
    assert contract.get_creator_policy_count(policy.creator) == 1


def test_policy_ids_are_unique_and_indexed_in_order(direct_deploy):
    contract = direct_deploy(CONTRACT)
    assert create_policy(contract, name="One") == "policy-1"
    assert create_policy(contract, name="Two") == "policy-2"
    assert contract.get_policy_id_at(0) == "policy-1"
    assert contract.get_policy_id_at(1) == "policy-2"


def test_criteria_persist_in_order_and_can_be_paginated(direct_deploy):
    contract = direct_deploy(CONTRACT)
    criteria = ["Identity is verified", "No unresolved defaults", "Activity is stable"]
    policy_id = create_policy(contract, criteria=criteria)

    policy = contract.get_policy(policy_id)
    assert policy.criterion_count == 3
    assert [contract.get_policy_criterion(policy_id, index) for index in range(3)] == criteria


def test_minimum_and_maximum_criteria_are_valid(direct_deploy):
    contract = direct_deploy(CONTRACT)
    create_policy(contract, name="Minimum", criteria=["One explicit check"])
    create_policy(contract, name="Maximum", criteria=["Criterion " + str(i) for i in range(12)])
    assert contract.get_policy_count() == 2


@pytest.mark.parametrize(
    ("permission", "name", "purpose", "criteria", "message"),
    [
        ("", "Name", "Purpose", ["Criterion"], "Permission cannot be empty"),
        ("Permission", "   ", "Purpose", ["Criterion"], "Policy name cannot be empty"),
        ("Permission", "Name", "", ["Criterion"], "Purpose cannot be empty"),
        ("Permission", "Name", "Purpose", [], "Invalid criterion count"),
        ("Permission", "Name", "Purpose", ["Criterion"] * 13, "Invalid criterion count"),
        ("Permission", "Name", "Purpose", ["  "], "Criterion cannot be empty"),
    ],
)
def test_empty_and_malformed_policy_inputs_revert(direct_deploy, direct_vm, permission, name, purpose, criteria, message):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert(message):
        create_policy(contract, permission, name, purpose, criteria)
    assert contract.get_policy_count() == 0


@pytest.mark.parametrize(
    ("permission", "name", "purpose", "criterion", "message"),
    [
        ("p" * 161, "Name", "Purpose", "Criterion", "Permission exceeds maximum length"),
        ("Permission", "n" * 97, "Purpose", "Criterion", "Policy name exceeds maximum length"),
        ("Permission", "Name", "u" * 481, "Criterion", "Purpose exceeds maximum length"),
        ("Permission", "Name", "Purpose", "c" * 281, "Criterion exceeds maximum length"),
    ],
)
def test_field_length_overflows_revert(direct_deploy, direct_vm, permission, name, purpose, criterion, message):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert(message):
        create_policy(contract, permission, name, purpose, [criterion])


def test_exact_field_length_boundaries_are_valid(direct_deploy):
    contract = direct_deploy(CONTRACT)
    policy_id = create_policy(contract, "p" * 160, "n" * 96, "u" * 480, ["c" * 280])
    policy = contract.get_policy(policy_id)
    assert len(policy.permission) == 160
    assert len(policy.name) == 96
    assert len(policy.purpose) == 480
    assert len(contract.get_policy_criterion(policy_id, 0)) == 280


def test_only_creator_can_update_or_freeze(direct_deploy, direct_vm, direct_bob):
    contract = direct_deploy(CONTRACT)
    policy_id = create_policy(contract)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the policy creator may mutate it"):
            contract.update_policy(policy_id, "other permission", "Other", "Other purpose", ["Other criterion"])
        with direct_vm.expect_revert("Only the policy creator may mutate it"):
            contract.freeze_policy(policy_id)
    assert contract.get_policy(policy_id).is_frozen is False


def test_lifecycle_allows_creator_update_then_permanent_freeze(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id = create_policy(contract)
    contract.update_policy(policy_id, "grant agent payout authority", "Payout agent", "Permit bounded payouts", ["Agent holds a valid mandate"])
    contract.freeze_policy(policy_id)

    policy = contract.get_policy(policy_id)
    assert policy.permission == "grant agent payout authority"
    assert policy.is_frozen is True
    with direct_vm.expect_revert("Frozen policy cannot be changed"):
        contract.update_policy(policy_id, "changed", "Changed", "Changed", ["Changed"])
    with direct_vm.expect_revert("Policy is already frozen"):
        contract.freeze_policy(policy_id)


def test_nonexistent_policy_reads_and_mutations_revert(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert("Policy does not exist"):
        contract.get_policy("policy-404")
    with direct_vm.expect_revert("Policy does not exist"):
        contract.get_policy_criterion("policy-404", 0)
    with direct_vm.expect_revert("Policy does not exist"):
        contract.freeze_policy("policy-404")


def test_pagination_and_storage_invariants(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    first = create_policy(contract, name="First")
    second = create_policy(contract, name="Second")
    assert contract.get_policy_count() == 2
    assert contract.get_policy_id_at(0) == first
    assert contract.get_policy_id_at(1) == second
    with direct_vm.expect_revert("Policy offset out of range"):
        contract.get_policy_id_at(2)
    with direct_vm.expect_revert("Criterion index out of range"):
        contract.get_policy_criterion(first, 1)
