import { useEffect, useRef, useState } from "react";
import type { AppState, AuditEntry, CommitPayload, Contract, ContractData, NewUserInput, PlanStep, Role, User, View } from "./types.ts";
import { api, ApiError, portalApi } from "./api.ts";
import { C, font, iStyle, ROLE_LABELS, sans, shadow } from "./theme.ts";
import { fmtDate, keyDate, tsNow } from "./lib/format.ts";
import { clearLocal, DEMO_PASSWORD, DEMO_USERS, demoState, loadLocal, saveLocal } from "./lib/demo.ts";
import { makePlan, RENEWAL_BY_DECISION, reschedulePlan, stepTemplate } from "./lib/plan.ts";
import { canCreateContract, canManageUsers } from "./permissions.ts";
import { Avatar, BrandMark } from "./components/ui.tsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, Plus, Search, Settings } from "./components/icons.tsx";
import { InviteLanding } from "./components/InviteLanding.tsx";
import { LoginScreen } from "./components/LoginScreen.tsx";
import { BOFormModal, ContractForm } from "./components/Modals.tsx";
import { AccountMenu } from "./components/AccountMenu.tsx";
import { getLang, setLang, t } from "./i18n/index.ts";
import { ContractList } from "./views/ContractList.tsx";
import { ContractDetail } from "./views/ContractDetail.tsx";
import { TeamView } from "./views/TeamView.tsx";
import { BOView } from "./views/BOView.tsx";
import { UsersView } from "./views/UsersView.tsx";
import { SupplierPortal } from "./views/SupplierPortal.tsx";
import { VendorsView } from "./views/VendorsView.tsx";
import { ConfigView } from "./views/ConfigView.tsx";
import { ExpiryView } from "./views/ExpiryView.tsx";
import { TasksView } from "./views/TasksView.tsx";
import { KpiView } from "./views/KpiView.tsx";
import { teamSummary } from "./lib/plan.ts";
import { BudgetView } from "./views/BudgetView.tsx";
import { SpendView } from "./views/SpendView.tsx";
import { RequestsView } from "./views/RequestsView.tsx";
import { ClausesView } from "./views/ClausesView.tsx";
import { ReviewsView } from "./views/ReviewsView.tsx";
import { navTabsFor, tabOfView } from "./lib/modules.tsx";

type Mode = "loading" | "api" | "local";
const REVIEWER_ROLES = ["legal", "compliance", "itsec"];
/** Pagina d'arrivo dopo l'accesso: la prima voce della navigazione del ruolo (per Manager e Buyer i Task, il lavoro di oggi). */
const homeFor = (u: User, apiMode: boolean): View => (u.role === "supplier" ? "supplier" : navTabsFor(u, apiMode)[0]?.key ?? "list");
/** Ruoli che non lavorano sui contratti: non serve caricarli. */
const hasContracts = (u: User) => u.role !== "supplier" && u.role !== "finance" && !REVIEWER_ROLES.includes(u.role);
const EMPTY: AppState = { contracts: [], plans: {}, auditLogs: {} };

export default function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [setupRequired, setSetupRequired] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<View>("list");
  /** Pratica o fornitore da aprire subito dopo un clic su "Da fare adesso". */
  const [focus, setFocus] = useState<{ taskId?: number; vendorId?: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [data, setData] = useState<AppState>(EMPTY);
  const { contracts, plans, auditLogs } = data;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [boFormContract, setBOFormContract] = useState<Contract | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [reviewFocus, setReviewFocus] = useState<number | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get("invite"));

  // Il dettaglio legge sempre la versione aggiornata del contratto (es. dopo una risposta BO).
  const selected = selectedId !== null ? contracts.find(c => c.id === selectedId) ?? null : null;

  const showToast = (msg: string) => { clearTimeout(toastTimer.current); setToast(msg); toastTimer.current = setTimeout(() => setToast(null), 3500); };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const resetSession = () => { setCurrentUser(null); setShowAccount(false); setShowForm(false); setEditingContract(null); setBOFormContract(null); setSelectedId(null); setView("list"); if (mode === "api") { setData(EMPTY); setUsers([]); } };
  /** Link delle email (?review=ID per le funzioni, ?task=ID per il buyer): apre direttamente la bozza o il task. */
  const applyDeepLink = (user: User) => {
    const q = new URLSearchParams(window.location.search), rv = Number(q.get("review")), tk = Number(q.get("task"));
    if (!rv && !tk) return;
    if (rv > 0 && (REVIEWER_ROLES.includes(user.role) || user.role === "bo")) { setReviewFocus(rv); setView("reviews"); }
    else if (tk > 0 && (user.role === "manager" || user.role === "buyer")) { setFocus({ taskId: tk }); setView("tasks"); }
    window.history.replaceState(null, "", window.location.pathname);
  };
  const sessionExpired = () => { resetSession(); showToast(t("Sessione scaduta: accedi di nuovo")); };

  /** Gestisce gli errori comuni dell'API. Restituisce true se l'errore è stato gestito. */
  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { sessionExpired(); return true; }
    return false;
  };

  const loadAll = async (user: User) => {
    try {
      if (hasContracts(user)) setData(await api.loadState());
      if (canManageUsers(user)) setUsers(await api.listUsers());
    } catch (err) { if (!handleApiError(err)) showToast("⚠️ " + t("Impossibile caricare i dati")); }
  };

  // All'avvio: sessione esistente? Se l'API non risponde si passa alla modalità demo locale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let user: User | null = null;
      try { user = (await api.me()).user; if (!cancelled) setMode("api"); if (user.lang && user.lang !== getLang()) { setLang(user.lang); return; } }
      catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) { setMode("api"); setSetupRequired(err.data.setupRequired === true); }
        else { setData(loadLocal() ?? demoState()); setUsers(DEMO_USERS); setMode("local"); }
        return;
      }
      if (cancelled) return;
      setCurrentUser(user); setView(homeFor(user, true)); applyDeepLink(user);
      await loadAll(user);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con più utenti sul database, ricarica i dati quando si torna sulla scheda.
  useEffect(() => {
    if (mode !== "api" || !currentUser || !hasContracts(currentUser)) return;
    const refresh = () => { if (document.visibilityState === "visible") api.loadState().then(setData).catch(handleApiError); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentUser]);

  useEffect(() => { if (mode === "local") saveLocal(data); }, [mode, data]);

  // ─── Accesso ───────────────────────────────────────────────
  const handleLogin = async (email: string, password: string): Promise<string | null> => {
    if (mode === "local") {
      const user = DEMO_USERS.find(u => u.email === email.trim().toLowerCase());
      if (!user || password !== DEMO_PASSWORD) return t("Credenziali non valide");
      setCurrentUser(user); setView(homeFor(user, false));
      return null;
    }
    try {
      const { user } = await api.login(email, password);
      // La lingua scelta sul profilo vale su ogni dispositivo: se è diversa l'app si ridisegna e riparte dalla sessione appena aperta.
      if (user.lang && user.lang !== getLang()) { setLang(user.lang); return null; }
      setCurrentUser(user); setView(homeFor(user, true)); setSetupRequired(false); applyDeepLink(user);
      await loadAll(user);
      return null;
    } catch (err) { return err instanceof ApiError ? err.message : t("Impossibile contattare il server"); }
  };
  const handleLogout = () => { if (mode === "api") api.logout().catch(() => undefined); resetSession(); };
  const handleResetDemo = () => { clearLocal(); setData(demoState()); showToast("↺ " + t("Dati demo ripristinati")); };

  // ─── Salvataggio ───────────────────────────────────────────
  // Scrive sul database (nessuna operazione in modalità locale). Se fallisce ricarica lo stato dal server per annullare le modifiche ottimistiche.
  const persist = async (payload: CommitPayload): Promise<{ ok: boolean; contractId?: number }> => {
    if (mode !== "api") return { ok: true };
    try { return { ok: true, contractId: (await api.commit(payload)).contractId }; }
    catch (err) {
      if (handleApiError(err)) return { ok: false };
      showToast(err instanceof ApiError && err.status === 403 ? "⛔ " + t("Operazione non consentita per il tuo ruolo") : "⚠️ " + t("Salvataggio non riuscito: dati ricaricati dal server"));
      api.loadState().then(setData).catch(handleApiError);
      return { ok: false };
    }
  };

  const entry = (action: string, detail: string, user?: string): AuditEntry => ({ ts: tsNow(), user: user || currentUser?.name || "Sistema", action, detail });
  const pushAudit = (s: AppState, id: number, entries: AuditEntry[]): AppState => ({ ...s, auditLogs: { ...s.auditLogs, [id]: [...(s.auditLogs[id] || []), ...entries] } });

  const handleSave = async (form: ContractData) => {
    if (!currentUser) return;
    if (editingContract) {
      const id = editingContract.id;
      const audit = [entry("Contratto modificato", `Da ${currentUser.name}`)];
      let plan: PlanStep[] | undefined;
      if (keyDate(form) !== keyDate(editingContract)) {
        plan = reschedulePlan(plans[id] || [], id, keyDate(form), (editingContract.boLeadDays ?? 75) - 75);
        audit.push(entry("Piano ricalcolato", form.noticeDate ? `Nuovo termine di disdetta: ${fmtDate(form.noticeDate)} (scadenza ${fmtDate(form.end)})` : `Nuova scadenza: ${fmtDate(form.end)}`, "Sistema"));
      }
      if (!(await persist({ contract: { ...form, id }, plan, audit })).ok) return;
      setData(s => pushAudit({ ...s, contracts: s.contracts.map(c => c.id === id ? { ...c, ...form, owner: currentUser.role === "buyer" ? c.owner : form.owner } : c), plans: plan ? { ...s.plans, [id]: plan } : s.plans }, id, audit));
      showToast("💾 " + t("Aggiornato"));
      // Con il server si rilegge tutto: nome e collegamento del Business Owner li calcola lui.
      if (mode === "api") void loadAll(currentUser);
    } else {
      const audit = [entry("Contratto creato", `${form.supplier} · ${form.object}`)];
      const plan = makePlan(0, keyDate(form));
      const res = await persist({ contract: form, plan, audit });
      if (!res.ok) return;
      const newId = res.contractId ?? Math.max(...contracts.map(c => c.id), 0) + 1;
      const owner = currentUser.role === "buyer" ? currentUser.name : form.owner;
      setData(s => pushAudit({ ...s, contracts: [...s.contracts, { ...form, owner, id: newId }], plans: { ...s.plans, [newId]: plan.map(st => ({ ...st, contractId: newId })) } }, newId, audit));
      showToast("✅ " + t("Contratto aggiunto"));
      if (mode === "api") void loadAll(currentUser);
    }
    setShowForm(false); setEditingContract(null);
  };

  const updatePlan = async (id: number, plan: PlanStep[], audit: AuditEntry[], contract?: Contract) => {
    if (!(await persist({ contractId: id, contract, plan, audit })).ok) return false;
    setData(s => pushAudit({ ...s, plans: { ...s.plans, [id]: plan }, contracts: contract ? s.contracts.map(c => c.id === id ? contract : c) : s.contracts }, id, audit));
    return true;
  };

  const handleSendBO = async (id: number) => {
    const c = contracts.find(x => x.id === id);
    if (!c) return;
    if (mode === "api") {
      try { await portalApi.sendBoNotice(id); if (currentUser) await loadAll(currentUser); showToast("✉️ " + t("Avviso inviato a {email}", { email: c.boEmail })); }
      catch (err) { if (!handleApiError(err)) showToast(`⚠️ ${err instanceof Error ? err.message : t("Invio non riuscito")}`); }
      return;
    }
    const plan = (plans[id] || []).map(s => s.stepId === "bo_notify" ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: "Sistema" } : s.stepId === "bo_response" ? { ...s, status: "pending_bo" as const } : s);
    if (await updatePlan(id, plan, [entry("Notifica BO inviata", `A: ${c.boEmail || "—"}`, "Sistema")]))
      showToast(c.boEmail ? "✉️ " + t("Notifica registrata per {email}", { email: c.boEmail }) : "⚠️ " + t("Nessuna email BO impostata per questo contratto"));
  };

  const handleBOResponse = async (id: number, { decision, notes }: { decision: string; notes: string }) => {
    const c = contracts.find(x => x.id === id);
    if (!c || !currentUser) return;
    const plan = (plans[id] || []).map(s => s.stepId === "bo_response" ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: currentUser.role === "bo" ? currentUser.email : `${currentUser.name} (per conto del BO)`, boDecision: decision, boNotes: notes, boRespondedAt: fmtDate(new Date()) } : s);
    const renewal = RENEWAL_BY_DECISION[decision];
    const updated = renewal ? { ...c, renewal } : c;
    const audit = [entry("Risposta BO ricevuta", `Decisione: ${decision}${notes ? ` · "${notes}"` : ""}`)];
    if (await updatePlan(id, plan, audit, updated)) showToast("✅ " + t("Decisione BO registrata"));
    setBOFormContract(null);
  };

  const handleCompleteStep = async (id: number, stepId: string) => {
    if (!currentUser) return;
    const tmpl = stepTemplate(stepId);
    const plan = (plans[id] || []).map(s => s.stepId === stepId ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: currentUser.name } : s);
    if (await updatePlan(id, plan, [entry(`Attività completata: ${tmpl.label}`, `Da ${currentUser.name}`)])) showToast("✓ " + t("\"{step}\" completata", { step: t(tmpl.label) }));
  };

  const handleUpdateStepDate = async (id: number, stepId: string, newDate: string, reason: string) => {
    const tmpl = stepTemplate(stepId);
    const plan = (plans[id] || []).map(s => s.stepId === stepId ? { ...s, scheduledDate: newDate, modified: true, modifiedReason: reason } : s);
    if (await updatePlan(id, plan, [entry(`Data modificata: ${tmpl.label}`, `Nuova data: ${fmtDate(newDate)} · Motivo: ${reason}`)])) showToast("📅 " + t("Data aggiornata"));
  };

  const handleApplySuggestion = async (id: number, offset: number) => {
    const c = contracts.find(x => x.id === id);
    if (!c) return;
    if (await updatePlan(id, makePlan(id, keyDate(c), offset), [entry("Piano anticipato", `Anticipo di ${offset} giorni`, "Sistema")])) showToast("⏩ " + t("Piano anticipato di {n} giorni", { n: offset }));
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm(t("Eliminare definitivamente il contratto con {supplier}? Verranno eliminati anche piano e storico.", { supplier: selected.supplier }))) return;
    const id = selected.id;
    if (!(await persist({ deleteContractId: id })).ok) return;
    setData(s => {
      const plansLeft = { ...s.plans }, auditLeft = { ...s.auditLogs };
      delete plansLeft[id]; delete auditLeft[id];
      return { contracts: s.contracts.filter(c => c.id !== id), plans: plansLeft, auditLogs: auditLeft };
    });
    setSelectedId(null); setView("list");
    showToast("🗑 " + t("Contratto eliminato"));
  };

  // ─── Gestione utenti (solo manager) ────────────────────────
  const userError = (err: unknown) => (handleApiError(err) ? t("Sessione scaduta") : err instanceof ApiError ? err.message : t("Operazione non riuscita"));
  const handleCreateUser = async (input: NewUserInput): Promise<string | null> => {
    try { const u = await api.createUser(input); setUsers(list => [...list, u]); showToast("✅ " + t("Utente {name} creato", { name: u.name })); return null; } catch (err) { return userError(err); }
  };
  const handleUpdateUser = async (id: number, patch: { active?: boolean; password?: string; role?: Role; title?: string; sapUser?: string }): Promise<string | null> => {
    try {
      const u = await api.updateUser({ id, ...patch });
      setUsers(list => list.map(x => x.id === id ? u : x));
      showToast(patch.password ? "🔑 " + t("Password reimpostata") : patch.active !== undefined ? (u.active ? t("Utente riattivato") : t("Utente disattivato")) : "✅ " + t("Utente aggiornato"));
      return null;
    } catch (err) { const m = userError(err); showToast(`⚠️ ${m}`); return m; }
  };
  const handleDeleteUser = async (u: User) => {
    if (!window.confirm(t("Eliminare definitivamente {name} ({email})? L'operazione non si può annullare. In alternativa puoi disattivarlo.", { name: u.name, email: u.email }))) return;
    try { await api.deleteUser(u.id); setUsers(list => list.filter(x => x.id !== u.id)); showToast("🗑 " + t("Utente {name} eliminato", { name: u.name })); }
    catch (err) { showToast(`⚠️ ${userError(err)}`); }
  };
  const handlePurge = async () => {
    if (window.prompt(t("Verranno eliminati TUTTI i contratti, con piani e storico. Scrivi ELIMINA per confermare.")) !== "ELIMINA") return;
    try { const { deleted } = await api.purge(); setData(EMPTY); setSelectedId(null); showToast("🗑 " + t("{n} contratti eliminati", { n: deleted })); } catch (err) { if (!handleApiError(err)) showToast("⚠️ " + t("Operazione non riuscita")); }
  };

  const openDetail = (c: Contract) => { setSelectedId(c.id); setView("detail"); };
  const openNew = () => { setEditingContract(null); setShowForm(true); };

  // I messaggi iniziano con un'emoji decorativa (⚠️ ⛔ ✅ …): la si sostituisce con un'icona coerente.
  const isWarn = !!toast && /^(⚠|⛔)/u.test(toast);
  const toastText = toast ? toast.replace(/^[^\p{L}\p{N}"'«]+/u, "") : "";
  const toastEl = toast && (
    <div role="status" className="toast" style={{ position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)", maxWidth: "92vw", background: C.navy, color: "#fff", padding: "11px 18px 11px 14px", borderRadius: 14, fontWeight: 550, fontSize: 13.5, zIndex: 400, boxShadow: shadow.lg, ...sans, display: "flex", alignItems: "center", gap: 10 }}>
      {isWarn ? <AlertTriangle size={18} color="#f5c55a" /> : <CheckCircle2 size={18} color="#5fd0a0" />}
      <span>{toastText}</span>
    </div>
  );

  // Sul telefono scorre solo il contenuto (la barra in basso resta ferma): cambiando pagina si riparte dall'alto.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [view]);
  // Altezza dell'intestazione: i filtri "fissi" delle liste si fermano subito sotto.
  useEffect(() => {
    const el = scrollRef.current?.querySelector(".topbar");
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", `${(el as HTMLElement).offsetHeight}px`);
    set(); const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect();
  }, [view, currentUser]);
  // Dopo la tastiera il browser del telefono a volte lascia la pagina spostata: la riportiamo a posto.
  useEffect(() => {
    const fix = () => { if (window.innerWidth < 960) setTimeout(() => window.scrollTo(0, 0), 50); };
    window.addEventListener("focusout", fix); return () => window.removeEventListener("focusout", fix);
  }, []);

  if (mode === "loading") return (
    <div style={{ ...sans, minHeight: "100vh", background: C.navy, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "rgba(255,255,255,.7)", fontSize: 13.5 }}>
      <BrandMark size={52} /><Loader2 className="spin" size={22} /><span>{t("Caricamento…")}</span>
    </div>
  );

  const leaveInvite = () => { setInviteToken(null); window.history.replaceState(null, "", window.location.pathname); };
  if (!currentUser && inviteToken && mode === "api") return (
    <><InviteLanding token={inviteToken} onCancel={leaveInvite} onActivated={user => { leaveInvite(); setCurrentUser(user); setView("supplier"); showToast(t("Account creato: completa la registrazione")); }} />{toastEl}</>
  );

  // Link d'invito aperto da un browser dove è già collegato qualcuno (es. il Manager che prova l'invito): senza questo avviso si vedrebbe l'app normale.
  if (currentUser && inviteToken && mode === "api") return (
    <div className="login-panel" style={{ minHeight: "100vh" }}>
      <div style={{ width: "100%", maxWidth: 430, background: "#fff", borderRadius: 20, padding: 32, boxShadow: "0 24px 60px rgba(16,24,43,.18)", border: `1px solid ${C.border}`, ...sans }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}><BrandMark size={48} /></div>
        <h1 style={{ ...font, fontSize: 21, margin: "0 0 8px", color: C.text, textAlign: "center" }}>{t("Hai aperto un invito per fornitori")}</h1>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: "0 0 20px", textAlign: "center" }}>{t("In questo browser sei già collegato come")} <b>{currentUser.name}</b> ({t(ROLE_LABELS[currentUser.role])}). {t("Per vedere l'invito come lo vede il fornitore devi uscire da questo account, oppure aprire il link in una finestra in incognito.")}</p>
        <button onClick={() => { handleLogout(); }} style={{ width: "100%", height: 46, background: C.accent, border: "none", borderRadius: 11, color: "#fff", fontWeight: 650, fontSize: 15, cursor: "pointer", marginBottom: 10 }}>{t("Esci e apri l'invito")}</button>
        <button onClick={leaveInvite} style={{ width: "100%", height: 44, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>{t("Continua come {name}", { name: currentUser.name.split(" ")[0] })}</button>
      </div>
    </div>
  );

  if (!currentUser) return <><LoginScreen mode={mode} setupRequired={setupRequired} onLogin={handleLogin} onResetDemo={mode === "local" ? handleResetDemo : undefined} />{toastEl}</>;

  // I fornitori hanno un'area dedicata, senza menu né dati interni.
  if (currentUser.role === "supplier") return (
    <div className="app-shell no-sidebar" style={{ ...sans, color: C.text }}>
      <div className="main-col">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 920, margin: "0 auto" }}>
          <BrandMark size={32} />
          <div style={{ flex: 1, minWidth: 0 }}><div className="topbar-eyebrow">{t("Portale fornitori")}</div><div className="topbar-title">{currentUser.name}</div></div>
          <button onClick={() => setShowAccount(true)} aria-label={t("Account")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><Avatar name={currentUser.name} size={34} /></button>
        </div>
      </header>
      <main className="page"><SupplierPortal onSessionExpired={sessionExpired} notify={showToast} /></main>
      </div>
      {showAccount && <AccountMenu user={currentUser} anchor="top" canChangePassword onProfileSaved={patch => setCurrentUser(u => (u ? { ...u, ...patch } : u))} onLogout={handleLogout} onClose={() => setShowAccount(false)} />}
      {toastEl}
    </div>
  );

  // ─── Navigazione per ruolo ─────────────────────────────────
  // Una pagina per voce, al massimo cinque voci: le stesse nella barra laterale (PC) e nella barra fissa in basso (telefono).
  // Indicatori e Amministrazione (solo Manager) si aprono dal menu del profilo.
  const tabs = navTabsFor(currentUser, mode === "api");
  const activeTab = tabOfView(view, currentUser.role);
  const inContracts = view === "list" || view === "detail";
  const titles: Record<View, string> = { clauses: t("Libreria clausole"), reviews: t("Revisioni"), dashboard: t("Contratti"), list: t("Contratti"), planning: t("Contratti"), team: t("Contratti"), notifiche: t("Contratti"), bo: t("Le mie richieste"), users: t("Utenti e permessi"), vendors: t("Fornitori"), expiries: t("Scadenze documenti"), tasks: t("Task"), kpi: t("Indicatori di processo"), budget: t("Master Plan"), spend: t("Spesa"), requests: t("Le mie RDA e i miei contratti"), hub: t("Task"), config: t("Configurazione"), supplier: t("Area fornitore"), detail: selected?.supplier ?? "" };
  const eyebrow = view === "config" || view === "users" ? t("Amministrazione") : view === "kpi" ? t("Indicatori") : view === "detail" ? t("Contratti") : view === "clauses" && activeTab === "list" ? t("Contratti") : "";
  const sideBtn = (key: string, label: string, icon: React.ReactNode, on: boolean, click: () => void) => (
    <button key={key} onClick={click} aria-current={on ? "page" : undefined} style={{ ...sans, position: "relative", display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px", marginBottom: 3, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: on ? 650 : 500, background: on ? "rgba(255,255,255,.1)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,.66)", textAlign: "left" }}>
      {on && <span aria-hidden style={{ position: "absolute", left: -14, top: 8, bottom: 8, width: 4, borderRadius: "0 4px 4px 0", background: C.accent }} />}
      <span style={{ display: "flex", color: on ? "#fff" : "rgba(255,255,255,.55)" }}>{icon}</span>{label}
    </button>
  );
  const tabBtn = (key: string, label: string, icon: React.ReactNode, on: boolean, click: () => void) => (
    <button key={key} onClick={click} aria-current={on ? "page" : undefined} style={{ flex: "1 1 0", minWidth: 0, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: on ? C.accent : C.subtle, padding: "2px 0" }}>
      <span style={{ display: "flex" }}>{icon}</span>
      <span style={{ ...sans, fontSize: 10.5, color: on ? C.accent : C.muted, fontWeight: on ? 650 : 500, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
  /** Due pagine dello stesso argomento nella stessa voce (Fornitori/Scadenze documenti, Configurazione/Utenti): si passa dall'una all'altra senza lasciare la voce. */
  const subTabs = (items: [View, string][]) => (
    <div role="tablist" style={{ display: "inline-flex", gap: 2, background: "#e9ecf2", borderRadius: 12, padding: 3, marginBottom: 16 }}>
      {items.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} style={{ ...sans, padding: "8px 14px", border: "none", borderRadius: 9, background: view === k ? "#fff" : "transparent", boxShadow: view === k ? shadow.sm : "none", color: view === k ? C.text : C.muted, fontWeight: view === k ? 650 : 500, fontSize: 13, cursor: "pointer" }}>{l}</button>)}
    </div>
  );

  return (
    <div className={`app-shell${tabs.length > 1 ? " has-tabbar" : ""}`} style={{ ...sans, color: C.text }}>
      {/* Menu laterale (desktop) */}
      <aside className="sidebar" aria-label={t("Menu principale")}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 26px" }}>
          <BrandMark size={38} />
          <div><div style={{ ...font, fontSize: 16, fontWeight: 700, color: "#fff" }}>Procurement Lab</div><div style={{ fontSize: 11, color: "rgba(255,255,255,.45)" }}>Indirect</div></div>
        </div>
        {tabs.length > 1 && <nav aria-label={t("Menu principale")}>{tabs.map(x => sideBtn(x.key, x.label, x.icon(19), activeTab === x.key, () => setView(x.key)))}</nav>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAccount(true)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, background: "rgba(255,255,255,.06)", cursor: "pointer", textAlign: "left", width: "100%" }}>
          <Avatar name={currentUser.name} size={36} />
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ ...sans, fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.name}</div><div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,.5)" }}>{t(ROLE_LABELS[currentUser.role])}</div></div>
          <Settings size={16} color="rgba(255,255,255,.5)" />
        </button>
      </aside>

      <div className="main-col" ref={scrollRef}>
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(view === "detail" || (view === "clauses" && activeTab === "list")) && <button className="topbar-back" onClick={() => setView("list")} aria-label={t("Torna alla lista")} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", flexShrink: 0 }}><ChevronLeft size={22} /></button>}
            <div style={{ flex: 1, minWidth: 0 }}>
              {eyebrow !== titles[view] && <div className="topbar-eyebrow">{eyebrow}</div>}
              <div className="topbar-title">{titles[view]}</div>
            </div>
            {inContracts && hasContracts(currentUser) && currentUser.role !== "bo" && (
              <div className="topbar-search" style={{ position: "relative", width: 300 }}>
                <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                <input value={listSearch} onChange={e => { setListSearch(e.target.value); if (view !== "list") setView("list"); }} placeholder={t("Cerca fornitore, oggetto, owner…")} aria-label={t("Cerca contratti")} style={{ ...iStyle, padding: "9px 12px 9px 36px", borderRadius: 10, background: "#fff" }} />
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {inContracts && canCreateContract(currentUser) && (
                <button className="desktop-only-flex" onClick={openNew} aria-label={t("Nuovo contratto")} style={{ ...sans, alignItems: "center", gap: 6, background: C.accent, border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 13, padding: "8px 12px", fontWeight: 650, flexShrink: 0, boxShadow: "0 1px 2px rgba(200,82,42,.35)" }}><Plus size={17} /><span className="desktop-label">{t("Nuovo contratto")}</span></button>
              )}
              <button className="mobile-only" onClick={() => setShowAccount(true)} aria-label={t("Account")} style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: 0 }}>
                <Avatar name={currentUser.name} size={32} />
              </button>
            </div>
          </div>
        </header>

        {mode === "local" && (
          <div style={{ ...sans, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.yellowBg, color: C.yellow, fontSize: 12, fontWeight: 600, textAlign: "center", padding: "7px 12px", borderBottom: "1px solid #f3dca0" }}>
            <AlertTriangle size={14} />{t("Modalità demo: database non raggiungibile, i dati sono salvati solo in questo browser")}
          </div>
        )}

        <main className="page">
          {view === "list" && <ContractList contracts={contracts} plans={plans} currentUser={currentUser} search={listSearch} onSearch={setListSearch} onSelect={openDetail} onNew={openNew} onOpenClauses={mode === "api" && (currentUser.role === "manager" || currentUser.role === "buyer") ? () => setView("clauses") : undefined} onOpenKpi={currentUser.role === "manager" && mode === "api" ? () => setView("kpi") : undefined} />}
          {view === "bo" && currentUser.role === "bo" && <BOView contracts={contracts} plans={plans} currentUser={currentUser} onOpenBOForm={setBOFormContract} />}
          {view === "requests" && mode === "api" && currentUser.role === "bo" && <RequestsView currentUser={currentUser} contracts={contracts} onOpenBOForm={setBOFormContract} onOpenContract={openDetail} onSessionExpired={sessionExpired} />}
          {view === "reviews" && mode === "api" && (REVIEWER_ROLES.includes(currentUser.role) || currentUser.role === "bo") && <ReviewsView currentUser={currentUser} initialOpenId={reviewFocus} onSessionExpired={sessionExpired} />}
          {view === "clauses" && mode === "api" && ["manager", "buyer", "legal", "compliance", "itsec"].includes(currentUser.role) && <ClausesView currentUser={currentUser} onSessionExpired={sessionExpired} />}
          {(view === "config" || view === "users") && currentUser.role === "manager" && mode === "api" && subTabs([["config", t("Configurazione")], ["users", t("Utenti")]])}
          {view === "users" && canManageUsers(currentUser) && <UsersView users={users} currentUser={currentUser} onCreate={handleCreateUser} onUpdate={handleUpdateUser} onDelete={handleDeleteUser} onPurge={handlePurge} />}
          {view === "tasks" && mode === "api" && (currentUser.role === "manager" || currentUser.role === "buyer") && <TasksView onUpdateStepDate={handleUpdateStepDate} initialOpenId={focus?.taskId} onFocusUsed={() => setFocus(null)} currentUser={currentUser} contracts={contracts} plans={plans} onCompleteStep={handleCompleteStep} onSendBO={handleSendBO} onOpenContract={openDetail} notify={showToast} onSessionExpired={sessionExpired} />}
          {(view === "vendors" || view === "expiries") && mode === "api" && <div className={view === "vendors" ? "desktop-only" : undefined}>{subTabs([["vendors", t("Fornitori")], ["expiries", t("Scadenze documenti")]])}</div>}
          {view === "vendors" && mode === "api" && <VendorsView onOpenExpiries={() => setView("expiries")} initialOpenId={focus?.vendorId} onFocusUsed={() => setFocus(null)} currentUser={currentUser} notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "expiries" && mode === "api" && <ExpiryView currentUser={currentUser} notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "budget" && mode === "api" && ["manager", "buyer", "finance", "viewer"].includes(currentUser.role) && <BudgetView currentUser={currentUser} notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "spend" && mode === "api" && ["manager", "buyer", "finance", "viewer"].includes(currentUser.role) && <SpendView onSessionExpired={sessionExpired} canImport={currentUser.role === "manager" || currentUser.role === "buyer"} />}
          {view === "kpi" && mode === "api" && currentUser.role === "manager" && <KpiView onSessionExpired={sessionExpired} team={<TeamView contracts={contracts} plans={plans} onApplySuggestion={handleApplySuggestion} onOpenContract={openDetail} />} teamSummary={teamSummary(contracts, plans)} />}
          {view === "config" && mode === "api" && currentUser.role === "manager" && <ConfigView notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "detail" && selected && <ContractDetail onPlanChanged={() => { if (currentUser) void loadAll(currentUser); }} contract={selected} contracts={contracts} onOpen={openDetail} auditLog={auditLogs[selected.id] || []} currentUser={currentUser} canOpenDocuments={mode === "api"} onBack={() => setView("list")} onEdit={() => { setEditingContract(selected); setShowForm(true); }} onDelete={handleDelete} />}
        </main>
      </div>


      {tabs.length > 1 && (
        <nav className="bottom-nav" aria-label={t("Navigazione")}>
          {tabs.map(x => tabBtn(x.key, x.label, x.icon(21), activeTab === x.key, () => setView(x.key)))}
        </nav>
      )}

      {showForm && <ContractForm initial={editingContract} currentUser={currentUser} users={users} canUpload={mode === "api"} onSave={handleSave} onClose={() => { setShowForm(false); setEditingContract(null); }} />}
      {boFormContract && <BOFormModal contract={boFormContract} currentUser={currentUser} onSubmit={handleBOResponse} onClose={() => setBOFormContract(null)} />}
      {showAccount && <AccountMenu user={currentUser} anchor="sidebar" canChangePassword={mode === "api"} onAdmin={currentUser.role === "manager" ? () => setView("config") : undefined} onKpi={currentUser.role === "manager" && mode === "api" ? () => setView("kpi") : undefined} onProfileSaved={patch => setCurrentUser(u => (u ? { ...u, ...patch } : u))} onLogout={handleLogout} onClose={() => setShowAccount(false)} />}
      {toastEl}
    </div>
  );
}
