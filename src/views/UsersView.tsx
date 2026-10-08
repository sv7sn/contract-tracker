import { useState } from "react";
import type { NewUserInput, User } from "../types.ts";
import { C, font, sans } from "../theme.ts";
import { Avatar, Card, Grid, RoleBadge } from "../components/ui.tsx";
import { NewUserModal, ResetPasswordModal } from "../components/Modals.tsx";

interface Props {
  users: User[]; currentUser: User;
  onCreate: (input: NewUserInput) => Promise<string | null>;
  onUpdate: (id: number, patch: { active?: boolean; password?: string }) => Promise<string | null>;
  onPurge: () => void;
}

export function UsersView({ users, currentUser, onCreate, onUpdate, onPurge }: Props) {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const small = { ...sans, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600 } as const;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...font, fontSize: 15, fontWeight: 700, color: C.navy }}>Utenti e permessi</div>
          <div style={{ ...sans, fontSize: 12, color: C.muted }}>{users.length} utenti · {users.filter(u => u.active).length} attivi</div>
        </div>
        <button onClick={() => setCreating(true)} style={{ ...sans, padding: "9px 16px", background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>➕ Nuovo utente</button>
      </div>

      <Card style={{ marginBottom: 16, ...sans, fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
        <b style={{ color: C.navy }}>Cosa può fare ogni ruolo</b><br />
        <b>Manager</b>: vede e modifica tutti i contratti, gestisce utenti, team e piani.<br />
        <b>Buyer</b>: crea contratti e gestisce solo i propri (come contract owner).<br />
        <b>Business Owner</b>: vede solo i contratti indicati con la sua email e registra la propria decisione di rinnovo.
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
              </div>
              <div style={{ textAlign: "right" }}><RoleBadge role={u.role} /><div style={{ ...sans, fontSize: 10, marginTop: 4, color: u.active ? C.green : C.red, fontWeight: 600 }}>{u.active ? "● Attivo" : "● Disattivato"}</div></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setResetting(u)} style={small}>🔑 Reimposta password</button>
              {u.id !== currentUser.id && <button onClick={() => { void onUpdate(u.id, { active: !u.active }); }} style={small}>{u.active ? "Disattiva" : "Riattiva"}</button>}
            </div>
          </Card>
        ))}
      </Grid>

      <div style={{ marginTop: 28, border: `1px solid ${C.red}`, borderRadius: 12, padding: 16 }}>
        <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 4 }}>Zona pericolosa</div>
        <div style={{ ...sans, fontSize: 12, color: C.muted, marginBottom: 10 }}>Elimina tutti i contratti, con piani e storico. Gli utenti non vengono toccati. Utile per togliere i dati di prova prima dell'uso reale.</div>
        <button onClick={onPurge} style={{ ...sans, padding: "7px 14px", background: "transparent", border: `1px solid ${C.red}`, borderRadius: 6, color: C.red, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>🗑 Elimina tutti i contratti</button>
      </div>

      {creating && <NewUserModal onSave={async input => { const err = await onCreate(input); if (!err) setCreating(false); return err; }} onClose={() => setCreating(false)} />}
      {resetting && <ResetPasswordModal user={resetting} onSave={async pw => { const err = await onUpdate(resetting.id, { password: pw }); if (!err) setResetting(null); return err; }} onClose={() => setResetting(null)} />}
    </div>
  );
}
