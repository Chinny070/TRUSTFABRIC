import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus, type CalldataEncodable } from "genlayer-js/types";
import { contract } from "./config";
import type { CriterionVerdict, Decision, Evidence, Outcome, Passport, Policy, TrustCase, TxStatus } from "./types";

type WalletProvider = { request: (request: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global { interface Window { ethereum?: WalletProvider } }

const STUDIO_CHAIN_ID_HEX = "0xf22f";
const GENLAYER_SNAP_ID = "npm:genlayer-wallet-plugin";

export function describeWalletError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown; shortMessage?: unknown; data?: { message?: unknown } };
    const message = [value.shortMessage, value.message, value.data?.message].find(item => typeof item === "string" && item.length > 0);
    const code = value.code === undefined ? "" : ` [provider code ${String(value.code)}]`;
    if (message) return `${message}${code}`;
    try { return `${JSON.stringify(error)}${code}`; } catch { return `Wallet/provider request failed${code}.`; }
  }
  return String(error || "Protocol request failed.");
}

const readClient = createClient({ chain: studionet });
const call = <T>(functionName: string, args: CalldataEncodable[] = []) =>
  readClient.readContract({ address: contract.address, functionName, args }) as Promise<T>;

export const trustFabric = {
  // Verified deployed reads: no registry-wide unbounded scans are used.
  getPolicy: (id: string) => call<Policy>("get_policy", [id]),
  getPolicyCriterion: (id: string, index: number) => call<string>("get_policy_criterion", [id, index]),
  getPolicyCount: () => call<number>("get_policy_count"),
  getPolicyIdAt: (index: number) => call<string>("get_policy_id_at", [index]),
  getCreatorPolicyCount: (address: string) => call<number>("get_creator_policy_count", [address]),
  getEvidence: (id: string) => call<Evidence>("get_evidence", [id]),
  getEvidenceCount: () => call<number>("get_evidence_count"),
  getEvidenceIdAt: (index: number) => call<string>("get_evidence_id_at", [index]),
  getEvidencePage: (start: number, limit: number) => call<Evidence[]>("get_evidence_page", [start, limit]),
  getSubmitterEvidenceCount: (address: string) => call<number>("get_submitter_evidence_count", [address]),
  getCase: (id: string) => call<TrustCase>("get_case", [id]),
  getCaseCount: () => call<number>("get_case_count"),
  getCaseIdAt: (index: number) => call<string>("get_case_id_at", [index]),
  getCaseEvidenceId: (id: string, index: number) => call<string>("get_case_evidence_id", [id, index]),
  getCasePage: (start: number, limit: number) => call<TrustCase[]>("get_case_page", [start, limit]),
  getCreatorCaseCount: (address: string) => call<number>("get_creator_case_count", [address]),
  getCaseCriterionVerdict: (id: string, index: number) => call<CriterionVerdict>("get_case_criterion_verdict", [id, index]),
  getCaseCriterionUsedEvidenceId: (id: string, criterion: number, used: number) => call<string>("get_case_criterion_used_evidence_id", [id, criterion, used]),
  getDecision: (id: string) => call<Decision>("get_decision", [id]),
  getPassport: (subject: string) => call<Passport>("get_passport", [subject]),
  getSubjectDecisionCount: (subject: string) => call<number>("get_subject_decision_count", [subject]),
  getSubjectDecisionCaseId: (subject: string, index: number) => call<string>("get_subject_decision_case_id", [subject, index]),
  getSubjectDecisionPage: (subject: string, start: number, limit: number) => call<Decision[]>("get_subject_decision_page", [subject, start, limit]),
  getLatestPolicyDecision: (subject: string, policyId: string) => call<Outcome>("get_latest_policy_decision", [subject, policyId]),
};

export async function connectWallet(): Promise<string> {
  if (!window.ethereum) throw new Error("No injected wallet found. Install or unlock a StudioNet-compatible wallet.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts[0]) throw new Error("Wallet did not provide an account.");
  return accounts[0];
}

async function preflightWallet(account: string): Promise<void> {
  if (!window.ethereum) throw new Error("No injected wallet found.");
  const [accounts, chainId] = await Promise.all([
    window.ethereum.request({ method: "eth_accounts" }) as Promise<string[]>,
    window.ethereum.request({ method: "eth_chainId" }) as Promise<string>,
  ]);
  if (!accounts.some(candidate => candidate.toLowerCase() === account.toLowerCase())) throw new Error("The connected wallet account changed. Reconnect your wallet and retry.");
  if (chainId !== STUDIO_CHAIN_ID_HEX) throw new Error(`Wallet is on chain ${parseInt(chainId, 16)}. Switch to StudioNet (61999) and retry.`);
  try {
    const snaps = await window.ethereum.request({ method: "wallet_getSnaps" }) as Record<string, unknown>;
    if (!snaps || typeof snaps !== "object") throw new Error("wallet_getSnaps returned an invalid response.");
    // A missing Snap is valid here: client.connect("studionet") will request its installation.
    const snapAlreadyInstalled = Object.prototype.hasOwnProperty.call(snaps, GENLAYER_SNAP_ID);
    if (snapAlreadyInstalled) return;
  } catch (error) {
    throw new Error(`This injected wallet cannot provide GenLayerJS Snap access (${describeWalletError(error)}). Use a MetaMask Snaps-compatible wallet for StudioNet writes.`, { cause: error });
  }
}

export async function writeTrustFabric(
  method: "create_policy" | "update_policy" | "freeze_policy" | "register_evidence" | "create_case" | "adjudicate_case",
  args: CalldataEncodable[], account: string, setStatus: (status: TxStatus, hash?: string) => void,
): Promise<string> {
  if (!window.ethereum) throw new Error("No injected wallet found.");
  setStatus("WALLET_CONFIRMATION");
  await preflightWallet(account);
  const client = createClient({ chain: studionet, account: account as `0x${string}`, provider: window.ethereum });
  await client.connect("studionet");
  const hash = await client.writeContract({ address: contract.address, functionName: method, args, value: 0n });
  setStatus("SUBMITTED", hash);
  setStatus("CONSENSUS_PENDING", hash);
  const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED });
  if (receipt.txExecutionResultName && receipt.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    throw new Error(`Consensus finalized but contract execution did not succeed: ${receipt.txExecutionResultName}`);
  }
  setStatus("FINALIZED", hash);
  return hash;
}
