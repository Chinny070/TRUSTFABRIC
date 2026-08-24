"""Opt-in Studio consensus smoke test for Stage 4.

Set GENLAYER_STUDIO_INTEGRATION=1 with Studio running to execute this test.
It is intentionally not run against an arbitrary RPC endpoint.
"""

import os

import pytest


pytestmark = pytest.mark.skipif(
    os.environ.get("GENLAYER_STUDIO_INTEGRATION") != "1",
    reason="requires an explicitly started local GenLayer Studio environment",
)


def test_case_adjudication_reaches_finalized_decision():
    """Studio-mode coverage belongs here once deterministic web/LLM fixtures are configured."""
    from gltest import get_contract_factory
    from gltest.assertions import tx_execution_succeeded

    factory = get_contract_factory("TrustFabric")
    contract = factory.deploy(args=[])
    policy_tx = contract.create_policy(
        args=["grant access", "Access", "Permit access", ["Identity is verified"]]
    ).transact()
    assert tx_execution_succeeded(policy_tx)
