export type Outcome = "TRUST_GRANTED" | "TRUST_DENIED" | "INSUFFICIENT_EVIDENCE" | "NO_DECISION";
export type TxStatus = "READY" | "WALLET_CONFIRMATION" | "SUBMITTED" | "CONSENSUS_PENDING" | "FINALIZED" | "FAILED";
export type Policy = { creator: string; permission: string; name: string; purpose: string; criterion_count: number; is_frozen: boolean };
export type Evidence = { submitter: string; subject: string; source_ref: string; source_hash: string; category: string; label: string; submitted_at: string };
export type TrustCase = { creator: string; subject: string; policy_id: string; permission: string; evidence_count: number; criterion_count: number; status: "OPEN" | "FINALIZED"; created_at: string; outcome: string; resolved_at: string; summary: string };
export type Decision = { case_id: string; subject: string; policy_id: string; permission: string; outcome: Outcome; resolved_at: string };
export type Passport = { subject: string; decision_count: number; granted_count: number; denied_count: number; insufficient_count: number; latest_case_id: string; updated_at: string };
export type CriterionVerdict = { verdict: "PASS" | "FAIL" | "UNKNOWN"; used_evidence_count: number };
