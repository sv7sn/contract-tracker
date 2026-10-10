import { useState } from "react";
import type { NewUserInput, Role, User } from "../types.ts";
import { C, font, sans } from "../theme.ts";
import { Avatar, Card, Grid, RoleBadge } from "../components/ui.tsx";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "../components/icons.tsx";
import { EditUserModal, NewUserModal, ResetPasswordModal } from "../components/Modals.tsx";

interface Props {
  users: User[]; currentUser: User;
  onCreate: (input: NewUserInput) => Promise<string | null>;
  onUpdate: (id: number, patch: { active?: boolean; password?: string; role?: Role; title?: string; sapUser?: string }) => Promise<string | null>;
  onDelete: (user: User) => void;
  onPurge: () => void;
}

export function UsersView({ users, currentUser, onCreate, onUpdate, onDelete, onPurge }: Props) {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const small = { ...sans, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, cursor: "pointer", fontSize: 12, fontWeight: 600 } as const;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 18, fontWeight: 700, color: C.text }}>Utenti e permessi</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>{users.length} utenti · {users.filter(u => u.active).length} attivi</div>
        </div>
        <button onClick={() => setCreating(true)} style={{ ...sans, display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontWeight: 650, cursor: "pointer", fontSize: 13, boxShadow: "0 1px 2px rgba(200,82,42,.35)" }}><Plus size={16} />Nuovo utente</button>
      </div>

      <Card style={{ marginBottom: 16, ...sans, fontSize: 13, color: C.muted, lineHeight: 1.75 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: C.text, fontWeight: 650 }}><ShieldCheck size={17} color={C.blue} />Cosa può fare ogni ruolo</div>
        <b>Manager</b>: vede e modifica tutti i contratti, gestisce utenti, team e piani.<br />
        <b>Buyer</b>: crea contratti e gestisce solo i propri (come contract owner).<br />
        <b>Business Owner</b> (è anche il richiedente): vede i contratti indicati con la sua email e le RDA aperte in SAP con il suo codice utente, risponde agli avvisi del buyer e gli scrive per chiarimenti.<br />
        <b>Controlling / CFO</b>: solo consultazione di contratti, Master Plan, spesa e indicatori; non modifica nulla.
      </Card>

      <Grid min={320} gap={10}>
        {users.map(u => (
          <Card key={u.id} style={{ opacity: u.active ? 1 : 0.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <Avatar name={u.name} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...sans, fontSize: 14, fontWeight: 700, color: C.navy }}>{u.name}{u.id === currentUser.id && <span style={{ color: C.subtle, fontWeight: 400 }}> (tu)</span>}</div>
                <div style={{ ...sans, fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
                {u.title && <div style={{ ...sans, fontSize: 11, color: C.subtle }}>{u.title}</div>}
                {u.role === "bo" && <div style={{ ...sans, fontSize: 11, color: u.sapUser ? C.subtle : C.yellow }}>{u.sapUser ? `Codice SAP ${u.sapUser}` : "Codice utente SAP mancante"}</div>}
              </div>
              <div style={{ textAlign: "right" }}><RoleBadge role={u.role} /><div style={{ ...sans, fontSize: 10, marginTop: 4, color: u.active ? C.green : C.red, fontWeight: 600 }}>{u.active ? "● Attivo" : "● Disattivato"}</div></div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setEditing(u)} style={small}><Pencil size={13} />Modifica</button>
              <button onClick={() => setResetting(u)} style={small}><KeyRound size={13} />Password</button>
              {u.id !== currentUser.id && <button onClick={() => { void onUpdate(u.id, { active: !u.active }); }} style={small}>{u.active ? "Disattiva" : "Riattiva"}</button>}
              {u.id !== currentUser.id && <button onClick={() => onDelete(u)} style={{ ...small, color: C.red, borderColor: "#f1c4c4" }}><Trash2 size={13} />Elimina</button>}
            </div>
          </Card>
        ))}
      </Grid>

      <div style={{ marginTop: 28, border: `1px solid #f1c4c4`, background: "#fffafa", borderRadius: 14, padding: 18 }}>
        <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 4 }}>Zona pericolosa</div>
        <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 10 }}>Elimina tutti i contratti, con piani e storico. Gli utenti non vengono toccati. Utile per togliere i dati di prova prima dell'uso reale.</div>
        <button onClick={onPurge} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", background: "#fff", border: `1px solid ${C.red}`, borderRadius: 9, color: C.red, cursor: "pointer", fontSize: 12.5, fontWeight: 650 }}><Trash2 size={14} />Elimina tutti i contratti</button>
      </div>

      {creating && <NewUserModal onSave={async input => { const err = await onCreate(input); if (!err) setCreating(false); return err; }} onClose={() => setCreating(false)} />}
      {editing && <EditUserModal user={editing} isSelf={editing.id === currentUser.id} onSave={async patch => { const err = await onUpdate(editing.id, patch); if (!err) setEditing(null); return err; }} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordModal user={resetting} onSave={async pw => { const err = await onUpdate(resetting.id, { password: pw }); if (!err) setResetting(null); return err; }} onClose={() => setResetting(null)} />}
    </div>
  );
}
