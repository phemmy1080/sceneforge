import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
//import { api } from "./api";
import { api } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Member {
  user_id: string; name: string; email: string; role: string; initials: string;
}
interface PendingInvite {
  token: string; email: string; role: string; created_at: string;
}
interface BrandKit {
  id: string; client_name: string; logo_url: string; colors: string[];
  subtitle_style: string; ai_tone: string; default_cta: string;
  created_at: string;
}

const ROLE_COLORS: Record<string, string> = {
  owner:  "bg-amber-900/30 text-amber-400",
  admin:  "bg-blue-900/30 text-blue-400",
  editor: "bg-violet-900/30 text-violet-300",
  client: "bg-teal-900/30 text-teal-400",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Team page
// ═══════════════════════════════════════════════════════════════════════════════
export function AgencyTeam() {
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get("/agency/workspace/members");
      setMembers(res.data.members);
      setPending(res.data.pending_invites);
    } finally {
      setLoading(false);
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError("");
    setInviteMsg("");
    try {
      await api.post("/agency/workspace/invite", { email: inviteEmail.trim(), role: inviteRole });
      setInviteMsg(`Invite sent to ${inviteEmail}`);
      setInviteEmail("");
      await load();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  async function removeM(uid: string) {
    if (!confirm("Remove this member?")) return;
    try {
      await api.delete(`/agency/workspace/members/${uid}`);
      setMembers(m => m.filter(x => x.user_id !== uid));
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to remove member");
    }
  }

  async function changeRole(uid: string, role: string) {
    try {
      await api.patch(`/agency/workspace/members/${uid}/role`, { role });
      setMembers(m => m.map(x => x.user_id === uid ? { ...x, role } : x));
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to update role");
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-xl font-bold text-white">Team</h1>

      {/* Invite */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <div className="text-sm font-semibold text-white">Invite someone</div>
        <div className="flex gap-3 flex-wrap">
          <input
            type="email"
            placeholder="colleague@email.com"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendInvite()}
            className="flex-1 min-w-48 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/50"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none"
          >
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
            <option value="client">Client</option>
          </select>
          <button
            onClick={sendInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="bg-gold text-black font-semibold px-5 py-2.5 rounded-xl text-sm hover:bg-gold/90 transition disabled:opacity-50"
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </div>
        {inviteMsg && <p className="text-green-400 text-xs">{inviteMsg}</p>}
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        <div className="text-xs text-zinc-500">
          <strong>Editor</strong> — can create and edit videos.{" "}
          <strong>Admin</strong> — can manage team.{" "}
          <strong>Client</strong> — can only view and comment.
        </div>
      </div>

      {/* Active members */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 text-sm font-semibold text-white">
          Active members ({members.length})
        </div>
        <div className="divide-y divide-zinc-800">
          {members.map(m => (
            <div key={m.user_id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-9 h-9 rounded-full bg-violet-900/40 text-violet-300 text-sm font-bold flex items-center justify-center flex-shrink-0">
                {m.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{m.name}</div>
                <div className="text-xs text-zinc-500">{m.email}</div>
              </div>
              {m.role === "owner" ? (
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ROLE_COLORS.owner}`}>Owner</span>
              ) : (
                <select
                  value={m.role}
                  onChange={e => changeRole(m.user_id, e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white outline-none"
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="client">Client</option>
                </select>
              )}
              {m.role !== "owner" && (
                <button
                  onClick={() => removeM(m.user_id)}
                  className="text-zinc-600 hover:text-rose-400 transition text-sm ml-1"
                  title="Remove member"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites */}
      {pending.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 text-sm font-semibold text-zinc-400">
            Pending invites ({pending.length})
          </div>
          <div className="divide-y divide-zinc-800">
            {pending.map(inv => (
              <div key={inv.token} className="flex items-center gap-3 px-5 py-3.5 opacity-70">
                <div className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-500 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  ?
                </div>
                <div className="flex-1">
                  <div className="text-sm text-white">{inv.email}</div>
                  <div className="text-xs text-zinc-500">Invite sent · expires in 7 days</div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ROLE_COLORS[inv.role] || ""}`}>
                  {inv.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Brand kits page
// ═══════════════════════════════════════════════════════════════════════════════
export function AgencyBrandKits() {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editKit, setEditKit] = useState<BrandKit | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get("/agency/brand-kits");
      setKits(res.data.brand_kits);
    } finally {
      setLoading(false);
    }
  }

  async function deleteKit(id: string) {
    if (!confirm("Delete this brand kit?")) return;
    await api.delete(`/agency/brand-kits/${id}`);
    setKits(k => k.filter(x => x.id !== id));
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Brand kits</h1>
        <button
          onClick={() => { setEditKit(null); setShowForm(true); }}
          className="flex items-center gap-2 bg-gold text-black font-semibold px-4 py-2 rounded-xl text-sm hover:bg-gold/90 transition"
        >
          + New brand kit
        </button>
      </div>

      {kits.length === 0 && !showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl py-16 text-center space-y-3">
          <div className="text-4xl">🎨</div>
          <div className="text-white font-semibold">No brand kits yet</div>
          <p className="text-zinc-500 text-sm max-w-xs mx-auto">
            Create one per client. Logo, colors, subtitle style, AI tone — all saved and applied automatically.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-gold text-black font-semibold px-5 py-2 rounded-xl text-sm hover:bg-gold/90 transition"
          >
            Create first brand kit
          </button>
        </div>
      )}

      {/* Kit cards */}
      {kits.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {kits.map(kit => (
            <div key={kit.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-white text-sm">{kit.client_name}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 capitalize">{kit.subtitle_style} subtitles</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditKit(kit); setShowForm(true); }}
                    className="text-xs text-zinc-400 hover:text-white transition">Edit</button>
                  <button onClick={() => deleteKit(kit.id)}
                    className="text-xs text-zinc-600 hover:text-rose-400 transition">Delete</button>
                </div>
              </div>

              {/* Colors */}
              {kit.colors.length > 0 && (
                <div className="flex gap-1.5">
                  {kit.colors.slice(0, 6).map((c, i) => (
                    <div key={i} style={{ background: c }}
                      className="w-6 h-6 rounded-md border border-zinc-700 flex-shrink-0" />
                  ))}
                </div>
              )}

              {kit.ai_tone && (
                <div className="text-xs text-zinc-400 italic">"{kit.ai_tone}"</div>
              )}
              {kit.default_cta && (
                <div className="text-xs text-zinc-500">CTA: {kit.default_cta}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Form overlay */}
      {showForm && (
        <BrandKitForm
          kit={editKit}
          onSaved={() => { setShowForm(false); setEditKit(null); load(); }}
          onCancel={() => { setShowForm(false); setEditKit(null); }}
        />
      )}
    </div>
  );
}

// ── Brand kit form ────────────────────────────────────────────────────────────
function BrandKitForm({
  kit, onSaved, onCancel
}: { kit: BrandKit | null; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    client_name:    kit?.client_name    || "",
    logo_url:       kit?.logo_url       || "",
    colors:         kit?.colors?.join(", ") || "",
    subtitle_style: kit?.subtitle_style || "viral",
    ai_tone:        kit?.ai_tone        || "",
    default_cta:    kit?.default_cta    || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!form.client_name.trim()) { setError("Client name required"); return; }
    setLoading(true);
    setError("");
    const payload = {
      ...form,
      colors: form.colors.split(",").map(s => s.trim()).filter(Boolean),
    };
    try {
      if (kit) {
        await api.put(`/agency/brand-kits/${kit.id}`, payload);
      } else {
        await api.post("/agency/brand-kits", payload);
      }
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Failed to save");
      setLoading(false);
    }
  }

  const F = (k: string) => ({
    value: form[k as keyof typeof form],
    onChange: (e: any) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-white">{kit ? "Edit brand kit" : "New brand kit"}</div>
        <button onClick={onCancel} className="text-zinc-500 hover:text-white">✕</button>
      </div>

      {[
        { key: "client_name",    label: "Client name *",       ph: "e.g. CryptoNova" },
        { key: "logo_url",       label: "Logo URL",            ph: "https://…/logo.png" },
        { key: "colors",         label: "Brand colors",        ph: "#0D1B2A, #00C8FF, #F7C948 (comma separated)" },
        { key: "ai_tone",        label: "AI tone / voice",     ph: "Confident, fast-paced, alpha energy" },
        { key: "default_cta",   label: "Default CTA",         ph: "Follow for daily crypto alpha" },
      ].map(f => (
        <div key={f.key}>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">{f.label}</label>
          <input type="text" placeholder={f.ph} {...F(f.key)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/50" />
        </div>
      ))}

      <div>
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Subtitle style</label>
        <select {...F("subtitle_style")}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none">
          <option value="viral">Bold word-by-word (viral)</option>
          <option value="minimal">Full line minimal</option>
          <option value="karaoke">Karaoke highlight</option>
          <option value="none">No subtitles</option>
        </select>
      </div>

      {error && <p className="text-rose-400 text-xs">{error}</p>}
      <button
        onClick={save}
        disabled={loading}
        className="w-full bg-gold text-black font-bold py-3 rounded-xl text-sm hover:bg-gold/90 transition disabled:opacity-50"
      >
        {loading ? "Saving…" : kit ? "Save changes" : "Create brand kit"}
      </button>
    </div>
  );
}
