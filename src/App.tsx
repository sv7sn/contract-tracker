import { useEffect, useRef, useState } from "react";
import type { AppState, AuditEntry, CommitPayload, Contract, ContractData, NewUserInput, PlanStep, Role, User, View } from "./types.ts";
import { api, ApiError } from "./api.ts";
import { C, font, ROLE_LABELS, sans } from "./theme.ts";
import { fmtDate, tsNow } from "./lib/format.ts";
import { clearLocal, DEMO_PASSWORD, DEMO_USERS, demoState, loadLocal, saveLocal } from "./lib/demo.ts";
import { makePlan, RENEWAL_BY_DECISION, reschedulePlan, stepTemplate } from "./lib/plan.ts";
import { canCreateContract, canManageUsers, canViewTeam } from "./permissions.ts";
import { Avatar } from "./components/ui.tsx";
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

type Mode = "loading" | "api" | "local";
const homeFor = (u: User): View => (u.role === "bo" ? "bo" : "dashboard");
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
      setData(await api.loadState());
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
      setCurrentUser(user); setView(homeFor(user));
      await loadAll(user);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con più utenti sul database, ricarica i dati quando si torna sulla scheda.
  useEffect(() => {
    if (mode !== "api" || !currentUser) return;
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
      setCurrentUser(user); setView(homeFor(user));
      return null;
    }
    try {
      const { user } = await api.login(email, password);
      setCurrentUser(user); setView(homeFor(user)); setSetupRequired(false);
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
  const handleUpdateUser = async (id: number, patch: { active?: boolean; password?: string }): Promise<string | null> => {
    try { const u = await api.updateUser({ id, ...patch }); setUsers(list => list.map(x => x.id === id ? u : x)); showToast(patch.password ? "🔑 Password reimpostata" : u.active ? "Utente riattivato" : "Utente disattivato"); return null; } catch (err) { const m = userError(err); showToast(`⚠️ ${m}`); return m; }
  };
  const handlePurge = async () => {
    if (window.prompt("Verranno eliminati TUTTI i contratti, con piani e storico. Scrivi ELIMINA per confermare.") !== "ELIMINA") return;
    try { const { deleted } = await api.purge(); setData(EMPTY); setSelectedId(null); showToast(`🗑 ${deleted} contratti eliminati`); } catch (err) { if (!handleApiError(err)) showToast("⚠️ Operazione non riuscita"); }
  };

  const openDetail = (c: Contract) => { setSelectedId(c.id); setView("detail"); };
  const openNew = () => { setEditingContract(null); setShowForm(true); };

  const toastEl = toast && (
    <div role="status" style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", maxWidth: "90vw", background: C.navy, color: "#fff", padding: "11px 22px", borderRadius: 24, fontWeight: 600, fontSize: 13, zIndex: 400, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", ...sans, textAlign: "center" }}>
      {toast}
    </div>
  );

  if (mode === "loading") return <div style={{ ...sans, minHeight: "100vh", background: C.navy, color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>Caricamento…</div>;

  if (!currentUser) return <><LoginScreen mode={mode} setupRequired={setupRequired} onLogin={handleLogin} onResetDemo={mode === "local" ? handleResetDemo : undefined} />{toastEl}</>;

  // ─── Navigazione per ruolo ─────────────────────────────────
  const navByRole: Record<Role, { key: View; icon: string; label: string }[]> = {
    manager: [
      { key: "dashboard", icon: "◈", label: "Overview" },
      { key: "list",      icon: "≡",  label: "Contratti" },
      { key: "planning",  icon: "▦",  label: "Piano" },
      { key: "team",      icon: "👥", label: "Team" },
      { key: "notifiche", icon: "✉",  label: "Alert" },
      ...(mode === "api" && canManageUsers(currentUser) ? [{ key: "users" as const, icon: "🔐", label: "Utenti" }] : []),
    ],
    buyer: [
      { key: "dashboard", icon: "◈", label: "Overview" },
      { key: "list",      icon: "≡",  label: "Contratti" },
      { key: "planning",  icon: "▦",  label: "Piano" },
      { key: "notifiche", icon: "✉",  label: "Alert" },
    ],
    bo: [
      { key: "bo",   icon: "📋", label: "Richieste" },
      { key: "list", icon: "≡",  label: "Contratti" },
    ],
  };
  const navItems = navByRole[currentUser.role];
  const titles: Record<View, string> = { dashboard: "Overview", list: "Contratti", planning: currentUser.role === "manager" ? "Piano — Team" : "Il mio piano", team: "Vista Team", notifiche: "Alert Email", bo: "Le mie richieste", users: "Utenti e permessi", detail: selected?.supplier ?? "" };
  const activeNav = view === "detail" ? "list" : view;
  const navBtn = (n: typeof navItems[number], sidebar: boolean) => {
    const on = activeNav === n.key;
    return sidebar ? (
      <button key={n.key} onClick={() => setView(n.key)} aria-current={on ? "page" : undefined} style={{ ...sans, display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px", marginBottom: 2, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: on ? 700 : 500, background: on ? "rgba(255,255,255,0.12)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,0.65)", textAlign: "left" }}>
        <span style={{ width: 20, textAlign: "center", color: on ? C.accent : undefined }}>{n.icon}</span>{n.label}
      </button>
    ) : (
      <button key={n.key} onClick={() => setView(n.key)} aria-current={on ? "page" : undefined} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 16, color: on ? C.accent : C.subtle }}>{n.icon}</span>
        <span style={{ ...sans, fontSize: 9, color: on ? C.accent : C.muted, fontWeight: on ? 700 : 400 }}>{n.label}</span>
        {on && <div style={{ width: 16, height: 2, background: C.accent, borderRadius: 2 }} />}
      </button>
    );
  };

  return (
    <div className="app-shell" style={{ ...sans, background: C.bg, color: C.text }}>
      {/* Menu laterale (desktop) */}
      <aside className="sidebar" aria-label="Menu principale">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 22px" }}>
          <div style={{ width: 36, height: 36, background: C.accent, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📋</div>
          <div><div style={{ ...font, fontSize: 15, fontWeight: 700, color: "#fff" }}>Contract Tracker</div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Prometeon</div></div>
        </div>
        <nav>{navItems.map(n => navBtn(n, true))}</nav>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAccount(true)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: "none", borderRadius: 10, background: "rgba(255,255,255,0.07)", cursor: "pointer", textAlign: "left", width: "100%" }}>
          <Avatar name={currentUser.name} size={34} />
          <div style={{ minWidth: 0 }}><div style={{ ...sans, fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.name}</div><div style={{ ...sans, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{ROLE_LABELS[currentUser.role]} · Account</div></div>
        </button>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {view === "detail" && <button className="topbar-back" onClick={() => setView("list")} aria-label="Torna alla lista" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: 0, flexShrink: 0 }}>←</button>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="topbar-eyebrow" style={font}>Prometeon · {ROLE_LABELS[currentUser.role]}</div>
              <div className="topbar-title" style={font}>{titles[view]}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {canCreateContract(currentUser) && (
                <button onClick={openNew} style={{ ...sans, background: C.green, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, padding: "6px 12px", fontWeight: 600, flexShrink: 0 }}>➕<span style={{ marginLeft: 6 }} className="desktop-label">Nuovo contratto</span></button>
              )}
              <button className="mobile-only" onClick={() => setShowAccount(true)} aria-label="Account" style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: 0 }}>
                <Avatar name={currentUser.name} size={30} />
              </button>
            </div>
          </div>
        </header>

        {mode === "local" && (
          <div style={{ ...sans, background: C.yellowBg, color: C.yellow, fontSize: 11, fontWeight: 600, textAlign: "center", padding: "6px 12px" }}>
            ⚠️ Modalità demo: database non raggiungibile, i dati sono salvati solo in questo browser
          </div>
        )}

        <main className="page">
          {view === "dashboard" && <Dashboard contracts={contracts} plans={plans} currentUser={currentUser} onNavigate={(v, c) => { setView(v); if (c) setSelectedId(c.id); }} />}
          {view === "list" && <ContractList contracts={contracts} currentUser={currentUser} onSelect={openDetail} />}
          {view === "planning" && <PlanningView contracts={contracts} plans={plans} auditLogs={auditLogs} currentUser={currentUser} onSendBO={handleSendBO} onCompleteStep={handleCompleteStep} onOpenBOForm={setBOFormContract} onUpdateStepDate={handleUpdateStepDate} />}
          {view === "team" && canViewTeam(currentUser) && <TeamView contracts={contracts} plans={plans} onApplySuggestion={handleApplySuggestion} />}
          {view === "bo" && currentUser.role === "bo" && <BOView contracts={contracts} plans={plans} currentUser={currentUser} onOpenBOForm={setBOFormContract} />}
          {view === "notifiche" && currentUser.role !== "bo" && <AlertsView contracts={contracts} users={users} />}
          {view === "users" && canManageUsers(currentUser) && <UsersView users={users} currentUser={currentUser} onCreate={handleCreateUser} onUpdate={handleUpdateUser} onPurge={handlePurge} />}
          {view === "detail" && selected && <ContractDetail contract={selected} auditLog={auditLogs[selected.id] || []} currentUser={currentUser} onBack={() => setView("list")} onEdit={() => { setEditingContract(selected); setShowForm(true); }} onDelete={handleDelete} />}
        </main>
      </div>

      {view === "list" && canCreateContract(currentUser) && <button className="fab" onClick={openNew} aria-label="Nuovo contratto">+</button>}

      {view !== "detail" && <nav className="bottom-nav" aria-label="Navigazione">{navItems.map(n => navBtn(n, false))}</nav>}

      {showForm && <ContractForm initial={editingContract} currentUser={currentUser} users={users} onSave={handleSave} onClose={() => { setShowForm(false); setEditingContract(null); }} />}
      {boFormContract && <BOFormModal contract={boFormContract} currentUser={currentUser} onSubmit={handleBOResponse} onClose={() => setBOFormContract(null)} />}
      {showAccount && <AccountModal user={currentUser} canChangePassword={mode === "api"} onLogout={handleLogout} onClose={() => setShowAccount(false)} />}
      {toastEl}
    </div>
  );
}
