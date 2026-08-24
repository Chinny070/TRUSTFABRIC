# TRUSTFABRIC deployment record

## Canonical StudioNet deployment

| Field | Value |
| --- | --- |
| Network | StudioNet (GenLayer Studio Network, chain ID 61999) |
| Contract address | `0x6BC987B2Bf586A6e800ac082494F92762B40F9aD` |
| Contract class | `TrustFabric` |
| Constructor | No arguments |
| Source of record | Manual redeployment supplied by the project owner on 2026-08-24 |
| Deployment transaction hash | Not supplied |
| Verification status | Verified against StudioNet on 2026-08-24; deployed source matches canonical fixed source |

This address is the canonical StudioNet contract address for subsequent frontend configuration. It must not be replaced through automated deployment. The normalized SHA-256 of both the deployed source and [the canonical contract](../contracts/TrustFabric.py) is `2dce4cd09451ec9831ec2da9c21eeb65059632e503fba3222f56504a0f48a078`.

## Superseded deployment

`0x13F46D5897c7a6669cD327dBDca1062745589DEe` is superseded. It remains a historical Stage 6 deployment only and must not be used by the frontend or for subsequent manual QA.
