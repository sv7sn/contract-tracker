import { useEffect, useRef, useState } from "react";
import type { AppState, AuditEntry, CommitPayload, Contract, ContractData, NewUserInput, PlanStep, Role, User, View } from "./types.ts";
import { api, ApiError } from "./api.ts";
import { C, font, iStyle, ROLE_LABELS, sans, shadow } from "./theme.ts";
import { fmtDate, tsNow } from "./lib/format.ts";
import { clearLocal, DEMO_PASSWORD, DEMO_USERS, demoState, loadLocal, saveLocal } from "./lib/demo.ts";
import { makePlan, RENEWAL_BY_DECISION, reschedulePlan, stepTemplate } from "./lib/plan.ts";
import { canCreateContract, canManageUsers, canViewTeam } from "./permissions.ts";
import { Avatar, BrandMark } from "./components/ui.tsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, House, LayoutGrid, Loader2, Plus, Search, Settings } from "./components/icons.tsx";
import { InviteLanding } from "./components/InviteLanding.tsx";
import { LoginScreen } from "./components/LoginScreen.tsx";
import { AccountModal, BOFormModal, ContractForm } from "./components/Modals.tsx";
import { Dashboard } from "./views/Dashboard.tsx";
import { ContractList } from "./views/ContractList.tsx";
import { ContractDetail } from "./views/ContractDetail.tsx";
import { PlanningView } from "./views/PlanningView.tsx";
import { TeamView } from "./views/TeamView.tsx";
import { BOView } from "./views/BOView.tsx";
import { AlertsView } from "./views/AlertsView.tsx";
import { UsersView } from "./views/UsersView.tsx";
import { SupplierPortal } from "./views/SupplierPortal.tsx";
import { VendorsView } from "./views/VendorsView.tsx";
import { ConfigView } from "./views/ConfigView.tsx";
import { ExpiryView } from "./views/ExpiryView.tsx";
import { TasksView } from "./views/TasksView.tsx";
import { HubView } from "./views/HubView.tsx";
import { moduleOfView, modulesFor } from "./lib/modules.tsx";

type Mode = "loading" | "api" | "local";
const homeFor = (u: User, apiMode: boolean): View => (u.role === "bo" ? "bo" : u.role === "supplier" ? "supplier" : !apiMode ? "dashboard" : "hub");
/** Ruoli che non lavorano sui contratti: non serve caricarli. */
const hasContracts = (u: User) => u.role !== "supplier" && u.role !== "finance";
const EMPTY: AppState = { contracts: [], plans: {}, auditLogs: {} };

export default function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [setupRequired, setSetupRequired] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<View>("dashboard");
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
  const [showModules, setShowModules] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get("invite"));

  // Il dettaglio legge sempre la versione aggiornata del contratto (es. dopo una risposta BO).
  const selected = selectedId !== null ? contracts.find(c => c.id === selectedId) ?? null : null;

  const showToast = (msg: string) => { clearTimeout(toastTimer.current); setToast(msg); toastTimer.current = setTimeout(() => setToast(null), 3500); };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const resetSession = () => { setCurrentUser(null); setShowAccount(false); setShowForm(false); setEditingContract(null); setBOFormContract(null); setSelectedId(null); setView("dashboard"); if (mode === "api") { setData(EMPTY); setUsers([]); } };
  const sessionExpired = () => { resetSession(); showToast("Sessione scaduta: accedi di nuovo"); };

  /** Gestisce gli errori comuni dell'API. Restituisce true se l'errore è stato gestito. */
  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { sessionExpired(); return true; }
    return false;
  };

  const loadAll = async (user: User) => {
    try {
      if (hasContracts(user)) setData(await api.loadState());
      if (canManageUsers(user)) setUsers(await api.listUsers());
    } catch (err) { if (!handleApiError(err)) showToast("⚠️ Impossibile caricare i dati"); }
  };

  // All'avvio: sessione esistente? Se l'API non risponde si passa alla modalità demo locale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let user: User | null = null;
      try { user = (await api.me()).user; if (!cancelled) setMode("api"); }
      catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) { setMode("api"); setSetupRequired(err.data.setupRequired === true); }
        else { setData(loadLocal() ?? demoState()); setUsers(DEMO_USERS); setMode("local"); }
        return;
      }
      if (cancelled) return;
      setCurrentUser(user); setView(homeFor(user, true));
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
      if (!user || password !== DEMO_PASSWORD) return "Credenziali non valide";
      setCurrentUser(user); setView(homeFor(user, false));
      return null;
    }
    try {
      const { user } = await api.login(email, password);
      setCurrentUser(user); setView(homeFor(user, true)); setSetupRequired(false);
      await loadAll(user);
      return null;
    } catch (err) { return err instanceof ApiError ? err.message : "Impossibile contattare il server"; }
  };
  const handleLogout = () => { if (mode === "api") api.logout().catch(() => undefined); resetSession(); };
  const handleResetDemo = () => { clearLocal(); setData(demoState()); showToast("↺ Dati demo ripristinati"); };

  // ─── Salvataggio ───────────────────────────────────────────
  // Scrive sul database (nessuna operazione in modalità locale). Se fallisce ricarica lo stato dal server per annullare le modifiche ottimistiche.
  const persist = async (payload: CommitPayload): Promise<{ ok: boolean; contractId?: number }> => {
    if (mode !== "api") return { ok: true };
    try { return { ok: true, contractId: (await api.commit(payload)).contractId }; }
    catch (err) {
      if (handleApiError(err)) return { ok: false };
      showToast(err instanceof ApiError && err.status === 403 ? "⛔ Operazione non consentita per il tuo ruolo" : "⚠️ Salvataggio non riuscito: dati ricaricati dal server");
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
      if (form.end !== editingContract.end) {
        plan = reschedulePlan(plans[id] || [], id, form.end);
        audit.push(entry("Piano ricalcolato", `Nuova scadenza: ${fmtDate(form.end)}`, "Sistema"));
      }
      if (!(await persist({ contract: { ...form, id }, plan, audit })).ok) return;
      setData(s => pushAudit({ ...s, contracts: s.contracts.map(c => c.id === id ? { ...c, ...form, owner: currentUser.role === "buyer" ? c.owner : form.owner } : c), plans: plan ? { ...s.plans, [id]: plan } : s.plans }, id, audit));
      showToast("💾 Aggiornato");
    } else {
      const audit = [entry("Contratto creato", `${form.supplier} · ${form.object}`)];
      const plan = makePlan(0, form.end);
      const res = await persist({ contract: form, plan, audit });
      if (!res.ok) return;
      const newId = res.contractId ?? Math.max(...contracts.map(c => c.id), 0) + 1;
      const owner = currentUser.role === "buyer" ? currentUser.name : form.owner;
      setData(s => pushAudit({ ...s, contracts: [...s.contracts, { ...form, owner, id: newId }], plans: { ...s.plans, [newId]: plan.map(st => ({ ...st, contractId: newId })) } }, newId, audit));
      showToast("✅ Contratto aggiunto");
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
    const plan = (plans[id] || []).map(s => s.stepId === "bo_notify" ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: "Sistema" } : s.stepId === "bo_response" ? { ...s, status: "pending_bo" as const } : s);
    if (await updatePlan(id, plan, [entry("Notifica BO inviata", `A: ${c.boEmail || "—"}`, "Sistema")]))
      showToast(c.boEmail ? `✉️ Notifica registrata per ${c.boEmail}` : "⚠️ Nessuna email BO impostata per questo contratto");
  };

  const handleBOResponse = async (id: number, { decision, notes }: { decision: string; notes: string }) => {
    const c = contracts.find(x => x.id === id);
    if (!c || !currentUser) return;
    const plan = (plans[id] || []).map(s => s.stepId === "bo_response" ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: currentUser.role === "bo" ? currentUser.email : `${currentUser.name} (per conto del BO)`, boDecision: decision, boNotes: notes, boRespondedAt: fmtDate(new Date()) } : s);
    const renewal = RENEWAL_BY_DECISION[decision];
    const updated = renewal ? { ...c, renewal } : c;
    const audit = [entry("Risposta BO ricevuta", `Decisione: ${decision}${notes ? ` · "${notes}"` : ""}`)];
    if (await updatePlan(id, plan, audit, updated)) showToast("✅ Decisione BO registrata");
    setBOFormContract(null);
  };

  const handleCompleteStep = async (id: number, stepId: string) => {
    if (!currentUser) return;
    const tmpl = stepTemplate(stepId);
    const plan = (plans[id] || []).map(s => s.stepId === stepId ? { ...s, status: "done" as const, completedAt: fmtDate(new Date()), completedBy: currentUser.name } : s);
    if (await updatePlan(id, plan, [entry(`Attività completata: ${tmpl.label}`, `Da ${currentUser.name}`)])) showToast(`✓ "${tmpl.label}" completata`);
  };

  const handleUpdateStepDate = async (id: number, stepId: string, newDate: string, reason: string) => {
    const tmpl = stepTemplate(stepId);
    const plan = (plans[id] || []).map(s => s.stepId === stepId ? { ...s, scheduledDate: newDate, modified: true, modifiedReason: reason } : s);
    if (await updatePlan(id, plan, [entry(`Data modificata: ${tmpl.label}`, `Nuova data: ${fmtDate(newDate)} · Motivo: ${reason}`)])) showToast("📅 Data aggiornata");
  };

  const handleApplySuggestion = async (id: number, offset: number) => {
    const c = contracts.find(x => x.id === id);
    if (!c) return;
    if (await updatePlan(id, makePlan(id, c.end, offset), [entry("Piano anticipato", `Anticipo di ${offset} giorni`, "Sistema")])) showToast(`⏩ Piano anticipato di ${offset} giorni`);
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm(`Eliminare definitivamente il contratto con ${selected.supplier}? Verranno eliminati anche piano e storico.`)) return;
    const id = selected.id;
    if (!(await persist({ deleteContractId: id })).ok) return;
    setData(s => {
      const plansLeft = { ...s.plans }, auditLeft = { ...s.auditLogs };
      delete plansLeft[id]; delete auditLeft[id];
      return { contracts: s.contracts.filter(c => c.id !== id), plans: plansLeft, auditLogs: auditLeft };
    });
    setSelectedId(null); setView("list");
    showToast("🗑 Contratto eliminato");
  };

  // ─── Gestione utenti (solo manager) ────────────────────────
  const userError = (err: unknown) => (handleApiError(err) ? "Sessione scaduta" : err instanceof ApiError ? err.message : "Operazione non riuscita");
  const handleCreateUser = async (input: NewUserInput): Promise<string | null> => {
    try { const u = await api.createUser(input); setUsers(list => [...list, u]); showToast(`✅ Utente ${u.name} creato`); return null; } catch (err) { return userError(err); }
  };
  const handleUpdateUser = async (id: number, patch: { active?: boolean; password?: string; role?: Role; title?: string }): Promise<string | null> => {
    try {
      const u = await api.updateUser({ id, ...patch });
      setUsers(list => list.map(x => x.id === id ? u : x));
      showToast(patch.password ? "🔑 Password reimpostata" : patch.active !== undefined ? (u.active ? "Utente riattivato" : "Utente disattivato") : "✅ Utente aggiornato");
      return null;
    } catch (err) { const m = userError(err); showToast(`⚠️ ${m}`); return m; }
  };
  const handleDeleteUser = async (u: User) => {
    if (!window.confirm(`Eliminare definitivamente ${u.name} (${u.email})? L'operazione non si può annullare. In alternativa puoi disattivarlo.`)) return;
    try { await api.deleteUser(u.id); setUsers(list => list.filter(x => x.id !== u.id)); showToast(`🗑 Utente ${u.name} eliminato`); }
    catch (err) { showToast(`⚠️ ${userError(err)}`); }
  };
  const handlePurge = async () => {
    if (window.prompt("Verranno eliminati TUTTI i contratti, con piani e storico. Scrivi ELIMINA per confermare.") !== "ELIMINA") return;
    try { const { deleted } = await api.purge(); setData(EMPTY); setSelectedId(null); showToast(`🗑 ${deleted} contratti eliminati`); } catch (err) { if (!handleApiError(err)) showToast("⚠️ Operazione non riuscita"); }
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

  if (mode === "loading") return (
    <div style={{ ...sans, minHeight: "100vh", background: C.navy, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "rgba(255,255,255,.7)", fontSize: 13.5 }}>
      <BrandMark size={52} /><Loader2 className="spin" size={22} /><span>Caricamento…</span>
    </div>
  );

  const leaveInvite = () => { setInviteToken(null); window.history.replaceState(null, "", window.location.pathname); };
  if (!currentUser && inviteToken && mode === "api") return (
    <><InviteLanding token={inviteToken} onCancel={leaveInvite} onActivated={user => { leaveInvite(); setCurrentUser(user); setView("supplier"); showToast("Account creato: completa la registrazione"); }} />{toastEl}</>
  );

  // Link d'invito aperto da un browser dove è già collegato qualcuno (es. il Manager che prova l'invito): senza questo avviso si vedrebbe l'app normale.
  if (currentUser && inviteToken && mode === "api") return (
    <div className="login-panel" style={{ minHeight: "100vh" }}>
      <div style={{ width: "100%", maxWidth: 430, background: "#fff", borderRadius: 20, padding: 32, boxShadow: "0 24px 60px rgba(16,24,43,.18)", border: `1px solid ${C.border}`, ...sans }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}><BrandMark size={48} /></div>
        <h1 style={{ ...font, fontSize: 21, margin: "0 0 8px", color: C.text, textAlign: "center" }}>Hai aperto un invito per fornitori</h1>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: "0 0 20px", textAlign: "center" }}>In questo browser sei già collegato come <b>{currentUser.name}</b> ({ROLE_LABELS[currentUser.role]}). Per vedere l'invito come lo vede il fornitore devi uscire da questo account, oppure aprire il link in una finestra in incognito.</p>
        <button onClick={() => { handleLogout(); }} style={{ width: "100%", height: 46, background: C.accent, border: "none", borderRadius: 11, color: "#fff", fontWeight: 650, fontSize: 15, cursor: "pointer", marginBottom: 10 }}>Esci e apri l'invito</button>
        <button onClick={leaveInvite} style={{ width: "100%", height: 44, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Continua come {currentUser.name.split(" ")[0]}</button>
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
          <div style={{ flex: 1, minWidth: 0 }}><div className="topbar-eyebrow">Portale fornitori</div><div className="topbar-title">{currentUser.name}</div></div>
          <button onClick={() => setShowAccount(true)} aria-label="Account" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><Avatar name={currentUser.name} size={34} /></button>
        </div>
      </header>
      <main className="page"><SupplierPortal onSessionExpired={sessionExpired} notify={showToast} /></main>
      </div>
      {showAccount && <AccountModal user={currentUser} canChangePassword onLogout={handleLogout} onClose={() => setShowAccount(false)} />}
      {toastEl}
    </div>
  );

  // ─── Navigazione per ruolo ─────────────────────────────────
  const modules = modulesFor(currentUser, mode === "api");
  const hubAvailable = mode === "api" && currentUser.role !== "bo";
  const curModule = moduleOfView(view);
  const activeModule = modules.find(m => m.key === curModule);
  const navItems = activeModule?.pages ?? [];
  const inContracts = curModule === "contracts";
  const titles: Record<View, string> = { dashboard: "Panoramica", list: "Contratti", planning: currentUser.role === "manager" ? "Piano del team" : "Il mio piano", team: "Vista team", notifiche: "Avvisi di scadenza", bo: "Le mie richieste", users: "Utenti e permessi", vendors: "Fornitori", expiries: "Scadenze documenti", tasks: "Task", hub: "Home", config: "Configurazione", supplier: "Area fornitore", detail: selected?.supplier ?? "" };
  const eyebrow = curModule === "hub" ? "Procurement Lab" : activeModule?.label ?? ROLE_LABELS[currentUser.role];
  const activeNav = view === "detail" ? "list" : view;
  const goModule = (m: { pages: { key: View }[] }) => { setView(m.pages[0].key); setShowModules(false); };
  const sideBtn = (label: string, icon: React.ReactNode, on: boolean, click: () => void, sub = false) => (
    <button key={label} onClick={click} aria-current={on ? "page" : undefined} style={{ ...sans, position: "relative", display: "flex", alignItems: "center", gap: 12, width: "100%", padding: sub ? "8px 12px 8px 14px" : "10px 12px", marginBottom: 3, border: "none", borderRadius: 10, cursor: "pointer", fontSize: sub ? 13.5 : 14, fontWeight: on ? 650 : 500, background: on ? "rgba(255,255,255,.1)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,.66)", textAlign: "left" }}>
      {on && <span aria-hidden style={{ position: "absolute", left: -14, top: 8, bottom: 8, width: 4, borderRadius: "0 4px 4px 0", background: C.accent }} />}
      <span style={{ display: "flex", color: on ? "#fff" : "rgba(255,255,255,.55)" }}>{icon}</span>{label}
    </button>
  );
  const tabBtn = (label: string, icon: React.ReactNode, on: boolean, click: () => void) => (
    <button key={label} onClick={click} aria-current={on ? "page" : undefined} style={{ flex: "1 0 66px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: on ? C.accent : C.subtle, padding: "2px 0" }}>
      {icon}
      <span style={{ ...sans, fontSize: 10, color: on ? C.accent : C.muted, fontWeight: on ? 650 : 500 }}>{label}</span>
    </button>
  );

  return (
    <div className="app-shell" style={{ ...sans, color: C.text }}>
      {/* Menu laterale (desktop) */}
      <aside className="sidebar" aria-label="Menu principale">
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 26px" }}>
          <BrandMark size={38} />
          <div><div style={{ ...font, fontSize: 16, fontWeight: 700, color: "#fff" }}>Procurement Lab</div><div style={{ fontSize: 11, color: "rgba(255,255,255,.45)" }}>Procurement indiretto</div></div>
        </div>
        {(hubAvailable || modules.length > 1) && (<>
          <div style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.35)", padding: "0 12px 8px" }}>Moduli</div>
          <nav aria-label="Moduli" style={{ marginBottom: 14 }}>
            {hubAvailable && sideBtn("Home", <House size={19} />, curModule === "hub", () => setView("hub"))}
            {modules.map(m => sideBtn(m.label, m.icon(19), curModule === m.key, () => goModule(m)))}
          </nav>
        </>)}
        {navItems.length > 1 && (<>
          <div style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.35)", padding: "6px 12px 8px", borderTop: "1px solid rgba(255,255,255,.08)" }}>{activeModule?.label}</div>
          <nav aria-label="Pagine del modulo">{navItems.map(n => sideBtn(n.label, n.icon, activeNav === n.key, () => setView(n.key), true))}</nav>
        </>)}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAccount(true)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, background: "rgba(255,255,255,.06)", cursor: "pointer", textAlign: "left", width: "100%" }}>
          <Avatar name={currentUser.name} size={36} />
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ ...sans, fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.name}</div><div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,.5)" }}>{ROLE_LABELS[currentUser.role]}</div></div>
          <Settings size={16} color="rgba(255,255,255,.5)" />
        </button>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {view === "detail" && <button className="topbar-back" onClick={() => setView("list")} aria-label="Torna alla lista" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", flexShrink: 0 }}><ChevronLeft size={22} /></button>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="topbar-eyebrow">{eyebrow}</div>
              <div className="topbar-title">{titles[view]}</div>
            </div>
            {inContracts && hasContracts(currentUser) && currentUser.role !== "bo" && (
              <div className="topbar-search" style={{ position: "relative", width: 300 }}>
                <Search size={16} color={C.subtle} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                <input value={listSearch} onChange={e => { setListSearch(e.target.value); if (view !== "list") setView("list"); }} placeholder="Cerca fornitore, oggetto, owner…" aria-label="Cerca contratti" style={{ ...iStyle, padding: "9px 12px 9px 36px", borderRadius: 10, background: "#fff" }} />
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {inContracts && canCreateContract(currentUser) && (
                <button onClick={openNew} aria-label="Nuovo contratto" style={{ ...sans, display: "flex", alignItems: "center", gap: 6, background: C.accent, border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 13, padding: "8px 12px", fontWeight: 650, flexShrink: 0, boxShadow: "0 1px 2px rgba(200,82,42,.35)" }}><Plus size={17} /><span className="desktop-label">Nuovo contratto</span></button>
              )}
              <button className="mobile-only" onClick={() => setShowAccount(true)} aria-label="Account" style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: 0 }}>
                <Avatar name={currentUser.name} size={32} />
              </button>
            </div>
          </div>
        </header>

        {mode === "local" && (
          <div style={{ ...sans, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.yellowBg, color: C.yellow, fontSize: 12, fontWeight: 600, textAlign: "center", padding: "7px 12px", borderBottom: "1px solid #f3dca0" }}>
            <AlertTriangle size={14} />Modalità demo: database non raggiungibile, i dati sono salvati solo in questo browser
          </div>
        )}

        <main className="page">
          {view === "dashboard" && <Dashboard contracts={contracts} plans={plans} currentUser={currentUser} onNew={openNew} onNavigate={(v, c) => { setView(v); if (c) setSelectedId(c.id); }} />}
          {view === "list" && <ContractList contracts={contracts} currentUser={currentUser} search={listSearch} onSearch={setListSearch} onSelect={openDetail} onNew={openNew} />}
          {view === "planning" && <PlanningView contracts={contracts} plans={plans} auditLogs={auditLogs} currentUser={currentUser} onSendBO={handleSendBO} onCompleteStep={handleCompleteStep} onOpenBOForm={setBOFormContract} onUpdateStepDate={handleUpdateStepDate} />}
          {view === "team" && canViewTeam(currentUser) && <TeamView contracts={contracts} plans={plans} onApplySuggestion={handleApplySuggestion} />}
          {view === "bo" && currentUser.role === "bo" && <BOView contracts={contracts} plans={plans} currentUser={currentUser} onOpenBOForm={setBOFormContract} />}
          {view === "notifiche" && currentUser.role !== "bo" && <AlertsView contracts={contracts} users={users} />}
          {view === "users" && canManageUsers(currentUser) && <UsersView users={users} currentUser={currentUser} onCreate={handleCreateUser} onUpdate={handleUpdateUser} onDelete={handleDeleteUser} onPurge={handlePurge} />}
          {view === "hub" && hubAvailable && <HubView user={currentUser} modules={modules} contracts={contracts} plans={plans} onOpen={setView} />}
          {view === "tasks" && mode === "api" && (currentUser.role === "manager" || currentUser.role === "buyer") && <TasksView currentUser={currentUser} contracts={contracts} plans={plans} onCompleteStep={handleCompleteStep} onSendBO={handleSendBO} onOpenContract={openDetail} notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "vendors" && mode === "api" && <VendorsView currentUser={currentUser} notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "expiries" && mode === "api" && <ExpiryView currentUser={currentUser} notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "config" && mode === "api" && currentUser.role === "manager" && <ConfigView notify={showToast} onSessionExpired={sessionExpired} />}
          {view === "detail" && selected && <ContractDetail contract={selected} auditLog={auditLogs[selected.id] || []} currentUser={currentUser} canOpenDocuments={mode === "api"} onBack={() => setView("list")} onEdit={() => { setEditingContract(selected); setShowForm(true); }} onDelete={handleDelete} />}
        </main>
      </div>

      {view === "list" && canCreateContract(currentUser) && <button className="fab" onClick={openNew} aria-label="Nuovo contratto"><Plus size={26} /></button>}

      {view !== "detail" && (
        <nav className="bottom-nav" aria-label="Navigazione">
          {curModule === "hub" ? modules.map(m => tabBtn(m.label, m.icon(19), false, () => goModule(m))) : navItems.map(n => tabBtn(n.label, n.icon, activeNav === n.key, () => setView(n.key)))}
          {(hubAvailable || modules.length > 1) && curModule !== "hub" && tabBtn("Moduli", <LayoutGrid size={19} />, false, () => setShowModules(true))}
        </nav>
      )}
      {showModules && (
        <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Moduli" onClick={e => { if (e.target === e.currentTarget) setShowModules(false); }}>
          <div className="sheet" style={{ maxWidth: 420 }}>
            <div style={{ ...font, fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Vai a</div>
            <div style={{ display: "grid", gap: 8 }}>
              {hubAvailable && <button onClick={() => { setView("hub"); setShowModules(false); }} style={{ ...sans, display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", fontSize: 14.5, fontWeight: 600, textAlign: "left" }}><House size={20} />Home</button>}
              {modules.map(m => <button key={m.key} onClick={() => goModule(m)} style={{ ...sans, display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, border: `1px solid ${curModule === m.key ? C.accent : C.border}`, background: curModule === m.key ? C.accentLight : "#fff", cursor: "pointer", fontSize: 14.5, fontWeight: 600, textAlign: "left" }}>{m.icon(20)}{m.label}</button>)}
            </div>
          </div>
        </div>
      )}

      {showForm && <ContractForm initial={editingContract} currentUser={currentUser} users={users} canUpload={mode === "api"} onSave={handleSave} onClose={() => { setShowForm(false); setEditingContract(null); }} />}
      {boFormContract && <BOFormModal contract={boFormContract} currentUser={currentUser} onSubmit={handleBOResponse} onClose={() => setBOFormContract(null)} />}
      {showAccount && <AccountModal user={currentUser} canChangePassword={mode === "api"} onLogout={handleLogout} onClose={() => setShowAccount(false)} />}
      {toastEl}
    </div>
  );
}
