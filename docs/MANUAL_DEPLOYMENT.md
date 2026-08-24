# TRUSTFABRIC manual deployment checklist

## Canonical artifact

- Contract source: `contracts/TrustFabric.py`
- Contract class: `TrustFabric`
- Constructor: no parameters
- Runner dependency pin: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`

## Before deployment

1. Run `genvm-lint check contracts/TrustFabric.py --json` and require `"ok": true`.
2. Run `pytest tests/direct/ -v` and require no failures.
3. When GenLayer Studio is available, run `gltest tests/integration/ -v -s` with `GENLAYER_STUDIO_INTEGRATION=1`.
4. Generate and review the ABI with `genvm-lint schema contracts/TrustFabric.py --json`.

## Studio deployment

1. Open GenLayer Studio and select the intended network.
2. Create a new Intelligent Contract, paste the exact canonical source, and verify Studio recognizes class `TrustFabric` with an empty constructor.
3. Deploy without constructor arguments.
4. Wait for the deployment transaction to reach its required final status.
5. Save the deployment record below and export the deployed schema before connecting any frontend.

## Record after deployment

- Network:
- Contract address:
- Deployment transaction hash:
- Final transaction status:
- Deployment timestamp:
- ABI/schema artifact or source:
- Any deployment or schema error:

## First integration smoke flow

1. `create_policy`, then `freeze_policy`.
2. `register_evidence` using an HTTP/HTTPS public reference.
3. `create_case` with only that frozen policy and attached evidence IDs.
4. `adjudicate_case` and wait for finality.
5. Verify `get_case`, `get_decision`, `get_passport`, and `get_latest_policy_decision`.

No deployment is performed by this repository checklist.
