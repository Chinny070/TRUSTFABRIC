# TRUSTFABRIC

## The Trust Operating System

TRUSTFABRIC is decentralized infrastructure for making permission-specific trust decisions. It does **not** calculate a reputation or credit score. A builder defines a bounded Trust Policy, registers evidence references, creates a case against a frozen policy, and asks GenLayer validator consensus to adjudicate the case.

`POLICY → EVIDENCE → CASE → AI VALIDATORS → CONSENSUS → TRUST DECISION`

## Why GenLayer

The product needs a protocol capable of decentralized judgment: deterministic storage fixes the policy and evidence context, then GenLayer validators evaluate the same bounded case evidence through consensus. A submitted transaction is not presented as a successful decision until it has finalized and contract execution has succeeded.

## Architecture

- Frontend: React, TypeScript, Vite.
- Protocol: deployed `TrustFabric` Intelligent Contract only.
- Network: StudioNet, chain ID `61999`.
- Canonical address: `0x6BC987B2Bf586A6e800ac082494F92762B40F9aD`.
- SDK: `genlayer-js` `1.1.8`.

There is no backend, database, server-side proxy, centralized adjudication service, or custom indexer. The contract is the source of truth. Its address is in [src/config.ts](src/config.ts), and its deployment record is in [docs/DEPLOYMENT_RECORD.md](docs/DEPLOYMENT_RECORD.md).

## Protocol model

**Trust Policy** — a concrete permission and bounded executable criteria. A draft may be edited by its creator; after freezing it is immutable.

**Evidence** — a registered source reference, provenance hash, category, label, subject, and submitter. Registration is not verification.

**Trust Court** — an immutable case binds a subject, exact frozen policy, requested permission, and 1–8 evidence IDs. Adjudication produces `TRUST_GRANTED`, `TRUST_DENIED`, or `INSUFFICIENT_EVIDENCE`.

**Trust Passport** — a chronological history of finalized decisions. It intentionally does not collapse a subject into one score; reversals remain visible.

**Permission primitive** — another application calls `get_latest_policy_decision(subject, policy_id)` and receives one of the three outcomes above or `NO_DECISION`.

## Use the live application

```bash
npm install
npm run dev
```

Connect an injected StudioNet-compatible wallet. First create a policy, freeze it, register evidence, create a case, and request adjudication. Wallet transactions progress through `READY`, `WALLET CONFIRMATION`, `SUBMITTED`, `CONSENSUS / PENDING`, `FINALIZED`, or `FAILED`.

## Build and verification

```bash
npm run typecheck
npm run lint
npm run build
```

Do not alter or redeploy [contracts/TrustFabric.py](contracts/TrustFabric.py). The verified deployment is canonical.
