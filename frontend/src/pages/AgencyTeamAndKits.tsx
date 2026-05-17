import { useState, useEffect } from "react";
import { api } from '../lib/api';
import { useAuthStore } from '../authStore';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Member {
  user_id: string; name: string; email: string;
  role: string; initials: string; suspended?: boolean;
}
interface Invite {
  token: string; email: string; role: string; created_at: string; status?: string;
}
interface BrandKit {
  id: string; client_name: string; logo_url: string; colors: string[];
  subtitle_style: string; ai_tone: string; default_cta: string;
}
interface Workspace { id: string; name: string; owner_id: string; seat_limit: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const ROLE_STYLE: Record<string, string> = {
  owner:  "bg-amber-400/15 text-amber-300 border border-amber-400/25",
  admin:  "bg-blue-400/15 text-blue-300 border border-blue-400/25",
  editor: "bg-violet-400/15 text-violet-300 border border-violet-400/25",
  client: "bg-teal-400/15 text-teal-300 border border-teal-400/25",
};
const AVATAR_COLORS = [
  "from-violet-500 to-indigo-600", "from-amber-400 to-orange-500",
  "from-teal-400 to-emerald-500",  "from-pink-500 to-rose-500",
  "from-blue-400 to-cyan-500",
];

function Avatar({ initials, i, size = 9 }: { initials: string; i: number; size?: number }) {
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEAM PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export function AgencyTeam() {
  const currentUser = useAuthStore((s: any) => s.user);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Modals
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [removing, setRemoving] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<Member | null>(null);
  const [suspending, setSuspending] = useState(false);

  // Workspace rename
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const isOwner = ws?.owner_id === currentUser?.id;

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [wsRes, mRes] = await Promise.all([
        api.get("/api/agency/workspace"),
        api.get("/api/agency/workspace/members"),
      ]);
      setWs(wsRes.data.workspace);
      setNewName(wsRes.data.workspace.name);
      setMembers(mRes.data.members);
      setPending(mRes.data.pending_invites.filter((i: Invite) => !i.status || i.status === "pending"));
    } finally { setLoading(false); }
  }

  // ── Invite ──────────────────────────────────────────────────────────────────
  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true); setMsg(null);
    try {
      await api.post("/api/agency/workspace/invite", { email: inviteEmail.trim(), role: inviteRole });
      setMsg({ text: `Invite sent to ${inviteEmail}`, ok: true });
      setInviteEmail("");
      load();
    } catch (e: any) {
      setMsg({ text: e.response?.data?.detail || "Failed to send invite", ok: false });
    } finally { setInviting(false); }
  }

  // ── Cancel invite ───────────────────────────────────────────────────────────
  async function cancelInvite(token: string, email: string) {
    if (!confirm(`Cancel invite to ${email}?`)) return;
    try {
      await api.delete(`/api/agency/workspace/invite/${token}`);
      setPending(p => p.filter(i => i.token !== token));
    } catch (e: any) { alert(e.response?.data?.detail || "Failed"); }
  }

  // ── Change role ─────────────────────────────────────────────────────────────
  async function changeRole(uid: string, role: string) {
    try {
      await api.patch(`/api/agency/workspace/members/${uid}/role`, { role });
      setMembers(m => m.map(x => x.user_id === uid ? { ...x, role } : x));
    } catch (e: any) { alert(e.response?.data?.detail || "Failed"); }
  }

  // ── Remove member (with project transfer) ───────────────────────────────────
  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      // Transfer projects first if a recipient is selected
      if (transferTo) {
        await api.post(`/api/agency/workspace/members/${removeTarget.user_id}/transfer-projects`,
          { to_user_id: transferTo });
      }
      await api.delete(`/api/agency/workspace/members/${removeTarget.user_id}`);
      setMembers(m => m.filter(x => x.user_id !== removeTarget.user_id));
      setRemoveTarget(null); setTransferTo("");
    } catch (e: any) { alert(e.response?.data?.detail || "Failed"); }
    finally { setRemoving(false); }
  }

  // ── Suspend / unsuspend ─────────────────────────────────────────────────────
  async function confirmSuspend() {
    if (!suspendTarget) return;
    setSuspending(true);
    try {
      const isSuspended = suspendTarget.suspended;
      await api.patch(`/api/agency/workspace/members/${suspendTarget.user_id}/suspend`,
        { suspended: !isSuspended });
      setMembers(m => m.map(x =>
        x.user_id === suspendTarget.user_id ? { ...x, suspended: !isSuspended } : x
      ));
      setSuspendTarget(null);
    } catch (e: any) { alert(e.response?.data?.detail || "Failed"); }
    finally { setSuspending(false); }
  }

  // ── Rename workspace ────────────────────────────────────────────────────────
  async function saveRename() {
    if (!newName.trim() || newName === ws?.name) { setEditingName(false); return; }
    setRenaming(true);
    try {
      await api.patch("/api/agency/workspace/rename", { name: newName.trim() });
      setWs(w => w ? { ...w, name: newName.trim() } : w);
      setEditingName(false);
    } catch (e: any) { alert(e.response?.data?.detail || "Failed"); }
    finally { setRenaming(false); }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const otherMembers = members.filter(m => m.user_id !== removeTarget?.user_id && m.role !== "client");

  return (
    <div className="max-w-2xl space-y-5 pb-8">

      {/* ── Workspace name ── */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
        <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-3">Workspace name</div>
        {editingName ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditingName(false); }}
              className="flex-1 bg-white/[0.06] border border-amber-400/40 rounded-xl px-4 py-2.5 text-white text-sm outline-none"
            />
            <button onClick={saveRename} disabled={renaming}
              className="bg-amber-400 hover:bg-amber-300 text-black font-bold px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-50">
              {renaming ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditingName(false); setNewName(ws?.name || ""); }}
              className="px-4 py-2.5 bg-white/[0.06] border border-white/[0.1] text-white/50 hover:text-white rounded-xl text-sm transition">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-extrabold text-white tracking-tight">{ws?.name}</div>
              <div className="text-xs text-white/30 mt-0.5">{members.length} / {ws?.seat_limit || 5} seats used</div>
            </div>
            {isOwner && (
              <button onClick={() => setEditingName(true)}
                className="flex items-center gap-1.5 text-xs border border-white/[0.1] text-white/40 hover:text-white hover:border-white/[0.2] px-3 py-1.5 rounded-lg transition font-medium">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M11 2l3 3-9 9H2v-3l9-9z"/>
                </svg>
                Rename
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Invite ── */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 space-y-3">
        <div className="text-sm font-bold text-white">Invite someone</div>
        <div className="flex gap-2 flex-wrap">
          <input type="email" placeholder="teammate@email.com"
            value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && invite()}
            className="flex-1 min-w-44 bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
            className="bg-white/[0.06] border border-white/[0.1] rounded-xl px-3 py-2.5 text-white/80 text-sm outline-none focus:border-amber-400/50 transition">
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
            <option value="client">Client</option>
          </select>
          <button onClick={invite} disabled={inviting || !inviteEmail.trim()}
            className="bg-amber-400 hover:bg-amber-300 active:scale-95 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20 disabled:opacity-50">
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </div>
        {msg && <p className={`text-xs font-medium ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</p>}
        <div className="grid grid-cols-3 gap-3 pt-1">
          {[
            { role: "Editor", desc: "Create & edit videos, render" },
            { role: "Admin",  desc: "Manage team & settings" },
            { role: "Client", desc: "View & comment only" },
          ].map(r => (
            <div key={r.role} className="bg-white/[0.03] rounded-xl p-2.5">
              <div className="text-[11px] font-bold text-white/50">{r.role}</div>
              <div className="text-[10.5px] text-white/25 mt-0.5 leading-snug">{r.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Active members ── */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-sm font-bold text-white">Members ({members.length})</span>
          <span className="text-xs text-white/25">{ws?.seat_limit || 5} seat limit</span>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {members.map((m, i) => (
            <div key={m.user_id}
              className={`flex items-center gap-3 px-5 py-3.5 ${m.suspended ? "opacity-50" : ""}`}>
              <div className="relative">
                <Avatar initials={m.initials} i={i} size={9} />
                {m.suspended && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#0A0A0F] flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500" title="Suspended" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white/80 truncate">{m.name || m.email}</span>
                  {m.suspended && (
                    <span className="text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded-full font-semibold">Suspended</span>
                  )}
                </div>
                <div className="text-xs text-white/30 truncate">{m.email}</div>
              </div>

              {/* Role */}
              {m.role === "owner" ? (
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${ROLE_STYLE.owner}`}>Owner</span>
              ) : isOwner ? (
                <select value={m.role} onChange={e => changeRole(m.user_id, e.target.value)}
                  className="bg-white/[0.06] border border-white/[0.1] rounded-lg px-2.5 py-1 text-xs text-white/70 outline-none hover:border-white/[0.2] transition">
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="client">Client</option>
                </select>
              ) : (
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${ROLE_STYLE[m.role] || ROLE_STYLE.editor}`}>{m.role}</span>
              )}

              {/* Actions — owner only, not on self */}
              {isOwner && m.role !== "owner" && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setSuspendTarget(m)}
                    title={m.suspended ? "Unsuspend" : "Suspend"}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/20 hover:text-amber-400 hover:bg-amber-400/10 transition text-sm">
                    {m.suspended ? "▶" : "⏸"}
                  </button>
                  <button
                    onClick={() => { setRemoveTarget(m); setTransferTo(""); }}
                    title="Remove member"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/20 hover:text-rose-400 hover:bg-rose-400/10 transition text-base leading-none">
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Pending invites ── */}
      {pending.length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-sm font-bold text-white/50">Pending invites ({pending.length})</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {pending.map(inv => (
              <div key={inv.token} className="flex items-center gap-3 px-5 py-3.5">
                <div className="w-9 h-9 rounded-full bg-white/[0.05] border border-dashed border-white/[0.1] text-white/25 text-xs font-bold flex items-center justify-center flex-shrink-0">?</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white/70 truncate">{inv.email}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] bg-amber-400/10 text-amber-400/70 border border-amber-400/15 px-1.5 py-0.5 rounded-full font-semibold">Pending</span>
                    <span className="text-[10px] text-white/25">Expires in 7 days</span>
                  </div>
                </div>
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${ROLE_STYLE[inv.role] || ROLE_STYLE.editor}`}>{inv.role}</span>
                {isOwner && (
                  <button onClick={() => cancelInvite(inv.token, inv.email)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/20 hover:text-rose-400 hover:bg-rose-400/10 transition text-base leading-none flex-shrink-0"
                    title="Cancel invite">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Suspended note ── */}
      {members.some(m => m.suspended) && (
        <div className="bg-rose-400/[0.05] border border-rose-400/15 rounded-xl p-4">
          <div className="text-xs font-bold text-rose-400 mb-1">Suspended members cannot:</div>
          <div className="flex gap-3 flex-wrap">
            {["Access projects", "Render videos", "Export files", "View assets"].map(r => (
              <span key={r} className="text-[11px] text-rose-400/60 flex items-center gap-1">
                <span className="text-rose-500/40">✕</span> {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ══ REMOVE MODAL ══ */}
      {removeTarget && (
        <Modal onClose={() => { setRemoveTarget(null); setTransferTo(""); }}>
          <div className="text-lg font-extrabold text-white mb-1">Remove member</div>
          <p className="text-sm text-white/50 mb-5 leading-relaxed">
            You're about to remove <strong className="text-white/80">{removeTarget.name || removeTarget.email}</strong>.
            Their session will be invalidated immediately and workspace access revoked.
          </p>

          {/* Transfer projects */}
          <div className="bg-amber-400/[0.06] border border-amber-400/15 rounded-xl p-4 mb-5 space-y-2">
            <div className="text-xs font-bold text-amber-300">Transfer projects first (recommended)</div>
            <p className="text-xs text-white/40 leading-relaxed">
              Select a team member to receive their assigned projects before removal.
            </p>
            <select value={transferTo} onChange={e => setTransferTo(e.target.value)}
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 transition mt-1">
              <option value="">— Skip transfer —</option>
              {otherMembers.map(m => (
                <option key={m.user_id} value={m.user_id}>{m.name || m.email} ({m.role})</option>
              ))}
            </select>
          </div>

          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 mb-5 space-y-1.5">
            <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest">What happens</div>
            {[
              "Projects transferred (if selected above)",
              "Access revoked immediately",
              "Active sessions invalidated",
              "Workspace permissions removed",
              "Project/asset access stopped",
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-white/50">
                <div className="w-1 h-1 rounded-full bg-white/20 flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button onClick={confirmRemove} disabled={removing}
              className="flex-1 bg-rose-500 hover:bg-rose-400 text-white font-bold py-3 rounded-xl text-sm transition disabled:opacity-50">
              {removing ? "Removing…" : "Remove member"}
            </button>
            <button onClick={() => { setRemoveTarget(null); setTransferTo(""); }}
              className="px-5 bg-white/[0.06] border border-white/[0.1] text-white/60 hover:text-white rounded-xl text-sm font-semibold transition">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ══ SUSPEND MODAL ══ */}
      {suspendTarget && (
        <Modal onClose={() => setSuspendTarget(null)}>
          <div className="text-lg font-extrabold text-white mb-1">
            {suspendTarget.suspended ? "Unsuspend" : "Suspend"} member
          </div>
          <p className="text-sm text-white/50 mb-5 leading-relaxed">
            {suspendTarget.suspended ? (
              <>Restore access for <strong className="text-white/80">{suspendTarget.name || suspendTarget.email}</strong>. They'll be able to access projects and render again.</>
            ) : (
              <>Suspend <strong className="text-white/80">{suspendTarget.name || suspendTarget.email}</strong>. They'll stay in the workspace but lose access to everything immediately.</>
            )}
          </p>

          {!suspendTarget.suspended && (
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 mb-5 space-y-1.5">
              <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest">Suspended users cannot</div>
              {["Access projects or scenes", "Start new renders", "Export videos", "View workspace assets"].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-white/50">
                  <span className="text-rose-500/50 text-xs">✕</span> {item}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={confirmSuspend} disabled={suspending}
              className={`flex-1 font-bold py-3 rounded-xl text-sm transition disabled:opacity-50 ${
                suspendTarget.suspended
                  ? "bg-emerald-500 hover:bg-emerald-400 text-white"
                  : "bg-amber-500 hover:bg-amber-400 text-black"
              }`}>
              {suspending ? "…" : suspendTarget.suspended ? "Restore access" : "Suspend member"}
            </button>
            <button onClick={() => setSuspendTarget(null)}
              className="px-5 bg-white/[0.06] border border-white/[0.1] text-white/60 hover:text-white rounded-xl text-sm font-semibold transition">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Modal wrapper ──────────────────────────────────────────────────────────────
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(7,7,14,0.85)", backdropFilter: "blur(12px)" }}
      onClick={onClose}>
      <div className="bg-[#111118] border border-white/[0.1] rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
        style={{ animation: "fadeUp .2s ease" }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRAND KITS PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export function AgencyBrandKits() {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editKit, setEditKit] = useState<BrandKit | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get("/api/agency/brand-kits");
      setKits(res.data.brand_kits);
    } finally { setLoading(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this brand kit?")) return;
    await api.delete(`/api/agency/brand-kits/${id}`);
    setKits(k => k.filter(x => x.id !== id));
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl space-y-5 pb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl">🎨</div>
          <div>
            <h1 className="text-xl font-extrabold text-white tracking-tight">Brand kits</h1>
            <p className="text-white/35 text-xs">{kits.length} kit{kits.length !== 1 ? "s" : ""} — one per client</p>
          </div>
        </div>
        <button onClick={() => { setEditKit(null); setShowForm(true); }}
          className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 active:scale-95 text-black font-bold px-4 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
          New brand kit
        </button>
      </div>

      {kits.length === 0 && !showForm && (
        <div className="bg-white/[0.03] border border-dashed border-white/[0.1] rounded-2xl py-16 text-center space-y-4">
          <div className="text-5xl">🎨</div>
          <div className="text-white/60 font-semibold">No brand kits yet</div>
          <p className="text-white/30 text-sm max-w-xs mx-auto">One per client — logo, colors, subtitle style and AI tone applied automatically.</p>
          <button onClick={() => setShowForm(true)}
            className="bg-amber-400 hover:bg-amber-300 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition shadow-md shadow-amber-400/20">
            Create first brand kit
          </button>
        </div>
      )}

      {kits.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {kits.map(kit => (
            <div key={kit.id}
              className="bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.14] rounded-2xl p-5 space-y-3.5 transition-colors group">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-white">{kit.client_name}</div>
                  <div className="text-xs text-white/30 mt-0.5 capitalize">{kit.subtitle_style} subtitles</div>
                </div>
                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => { setEditKit(kit); setShowForm(true); }}
                    className="text-xs bg-white/[0.06] border border-white/[0.1] text-white/50 hover:text-white px-2.5 py-1 rounded-lg transition">Edit</button>
                  <button onClick={() => del(kit.id)}
                    className="text-xs bg-rose-400/10 border border-rose-400/20 text-rose-400 hover:bg-rose-400/20 px-2.5 py-1 rounded-lg transition">Del</button>
                </div>
              </div>
              {kit.colors.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {kit.colors.slice(0, 8).map((c, i) => (
                    <div key={i} style={{ background: c }} className="w-6 h-6 rounded-md border border-white/10 flex-shrink-0" title={c} />
                  ))}
                </div>
              )}
              <div className="space-y-1">
                {kit.ai_tone && <div className="text-xs text-white/35 italic">"{kit.ai_tone}"</div>}
                {kit.default_cta && <div className="text-xs text-white/25"><span className="font-medium text-white/20">CTA:</span> {kit.default_cta}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <BrandKitForm kit={editKit}
          onSaved={() => { setShowForm(false); setEditKit(null); load(); }}
          onCancel={() => { setShowForm(false); setEditKit(null); }} />
      )}
    </div>
  );
}

function BrandKitForm({ kit, onSaved, onCancel }: { kit: BrandKit | null; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    client_name: kit?.client_name || "", logo_url: kit?.logo_url || "",
    colors: kit?.colors?.join(", ") || "", subtitle_style: kit?.subtitle_style || "viral",
    ai_tone: kit?.ai_tone || "", default_cta: kit?.default_cta || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!form.client_name.trim()) { setError("Client name required"); return; }
    setSaving(true); setError("");
    const payload = { ...form, colors: form.colors.split(",").map(s => s.trim()).filter(Boolean) };
    try {
      if (kit) await api.put(`/api/agency/brand-kits/${kit.id}`, payload);
      else await api.post("/api/agency/brand-kits", payload);
      onSaved();
    } catch (e: any) { setError(e.response?.data?.detail || "Failed"); setSaving(false); }
  }

  const F = (k: string) => ({
    value: form[k as keyof typeof form] as string,
    onChange: (e: any) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  return (
    <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-bold text-white">{kit ? "Edit brand kit" : "New brand kit"}</div>
        <button onClick={onCancel} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/[0.06] transition text-lg leading-none">×</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { key: "client_name", label: "Client name *", ph: "CryptoNova" },
          { key: "logo_url",    label: "Logo URL",      ph: "https://…/logo.png" },
          { key: "ai_tone",     label: "AI tone",       ph: "Confident, fast-paced" },
          { key: "default_cta", label: "Default CTA",   ph: "Follow for daily crypto alpha" },
        ].map(f => (
          <div key={f.key}>
            <label className="block text-[11px] font-bold text-white/35 uppercase tracking-widest mb-1.5">{f.label}</label>
            <input type="text" placeholder={f.ph} {...F(f.key)}
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-[11px] font-bold text-white/35 uppercase tracking-widest mb-1.5">Brand colors <span className="normal-case font-normal text-white/20">(comma separated hex)</span></label>
        <input type="text" placeholder="#0D1B2A, #00C8FF, #F7C948" {...F("colors")}
          className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition font-mono" />
        {form.colors && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {form.colors.split(",").map(c => c.trim()).filter(Boolean).map((c, i) => (
              <div key={i} style={{ background: c }} className="w-6 h-6 rounded-md border border-white/10" title={c} />
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-[11px] font-bold text-white/35 uppercase tracking-widest mb-1.5">Subtitle style</label>
        <select {...F("subtitle_style")}
          className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 transition">
          <option value="viral">Bold word-by-word (viral)</option>
          <option value="minimal">Full line minimal</option>
          <option value="karaoke">Karaoke highlight</option>
          <option value="none">No subtitles</option>
        </select>
      </div>
      {error && <p className="text-rose-400 text-xs">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={save} disabled={saving}
          className="flex-1 bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 rounded-xl text-sm transition shadow-md shadow-amber-400/20 disabled:opacity-50">
          {saving ? "Saving…" : kit ? "Save changes" : "Create brand kit"}
        </button>
        <button onClick={onCancel}
          className="px-5 bg-white/[0.06] border border-white/[0.1] text-white/60 hover:text-white rounded-xl text-sm font-semibold transition">
          Cancel
        </button>
      </div>
    </div>
  );
}
