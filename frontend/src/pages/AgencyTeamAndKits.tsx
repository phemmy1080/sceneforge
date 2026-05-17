import { useState, useEffect } from "react";
import { api } from '../lib/api';

interface Member { user_id: string; name: string; email: string; role: string; initials: string; }
interface PendingInvite { token: string; email: string; role: string; created_at: string; }
interface BrandKit {
  id: string; client_name: string; logo_url: string; colors: string[];
  subtitle_style: string; ai_tone: string; default_cta: string; created_at: string;
}

const ROLE_STYLE: Record<string, string> = {
  owner:  "bg-amber-400/15 text-amber-300 border-amber-400/20",
  admin:  "bg-blue-400/15 text-blue-300 border-blue-400/20",
  editor: "bg-violet-400/15 text-violet-300 border-violet-400/20",
  client: "bg-teal-400/15 text-teal-300 border-teal-400/20",
};

const AVATAR_COLORS = [
  "from-violet-500 to-indigo-600", "from-amber-400 to-orange-500",
  "from-teal-400 to-emerald-500",  "from-pink-500 to-rose-500",
  "from-blue-400 to-cyan-500",
];

// ─── Team page ────────────────────────────────────────────────────────────────
export function AgencyTeam() {
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get("/api/agency/workspace/members");
      setMembers(res.data.members);
      setPending(res.data.pending_invites);
    } finally { setLoading(false); }
  }

  async function invite() {
    if (!email.trim()) return;
    setInviting(true); setMsg(null);
    try {
      await api.post("/api/agency/workspace/invite", { email: email.trim(), role });
      setMsg({ text: `Invite sent to ${email}`, ok: true });
      setEmail("");
      load();
    } catch (e: any) {
      setMsg({ text: e.response?.data?.detail || "Failed", ok: false });
    } finally { setInviting(false); }
  }

  async function changeRole(uid: string, newRole: string) {
    try {
      await api.patch(`/api/agency/workspace/members/${uid}/role`, { role: newRole });
      setMembers(m => m.map(x => x.user_id === uid ? { ...x, role: newRole } : x));
    } catch (e: any) { alert(e.response?.data?.detail || "Failed"); }
  }

  async function remove(uid: string, name: string) {
    if (!confirm(`Remove ${name} from the workspace?`)) return;
    try {
      await api.delete(`/api/agency/workspace/members/${uid}`);
      setMembers(m => m.filter(x => x.user_id !== uid));
    } catch (e: any) { alert(e.response?.data?.detail || "Failed"); }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-2xl space-y-5 pb-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="text-2xl">👥</div>
        <div>
          <h1 className="text-xl font-extrabold text-white tracking-tight">Team</h1>
          <p className="text-white/35 text-xs">{members.length} member{members.length !== 1 ? "s" : ""} · {pending.length} pending</p>
        </div>
      </div>

      {/* Invite card */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 space-y-3">
        <div className="text-sm font-bold text-white mb-1">Invite someone</div>
        <div className="flex gap-2 flex-wrap">
          <input type="email" placeholder="teammate@email.com"
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && invite()}
            className="flex-1 min-w-48 bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
          <select value={role} onChange={e => setRole(e.target.value)}
            className="bg-white/[0.06] border border-white/[0.1] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 transition">
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
            <option value="client">Client</option>
          </select>
          <button onClick={invite} disabled={inviting || !email.trim()}
            className="bg-amber-400 hover:bg-amber-300 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20 disabled:opacity-50 active:scale-95">
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </div>
        {msg && (
          <p className={`text-xs font-medium ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</p>
        )}
        <div className="flex gap-4 pt-1">
          {[
            { role: "Editor", desc: "Create & edit videos" },
            { role: "Admin",  desc: "Manage team" },
            { role: "Client", desc: "View & comment only" },
          ].map(r => (
            <div key={r.role} className="text-[11px] text-white/30">
              <span className="text-white/50 font-semibold">{r.role}</span> — {r.desc}
            </div>
          ))}
        </div>
      </div>

      {/* Members */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06] text-sm font-bold text-white">
          Members ({members.length})
        </div>
        <div className="divide-y divide-white/[0.05]">
          {members.map((m, i) => (
            <div key={m.user_id} className="flex items-center gap-3 px-5 py-3.5">
              <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-white text-sm font-bold flex items-center justify-center flex-shrink-0`}>
                {m.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white/80">{m.name || m.email}</div>
                <div className="text-xs text-white/30 truncate">{m.email}</div>
              </div>
              {m.role === "owner" ? (
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold border ${ROLE_STYLE.owner}`}>Owner</span>
              ) : (
                <select value={m.role} onChange={e => changeRole(m.user_id, e.target.value)}
                  className="bg-white/[0.06] border border-white/[0.1] rounded-lg px-2.5 py-1 text-xs text-white/70 outline-none hover:border-white/[0.2] transition">
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="client">Client</option>
                </select>
              )}
              {m.role !== "owner" && (
                <button onClick={() => remove(m.user_id, m.name || m.email)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white/20 hover:text-rose-400 hover:bg-rose-400/10 transition text-base ml-1">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites */}
      {pending.length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06] text-sm font-bold text-white/50">
            Pending invites ({pending.length})
          </div>
          <div className="divide-y divide-white/[0.04]">
            {pending.map(inv => (
              <div key={inv.token} className="flex items-center gap-3 px-5 py-3.5 opacity-60">
                <div className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.08] text-white/30 text-xs font-bold flex items-center justify-center flex-shrink-0">?</div>
                <div className="flex-1">
                  <div className="text-sm text-white/70">{inv.email}</div>
                  <div className="text-xs text-white/25">Expires in 7 days</div>
                </div>
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold border ${ROLE_STYLE[inv.role] || ROLE_STYLE.editor}`}>{inv.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Brand kits ───────────────────────────────────────────────────────────────
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
          <p className="text-white/30 text-sm max-w-xs mx-auto">Create one per client. Logo, colors, subtitle style and AI tone — applied automatically to every video.</p>
          <button onClick={() => setShowForm(true)}
            className="bg-amber-400 hover:bg-amber-300 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20">
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
                  <div className="font-bold text-white text-sm">{kit.client_name}</div>
                  <div className="text-xs text-white/30 mt-0.5 capitalize">{kit.subtitle_style} subtitles</div>
                </div>
                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => { setEditKit(kit); setShowForm(true); }}
                    className="text-xs bg-white/[0.06] border border-white/[0.1] text-white/50 hover:text-white hover:border-white/[0.2] px-2.5 py-1 rounded-lg transition">Edit</button>
                  <button onClick={() => del(kit.id)}
                    className="text-xs bg-rose-400/10 border border-rose-400/20 text-rose-400 hover:bg-rose-400/20 px-2.5 py-1 rounded-lg transition">Del</button>
                </div>
              </div>

              {kit.colors.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {kit.colors.slice(0, 8).map((c, i) => (
                    <div key={i} style={{ background: c }}
                      className="w-6 h-6 rounded-md border border-white/10 flex-shrink-0" title={c} />
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                {kit.ai_tone && (
                  <div className="text-[11.5px] text-white/40 italic">"{kit.ai_tone}"</div>
                )}
                {kit.default_cta && (
                  <div className="text-[11.5px] text-white/30">
                    <span className="text-white/20 font-medium">CTA:</span> {kit.default_cta}
                  </div>
                )}
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
    client_name:    kit?.client_name    || "",
    logo_url:       kit?.logo_url       || "",
    colors:         kit?.colors?.join(", ") || "",
    subtitle_style: kit?.subtitle_style || "viral",
    ai_tone:        kit?.ai_tone        || "",
    default_cta:    kit?.default_cta    || "",
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
    } catch (e: any) {
      setError(e.response?.data?.detail || "Failed to save");
      setSaving(false);
    }
  }

  const F = (k: string) => ({
    value: form[k as keyof typeof form] as string,
    onChange: (e: any) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  return (
    <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-bold text-white">{kit ? "Edit brand kit" : "New brand kit"}</div>
        <button onClick={onCancel}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/[0.06] transition text-lg leading-none">×</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { key: "client_name",  label: "Client name *",  ph: "CryptoNova" },
          { key: "logo_url",     label: "Logo URL",        ph: "https://…/logo.png" },
          { key: "ai_tone",      label: "AI tone / voice", ph: "Confident, fast-paced" },
          { key: "default_cta",  label: "Default CTA",     ph: "Follow for daily crypto alpha" },
        ].map(f => (
          <div key={f.key}>
            <label className="block text-[11px] font-bold text-white/40 uppercase tracking-widest mb-1.5">{f.label}</label>
            <input type="text" placeholder={f.ph} {...F(f.key)}
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
          </div>
        ))}
      </div>

      <div>
        <label className="block text-[11px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Brand colors <span className="normal-case font-normal text-white/25">(comma separated hex)</span></label>
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
        <label className="block text-[11px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Subtitle style</label>
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
          className="flex-1 bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20 disabled:opacity-50">
          {saving ? "Saving…" : kit ? "Save changes" : "Create brand kit"}
        </button>
        <button onClick={onCancel}
          className="px-5 bg-white/[0.06] border border-white/[0.1] text-white/60 hover:text-white hover:border-white/[0.2] font-semibold rounded-xl text-sm transition">
          Cancel
        </button>
      </div>
    </div>
  );
}
