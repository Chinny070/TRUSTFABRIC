import pytest


CONTRACT = "contracts/TrustFabric.py"
HASH = "a" * 64


def register(contract, subject="wallet:0xabc", source="https://example.com/evidence", source_hash=HASH, category="IDENTITY", label="Primary record"):
    return contract.register_evidence(subject, source, source_hash, category, label)


def test_valid_evidence_registration_and_submitter_attribution(direct_deploy, direct_owner):
    contract = direct_deploy(CONTRACT)
    evidence_id = register(contract)
    evidence = contract.get_evidence(evidence_id)
    assert evidence_id == "evidence-1"
    assert str(evidence.submitter).lower() == "0x" + direct_owner.hex()
    assert evidence.subject == "wallet:0xabc"
    assert evidence.source_ref == "https://example.com/evidence"
    assert evidence.source_hash == HASH
    assert evidence.category == "IDENTITY"
    assert evidence.label == "Primary record"
    assert contract.get_evidence_count() == 1
    assert contract.get_submitter_evidence_count(evidence.submitter) == 1


def test_sequential_evidence_ids_and_supported_categories(direct_deploy):
    contract = direct_deploy(CONTRACT)
    categories = ["IDENTITY", "REPAYMENT_HISTORY", "PROFESSIONAL_HISTORY", "CONTRIBUTION_HISTORY", "BUSINESS_RECORD", "ONCHAIN_HISTORY", "COMMUNITY_REFERENCE", "PUBLIC_RECORD", "SECURITY_RISK", "CUSTOM"]
    for index, category in enumerate(categories):
        assert register(contract, subject="subject-" + str(index), source="https://example.com/" + str(index), category=category) == "evidence-" + str(index + 1)


def test_http_and_https_sources_are_supported_and_scheme_is_normalized(direct_deploy):
    contract = direct_deploy(CONTRACT)
    http_id = register(contract, subject="http-subject", source=" HTTP://example.com/a ")
    https_id = register(contract, subject="https-subject", source="https://example.com/b")
    assert contract.get_evidence(http_id).source_ref == "http://example.com/a"
    assert contract.get_evidence(https_id).source_ref == "https://example.com/b"


@pytest.mark.parametrize("source", ["javascript:alert(1)", "file:///secret", "data:text/plain,no", "ftp://example.com/x", "https://", "https://example.com/a b"])
def test_unsupported_or_malformed_sources_revert(direct_deploy, direct_vm, source):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert():
        register(contract, source=source)


@pytest.mark.parametrize(
    ("subject", "source", "source_hash", "category", "label", "message"),
    [
        ("   ", "https://example.com/a", HASH, "IDENTITY", "", "Subject cannot be empty"),
        ("s" * 161, "https://example.com/a", HASH, "IDENTITY", "", "Subject exceeds maximum length"),
        ("subject", "https://example.com/" + "a" * 500, HASH, "IDENTITY", "", "Evidence source reference exceeds maximum length"),
        ("subject", "https://example.com/a", "A" * 64, "IDENTITY", "", "Evidence source hash must be empty or 64 lowercase hex characters"),
        ("subject", "https://example.com/a", "abc", "IDENTITY", "", "Evidence source hash must be empty or 64 lowercase hex characters"),
        ("subject", "https://example.com/a", HASH, "UNBOUNDED", "", "Unsupported evidence category"),
        ("subject", "https://example.com/a", HASH, "IDENTITY", "l" * 97, "Evidence label exceeds maximum length"),
    ],
)
def test_evidence_validation_reverts(direct_deploy, direct_vm, subject, source, source_hash, category, label, message):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert(message):
        register(contract, subject, source, source_hash, category, label)
    assert contract.get_evidence_count() == 0


def test_duplicate_source_and_subject_rejected_but_different_subject_allowed(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    register(contract, subject="organization:one", source="https://example.com/profile")
    with direct_vm.expect_revert("Duplicate evidence source for subject"):
        register(contract, subject="organization:one", source=" HTTPS://example.com/profile ")
    evidence_id = register(contract, subject="organization:two", source="https://example.com/profile")
    assert evidence_id == "evidence-2"


def test_submitter_evidence_cap(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    for index in range(20):
        register(contract, subject="subject-" + str(index), source="https://example.com/" + str(index))
    with direct_vm.expect_revert("Submitter evidence capacity reached"):
        register(contract, subject="subject-overflow", source="https://example.com/overflow")


def test_global_evidence_cap_boundary(direct_deploy, direct_vm, direct_accounts):
    contract = direct_deploy(CONTRACT)
    for index in range(100):
        with direct_vm.prank(direct_accounts[index % 10]):
            register(contract, subject="global-" + str(index), source="https://example.com/global-" + str(index))
    assert contract.get_evidence_count() == 100
    with direct_vm.prank(direct_accounts[0]):
        with direct_vm.expect_revert("Evidence registry capacity reached"):
            register(contract, subject="global-overflow", source="https://example.com/global-overflow")


def test_evidence_pagination_and_bounds(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    for index in range(3):
        register(contract, subject="page-" + str(index), source="https://example.com/page-" + str(index))
    page = contract.get_evidence_page(1, 2)
    assert [record.subject for record in page] == ["page-1", "page-2"]
    assert contract.get_evidence_id_at(2) == "evidence-3"
    with direct_vm.expect_revert("Invalid evidence page size"):
        contract.get_evidence_page(0, 0)
    with direct_vm.expect_revert("Invalid evidence page size"):
        contract.get_evidence_page(0, 26)
    with direct_vm.expect_revert("Evidence page start out of range"):
        contract.get_evidence_page(3, 1)
    with direct_vm.expect_revert("Evidence index out of range"):
        contract.get_evidence_id_at(3)


def test_nonexistent_evidence_reverts_and_policy_state_is_untouched(direct_deploy, direct_vm):
    contract = direct_deploy(CONTRACT)
    policy_id = contract.create_policy("grant marketplace access", "Seller", "Allow qualified sellers", ["Identity is independently verified"])
    register(contract)
    assert contract.get_policy_count() == 1
    assert contract.get_policy(policy_id).name == "Seller"
    assert contract.get_policy_criterion(policy_id, 0) == "Identity is independently verified"
    with direct_vm.expect_revert("Evidence does not exist"):
        contract.get_evidence("evidence-404")
