import { useState, useEffect } from "react";
import { useStore } from '../store';
import { useAuthStore } from '../authStore';
import { api } from '../lib/api';
import { SuspendedScreen } from './AgencyProjects';

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
interface SceneReview {
  project_id: string; project_title: string; client_name: string;
  count: number;
  comments: { scene_index: number; text: string; author: string }[];
  scenes?: { scene_index: number; text: string; author: string }[];
}

interface MyTask {
  comment_id: string; scene_index: number; text: string; author: string;
  priority: string; deadline?: string; created_at: string;
  project_id: string; project_title: string; client_name: string; proj_status: string;
}

interface UsageEntry {
  user_id: string; job_id: string; tokens_used: number; scene_count: number;
  project_id: string; project_title: string; ts: string;
  balance_after?: number;
}

interface DashboardData {
  active_projects: number; pending_approvals: number;
  team_members: number; pool_tokens: number;
  recent_projects: Project[]; recent_activity: ActivityEvent[]; members: Member[];
  scenes_needing_review?: SceneReview[];
  scenes_updated?: SceneReview[];
  my_tasks?: MyTask[];
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


// Priority config
const PRIORITY: Record<string, { label: string; dot: string; border: string; text: string; bg: string }> = {
  urgent: { label: "Urgent",  dot: "🔴", border: "border-red-500/30",    text: "text-red-400",    bg: "bg-red-400/[0.06]" },
  medium: { label: "Medium",  dot: "🟡", border: "border-amber-400/30",  text: "text-amber-300",  bg: "bg-amber-400/[0.06]" },
  low:    { label: "Low",     dot: "🟢", border: "border-emerald-400/30",text: "text-emerald-300",bg: "bg-emerald-400/[0.06]" },
};

function deadlineLabel(deadline?: string): { label: string; urgent: boolean } | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  const hours = diff / 3600000;
  if (diff < 0)         return { label: "Overdue",       urgent: true };
  if (hours < 2)        return { label: `Due in ${Math.round(hours * 60)}m`, urgent: true };
  if (hours < 24)       return { label: `Due in ${Math.round(hours)}h`,      urgent: true };
  const days = Math.floor(hours / 24);
  if (days === 0)       return { label: "Due today",      urgent: true };
  if (days === 1)       return { label: "Due tomorrow",   urgent: false };
  return { label: `Due in ${days}d`, urgent: false };
}

function timeAgo(ts: string): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

export default function AgencyDashboard() {
  const setStep = useStore((s) => s.setStep);
  const setAgencyProjectId = useStore((s: any) => s.setAgencyProjectId);
  const currentUser = useAuthStore((s: any) => s.user);
  const [data, setData] = useState<DashboardData | null>(null);
  const [usageLog, setUsageLog] = useState<UsageEntry[]>([]);
  const [usageOpen, setUsageOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [polling, setPolling] = useState(false);
  const [loading, setLoading] = useState(!!(currentUser?.workspace_suspended));
  const [error, setError] = useState("");
  // Derive immediately from cached user — no API round-trip needed
  const [suspendedBlocked, setSuspendedBlocked] = useState(!!(currentUser?.workspace_suspended));
  const [workspace, setWorkspace] = useState<{ name: string } | null>(null);

  // Role — derived once, used everywhere in this component
  const wsRole = currentUser?.workspace_role || (currentUser?.plan === 'agency' ? 'owner' : 'editor');
  const isAdminOrOwner = wsRole === 'owner' || wsRole === 'admin';

  useEffect(() => {
    // Don't bother loading — already know they're suspended
    if (currentUser?.workspace_suspended) { setSuspendedBlocked(true); setLoading(false); return; }
    load();
  }, []);

  // Re-check if suspension state changes while on the dashboard
  useEffect(() => {
    if (currentUser?.workspace_suspended) { setSuspendedBlocked(true); setLoading(false); }
  }, [currentUser?.workspace_suspended]);

  // 30-second polling — keeps dashboard data fresh without a page refresh
  useEffect(() => {
    if (currentUser?.workspace_suspended) return;
    const interval = setInterval(() => {
      silentRefresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [currentUser?.workspace_suspended]);

  // Silent background refresh — used by the 30s polling interval
  async function silentRefresh() {
    if (polling) return; // skip if already refreshing
    try {
      setPolling(true);
      const [dashRes, usageRes] = await Promise.all([
        api.get("/api/agency/workspace/dashboard"),
        api.get("/api/agency/workspace/token-usage", { silent: true } as any).catch(() => ({ data: { usage: [] } })),
      ]);
      setData(dashRes.data);
      setUsageLog(usageRes.data.usage || []);
      setLastUpdated(new Date());
    } catch { /* non-fatal — keep showing stale data */ }
    finally { setPolling(false); }
  }

  async function load() {
    try {
      setLoading(true);
      const [wsRes, dashRes, usageRes] = await Promise.all([
        api.get("/api/agency/workspace"),
        api.get("/api/agency/workspace/dashboard"),
        api.get("/api/agency/workspace/token-usage", { silent: true } as any).catch(() => ({ data: { usage: [] } })),
      ]);
      setWorkspace(wsRes.data.workspace);
      setData(dashRes.data);
      setUsageLog(usageRes.data.usage || []);
      setLastUpdated(new Date());
      setError("");
    } catch (e: any) {
      const detail = e.response?.data?.detail || "";
      if (e.response?.status === 403 && detail.toLowerCase().includes("suspended")) {
        setSuspendedBlocked(true);
      } else if (e.response?.status === 403 && detail.toLowerCase().includes("upgrade")) {
        // Only show SetupWorkspace if they truly have no workspace
        setError("no_workspace");
      } else if (e.response?.status === 403) {
        // Editor or other role — show a clear message instead of setup screen
        setError("You don't have permission to view this dashboard. Contact your workspace owner.");
      } else {
        setError(detail || "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }

  if (suspendedBlocked) return (
    <SuspendedScreen
      currentUser={currentUser}
      onGoPersonal={() => { useStore.getState().setAgencyProjectId(''); useStore.getState().setStep('projects' as any); }}
      onSignOut={() => useAuthStore.getState().logout()}
    />
  );

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
        {isAdminOrOwner && (
          <button
            onClick={() => setStep('agency-new' as any)}
            className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 active:scale-95 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-amber-400/25"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
            New project
          </button>
        )}
      </div>

      {/* Stats */}
      {/* Last updated indicator */}
      {lastUpdated && (
        <div className="flex items-center justify-end gap-2 mb-2">
          {polling && <div className="w-1.5 h-1.5 rounded-full bg-teal-400/60 animate-pulse" />}
          <span className="text-[11px] text-white/20">
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: isAdminOrOwner ? "Active projects" : "Assigned to me",
            value: isAdminOrOwner
              ? data.active_projects
              : data.recent_projects.filter((p: any) => p.assigned_to?.includes(currentUser?.id)).length,
            color: "text-white", bg: "from-white/[0.06]", icon: "📁"
          },
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

      {/* ── Scenes needing adjustment ── */}
      {(data.scenes_needing_review?.length ?? 0) > 0 && (
        <div className="bg-amber-400/[0.06] border border-amber-400/20 rounded-2xl p-4 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-amber-400/15 flex items-center justify-center text-sm">✎</div>
            <div className="text-sm font-bold text-amber-300">
              {data.scenes_needing_review!.reduce((t, p) => t + p.count, 0)} scene{data.scenes_needing_review!.reduce((t, p) => t + p.count, 0) !== 1 ? 's' : ''} need{data.scenes_needing_review!.reduce((t, p) => t + p.count, 0) === 1 ? 's' : ''} your attention
            </div>
          </div>
          <div className="space-y-2">
            {data.scenes_needing_review!.map(proj => (
              <div key={proj.project_id} className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div>
                    <span className="text-xs font-semibold text-white">{proj.project_title}</span>
                    {proj.client_name && <span className="text-xs text-white/35 ml-1.5">· {proj.client_name}</span>}
                  </div>
                  <span className="text-[11px] bg-amber-400/15 text-amber-300 border border-amber-400/20 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                    {proj.count} scene{proj.count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-1">
                  {proj.comments.slice(0, 3).map((c, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px] text-white/45">
                      <span className="text-amber-400/60 flex-shrink-0">Scene {c.scene_index + 1}:</span>
                      <span className="line-clamp-1">{c.text}</span>
                    </div>
                  ))}
                  {proj.comments.length > 3 && <div className="text-[11px] text-white/30">+{proj.comments.length - 3} more comments</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── My Tasks — visible to editors with assigned work ── */}
      {!isAdminOrOwner && (data.my_tasks?.length ?? 0) > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden mb-2">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <div>
              <div className="text-sm font-bold text-white">My Tasks</div>
              <div className="text-xs text-white/30 mt-0.5">{data.my_tasks!.length} task{data.my_tasks!.length !== 1 ? "s" : ""} need your attention</div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              {["urgent","medium","low"].map(p => {
                const count = data.my_tasks!.filter(t => (t.priority || "medium") === p).length;
                if (!count) return null;
                const pri = PRIORITY[p];
                return <span key={p} className={`flex items-center gap-1 ${pri.text}`}>{pri.dot} {count}</span>;
              })}
            </div>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {data.my_tasks!.map((task, i) => {
              const pri = PRIORITY[task.priority || "medium"];
              const dl = deadlineLabel(task.deadline);
              const ago = timeAgo(task.created_at);
              return (
                <div key={i} className={`flex items-start gap-3 px-5 py-3.5 ${pri.bg} hover:bg-white/[0.03] transition`}>
                  <span className="text-sm flex-shrink-0 mt-0.5" title={pri.label}>{pri.dot}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-bold text-white">{task.project_title}</span>
                      {task.client_name && <span className="text-[11px] text-white/30">· {task.client_name}</span>}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${pri.border} ${pri.text}`}>
                        Scene {task.scene_index + 1}
                      </span>
                      {dl && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${dl.urgent ? "bg-red-400/15 text-red-400 border border-red-400/30" : "bg-white/[0.06] text-white/40 border border-white/[0.08]"}`}>
                          {dl.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/50 line-clamp-2">{task.text}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-white/25">From {task.author} · {ago}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => { useStore.getState().setAgencyProjectId(task.project_id); useStore.getState().setStep('agency-detail' as any) }}
                    className="flex-shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-amber-400/15 border border-amber-400/25 text-amber-300 hover:bg-amber-400/20 transition mt-0.5"
                  >
                    Fix →
                  </button>
                </div>
              );
            })}
          </div>
          {/* Empty state */}
        </div>
      )}
      {!isAdminOrOwner && (data.my_tasks?.length ?? 0) === 0 && data !== null && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl px-5 py-6 mb-2 flex items-center gap-3">
          <div className="text-2xl">✅</div>
          <div>
            <div className="text-sm font-bold text-white">All caught up!</div>
            <div className="text-xs text-white/30 mt-0.5">No tasks assigned to you right now.</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Scenes updated by editors — awaiting owner/admin review ── */}
      {isAdminOrOwner && (data.scenes_updated?.length ?? 0) > 0 && (
        <div className="bg-green-400/[0.05] border border-green-400/20 rounded-2xl overflow-hidden mb-2">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-green-400/10">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-green-400/15 flex items-center justify-center text-xs font-bold text-green-300">
                {data.scenes_updated!.reduce((t, p) => t + p.count, 0)}
              </div>
              <span className="text-sm font-bold text-green-300">Scenes awaiting your review</span>
            </div>
          </div>
          {/* Scene rows */}
          <div className="divide-y divide-white/[0.05]">
            {data.scenes_updated!.flatMap(proj =>
              (proj.scenes ?? []).slice(0, 4).map((s: any, i: number) => {
                const pri = PRIORITY[s.priority || "medium"];
                const member = data.members?.find((m: any) => m.user_id === s.author_id);
                const ago = timeAgo(s.updated_at || "");
                return (
                  <div key={`${proj.project_id}-${i}`} className={`flex items-start gap-3 px-4 py-3 ${pri.bg} hover:bg-white/[0.03] transition`}>
                    {/* Priority dot */}
                    <span className="text-sm flex-shrink-0 mt-0.5" title={pri.label}>{pri.dot}</span>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-bold text-white">{proj.project_title}</span>
                        {proj.client_name && <span className="text-[11px] text-white/30">· {proj.client_name}</span>}
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${pri.border} ${pri.text}`}>
                          Scene {s.scene_index + 1}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/50 line-clamp-1">{s.text || "Scene updated"}</p>
                    </div>
                    {/* Meta + actions */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <div className="flex items-center gap-1.5">
                        {/* Editor avatar */}
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[9px] font-bold text-white" title={s.author}>
                          {initials(s.author || "?")}
                        </div>
                        {ago && <span className="text-[10px] text-white/25">{ago}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { useStore.getState().setAgencyProjectId(proj.project_id); useStore.getState().setStep('agency-detail' as any) }}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/[0.08] border border-white/[0.10] text-white/60 hover:text-white hover:bg-white/[0.12] transition"
                        >Fix →</button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

              {/* ── Token usage log ── */}
        {usageLog.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div>
                <div className="text-sm font-bold text-white">Token usage</div>
                <div className="text-xs text-white/30 mt-0.5">Last {usageLog.length} render{usageLog.length !== 1 ? "s" : ""}</div>
              </div>
              <button onClick={() => setUsageOpen(o => !o)}
                className="text-xs border border-white/[0.1] text-white/40 hover:text-white px-3 py-1.5 rounded-lg transition">
                {usageOpen ? "Hide" : "Show breakdown"}
              </button>
            </div>
            {usageOpen && (
              <div className="divide-y divide-white/[0.04] max-h-72 overflow-y-auto">
                {usageLog.map((entry, i) => {
                  const member = data?.members?.find((m: any) => m.user_id === entry.user_id);
                  const name   = member?.name || member?.email || entry.user_id.slice(0, 8);
                  const date   = new Date(entry.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                        {(member?.initials || name.slice(0,2)).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white/80 truncate">{name}</div>
                        <div className="text-[11px] text-white/30 truncate">{entry.project_title || "Unknown project"}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-bold text-amber-300">{entry.tokens_used} tokens</div>
                        <div className="text-[10px] text-white/25">{entry.scene_count} scenes · {date}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-white/30">
                Total ({usageLog.length} renders): {usageLog.reduce((s, e) => s + e.tokens_used, 0).toLocaleString()} tokens
              </span>
              {data && (
                <span className="text-xs font-semibold text-violet-300">
                  {data.pool_tokens.toLocaleString()} remaining
                </span>
              )}
            </div>
          </div>
        )}

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
              {isAdminOrOwner && (
                <button onClick={() => setStep('agency-new' as any)}
                  className="text-xs bg-amber-400/10 border border-amber-400/25 text-amber-300 px-4 py-2 rounded-lg hover:bg-amber-400/15 transition font-medium">
                  Create your first project →
                </button>
              )}
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
              ) : data.recent_activity.map((ev, i) => {
                const member = data.members?.find((m: any) => m.user_id === ev.detail?.user_id || m.user_id === ev.id);
                const memberName = member?.name || ev.detail?.email || "Team member";
                const ini = initials(memberName);
                const actionIcons: Record<string,string> = {
                  comment_added: "💬", project_created: "✨", member_joined: "👋",
                  project_status_changed: "🔄", review_link_created: "🔗",
                  render_complete: "🎬", client_approved: "✅", client_changes_requested: "📝",
                  scene_rerendered: "↻", brand_kit_created: "🎨", workspace_created: "🏢",
                };
                const icon = actionIcons[ev.action] || "•";
                return (
                  <div key={ev.id || i} className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition">
                    {/* Member avatar */}
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500/60 to-indigo-600/60 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 mt-0.5">
                      {ini}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] text-white/60 leading-snug">
                        <span className="mr-1">{icon}</span>
                        <span className="font-semibold text-white/80">{memberName}</span>
                        {" "}{(ACTION_LABEL[ev.action] || ev.action).toLowerCase()}
                        {ev.detail?.title && <span className="text-white/30"> — {ev.detail.title}</span>}
                        {ev.detail?.scene !== undefined && ev.detail?.scene !== null && (
                          <span className="text-white/30"> · Scene {Number(ev.detail.scene) + 1}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-white/20 mt-0.5">{timeAgo(ev.ts)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Quick links — role aware */}
      {(() => {
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
