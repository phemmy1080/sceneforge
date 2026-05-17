import { useState, useEffect } from "react";
import { useStore } from '../store';
import { api } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Project {
  id: string;
  title: string;
  client_name: string;
  platform: string;
  status: string;
  assigned_to: string[];
  updated_at: string;
}

interface Member {
  user_id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
}

interface ActivityEvent {
  id: string;
  action: string;
  detail: Record<string, string>;
  user_id: string;
  ts: string;
}

interface DashboardData {
  active_projects: number;
  pending_approvals: number;
  team_members: number;
  pool_tokens: number;
  recent_projects: Project[];
  recent_activity: ActivityEvent[];
  members: Member[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  draft:          "bg-zinc-800 text-zinc-400",
  in_review:      "bg-amber-900/40 text-amber-400",
  client_review:  "bg-violet-900/40 text-violet-300",
  approved:       "bg-green-900/40 text-green-400",
  rendering:      "bg-blue-900/40 text-blue-400",
  exported:       "bg-teal-900/40 text-teal-400",
};

const STATUS_LABEL: Record<string, string> = {
  draft:          "Draft",
  in_review:      "In review",
  client_review:  "Client review",
  approved:       "Approved",
  rendering:      "Rendering",
  exported:       "Exported",
};

const ACTION_LABEL: Record<string, string> = {
  workspace_created:     "Created workspace",
  member_joined:         "Joined workspace",
  project_created:       "Created project",
  project_status_changed:"Updated project status",
  brand_kit_created:     "Created brand kit",
  comment_added:         "Left a comment",
  review_link_created:   "Generated client review link",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AgencyDashboard() {
  const setStep = useStore((s) => s.setStep);
  const setAgencyProjectId = useStore((s: any) => s.setAgencyProjectId);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<{ name: string } | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const [wsRes, dashRes] = await Promise.all([
        api.get("/agency/workspace"),
        api.get("/agency/workspace/dashboard"),
      ]);
      setWorkspace(wsRes.data.workspace);
      setData(dashRes.data);
    } catch (e: any) {
      if (e.response?.status === 403) {
        setError("no_workspace");
      } else {
        setError(e.response?.data?.detail || "Failed to load dashboard");
      }
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error === "no_workspace") return <SetupWorkspace onCreated={load} />;

  if (error) return (
    <div className="text-rose-400 text-sm p-8">{error}</div>
  );

  if (!data) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{workspace?.name}</h1>
          <p className="text-zinc-400 text-sm mt-1">Agency workspace</p>
        </div>
        <button
          onClick={() => setStep('agency-new' as any)}
          className="flex items-center gap-2 bg-gold text-black font-semibold px-4 py-2 rounded-xl text-sm hover:bg-gold/90 transition"
        >
          <span className="text-lg leading-none">+</span> New project
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active projects",   value: data.active_projects,   color: "text-white" },
          { label: "Pending approvals", value: data.pending_approvals, color: "text-amber-400" },
          { label: "Team members",      value: data.team_members,      color: "text-teal-400" },
          { label: "Shared tokens",     value: data.pool_tokens.toLocaleString(), color: "text-violet-300" },
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-zinc-400 text-xs mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent projects */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <span className="font-semibold text-white text-sm">Recent projects</span>
            <button
              onClick={() => setStep('agency-projects' as any)}
              className="text-xs text-zinc-400 hover:text-white transition"
            >
              View all →
            </button>
          </div>
          <div className="divide-y divide-zinc-800">
            {data.recent_projects.length === 0 && (
              <div className="px-5 py-10 text-center text-zinc-500 text-sm">
                No projects yet —{" "}
                <button onClick={() => setStep('agency-new' as any)} className="text-gold hover:underline">
                  create one
                </button>
              </div>
            )}
            {data.recent_projects.map(p => (
              <div
                key={p.id}
                onClick={() => (() => { setAgencyProjectId(p.id); setStep('agency-detail' as any); })()}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-800/50 cursor-pointer transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{p.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{p.client_name || "No client"} · {p.platform}</div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLE[p.status] || STATUS_STYLE.draft}`}>
                  {STATUS_LABEL[p.status] || p.status}
                </span>
                <span className="text-xs text-zinc-600 hidden sm:block">{timeAgo(p.updated_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right column — team + activity */}
        <div className="flex flex-col gap-5">

          {/* Team */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800">
              <span className="font-semibold text-white text-sm">Team</span>
              <button onClick={() => setStep('agency-team' as any)} className="text-xs text-zinc-400 hover:text-white transition">
                Manage →
              </button>
            </div>
            <div className="divide-y divide-zinc-800">
              {data.members.slice(0, 4).map(m => (
                <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-7 h-7 rounded-full bg-violet-900/50 text-violet-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {m.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">{m.name}</div>
                    <div className="text-xs text-zinc-500 truncate">{m.email}</div>
                  </div>
                  <span className="text-xs text-zinc-500 capitalize">{m.role}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-zinc-800">
              <span className="font-semibold text-white text-sm">Recent activity</span>
            </div>
            <div className="divide-y divide-zinc-800 max-h-64 overflow-y-auto">
              {data.recent_activity.length === 0 && (
                <div className="px-4 py-6 text-center text-zinc-600 text-xs">No activity yet</div>
              )}
              {data.recent_activity.map(ev => (
                <div key={ev.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-300">
                      {ACTION_LABEL[ev.action] || ev.action}
                      {ev.detail?.title ? ` — ${ev.detail.title}` : ""}
                    </div>
                    <div className="text-xs text-zinc-600 mt-0.5">{timeAgo(ev.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Setup workspace prompt ────────────────────────────────────────────────────
function SetupWorkspace({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.post("/agency/workspace", { name: name.trim() });
      onCreated();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Failed to create workspace");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-md w-full text-center space-y-5">
        <div className="text-4xl">🏢</div>
        <h2 className="text-xl font-bold text-white">Set up your agency workspace</h2>
        <p className="text-zinc-400 text-sm">Give your workspace a name — usually your agency name or brand.</p>
        <input
          type="text"
          placeholder="e.g. Velocity Media Agency"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && create()}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-gold/50"
        />
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        <button
          onClick={create}
          disabled={loading || !name.trim()}
          className="w-full bg-gold text-black font-bold py-3 rounded-xl text-sm hover:bg-gold/90 transition disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create workspace"}
        </button>
      </div>
    </div>
  );
}
