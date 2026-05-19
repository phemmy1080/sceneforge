import { useState, useEffect } from "react";
import { useStore } from '../store';
import { useAuthStore } from '../authStore';
import { api } from '../lib/api';

interface Project {
  id: string; title: string; client_name: string;
  platform: string; status: string; updated_at: string;
}
interface Member {
  user_id: string; name: string; email: string; role: string; initials: string;
}
interface ActivityEvent {
  id: string; action: string; detail: Record<string, string>; ts: string;
}
interface DashboardData {
  active_projects: number; pending_approvals: number;
  team_members: number; pool_tokens: number;
  recent_projects: Project[]; recent_activity: ActivityEvent[]; members: Member[];
}

const STATUS: Record<string, { label: string; color: string; dot: string }> = {
  draft:         { label: "Draft",         color: "bg-white/10 text-white/50",         dot: "#6b7280" },
  in_review:     { label: "In review",     color: "bg-amber-400/15 text-amber-300",     dot: "#fbbf24" },
  client_review: { label: "Client review", color: "bg-violet-400/15 text-violet-300",   dot: "#a78bfa" },
  approved:      { label: "Approved",      color: "bg-emerald-400/15 text-emerald-300", dot: "#34d399" },
  rendering:     { label: "Rendering",     color: "bg-blue-400/15 text-blue-300",       dot: "#60a5fa" },
  exported:      { label: "Exported",      color: "bg-teal-400/15 text-teal-300",       dot: "#2dd4bf" },
};

const ACTION_LABEL: Record<string, string> = {
  workspace_created:      "Created workspace",
  member_joined:          "Joined workspace",
  project_created:        "Created project",
  project_status_changed: "Status updated",
  brand_kit_created:      "Created brand kit",
  comment_added:          "Left a comment",
  review_link_created:    "Sent client review link",
};

const AVATAR_COLORS = [
  "from-violet-500 to-indigo-600",
  "from-amber-400 to-orange-500",
  "from-teal-400 to-emerald-500",
  "from-pink-500 to-rose-500",
  "from-blue-400 to-cyan-500",
];

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AgencyDashboard() {
  const setStep = useStore((s) => s.setStep);
  const setAgencyProjectId = useStore((s: any) => s.setAgencyProjectId);
  const currentUser = useAuthStore((s: any) => s.user);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<{ name: string } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [wsRes, dashRes] = await Promise.all([
        api.get("/api/agency/workspace"),
        api.get("/api/agency/workspace/dashboard"),
      ]);
      setWorkspace(wsRes.data.workspace);
      setData(dashRes.data);
      setError("");
    } catch (e: any) {
      if (e.response?.status === 403) setError("no_workspace");
      else setError(e.response?.data?.detail || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
    </div>
  );

  if (error === "no_workspace") return <SetupWorkspace onCreated={load} />;
  if (error) return <div className="text-rose-400 text-sm p-8 text-center">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6 pb-8">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-bold text-amber-400/80 uppercase tracking-[.12em]">Agency workspace</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">{workspace?.name}</h1>
        </div>
        <button
          onClick={() => setStep('agency-new' as any)}
          className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 active:scale-95 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-amber-400/25"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
          New project
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Active projects",   value: data.active_projects,             color: "text-white",       bg: "from-white/[0.06]",     icon: "📁" },
          { label: "Pending approvals", value: data.pending_approvals,           color: "text-amber-400",   bg: "from-amber-400/[0.08]", icon: "⏳" },
          { label: "Team members",      value: data.team_members,                color: "text-teal-400",    bg: "from-teal-400/[0.08]",  icon: "👥" },
          { label: "Shared tokens",     value: data.pool_tokens.toLocaleString(), color: "text-violet-300", bg: "from-violet-400/[0.08]",icon: "🪙" },
        ].map(s => (
          <div key={s.label}
            className={`bg-gradient-to-br ${s.bg} to-transparent border border-white/[0.08] rounded-2xl p-4 hover:border-white/[0.14] transition-colors`}>
            <div className="text-2xl mb-2">{s.icon}</div>
            <div className={`text-2xl font-extrabold tracking-tight ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-white/35 mt-1 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Recent projects */}
        <div className="lg:col-span-2 bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <span className="text-sm font-bold text-white">Recent projects</span>
            <button onClick={() => setStep('agency-projects' as any)}
              className="text-xs font-semibold text-amber-400/70 hover:text-amber-400 transition">
              View all →
            </button>
          </div>
          {data.recent_projects.length === 0 ? (
            <div className="py-14 text-center">
              <div className="text-4xl mb-3">🎬</div>
              <div className="text-white/35 text-sm mb-4">No projects yet</div>
              <button onClick={() => setStep('agency-new' as any)}
                className="text-xs bg-amber-400/10 border border-amber-400/25 text-amber-300 px-4 py-2 rounded-lg hover:bg-amber-400/15 transition font-medium">
                Create your first project →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {data.recent_projects.map(p => {
                const s = STATUS[p.status] || STATUS.draft;
                return (
                  <div key={p.id}
                    onClick={() => { setAgencyProjectId(p.id); setStep('agency-detail' as any); }}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.03] cursor-pointer transition group">
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: s.dot }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white/80 group-hover:text-amber-300 transition truncate">{p.title}</div>
                      <div className="text-xs text-white/30 mt-0.5">{p.client_name || "No client"} · {p.platform}</div>
                    </div>
                    <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${s.color}`}>{s.label}</span>
                    <span className="text-[11px] text-white/20 hidden sm:block flex-shrink-0">{timeAgo(p.updated_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">

          {/* Team */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06]">
              <span className="text-sm font-bold text-white">Team</span>
              <button onClick={() => setStep('agency-team' as any)}
                className="text-xs font-semibold text-amber-400/70 hover:text-amber-400 transition">
                Manage →
              </button>
            </div>
            <div>
              {data.members.slice(0, 4).map((m, i) => (
                <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                  <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0`}>
                    {m.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-white/80 truncate">{m.name || m.email}</div>
                    <div className="text-[10px] text-white/30 capitalize">{m.role}</div>
                  </div>
                </div>
              ))}
              <button onClick={() => setStep('agency-team' as any)}
                className="w-full py-2.5 text-xs text-white/25 hover:text-amber-400 hover:bg-amber-400/[0.04] transition font-medium flex items-center justify-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
                Invite team member
              </button>
            </div>
          </div>

          {/* Activity */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-white/[0.06]">
              <span className="text-sm font-bold text-white">Activity</span>
            </div>
            <div className="overflow-y-auto max-h-52">
              {data.recent_activity.length === 0 ? (
                <div className="py-8 text-center text-white/20 text-xs">No activity yet</div>
              ) : data.recent_activity.map(ev => (
                <div key={ev.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400/50 mt-1.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11.5px] text-white/55 leading-snug">
                      {ACTION_LABEL[ev.action] || ev.action}
                      {ev.detail?.title && <span className="text-white/30"> — {ev.detail.title}</span>}
                    </div>
                    <div className="text-[10px] text-white/20 mt-0.5">{timeAgo(ev.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick links — role aware */}
      {(() => {
        const role = currentUser?.workspace_role || (currentUser?.plan === 'agency' ? 'owner' : 'editor')
        const isAdminOrOwner = role === 'owner' || role === 'admin'
        const links = [
          { label: "All projects", sub: "View & manage", icon: "📁", step: "agency-projects", show: true },
          { label: "Brand kits",  sub: "Manage clients", icon: "🎨", step: "agency-kits",     show: isAdminOrOwner },
          { label: "Team",        sub: "Invite members", icon: "👥", step: "agency-team",     show: isAdminOrOwner },
          { label: "New project", sub: "Start creating", icon: "✨", step: "agency-new",      show: isAdminOrOwner },
        ].filter(q => q.show)
        return (
          <div className={`grid gap-3 ${links.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : links.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {links.map(q => (
              <button key={q.label} onClick={() => setStep(q.step as any)}
                className="bg-white/[0.03] border border-white/[0.07] hover:border-amber-400/25 hover:bg-amber-400/[0.04] rounded-2xl p-4 text-left transition-all group active:scale-95">
                <div className="text-2xl mb-2">{q.icon}</div>
                <div className="text-sm font-bold text-white/70 group-hover:text-white transition">{q.label}</div>
                <div className="text-xs text-white/25 mt-0.5">{q.sub}</div>
              </button>
            ))}
          </div>
        )
      })()}
    </div>
  );
}

function SetupWorkspace({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/agency/workspace").then(() => onCreated()).catch(() => {});
  }, []);

  async function create() {
    setLoading(true); setError("");
    try {
      await api.post("/api/agency/workspace", { name: name.trim() || "My Agency" });
      onCreated();
    } catch (e: any) {
      const d = e.response?.data?.detail || "";
      if (d.includes("already have a workspace")) { onCreated(); return; }
      setError(d || "Failed to create workspace");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white/[0.04] border border-white/[0.09] rounded-2xl p-8 max-w-md w-full text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-3xl mx-auto">🏢</div>
        <h2 className="text-xl font-extrabold text-white tracking-tight">Set up your workspace</h2>
        <p className="text-white/40 text-sm leading-relaxed">Give your workspace a name — usually your agency or brand name.</p>
        <input type="text" placeholder="e.g. Velocity Media Agency"
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && create()}
          className="w-full bg-white/[0.06] border border-white/[0.12] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        <button onClick={create} disabled={loading}
          className="w-full bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 rounded-xl text-sm transition-all shadow-lg shadow-amber-400/20 disabled:opacity-50">
          {loading ? "Creating…" : "Create workspace →"}
        </button>
      </div>
    </div>
  );
}
