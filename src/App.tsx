import { FormEvent, useEffect, useState } from "react";
import { contract, limits, network } from "./config";
import { connectWallet, describeWalletError, trustFabric, writeTrustFabric } from "./contract";
import type { CalldataEncodable } from "genlayer-js/types";
import type { Evidence, Outcome, Policy, TrustCase, TxStatus } from "./types";

type Route = "home" | "policy" | "evidence" | "case" | "court" | "passport" | "terminal" | "explorer";
type CreationMethod = "create_policy" | "register_evidence" | "create_case";
type TxResult = string | undefined;
const categories = ["IDENTITY", "REPAYMENT_HISTORY", "PROFESSIONAL_HISTORY", "CONTRIBUTION_HISTORY", "BUSINESS_RECORD", "ONCHAIN_HISTORY", "COMMUNITY_REFERENCE", "PUBLIC_RECORD", "SECURITY_RISK", "CUSTOM"];
const truncate = (value: string) => value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
const asMessage = (error: unknown) => describeWalletError(error).replace(/^Error: /, "");
const isText = (value: unknown, maximum: number) => typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
function clientValidation(method: Parameters<typeof writeTrustFabric>[0], args: CalldataEncodable[]): string | null {
  if (method === "create_policy" || method === "update_policy") {
    const offset = method === "update_policy" ? 1 : 0; const criteria = args[offset + 3];
    if (!isText(args[offset], limits.permission) || !isText(args[offset + 1], limits.policyName) || !isText(args[offset + 2], limits.purpose)) return "Permission, policy name, and purpose must be non-empty and within protocol limits.";
    if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > limits.criteria || criteria.some(item => !isText(item, limits.criterion))) return `Provide 1–${limits.criteria} non-empty criteria of at most ${limits.criterion} characters.`;
  }
  if (method === "freeze_policy" && !isText(args[0], 64)) return "Enter a policy ID to freeze.";
  if (method === "register_evidence") {
    const [subject, source, hash, category, label] = args;
    if (!isText(subject, limits.subject) || !isText(source, limits.source) || !isText(category, 64) || typeof label !== "string" || label.length > limits.label) return "Complete the evidence fields within their protocol limits.";
    if (!/^https?:\/\/\S+$/i.test(String(source))) return "Evidence sources must be valid HTTP or HTTPS references.";
    if (hash !== "" && !/^[0-9a-f]{64}$/.test(String(hash))) return "Provenance hash must be empty or 64 lowercase hexadecimal characters.";
  }
  if (method === "create_case") {
    const [subject, policy, permission, evidence] = args;
    if (!isText(subject, limits.subject) || !isText(policy, 64) || !isText(permission, limits.permission)) return "Subject, frozen policy ID, and exact permission are required.";
    if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > limits.evidencePerCase || new Set(evidence).size !== evidence.length || evidence.some(item => !isText(item, 64))) return "Attach 1–8 unique evidence IDs in the intended order.";
  }
  if (method === "adjudicate_case" && !isText(args[0], 64)) return "Enter an open case ID to adjudicate.";
  return null;
}

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [wallet, setWallet] = useState("");
  const [tx, setTx] = useState<{ status: TxStatus; hash?: string; message?: string }>({ status: "READY" });
  const [counts, setCounts] = useState({ policies: 0, evidence: 0, cases: 0 });
  const [latestEvidenceId, setLatestEvidenceId] = useState("");
  const [latestCaseId, setLatestCaseId] = useState("");
  const refreshCounts = async () => {
    try { const [policies, evidence, cases] = await Promise.all([trustFabric.getPolicyCount(), trustFabric.getEvidenceCount(), trustFabric.getCaseCount()]); setCounts({ policies: Number(policies), evidence: Number(evidence), cases: Number(cases) }); } catch { /* Network availability is surfaced in destination views. */ }
  };
  useEffect(() => { const timer = window.setTimeout(() => { void refreshCounts(); }, 0); return () => window.clearTimeout(timer); }, []);
  const connect = async () => { try { setWallet(await connectWallet()); } catch (error) { setTx({ status: "FAILED", message: asMessage(error) }); } };
  const countBeforeCreation = async (method: CreationMethod) => {
    if (method === "create_policy") return Number(await trustFabric.getPolicyCount());
    if (method === "register_evidence") return Number(await trustFabric.getEvidenceCount());
    return Number(await trustFabric.getCaseCount());
  };
  const resolveCreatedId = async (method: CreationMethod, before: number, args: CalldataEncodable[]) => {
    const after = await countBeforeCreation(method);
    if (after <= before) throw new Error("Transaction finalized, but the corresponding registry count did not increase. Refresh and inspect the transaction before retrying.");
    if (method === "create_policy") {
      const id = await trustFabric.getPolicyIdAt(after - 1); const policy = await trustFabric.getPolicy(id);
      if (policy.creator.toLowerCase() !== wallet.toLowerCase() || policy.permission !== args[0] || policy.name !== args[1]) throw new Error("Finalized policy could not be attributed to this transaction. Inspect the Explorer before retrying.");
      return id;
    }
    if (method === "register_evidence") {
      const id = await trustFabric.getEvidenceIdAt(after - 1); const evidence = await trustFabric.getEvidence(id);
      if (evidence.submitter.toLowerCase() !== wallet.toLowerCase() || evidence.subject !== String(args[0]).trim()) throw new Error("Finalized evidence could not be attributed to this transaction. Inspect the Explorer before retrying.");
      return id;
    }
    const id = await trustFabric.getCaseIdAt(after - 1); const trustCase = await trustFabric.getCase(id);
    if (trustCase.creator.toLowerCase() !== wallet.toLowerCase() || trustCase.subject !== String(args[0]).trim() || trustCase.policy_id !== args[1]) throw new Error("Finalized case could not be attributed to this transaction. Inspect the Explorer before retrying.");
    return id;
  };
  const transact = async (method: Parameters<typeof writeTrustFabric>[0], args: CalldataEncodable[]): Promise<TxResult> => {
    const validationError = clientValidation(method, args);
    if (validationError) { setTx({ status: "FAILED", message: validationError }); return undefined; }
    if (!wallet) { setTx({ status: "FAILED", message: "Connect a wallet before submitting a protocol action." }); return undefined; }
    try {
      const before = method === "create_policy" || method === "register_evidence" || method === "create_case" ? await countBeforeCreation(method) : undefined;
      setTx({ status: "WALLET_CONFIRMATION" });
      await writeTrustFabric(method, args, wallet, (status, hash) => setTx({ status, hash }));
      const createdId = before === undefined ? undefined : await resolveCreatedId(method as CreationMethod, before, args);
      if (method === "register_evidence" && createdId) setLatestEvidenceId(createdId);
      if (method === "create_case" && createdId) setLatestCaseId(createdId);
      await refreshCounts();
      return createdId ?? "FINALIZED";
    }
    catch (error) { setTx({ status: "FAILED", message: asMessage(error) }); }
  };
  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setRoute("home")} aria-label="TRUSTFABRIC home">TRUST<span>FABRIC</span></button><div className="network"><i /> STUDIO<span>NET</span> · 61999</div><button className="wallet" onClick={connect}>{wallet ? truncate(wallet) : "CONNECT WALLET"}</button></header>
    <nav aria-label="Primary navigation">{(["home", "policy", "evidence", "case", "court", "passport", "terminal", "explorer"] as Route[]).map(item => <button key={item} className={route === item ? "active" : ""} onClick={() => setRoute(item)}>{item === "home" ? "PROTOCOL" : item}</button>)}</nav>
    <TxBar tx={tx} />
    <main>
      {route === "home" && <Home counts={counts} go={setRoute} />}
      {route === "policy" && <PolicyLab transact={transact} />}
      {route === "evidence" && <EvidenceVault transact={transact} />}
      {route === "case" && <CreateCase transact={transact} go={setRoute} initialEvidenceId={latestEvidenceId} onCreated={setLatestCaseId} />}
      {route === "court" && <TrustCourt transact={transact} initialCaseId={latestCaseId} />}
      {route === "passport" && <Passport />}
      {route === "terminal" && <Terminal />}
      {route === "explorer" && <Explorer counts={counts} />}
    </main>
    <footer>CANONICAL STUDIO<span>NET</span> · {contract.address} · <strong>REGISTERED ≠ VERIFIED</strong></footer>
  </div>;
}

function TxBar({ tx }: { tx: { status: TxStatus; hash?: string; message?: string } }) { return <div className={`txbar ${tx.status.toLowerCase()}`} role="status"><b>TX / {tx.status.replaceAll("_", " ")}</b>{tx.hash && <code>{tx.hash}</code>}{tx.message && <span>{tx.message}</span>}<small>READY → WALLET CONFIRMATION → SUBMITTED → CONSENSUS / PENDING → FINALIZED</small></div>; }
function Home({ counts, go }: { counts: { policies: number; evidence: number; cases: number }; go: (route: Route) => void }) { return <>
  <section className="hero"><p className="eyebrow">THE TRUST OPERATING SYSTEM / GENLAYER</p><h1>TRUST IS NOT<br />A SCORE.<br /><em>IT IS A DECISION.</em></h1><p className="lede">TRUSTFABRIC lets decentralized applications define trust policies, register real-world evidence, and obtain finalized trust decisions through GenLayer AI-validator consensus.</p><button className="action" onClick={() => go("policy")}>BEGIN WITH A POLICY →</button></section>
  <section className="process" aria-label="Trust decision architecture">{["POLICY", "EVIDENCE", "CASE", "AI VALIDATORS", "CONSENSUS", "TRUST DECISION"].map((step, index) => <div key={step}><span>0{index + 1}</span><b>{step}</b>{index < 5 && <i>→</i>}</div>)}</section>
  <section className="metrics"><Metric value={counts.policies} label="POLICIES" /><Metric value={counts.evidence} label="EVIDENCE REFERENCES" /><Metric value={counts.cases} label="TRUST CASES" /><div><b>0</b><span>FINALIZED DECISIONS</span><small>Start the protocol: author → register → case → adjudicate.</small></div></section>
</> }
function Metric({ value, label }: { value: number; label: string }) { return <div><b>{value.toString().padStart(2, "0")}</b><span>{label}</span><small>On-chain registry count</small></div>; }

function PolicyLab({ transact }: { transact: (m: Parameters<typeof writeTrustFabric>[0], a: CalldataEncodable[]) => Promise<TxResult> }) { const [freezeId, setFreezeId] = useState(""); const [permission, setPermission] = useState(""); const [name, setName] = useState(""); const [purpose, setPurpose] = useState(""); const [criteria, setCriteria] = useState([""]); const [createdId, setCreatedId] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); const clean = criteria.map(x => x.trim()).filter(Boolean); const id = await transact("create_policy", [permission, name, purpose, clean]); if (id) { setCreatedId(id); setFreezeId(id); } };
  return <Page title="POLICY LAB" subtitle="A frozen policy is an executable permission rule — never a reputation score.">{createdId && <Success kind="POLICY CREATED" id={createdId} action="USE / FREEZE THIS POLICY" />}<form className="form-grid" onSubmit={e => void submit(e)}><Field label="Permission" value={permission} max={limits.permission} onChange={setPermission} required /><Field label="Policy name" value={name} max={limits.policyName} onChange={setName} required /><label>Purpose<textarea value={purpose} maxLength={limits.purpose} onChange={e => setPurpose(e.target.value)} required /><small>{purpose.length}/{limits.purpose}</small></label><div className="criteria"><b>EXECUTABLE CRITERIA / 1–{limits.criteria}</b>{criteria.map((criterion, index) => <label key={index}>#{index + 1}<input value={criterion} maxLength={limits.criterion} onChange={e => setCriteria(criteria.map((v, i) => i === index ? e.target.value : v))} required /></label>)}{criteria.length < limits.criteria && <button type="button" className="quiet" onClick={() => setCriteria([...criteria, ""])}>+ ADD CRITERION</button>}</div><button className="action" type="submit">CREATE POLICY</button></form><hr /><div className="inline-form"><Field label="Policy ID to freeze" value={freezeId} onChange={setFreezeId} /><button className="danger" onClick={() => void transact("freeze_policy", [freezeId])}>FREEZE POLICY</button><small>DRAFT → FROZEN. Frozen policies cannot be changed.</small></div></Page>; }

function EvidenceVault({ transact }: { transact: (m: Parameters<typeof writeTrustFabric>[0], a: CalldataEncodable[]) => Promise<TxResult> }) { const [form, setForm] = useState({ subject: "", source: "", hash: "", category: categories[0], label: "" }); const [createdId, setCreatedId] = useState(""); return <Page title="EVIDENCE VAULT" subtitle="Registration makes a source available for adjudication. Registered ≠ Verified.">{createdId && <Success kind="EVIDENCE REGISTERED" id={createdId} action="COPY / USE IN CREATE CASE" />}<form className="form-grid" onSubmit={async e => { e.preventDefault(); const id = await transact("register_evidence", [form.subject, form.source, form.hash, form.category, form.label]); if (id) setCreatedId(id); }}><Field label="Subject" value={form.subject} max={limits.subject} onChange={v => setForm({ ...form, subject: v })} required /><Field label="Public HTTP/HTTPS source" value={form.source} max={limits.source} onChange={v => setForm({ ...form, source: v })} required /><Field label="Provenance hash (optional 64 lowercase hex)" value={form.hash} onChange={v => setForm({ ...form, hash: v })} /><label>Category<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select></label><Field label="Evidence label" value={form.label} max={limits.label} onChange={v => setForm({ ...form, label: v })} /><button className="action">REGISTER EVIDENCE</button></form><aside className="warning">No source is deemed credible merely because it appears here. Credibility is assessed only during a finalized GenLayer adjudication.</aside></Page>; }

function CreateCase({ transact, go, initialEvidenceId, onCreated }: { transact: (m: Parameters<typeof writeTrustFabric>[0], a: CalldataEncodable[]) => Promise<TxResult>; go: (route: Route) => void; initialEvidenceId: string; onCreated: (id: string) => void }) { const [subject, setSubject] = useState(""); const [policy, setPolicy] = useState(""); const [permission, setPermission] = useState(""); const [ids, setIds] = useState(initialEvidenceId); const [createdId, setCreatedId] = useState(""); return <Page title="CREATE TRUST CASE" subtitle="Frozen policy → subject → registered evidence → consensus judgment.">{createdId && <Success kind="CASE CREATED" id={createdId} action="OPEN IN TRUST COURT" />}<form className="form-grid" onSubmit={async e => { e.preventDefault(); const evidence = ids.split(",").map(i => i.trim()).filter(Boolean); if (evidence.length < 1 || evidence.length > 8) return; const id = await transact("create_case", [subject, policy, permission, evidence]); if (id) { setCreatedId(id); onCreated(id); go("court"); } }}><Field label="Subject" value={subject} max={limits.subject} onChange={setSubject} required /><Field label="Frozen policy ID" value={policy} onChange={setPolicy} required /><Field label="Permission (exact frozen-policy match)" value={permission} onChange={setPermission} required /><label>Evidence IDs / ordered, comma-separated<input value={ids} onChange={e => setIds(e.target.value)} placeholder="evidence-1, evidence-2" required /><small>1–8 unique references; each must concern this exact subject.</small></label><div className="review">CASE INPUTS ARE IMMUTABLE AFTER CREATION. The contract independently enforces policy freeze, subject match, exact permission, and evidence uniqueness.</div><button className="action">CREATE OPEN CASE → TRUST COURT</button></form></Page>; }

function TrustCourt({ transact, initialCaseId }: { transact: (m: Parameters<typeof writeTrustFabric>[0], a: CalldataEncodable[]) => Promise<TxResult>; initialCaseId: string }) { const [id, setId] = useState(initialCaseId); const [caseData, setCaseData] = useState<TrustCase | null>(null); const [error, setError] = useState(""); const load = async () => { try { const loaded = await trustFabric.getCase(id); setCaseData(loaded); setError(""); return loaded; } catch (e) { setError(asMessage(e)); setCaseData(null); return null; } }; const normalizedStatus = String(caseData?.status ?? "").trim().toUpperCase(); const isOpen = normalizedStatus === "OPEN"; const adjudicate = async () => { const finalized = await transact("adjudicate_case", [id]); if (!finalized) return; for (let attempt = 0; attempt < 3; attempt += 1) { const loaded = await load(); if (String(loaded?.status ?? "").trim().toUpperCase() === "FINALIZED") return; await new Promise<void>(resolve => window.setTimeout(resolve, 750)); } setError("Transaction finalized, but this StudioNet read node has not exposed the finalized case yet. Click LOAD CASE to retry."); }; return <Page title="TRUST COURT" subtitle="A case is judged only against its frozen policy and immutable evidence set.">{initialCaseId && <Success kind="CASE CREATED" id={initialCaseId} action="READY FOR COURT / ADJUDICATION" />}<div className="inline-form"><Field label="Case ID" value={id} onChange={setId} /><button className="quiet" onClick={() => void load()}>LOAD CASE</button></div>{error && <p className="error">{error}</p>}{caseData ? <article className="court"><div><span>CASE</span><code>{id}</code><span>SUBJECT</span><b>{caseData.subject}</b><span>PERMISSION</span><b>{caseData.permission}</b><span>FROZEN POLICY</span><code>{caseData.policy_id}</code></div><div className="case-flow"><b className={isOpen ? "done" : ""}>{normalizedStatus || "UNKNOWN"}</b><i>→</i><b className={normalizedStatus === "FINALIZED" ? "done" : ""}>ADJUDICATING</b><i>→</i><b className={normalizedStatus === "FINALIZED" ? "done" : ""}>FINALIZED</b></div><div><span>EVIDENCE</span><b>{caseData.evidence_count} REFERENCES</b><span>CRITERIA</span><b>{caseData.criterion_count}</b><span>OUTCOME</span><Outcome value={caseData.outcome as Outcome} /><p>{caseData.summary || "No adjudication summary yet."}</p></div><div className="court-action">{isOpen ? <button className="action" onClick={() => void adjudicate()}>ADJUDICATE CASE WITH GENLAYER VALIDATORS</button> : <small>Adjudication is available only while the recorded case status is OPEN.</small>}</div><small>This view does not invent validator votes; the contract does not expose them.</small></article> : <div className="empty">No loaded case. Create a policy, freeze it, register evidence, then open a case.</div>}</Page>; }

function Passport() { const [subject, setSubject] = useState(""); const [data, setData] = useState<{ passport: Awaited<ReturnType<typeof trustFabric.getPassport>>; decisions: Awaited<ReturnType<typeof trustFabric.getSubjectDecisionPage>> } | null>(null); return <Page title="TRUST PASSPORT" subtitle="A living, immutable history of adjudicated decisions — not a score."><div className="inline-form"><Field label="Subject" value={subject} onChange={setSubject} /><button className="quiet" onClick={() => void (async () => { const passport = await trustFabric.getPassport(subject); const decisions = passport.decision_count ? await trustFabric.getSubjectDecisionPage(subject, 0, Math.min(Number(passport.decision_count), 25)) : []; setData({ passport, decisions }); })()}>LOOK UP PASSPORT</button></div>{data && <article className="passport"><h2>{data.passport.subject}</h2><div className="passport-counts"><Metric value={Number(data.passport.decision_count)} label="DECISIONS" /><Metric value={Number(data.passport.granted_count)} label="GRANTED" /><Metric value={Number(data.passport.denied_count)} label="DENIED" /><Metric value={Number(data.passport.insufficient_count)} label="INSUFFICIENT" /></div><h3>IMMUTABLE HISTORY</h3>{data.decisions.length ? data.decisions.map(d => <div className="decision" key={d.case_id}><code>{d.case_id}</code><Outcome value={d.outcome} /><span>{d.permission}</span><time>{d.resolved_at}</time></div>) : <div className="empty">No finalized decisions. There is no score to show.</div>}</article>}</Page>; }

function Terminal() { const [subject, setSubject] = useState(""); const [policy, setPolicy] = useState(""); const [result, setResult] = useState<Outcome | null>(null); return <Page title="PERMISSION TERMINAL" subtitle="The composability primitive another application can consume."><div className="terminal"><Field label="Subject" value={subject} onChange={setSubject} /><Field label="Policy ID" value={policy} onChange={setPolicy} /><button className="action" onClick={() => void trustFabric.getLatestPolicyDecision(subject, policy).then(setResult)}>QUERY LATEST DECISION</button>{result && <Outcome value={result} />}</div><p>Returns exactly: TRUST_GRANTED, TRUST_DENIED, INSUFFICIENT_EVIDENCE, or NO_DECISION. TRUSTFABRIC adjudicates permission-specific trust; it does not calculate credit scores.</p></Page>; }

function Explorer({ counts }: { counts: { policies: number; evidence: number; cases: number } }) { const [tab, setTab] = useState<"policies" | "evidence" | "cases">("policies"); const [items, setItems] = useState<(Policy | Evidence | TrustCase)[]>([]); const [start, setStart] = useState(0); const count = tab === "policies" ? counts.policies : tab === "evidence" ? counts.evidence : counts.cases; const load = async (next = start) => { setStart(next); if (tab === "policies") { const ids = await Promise.all(Array.from({ length: Math.min(10, Math.max(0, counts.policies - next)) }, (_, i) => trustFabric.getPolicyIdAt(next + i))); setItems(await Promise.all(ids.map(trustFabric.getPolicy))); } else if (tab === "evidence") setItems(await trustFabric.getEvidencePage(next, Math.min(10, Math.max(1, counts.evidence - next)))); else setItems(await trustFabric.getCasePage(next, Math.min(10, Math.max(1, counts.cases - next)))); }; return <Page title="EXPLORER" subtitle="Bounded, on-chain registry views. Never an unbounded client-side scan."><div className="tabs">{(["policies", "evidence", "cases"] as const).map(t => <button className={t === tab ? "active" : ""} onClick={() => { setTab(t); setItems([]); setStart(0); }}>{t}</button>)}</div><button className="quiet" onClick={() => void load()}>LOAD {tab.toUpperCase()} / {count}</button>{!count ? <div className="empty">This registry is empty. Production UI never substitutes fake protocol records.</div> : <div className="explore-list">{items.map((item, index) => <pre key={index}>{JSON.stringify(item, null, 2)}</pre>)}<div><button disabled={start === 0} onClick={() => void load(Math.max(0, start - 10))}>← PREVIOUS</button><button disabled={start + 10 >= count} onClick={() => void load(start + 10)}>NEXT →</button></div></div>}</Page>; }

function Success({ kind, id, action }: { kind: string; id: string; action: string }) { return <aside className="success" role="status"><b>{kind}</b><code>{id}</code><button className="quiet" onClick={() => void navigator.clipboard?.writeText(id)}>COPY ID</button><small>{action}</small></aside>; }
function Outcome({ value }: { value: Outcome }) { const label = value || "OPEN"; return <strong className={`outcome ${label.toLowerCase()}`}>{label.replaceAll("_", " ")}</strong>; }
function Page({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="page"><p className="eyebrow">TRUSTFABRIC / {network.name.toUpperCase()}</p><h1>{title}</h1><p className="lede">{subtitle}</p>{children}</section>; }
function Field({ label, value, onChange, max, required }: { label: string; value: string; onChange: (value: string) => void; max?: number; required?: boolean }) { return <label>{label}<input value={value} maxLength={max} onChange={e => onChange(e.target.value)} required={required} />{max && <small>{value.length}/{max}</small>}</label>; }
