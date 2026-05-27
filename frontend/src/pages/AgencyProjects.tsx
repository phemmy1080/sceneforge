import React, { useState, useEffect } from "react";
import { useStore } from '../store';
import { useAuthStore } from '../authStore';
import { api } from '../lib/api';

interface Project {
  id: string; title: string; client_name: string; brand_kit_id: string;
  platform: string; status: string; notes: string; render_job_ids: string[];
  assigned_to: string[]; created_at: string; updated_at: string;
  deadline?: string;
  scene_counts?: { total: number; flagged: number; approved: number };
  health?: string[];
}
interface Comment {
  id: string; author_name: string; author_id: string; scene_index: number | null;
  text: string; is_client: boolean; resolved: boolean; created_at: string;
  is_scene_update?: boolean;
  edited?: boolean; edited_at?: string;
}
interface SceneClip {
  index: number;
  url: string;
  label: string;
  version?: number;  // incremented on re-render to force video reload
}
interface BrandKit { id: string; client_name: string; }

// Module-level patch store — persists across component mounts, navigation, and React re-renders.
// Key: "{jobId}:{sceneIndex}" → patched scene URL (with ?v=ts for cache-busting)
const _scenePatches = new Map<string, string>();

function getPatchKey(jobId: string, index: number) { return `${jobId}:${index}`; }
function setScenePatch(jobId: string, index: number, url: string) {
  _scenePatches.set(getPatchKey(jobId, index), url);
  // Also persist to sessionStorage for browser refresh
  try {
    const key = `sf_scene_urls:${jobId}`;
    const arr = JSON.parse(sessionStorage.getItem(key) || '[]');
    arr[index] = url.split('?')[0]; // store base URL without ?v=ts
    sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}
function getScenePatch(jobId: string, index: number): string | undefined {
  return _scenePatches.get(getPatchKey(jobId, index));
}

export function SuspendedScreen({ currentUser, onGoPersonal, onSignOut }: {
  currentUser: any;
  onGoPersonal: () => void;
  onSignOut: () => void;
}) {
  const hasPersonal = currentUser?.plan && currentUser.plan !== 'none';
  return (
    <div className="max-w-md mx-auto py-16 text-center space-y-5">
      <div className="w-16 h-16 rounded-full bg-rose-400/10 border border-rose-400/20 flex items-center justify-center mx-auto">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e24b4a" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-bold text-white mb-2">Workspace access suspended</h2>
        <p className="text-white/50 text-sm leading-relaxed">
          Your access to this agency workspace has been suspended by the owner.
          You cannot view or work on projects until access is restored.
        </p>
        <p className="text-white/25 text-xs mt-2">Contact your workspace owner to resolve this.</p>
      </div>
      <div className="flex gap-3 justify-center flex-wrap">
        {hasPersonal && (
          <button onClick={onGoPersonal}
            className="text-sm bg-amber-400 hover:bg-amber-300 text-black font-bold px-5 py-2.5 rounded-xl transition">
            Go to personal workspace
          </button>
        )}
        <button onClick={onSignOut}
          className="text-sm border border-white/[0.1] text-white/50 hover:text-white px-5 py-2.5 rounded-xl transition">
          Sign out
        </button>
      </div>
    </div>
  );
}
interface Member { user_id: string; name: string; email: string; role: string; initials: string; }

const STATUSES = [
  { key: "draft",         label: "Draft",         color: "bg-white/[0.08] text-white/50",          dot: "#6b7280" },
  { key: "in_review",     label: "In review",     color: "bg-amber-400/15 text-amber-300",          dot: "#fbbf24" },
  { key: "client_review", label: "Client review", color: "bg-violet-400/15 text-violet-300",        dot: "#a78bfa" },
  { key: "approved",      label: "Approved",      color: "bg-emerald-400/15 text-emerald-300",      dot: "#34d399" },
  { key: "rendering",     label: "Rendering",     color: "bg-blue-400/15 text-blue-300",            dot: "#60a5fa" },
  { key: "exported",      label: "Exported",      color: "bg-teal-400/15 text-teal-300",            dot: "#2dd4bf" },
];

function getStatus(k: string) { return STATUSES.find(s => s.key === k) || STATUSES[0]; }

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Projects list ────────────────────────────────────────────────────────────
export function AgencyProjects() {
  const setStep = useStore((s) => s.setStep);
  const setAgencyProjectId = useStore((s: any) => s.setAgencyProjectId);
  const currentUser = useAuthStore((s: any) => s.user);
  // workspace_role is set for members; owner may have null role but plan=agency
  const wsRole = currentUser?.workspace_role ||
    (currentUser?.plan === 'agency' ? 'owner' : 'editor');
  const isAdminOrOwner = wsRole === 'owner' || wsRole === 'admin';
  const canCreate = isAdminOrOwner; // only owner/admin can create new projects
  const canInvite = isAdminOrOwner;
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(!!(currentUser?.workspace_suspended));
  const [filter, setFilter] = useState("all");
  // Initialise immediately from cached user — no API wait
  const [suspendedBlocked, setSuspendedBlocked] = useState(!!(currentUser?.workspace_suspended));

  useEffect(() => {
    // Skip API call entirely — already know they're suspended
    if (currentUser?.workspace_suspended) { setSuspendedBlocked(true); setLoading(false); return; }
    api.get("/api/agency/projects")
      .then(r => setProjects(r.data.projects))
      .catch(e => {
        if (e?.response?.status === 403 &&
            e?.response?.data?.detail?.toLowerCase().includes("suspended")) {
          setSuspendedBlocked(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Also react if suspension changes mid-session
  useEffect(() => {
    if (currentUser?.workspace_suspended) { setSuspendedBlocked(true); setLoading(false); }
  }, [currentUser?.workspace_suspended]);

  // Editors can only ACTION assigned projects but can VIEW all
  // Backend already filters clients — here we just track which ones are assigned to the editor
  const myProjects = (wsRole === 'editor' || wsRole === 'client')
    ? projects.filter(p => p.assigned_to?.includes(currentUser?.id || ''))
    : projects;

  const filtered = (() => {
    if (filter === "all")      return projects;
    if (filter === "assigned") return myProjects;
    if (filter === "overdue")  return projects.filter(p => p.health?.includes("Project overdue"));
    return projects.filter(p => p.status === filter);
  })();

  if (suspendedBlocked) return (
    <SuspendedScreen
      currentUser={currentUser}
      onGoPersonal={() => { useStore.getState().setAgencyProjectId(''); setStep('projects' as any); }}
      onSignOut={() => useAuthStore.getState().logout()}
    />
  );

  return (
    <div className="max-w-4xl space-y-5 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="text-2xl">📁</div>
          <div>
            <h1 className="text-xl font-extrabold text-white tracking-tight">Projects</h1>
            <p className="text-white/35 text-xs">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setStep('agency-new' as any)}
            className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 active:scale-95 text-black font-bold px-4 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
            New project
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "all",         label: "All",            count: projects.length },
          { key: "assigned",    label: "Assigned to me", count: myProjects.length, editorOnly: true },
          { key: "in_review",   label: "Needs review",   count: projects.filter(p => p.status === "in_review").length },
          { key: "overdue",     label: "Overdue",        count: projects.filter(p => p.health?.includes("Project overdue")).length },
          { key: "client_review", label: "With client",  count: projects.filter(p => p.status === "client_review").length },
          { key: "exported",    label: "Completed",      count: projects.filter(p => p.status === "exported").length },
        ].filter(f => !f.editorOnly || wsRole === "editor").map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-xs px-3.5 py-1.5 rounded-full font-semibold border transition-all flex items-center gap-1.5 ${
              filter === f.key
                ? "bg-amber-400 text-black border-amber-400 shadow-md shadow-amber-400/20"
                : "text-white/50 border-white/[0.1] hover:border-white/20 hover:text-white/80"
            }`}>
            {f.label}
            {f.count > 0 && (
              <span className={`text-[10px] px-1.5 rounded-full font-bold ${
                filter === f.key ? "bg-black/20 text-black/70" : "bg-white/[0.08] text-white/40"
              }`}>{f.count}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white/[0.03] border border-dashed border-white/[0.1] rounded-2xl py-16 text-center space-y-3">
          <div className="text-4xl">🎬</div>
          <div className="text-white/50 font-semibold">No projects found</div>
          {canCreate && (
            <button onClick={() => setStep('agency-new' as any)}
              className="text-sm bg-amber-400/10 border border-amber-400/25 text-amber-300 px-5 py-2 rounded-xl hover:bg-amber-400/15 transition font-medium">
              Create your first project →
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="divide-y divide-white/[0.05]">
            {filtered.map(p => {
              const s = getStatus(p.status);
              return (
                <div key={p.id}
                  onClick={() => { setAgencyProjectId(p.id); setStep('agency-detail' as any); }}
                  className={`flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] cursor-pointer transition group ${
                    myProjects.some(mp => mp.id === p.id) && wsRole === 'editor'
                      ? 'border-l-2 border-amber-400/30' : ''
                  }`}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-bold text-white/80 group-hover:text-amber-300 transition truncate">{p.title}</div>
                      {myProjects.some(mp => mp.id === p.id) && wsRole === 'editor' && (
                        <span className="text-[10px] bg-amber-400/15 text-amber-300 border border-amber-400/20 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">Assigned</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-white/30">{p.client_name || "No client"} · {p.platform}</span>
                    {/* Scene counters */}
                    {p.scene_counts && p.scene_counts.total > 0 && (
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-white/25">{p.scene_counts.total} scenes</span>
                        {p.scene_counts.flagged > 0 && (
                          <span className="bg-red-400/15 text-red-400 border border-red-400/20 px-1.5 py-0.5 rounded-full font-semibold">
                            {p.scene_counts.flagged} flagged
                          </span>
                        )}
                        {p.scene_counts.approved > 0 && (
                          <span className="bg-teal-400/10 text-teal-400/70 border border-teal-400/15 px-1.5 py-0.5 rounded-full">
                            {p.scene_counts.approved} resolved
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Health warnings */}
                  {p.health && p.health.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {p.health.map((w: string, i: number) => (
                        <span key={i} className="text-[10px] bg-amber-400/10 text-amber-400/80 border border-amber-400/20 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          ⚠ {w}
                        </span>
                      ))}
                    </div>
                  )}
                  </div>
                  {/* Assigned members avatars */}
                  {p.assigned_to && p.assigned_to.length > 0 && isAdminOrOwner && (
                    <div className="flex -space-x-1.5 flex-shrink-0">
                      {p.assigned_to.slice(0, 3).map((uid, i) => (
                        <div key={uid} className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 border border-[#0A0A0F] flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                          style={{ zIndex: 3 - i }}>
                          {uid.slice(0, 2).toUpperCase()}
                        </div>
                      ))}
                      {p.assigned_to.length > 3 && (
                        <div className="w-6 h-6 rounded-full bg-white/10 border border-[#0A0A0F] flex items-center justify-center text-[9px] text-white/50">+{p.assigned_to.length - 3}</div>
                      )}
                    </div>
                  )}
                  <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${s.color}`}>{s.label}</span>
                  <span className="text-[11px] text-white/20 flex-shrink-0 hidden sm:block">{timeAgo(p.updated_at)}</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20 flex-shrink-0">
                    <path d="M5 3l4 4-4 4"/>
                  </svg>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New project ──────────────────────────────────────────────────────────────
export function NewProject() {
  const setStep = useStore((s) => s.setStep);
  const setAgencyProjectId = useStore((s: any) => s.setAgencyProjectId);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [form, setForm] = useState({ title: "", client_name: "", brand_kit_id: "", platform: "TikTok", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api.get("/api/agency/brand-kits").then(r => setKits(r.data.brand_kits)).catch(() => {}); }, []);

  async function submit() {
    if (!form.title.trim()) { setError("Title is required"); return; }
    setLoading(true); setError("");
    try {
      const res = await api.post("/api/agency/projects", form);
      setAgencyProjectId(res.data.project.id);
      setStep('agency-detail' as any);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Failed");
      setLoading(false);
    }
  }

  const F = (k: string) => ({
    value: form[k as keyof typeof form],
    onChange: (e: any) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  return (
    <div className="max-w-xl pb-8">
      <button onClick={() => setStep('agency-projects' as any)}
        className="flex items-center gap-1.5 text-white/30 hover:text-white text-sm mb-6 transition">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3L5 7l4 4"/></svg>
        Projects
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="text-2xl">✨</div>
        <h1 className="text-xl font-extrabold text-white tracking-tight">New project</h1>
      </div>

      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        {[
          { key: "title",       label: "Project title *", ph: "AI Trading Shorts — Week 3", type: "text" },
          { key: "client_name", label: "Client name",     ph: "CryptoNova",                 type: "text" },
        ].map(f => (
          <div key={f.key}>
            <label className="block text-[11px] font-bold text-white/40 uppercase tracking-widest mb-1.5">{f.label}</label>
            <input type={f.type} placeholder={f.ph} {...F(f.key)}
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
          </div>
        ))}

        <div>
          <label className="block text-[11px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Brand kit</label>
          <select {...F("brand_kit_id")}
            className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 transition">
            <option value="">— None —</option>
            {kits.map(k => <option key={k.id} value={k.id}>{k.client_name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Platform</label>
          <select {...F("platform")}
            className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 transition">
            {[
                  ["TikTok",          "TikTok (9:16 · 60s)"],
                  ["Instagram Reels", "Instagram Reels (9:16 · 30s)"],
                  ["YouTube Shorts",  "YouTube Shorts (9:16 · 60s)"],
                  ["YouTube",         "YouTube (16:9 · 3-10 min)"],
                  ["Facebook",        "Facebook (16:9 · 60s)"],
                  ["LinkedIn",        "LinkedIn (1:1 · 60s)"],
                  ["Twitter/X",       "Twitter/X (16:9 · 30s)"],
                  ["Snapchat",        "Snapchat (9:16 · 15s)"],
                  ["Pinterest",       "Pinterest (2:3 · 60s)"],
                ].map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Notes</label>
          <textarea rows={3} placeholder="Brief, tone, special instructions…" {...F("notes")}
            className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition resize-none" />
        </div>

        {error && <p className="text-rose-400 text-xs">{error}</p>}

        <button onClick={submit} disabled={loading}
          className="w-full bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20 disabled:opacity-50">
          {loading ? "Creating…" : "Create project →"}
        </button>
      </div>
    </div>
  );
}

// ─── Project detail ───────────────────────────────────────────────────────────
export function ProjectDetail() {
  const setStep = useStore((s) => s.setStep);
  const id = useStore((s: any) => s.agencyProjectId);
  const currentUser   = useAuthStore((s: any) => s.user);
  const wsRole        = currentUser?.workspace_role || 'editor';
  const isOwner       = wsRole === 'owner';
  const isAdmin       = wsRole === 'owner' || wsRole === 'admin';
  const isSuspended   = !!(currentUser?.workspace_suspended);
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  // Don't start loading if already suspended — show suspended screen immediately
  const [loading, setLoading] = useState(!isSuspended);
  const [commentText, setCommentText] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [shareTab, setShareTab] = useState<"whatsapp"|"email"|"copy">("whatsapp");
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [sceneClips, setSceneClips] = useState<SceneClip[]>([]);
  // Ref always holds latest sceneClips so polling callback avoids stale closure
  const sceneClipsRef = React.useRef<SceneClip[]>([]);
  React.useEffect(() => { sceneClipsRef.current = sceneClips; }, [sceneClips]);
  // Ref stores patched scene URLs that survive any setSceneClips reset
  // jobId used for sessionStorage persistence of patched scene URLs
  const lastJobIdRef = React.useRef<string>('');
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [sceneCommentText, setSceneCommentText] = useState("")
  const [sceneCommentPriority, setSceneCommentPriority] = useState("medium")
  const [sceneCommentDeadline, setSceneCommentDeadline] = useState("");
  const [rerenderingScene, setRerenderingScene] = useState<number | null>(null);
  const [patchedVideoUrl, setPatchedVideoUrl] = useState<string>("");
  const [jobCreatedBy, setJobCreatedBy]       = useState<string | null>(null);
  const [updatedScenes, setUpdatedScenes]       = useState<Set<number>>(new Set());
  const [pendingEditScenes, setPendingEditScenes] = useState<Set<number>>(new Set());
  const [toast, setToast]                    = useState<{ type: 'success'|'error'; msg: string } | null>(null);

  function showToast(type: 'success'|'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }
  const [members, setMembers] = useState<Member[]>([]);
  const [assignOpen, setAssignOpen]   = useState(false);
  const [assigning, setAssigning]     = useState(false);
  // Edit project details
  const [editOpen, setEditOpen]       = useState(false);
  const [editForm, setEditForm]       = useState({ title: '', client_name: '', platform: '', notes: '', brand_kit_id: '' });
  const [editSaving, setEditSaving]   = useState(false);
  const [editError, setEditError]     = useState('');
  const [editKits, setEditKits]       = useState<BrandKit[]>([]);

  const LOCKED_STATUSES = ['approved', 'rendering', 'exported'];
  const canEditDetails = isAdmin && !LOCKED_STATUSES.includes(project?.status || '');
  // Owner/admin can only edit scenes/video if they created the render job or are an editor assigned to it
  const canEditVideo = isAdmin
    ? (!jobCreatedBy || jobCreatedBy === currentUser?.id)
    : (project?.assigned_to?.includes(currentUser?.id || '') ?? false);

  useEffect(() => {
    if (id && !isSuspended) {
      load();
      // Eagerly load kits so the edit dropdown is instant when opened
      api.get('/api/agency/brand-kits')
        .then(r => setEditKits(r.data.brand_kits || []))
        .catch(() => {});
    }
  }, [id]);

  // ── Poll for scene updates from other users (editor re-renders) ─────────────
  // Runs every 15s while the project detail is open.
  // Compares Redis scene_urls against current sceneClips — updates only on change.
  useEffect(() => {
    if (!id || isSuspended) return;

    const pollInterval = setInterval(async () => {
      const jobId = lastJobIdRef.current;
      if (!jobId) return;
      try {
        const res = await api.get(`/api/render/scenes/${jobId}`);
        const freshUrls: string[] = res.data.scene_urls || [];
        if (freshUrls.length === 0) return;

        // Compare against what we're currently showing
        // Use module-level patches as the current source of truth
        let hasChange = false;
        freshUrls.forEach((url, i) => {
          if (!url) return;
          // Get what we're currently displaying for this index
          const currentClip = sceneClipsRef.current.find((c: SceneClip) => c.index === i);
          const currentBase = (currentClip?.url || '').split('?')[0];
          const freshBase   = url.split('?')[0];
          // New URL = a patch happened that we haven't seen yet
          if (freshBase && freshBase !== currentBase) {
            hasChange = true;
            // Write to module-level Map so getClipUrl picks it up
            _scenePatches.set(getPatchKey(jobId, i), url);
            // Update sessionStorage
            try {
              const stored = JSON.parse(sessionStorage.getItem(`sf_scene_urls:${jobId}`) || '[]');
              stored[i] = url;
              sessionStorage.setItem(`sf_scene_urls:${jobId}`, JSON.stringify(stored));
            } catch {}
          }
        });

        if (hasChange) {
          // Rebuild clips from fresh URLs, applying module-level patches
          const clips: SceneClip[] = freshUrls.map((url, i) => ({
            index: i,
            url: _scenePatches.get(getPatchKey(jobId, i)) || url || '',
            label: `Scene ${i + 1}`,
          })).filter(c => c.url.startsWith('http'));
          setSceneClips(clips);
          // Also refresh comments so is_scene_update badges appear
          api.get(`/api/agency/projects/${id}`)
            .then(r => setComments(r.data.comments || []))
            .catch(() => {});
        }
      } catch { /* non-fatal — poll silently */ }
    }, 15000); // every 15 seconds

    return () => clearInterval(pollInterval);
  }, [id, isSuspended]);


  async function load() {
    try {
      const [projRes, membersRes] = await Promise.all([
        api.get(`/api/agency/projects/${id}`),
        api.get("/api/agency/workspace/members"),
      ]);
      setProject(projRes.data.project);
      setComments(projRes.data.comments);
      // Keep agencyProjectId in sync — important for when editors navigate here
      useStore.getState().setAgencyProjectId(id || '');

      // Auto-restore the current review link so owner always sees the latest link
      // without having to regenerate after editor fixes scenes
      try {
        const rlRes = await api.get(`/api/agency/projects/${id}/review-link`);
        if (rlRes.data?.review_url && rlRes.data?.status !== 'expired') {
          setReviewUrl(rlRes.data.review_url);
          setReviewDismissed(false);
        }
      } catch { /* non-fatal */ }
      // Only editors/admins can be assigned — not clients
      const eligible = (membersRes.data.members || []).filter(
        (m: Member) => m.role === 'editor' || m.role === 'admin' || m.role === 'owner'
      );
      setMembers(eligible);

      // Load scene clips from the latest render job
      const jobIds: string[] = projRes.data.project.render_job_ids || [];
      if (jobIds.length > 0) {
        const latestJobId = jobIds[jobIds.length - 1];
        lastJobIdRef.current = latestJobId;
        loadSceneClips(latestJobId);
      }
      // Restore pending edit badges from sessionStorage
      try {
        const stored = JSON.parse(sessionStorage.getItem('sf_pending_edits') || '{}')
        const pending: number[] = stored[id] || []
        if (pending.length > 0) setPendingEditScenes(new Set(pending))
      } catch {}
      // Note: if render_job_ids is empty, scene review is simply hidden
      // Don't try store jobId — it belongs to whatever project was last rendered
      // which could be a completely different project → causes "Job not found" errors
    } finally { setLoading(false); }
  }

  async function loadSceneCreator(jobId: string) {
    try {
      const res = await api.get(`/api/render/job-creator/${jobId}`);
      setJobCreatedBy(res.data.created_by || null);
    } catch { setJobCreatedBy(null); }
  }

  async function loadSceneClips(jobId: string, bustCache = false) {
    loadSceneCreator(jobId).catch(() => {});
    lastJobIdRef.current = jobId;
    if (!jobId) return;

    // ── Seed module Map from sessionStorage (for browser refresh) ──
    try {
      const cached = JSON.parse(sessionStorage.getItem(`sf_scene_urls:${jobId}`) || 'null');
      if (cached && Array.isArray(cached) && cached.length > 0) {
        // Populate module Map so getScenePatch works immediately
        cached.forEach((url: string, i: number) => {
          if (url && url.startsWith('http') && !getScenePatch(jobId, i)) {
            _scenePatches.set(getPatchKey(jobId, i), url);
          }
        });
        // Show immediately from sessionStorage while Redis loads
        const clips: SceneClip[] = cached.map((url: string, i: number) => ({
          index: i, url: getScenePatch(jobId, i) || url || '', label: `Scene ${i + 1}`,
        })).filter((c: SceneClip) => c.url.startsWith('http'));
        if (clips.length > 0) setSceneClips(clips);
      }
    } catch {}

    try {
      // ── Step 1: Redis scene_urls — always has latest patched URLs ──
      let patchedUrls: string[] = [];
      try {
        const scenesRes = await api.get(`/api/render/scenes/${jobId}`);
        patchedUrls = scenesRes.data.scene_urls || [];
      } catch { /* 404 = no scenes saved yet, fall through to status */ }

      if (patchedUrls.length > 0) {
        // Save to sessionStorage for browser refresh persistence
        try { sessionStorage.setItem(`sf_scene_urls:${jobId}`, JSON.stringify(patchedUrls)); } catch {}
        const clips: SceneClip[] = patchedUrls.map((url, i) => ({
          index: i,
          // Module-level patch takes priority — has ?v=ts cache-buster from this session
          url: getScenePatch(jobId, i) || url || '',
          label: `Scene ${i + 1}`,
        })).filter(c => c.url.startsWith('http'));
        setSceneClips(clips);
        return;
      }

      // ── Step 2: Fall back to render status r2_urls (original render) ──
      let res;
      try {
        res = await api.get(`/api/render/status/${jobId}`);
      } catch (fetchErr: any) {
        if (fetchErr?.response?.status === 404) return;
        throw fetchErr;
      }
      if (!res.data?.result) return;
      const data = res.data;
      const r2 = data.result?.r2_urls || {};
      const workerBase = (data.result?.video_url || '')
        .replace(/\/renders\/.*$/, '');

      const clips: SceneClip[] = [];

      // Padded keys: scene_01.mp4 …
      let i = 1;
      while (i <= 50) {
        const pad = String(i).padStart(2, '0');
        const key = `scene_${pad}.mp4`;
        if (r2[key]) {
          clips.push({ index: i - 1, url: r2[key], label: `Scene ${i}` });
          i++;
        } else { break; }
      }

      // Fallback A: unpadded keys (older renders)
      if (clips.length === 0) {
        i = 1;
        while (r2[`scene_${i}.mp4`]) {
          clips.push({ index: i - 1, url: r2[`scene_${i}.mp4`], label: `Scene ${i}` });
          i++;
        }
      }

      // Fallback B: worker base URLs
      if (clips.length === 0 && workerBase) {
        const sceneCount = data.result?.scene_count || 0;
        for (let j = 1; j <= sceneCount; j++) {
          const pad = String(j).padStart(2, '0');
          clips.push({
            index: j - 1,
            url: `${workerBase}/renders/${jobId}/scene_${pad}.mp4`,
            label: `Scene ${j}`,
          });
        }
      }

      // Apply any module-level patches before setting state
      const patchedClips = clips.map(c => ({
        ...c, url: getScenePatch(jobId, c.index) || c.url
      }));
      setSceneClips(patchedClips);
    } catch (e) {
      console.warn('loadSceneClips failed:', e);
    }
  }

  async function postSceneComment() {
    if (!sceneCommentText.trim()) return;
    try {
      const res = await api.post(`/api/agency/projects/${id}/comments`, {
        text: sceneCommentText,
        scene_index: activeScene,
        priority: sceneCommentPriority,
        deadline: sceneCommentDeadline || undefined,
      });
      setComments(c => [...c, res.data.comment]);
      setSceneCommentText("");
      setSceneCommentPriority("medium");
      setSceneCommentDeadline("");
    } catch {}
  }

  async function changeStatus(s: string) {
    setBusy("status"); setStatusOpen(false);
    try {
      const res = await api.patch(`/api/agency/projects/${id}/status`, { status: s });
      setProject(res.data.project);
    } finally { setBusy(""); }
  }

  async function genReviewLink() {
    setBusy("review");
    try {
      const res = await api.post(`/api/agency/projects/${id}/review-link`);
      setReviewUrl(res.data.review_url);
      setReviewDismissed(false);
      setProject(p => p ? { ...p, status: "client_review" } : p);
    } finally { setBusy(""); }
  }

  async function postComment() {
    if (!commentText.trim()) return;
    try {
      const res = await api.post(`/api/agency/projects/${id}/comments`, { text: commentText });
      setComments(c => [...c, res.data.comment]);
      setCommentText("");
    } catch {}
  }

  // Re-render a single scene without a full re-render
  async function rerenderScene(sceneIndex: number) {
    if (!project?.render_job_ids?.length) {
      showToast('error', 'No previous render found. Please do a full render first.');
      return;
    }
    const lastJobId = project.render_job_ids[project.render_job_ids.length - 1];

    // Prefer fresh scenes from Zustand store (editor may have updated them)
    // Fall back to Redis if store is empty
    const storeScenes = useStore.getState().scenes;
    let sceneData: any = storeScenes?.[sceneIndex] ?? null;

    if (!sceneData) {
      // Store is empty — try Redis
      try {
        const scenesRes = await api.get(`/api/render/scenes/${lastJobId}`);
        sceneData = scenesRes.data.scenes?.[sceneIndex];
      } catch {}
    }

    if (!sceneData) {
      showToast('error', 'Scene data not found. Edit the scene first, click "Save & return to project", then re-render.');
      return;
    }

    // Note: SceneEditor already flushes scenes to Redis on "Save & return"
    // No need to flush again here — avoids race conditions with the rerender endpoint

    setRerenderingScene(sceneIndex);
    try {
      const res = await api.post(`/api/render/scenes/${lastJobId}/${sceneIndex}`, {
        scene: sceneData,
        visual_source: 'pexels_video',
        subtitle_style: 'viral',
        platform: project.platform || 'TikTok',
        motion: 'auto',
      });
      setPatchedVideoUrl(res.data.video_url);

      // Update the scene clip URL immediately — unique ?v=ts key forces React to remount video element
      const ts = Date.now();
      const newSceneUrl = res.data.scene_url
        ? `${res.data.scene_url}?v=${ts}`
        : null;
      if (newSceneUrl) {
        const jobId = lastJobIdRef.current;
        // Write to module-level Map — survives component unmount, navigation, React re-renders
        if (jobId) setScenePatch(jobId, sceneIndex, newSceneUrl);
        // Update React state for immediate display
        setSceneClips(prev => prev.map(c =>
          c.index === sceneIndex ? { ...c, url: newSceneUrl } : c
        ));
      }

      // Post a system comment — fire-and-forget, never blocks or shows errors
      const updateNote = `Scene ${sceneIndex + 1} has been updated and re-rendered.`;
      api.post(`/api/agency/projects/${id}/comments`, {
        text: updateNote,
        scene_index: sceneIndex,
        is_scene_update: true,
      }).then(r => {
        if (r.data?.comment) setComments(prev => [r.data.comment, ...prev]);
      }).catch(() => { /* non-fatal — comment failure never surfaces to user */ });

      // Mark this scene as updated (for owner badge)
      setUpdatedScenes(prev => new Set(prev).add(sceneIndex));

      showToast('success', `Scene ${sceneIndex + 1} re-rendered successfully. Full video updated.`);
      // Clear pending edit badge for this scene
      setPendingEditScenes(prev => { const n = new Set(prev); n.delete(sceneIndex); return n; });
      try {
        const stored = JSON.parse(sessionStorage.getItem('sf_pending_edits') || '{}')
        stored[id] = (stored[id] || []).filter((i: number) => i !== sceneIndex)
        sessionStorage.setItem('sf_pending_edits', JSON.stringify(stored))
      } catch {}
      // DO NOT reload from Redis here — the setSceneClips above already has the fresh URL
      // from the re-render response. Calling loadSceneClips would overwrite with Redis which
      // may still have the old URL or return the same URL without forcing a browser reload.
    } catch (e: any) {
      const isNetwork = !e.response && (e.code === 'ERR_NETWORK' || e.message?.includes('Network'));
      const msg = isNetwork
        ? 'Network error — the re-render may still be processing. Check back in a moment.'
        : (e.response?.data?.detail || 'Scene re-render failed. Please try again.');
      showToast('error', msg);
    } finally {
      setRerenderingScene(null);
    }
  }

  // Jump straight into the SceneEditor at a specific scene index
  async function editScene(sceneIndex: number) {
    const store = useStore.getState()

    // Try to load scenes from the last render job so the editor isn't empty
    const jobIds: string[] = project?.render_job_ids || []
    let loadedScenes = false

    if (jobIds.length > 0) {
      const lastJobId = jobIds[jobIds.length - 1]
      try {
        const res = await api.get(`/api/render/scenes/${lastJobId}`)
        if (res.data.scenes?.length) {
          // Hydrate the store with scenes from the render
          store.setScenes(res.data.scenes)
          loadedScenes = true
        }
      } catch {
        // 404 = job scenes not stored (old render) — fall through
      }
    }

    if (!loadedScenes) {
      // No scenes in Redis — need to go through script step first
      // But navigate to setup so editor can regenerate
      store.startAgencyVideo(id || '', 'setup', 0)
      // Show a toast/alert explaining why
      setTimeout(() => {
        alert('No saved scene data found for this project. Please run through Setup → Script → Scenes to regenerate the scenes first, then come back to edit.')
      }, 300)
      return
    }

    // Scenes loaded — go straight to SceneEditor at the right index
    // startAgencyVideo sets activeSceneIndex atomically, overriding setScenes' reset to 0
    store.startAgencyVideo(id || '', 'scenes', sceneIndex)
    // Belt-and-suspenders: set it again after a tick to be sure
    requestAnimationFrame(() => {
      useStore.getState().setActiveSceneIndex(sceneIndex)
    })
  }

  async function openEdit() {
    setEditForm({
      title:        project?.title        || '',
      client_name:  project?.client_name  || '',
      platform:     project?.platform     || '',
      notes:        project?.notes        || '',
      brand_kit_id: (project as any)?.brand_kit_id || '',
    });
    setEditError('');
    setEditOpen(true);
    // Load brand kits for the selector
    api.get('/api/agency/brand-kits')
      .then(r => setEditKits(r.data.brand_kits || []))
      .catch(() => {});
  }

  async function saveProjectEdit() {
    if (!editForm.title.trim()) { setEditError('Title is required'); return; }
    setEditSaving(true); setEditError('');
    try {
      const res = await api.put(`/api/agency/projects/${id}`, editForm);
      setProject(res.data.project);
      setEditOpen(false);
    } catch (e: any) {
      setEditError(e.response?.data?.detail || 'Failed to save');
    } finally { setEditSaving(false); }
  }

  async function toggleAssign(memberId: string) {
    if (!project) return;
    setAssigning(true);
    const current = project.assigned_to || [];
    const updated = current.includes(memberId)
      ? current.filter(id => id !== memberId)
      : [...current, memberId];
    try {
      const res = await api.put(`/api/agency/projects/${id}`, { assigned_to: updated });
      setProject(res.data.project);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to update assignment");
    } finally { setAssigning(false); }
  }

  async function resolve(cid: string) {
    await api.patch(`/api/agency/projects/${id}/comments/${cid}/resolve`);
    setComments(cs => cs.map(c => c.id === cid ? { ...c, resolved: true } : c));
  }

  // Edit/delete state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  function startEdit(c: Comment) {
    setEditingId(c.id);
    setEditText(c.text);
  }

  async function saveEdit(cid: string) {
    if (!editText.trim()) return;
    try {
      const res = await api.patch(`/api/agency/projects/${id}/comments/${cid}`,
        { text: editText.trim() });
      setComments(cs => cs.map(c => c.id === cid ? res.data.comment : c));
      setEditingId(null);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to edit");
    }
  }

  async function deleteComment(cid: string) {
    if (!confirm("Delete this note?")) return;
    try {
      await api.delete(`/api/agency/projects/${id}/comments/${cid}`);
      setComments(cs => cs.filter(c => c.id !== cid));
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to delete");
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(reviewUrl);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Suspended members see the same full screen as the projects list — no inline banner
  if (isSuspended) return (
    <SuspendedScreen
      currentUser={currentUser}
      onGoPersonal={() => { useStore.getState().setAgencyProjectId(''); setStep('projects' as any); }}
      onSignOut={() => useAuthStore.getState().logout()}
    />
  );

  if (!project) return <div className="text-white/40 text-sm p-8">Project not found</div>;

  const st = getStatus(project.status);
  const si = STATUSES.findIndex(s => s.key === project.status);

  return (
    <div className="max-w-3xl space-y-5 pb-8">

      {/* Back */}
      {/* ── Toast notification ── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-sm font-medium animate-in slide-in-from-bottom-2 ${
          toast.type === 'success'
            ? 'bg-[#0d1a12] border-green-400/30 text-green-300'
            : 'bg-[#1a0d0d] border-rose-400/30 text-rose-300'
        }`}>
          <span className="text-base flex-shrink-0 mt-0.5">{toast.type === 'success' ? '✓' : '✕'}</span>
          <span className="flex-1 leading-relaxed">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="flex-shrink-0 opacity-50 hover:opacity-100 transition text-lg leading-none ml-1">×</button>
        </div>
      )}
      <button onClick={() => setStep('agency-projects' as any)}
        className="flex items-center gap-1.5 text-white/30 hover:text-white text-sm transition">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3L5 7l4 4"/></svg>
        Projects
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-white tracking-tight truncate">{project.title}</h1>
            {canEditDetails && (
              <button onClick={openEdit}
                title="Edit project details"
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/[0.07] transition">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z"/>
                </svg>
              </button>
            )}
          </div>
          <p className="text-white/35 text-sm mt-1">{project.client_name || "No client"} · {project.platform}</p>
          {!canEditDetails && LOCKED_STATUSES.includes(project.status) && isAdmin && (
            <p className="text-[11px] text-white/20 mt-1">Project is locked for editing after {project.status}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">

          {/* Status picker — owner/admin only */}
          {isAdmin && <div className="relative">
            <button onClick={() => setStatusOpen(o => !o)}
              className={`text-[11px] px-3 py-1.5 rounded-full font-semibold border flex items-center gap-1.5 transition ${st.color}`}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
              {st.label}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3.5l3 3 3-3"/></svg>
            </button>
            {statusOpen && (
              <div className="absolute right-0 top-8 z-30 bg-[#111118] border border-white/[0.1] rounded-xl overflow-hidden shadow-2xl min-w-40">
                {STATUSES.map(s => (
                  <button key={s.key} onClick={() => changeStatus(s.key)}
                    className={`w-full text-left px-4 py-2.5 text-xs hover:bg-white/[0.05] transition flex items-center gap-2 ${s.key === project.status ? "text-white font-bold" : "text-white/50"}`}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>}

          {/* Review link — owner/admin only */}
          {isAdmin && <button onClick={genReviewLink} disabled={busy === "review"}
            className="flex items-center gap-1.5 text-xs border border-violet-400/30 text-violet-300 px-3 py-1.5 rounded-full hover:bg-violet-400/10 transition font-semibold disabled:opacity-50">
            🔗 {busy === "review" ? "Generating…" : "Client review link"}
          </button>}

          {/* Create video — editors must be assigned, owners/admins always can */}
          {(() => {
            const isAssigned = project.assigned_to?.includes(currentUser?.id || '');
            const canCreate  = (isAdmin || isAssigned) && !isSuspended;
            return (
              <button
                onClick={() => {
                  if (!canCreate) return;
                  useStore.getState().startAgencyVideo(id || '');
                }}
                disabled={!canCreate}
                title={isSuspended ? "Your access is suspended — contact the workspace owner" : !canCreate ? "You are not assigned to this project" : undefined}
                className={`flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full transition shadow-md ${
                  canCreate
                    ? "bg-amber-400 hover:bg-amber-300 text-black shadow-amber-400/20"
                    : "bg-white/[0.06] text-white/25 cursor-not-allowed"
                }`}>
                ▶ Create video
              </button>
            );
          })()}
        </div>
      </div>

      {/* Review link card */}
      {reviewUrl && !reviewDismissed && isAdmin && (() => {
        const clientName = project.client_name || "there";
        const projectTitle = project.title || "your video";
        const platform = project.platform ? ` on ${project.platform}` : "";
        const expiryDays = 7;

        const whatsappMsg =
`Hi ${clientName} 👋

Your video${platform} is ready for review!

*${projectTitle}*

Please watch the video and let us know what you think. You can:
• Watch each scene individually
• Leave notes pinned to specific scenes
• Click *Approve* if you're happy ✅
• Click *Request changes* if you'd like edits 🔄

🔗 Review link: ${reviewUrl}

This link expires in ${expiryDays} days. Looking forward to your feedback!`;

        const emailSubject = `Video ready for your review — ${projectTitle}`;
        const emailBody =
`Hi ${clientName},

Your video is ready for review.

Project: ${projectTitle}${platform}

Please use the link below to watch the video and share your feedback. You can review each scene individually, leave specific notes, and either approve the video or request changes.

Review link: ${reviewUrl}

What to do:
1. Click the link above
2. Watch the full video (and individual scenes)
3. Leave any notes on scenes you'd like changed
4. Click Approve or Request changes at the bottom

The link will expire in ${expiryDays} days. No account or login needed.

If you have any questions, feel free to reply to this email.

Best regards`;

        const copyMsg = `Hi ${clientName}, your video "${projectTitle}" is ready for review. Please use this link to watch, leave feedback, and approve: ${reviewUrl} (expires in ${expiryDays} days, no login needed)`;

        async function copyMessage(text: string) {
          await navigator.clipboard.writeText(text);
          setCopiedMsg(true);
          setTimeout(() => { setCopiedMsg(false); setReviewDismissed(true); }, 1200);
        }

        function openWhatsApp() {
          window.open(`https://wa.me/?text=${encodeURIComponent(whatsappMsg)}`, "_blank");
          setTimeout(() => setReviewDismissed(true), 800);
        }

        function openEmail() {
          window.open(`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`, "_blank");
          setTimeout(() => setReviewDismissed(true), 800);
        }

        return (
          <div className="bg-emerald-400/[0.05] border border-emerald-400/20 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-emerald-400/10 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-emerald-300">🔗 Client review link ready</div>
                <div className="text-[11px] text-white/35 mt-0.5 font-mono truncate max-w-xs">{reviewUrl}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <button onClick={() => { copy(); setTimeout(() => setReviewDismissed(true), 1200); }}
                  className="text-xs bg-emerald-400/15 border border-emerald-400/25 text-emerald-300 hover:bg-emerald-400/20 px-3.5 py-1.5 rounded-xl transition font-semibold">
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
                <button onClick={() => setReviewDismissed(true)}
                  className="text-white/25 hover:text-white/60 transition text-lg leading-none px-1"
                  title="Dismiss">×</button>
              </div>
            </div>

            {/* Share tabs */}
            <div className="px-5 pt-4 flex gap-2">
              {(["whatsapp","email","copy"] as const).map(t => (
                <button key={t} onClick={() => setShareTab(t)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                    shareTab === t
                      ? "bg-emerald-400/15 text-emerald-300"
                      : "text-white/35 hover:text-white/60"
                  }`}>
                  {t === "whatsapp" ? "📱 WhatsApp" : t === "email" ? "✉️ Email" : "📋 Quick copy"}
                </button>
              ))}
            </div>

            {/* Message preview */}
            <div className="px-5 py-4">
              {shareTab === "whatsapp" && (
                <div className="space-y-3">
                  <div className="bg-[#0f1c17] border border-emerald-900/50 rounded-xl p-4 text-xs text-emerald-100/70 leading-relaxed whitespace-pre-wrap font-mono max-h-52 overflow-y-auto">
                    {whatsappMsg}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={openWhatsApp}
                      className="flex items-center gap-2 bg-[#25d366] hover:bg-[#20ba57] text-white font-bold px-4 py-2.5 rounded-xl text-xs transition shadow-md shadow-[#25d366]/20">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      Open WhatsApp
                    </button>
                    <button onClick={() => copyMessage(whatsappMsg)}
                      className="text-xs border border-white/[0.1] text-white/50 hover:text-white px-4 py-2.5 rounded-xl transition font-medium">
                      {copiedMsg ? "Copied ✓" : "Copy message"}
                    </button>
                  </div>
                </div>
              )}

              {shareTab === "email" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                      <div className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-1">Subject</div>
                      <div className="text-xs text-white/70">{emailSubject}</div>
                    </div>
                    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 max-h-52 overflow-y-auto">
                      <div className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-1">Body</div>
                      <div className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{emailBody}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={openEmail}
                      className="flex items-center gap-2 bg-amber-400/15 border border-amber-400/25 text-amber-300 hover:bg-amber-400/20 px-4 py-2.5 rounded-xl text-xs transition font-bold">
                      ✉️ Open in email client
                    </button>
                    <button onClick={() => copyMessage(`Subject: ${emailSubject}

${emailBody}`)}
                      className="text-xs border border-white/[0.1] text-white/50 hover:text-white px-4 py-2.5 rounded-xl transition font-medium">
                      {copiedMsg ? "Copied ✓" : "Copy email"}
                    </button>
                  </div>
                </div>
              )}

              {shareTab === "copy" && (
                <div className="space-y-3">
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-xs text-white/60 leading-relaxed">
                    {copyMsg}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => copyMessage(copyMsg)}
                      className="flex items-center gap-2 bg-white/[0.08] border border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.12] px-4 py-2.5 rounded-xl text-xs transition font-semibold">
                      {copiedMsg ? "✓ Copied!" : "📋 Copy message"}
                    </button>
                    <button onClick={() => copyMessage(reviewUrl)}
                      className="text-xs border border-white/[0.1] text-white/35 hover:text-white/70 px-4 py-2.5 rounded-xl transition font-medium">
                      Link only
                    </button>
                  </div>
                  <p className="text-[11px] text-white/25 leading-relaxed">
                    Paste this anywhere — iMessage, Telegram, Slack, or any other chat. The client doesn't need an account to view and review.
                  </p>
                </div>
              )}
            </div>

            {/* Expiry note */}
            <div className="px-5 pb-4">
              <p className="text-[11px] text-white/20">
                ⏱ Link expires in 7 days · No login required for the client · One approval decision per link
              </p>
            </div>
          </div>
        );
      })()}

      {/* ── Edit project details panel ── */}
      {editOpen && (
        <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
            <div className="text-sm font-bold text-white">Edit project details</div>
            <button onClick={() => setEditOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/[0.06] transition text-lg leading-none">×</button>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Project title *</label>
              <input type="text" value={editForm.title} placeholder="e.g. AI Trading Shorts — Week 4"
                onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Client name</label>
              <input type="text" value={editForm.client_name} placeholder="e.g. CryptoNova"
                onChange={e => setEditForm(f => ({ ...f, client_name: e.target.value }))}
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Platform</label>
              <select value={editForm.platform} onChange={e => setEditForm(f => ({ ...f, platform: e.target.value }))}
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 transition">
                <option value="">Select platform</option>
                {[
                  ["TikTok",          "TikTok (9:16 · 60s)"],
                  ["Instagram Reels", "Instagram Reels (9:16 · 30s)"],
                  ["YouTube Shorts",  "YouTube Shorts (9:16 · 60s)"],
                  ["YouTube",         "YouTube (16:9 · 3-10 min)"],
                  ["Facebook",        "Facebook (16:9 · 60s)"],
                  ["LinkedIn",        "LinkedIn (1:1 · 60s)"],
                  ["Twitter/X",       "Twitter/X (16:9 · 30s)"],
                  ["Snapchat",        "Snapchat (9:16 · 15s)"],
                  ["Pinterest",       "Pinterest (2:3 · 60s)"],
                ].map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Brand kit</label>
              <select value={editForm.brand_kit_id} onChange={e => setEditForm(f => ({ ...f, brand_kit_id: e.target.value }))}
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 transition">
                <option value="">— None —</option>
                {editKits.map(k => <option key={k.id} value={k.id}>{k.client_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-white/30 uppercase tracking-widest mb-1.5">Notes <span className="normal-case font-normal text-white/20">(brief for editors)</span></label>
              <textarea rows={3} value={editForm.notes} placeholder="Any context or instructions for the team..."
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition resize-none" />
            </div>
            {editError && <p className="text-rose-400 text-xs font-medium">{editError}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={saveProjectEdit} disabled={editSaving}
                className="flex-1 bg-amber-400 hover:bg-amber-300 text-black font-bold py-2.5 rounded-xl text-sm transition disabled:opacity-50">
                {editSaving ? "Saving…" : "Save changes"}
              </button>
              <button onClick={() => setEditOpen(false)}
                className="px-5 bg-white/[0.06] border border-white/[0.1] text-white/50 hover:text-white rounded-xl text-sm font-semibold transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assignment panel ── */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-bold text-white">Assigned team</div>
            <div className="text-xs text-white/30 mt-0.5">
              {project.assigned_to?.length
                ? `${project.assigned_to.length} member${project.assigned_to.length !== 1 ? "s" : ""} assigned`
                : "No one assigned yet"}
            </div>
          </div>
          {isAdmin && (
            <button onClick={() => setAssignOpen(o => !o)}
              className="text-xs border border-white/[0.1] text-white/50 hover:text-white hover:border-white/[0.2] px-3 py-1.5 rounded-lg transition font-medium">
              {assignOpen ? "Done" : "Manage"}
            </button>
          )}
        </div>

        {/* Assigned member chips */}
        <div className="flex flex-wrap gap-2">
          {members.filter(m => project.assigned_to?.includes(m.user_id)).map((m, i) => (
            <div key={m.user_id} className="flex items-center gap-2 bg-white/[0.06] border border-white/[0.1] rounded-full pl-1 pr-3 py-1">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {m.initials}
              </div>
              <span className="text-xs text-white/70 font-medium">{m.name || m.email}</span>
              <span className="text-[10px] text-white/30 capitalize">{m.role}</span>
              {isAdmin && (
                <button onClick={() => toggleAssign(m.user_id)}
                  className="text-white/25 hover:text-rose-400 transition ml-1 text-sm leading-none">×</button>
              )}
            </div>
          ))}
          {(!project.assigned_to?.length) && !assignOpen && (
            <div className="text-xs text-white/25 italic py-1">
              {isAdmin ? "Click Manage to assign team members" : "No editors assigned yet"}
            </div>
          )}
        </div>

        {/* Assign dropdown — owner/admin only */}
        {assignOpen && isAdmin && (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-2">Available members</div>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {members.map(m => {
                const assigned = project.assigned_to?.includes(m.user_id);
                return (
                  <button key={m.user_id}
                    onClick={() => toggleAssign(m.user_id)}
                    disabled={assigning}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition text-left ${
                      assigned
                        ? "bg-amber-400/10 border-amber-400/25"
                        : "bg-white/[0.03] border-white/[0.07] hover:border-white/[0.15]"
                    }`}>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {m.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${assigned ? "text-amber-300" : "text-white/70"}`}>
                        {m.name || m.email}
                      </div>
                      <div className="text-xs text-white/30 capitalize">{m.role}</div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                      assigned ? "bg-amber-400 border-amber-400" : "border-white/20"
                    }`}>
                      {assigned && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round"><path d="M2 5l2 2.5L8 2"/></svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Client decision banner (owner only) ── */}
      {isOwner && project.status === 'approved' && (
        <div className="bg-emerald-400/[0.07] border border-emerald-400/25 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-emerald-400/15 flex items-center justify-center text-xl flex-shrink-0">✅</div>
          <div className="flex-1">
            <div className="text-sm font-bold text-emerald-300">Client approved this video</div>
            <div className="text-xs text-white/40 mt-0.5">Client has approved. Click "Start render" to go directly to the export and download page.</div>
          </div>
          <button onClick={async () => {
              const store = useStore.getState();
              const jobIds: string[] = project.render_job_ids || [];

              if (jobIds.length > 0) {
                const lastJobId = jobIds[jobIds.length - 1];
                try {
                  const [statusRes, scenesRes] = await Promise.allSettled([
                    api.get(`/api/render/status/${lastJobId}`),
                    api.get(`/api/render/scenes/${lastJobId}`),
                  ]);

                  const videoUrl = statusRes.status === 'fulfilled'
                    ? statusRes.value.data?.result?.video_url || '' : '';

                  if (videoUrl) {
                    // Load scenes so Export page shows scene count + duration
                    if (scenesRes.status === 'fulfilled' && scenesRes.value.data?.scenes?.length) {
                      store.setScenes(scenesRes.value.data.scenes);
                    }

                    // Populate config from agency project so caption generator has context
                    store.setConfig({
                      niche:    project.notes || project.client_name || '',
                      platform: project.platform || '',
                      style:    '',
                      tone:     '',
                      audience: '',
                    });

                    // Set active project name for the title display
                    // Use a synthetic project entry if not in personal projects list
                    store.setAgencyProjectMeta({
                      title: project.title,
                      client_name: project.client_name,
                    });

                    store.startAgencyExport(id || '', lastJobId, videoUrl);
                    return;
                  }
                } catch {}
              }
              // No completed render found — start fresh from setup
              store.startAgencyVideo(id || '', 'setup');
            }}
            className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-4 py-2 rounded-xl text-xs transition">
            Start render
          </button>
        </div>
      )}

      {isOwner && project.status === 'client_review' && comments.filter(c => c.is_client && !c.resolved).length > 0 && (
        <div className="bg-amber-400/[0.06] border border-amber-400/20 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-amber-400/15 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-bold text-amber-300">Client has left feedback</span>
            </div>
            <span className="text-xs text-amber-400/60">
              {comments.filter(c => c.is_client && !c.resolved).length} unresolved
            </span>
          </div>
          <div className="divide-y divide-amber-400/10">
            {comments.filter(c => c.is_client && !c.resolved).map(c => (
              <div key={c.id} className="flex items-start gap-3 px-5 py-3">
                <div className="w-6 h-6 rounded-full bg-violet-400/20 text-violet-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {c.author_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-white/70">{c.author_name}</span>
                    {c.scene_index !== null && (
                      <span className="text-[10px] bg-amber-400/15 text-amber-300 px-1.5 py-0.5 rounded-full">
                        Scene {(c.scene_index ?? 0) + 1}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/55 leading-relaxed">{c.text}</p>
                </div>
                <button onClick={() => resolve(c.id)}
                  className="text-[10px] text-white/20 hover:text-emerald-400 transition flex-shrink-0 self-start mt-1 font-medium">
                  ✓ Done
                </button>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-amber-400/10">
            <p className="text-xs text-white/30">Address these notes, re-render, then send a new review link.</p>
          </div>
        </div>
      )}

      {/* Status pipeline */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
        <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-4">Workflow</div>
        <div className="flex items-center">
          {STATUSES.map((s, i) => {
            const done = i < si; const active = i === si;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1 gap-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full transition-all ${active ? "ring-4 ring-offset-1 ring-offset-[#0A0A0F] shadow-lg" : ""}`}
                    style={{
                      background: active ? s.dot : done ? "#2dd4bf" : "#374151",
                      boxShadow: active ? `0 0 0 3px ${s.dot}30, 0 0 10px ${s.dot}60` : undefined,
                    }} />
                  <div className={`text-[9.5px] text-center leading-tight font-medium ${active ? "text-white" : done ? "text-teal-400/70" : "text-white/20"}`}>
                    {s.label}
                  </div>
                </div>
                {i < STATUSES.length - 1 && (
                  <div className={`h-px flex-1 mx-1 mb-4 ${done ? "bg-teal-500/40" : "bg-white/[0.06]"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      {project.notes && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
          <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-2">Notes</div>
          <p className="text-sm text-white/60 leading-relaxed">{project.notes}</p>
        </div>
      )}

      {/* ── Scene review panel ── */}
      {sceneClips.length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-sm font-bold text-white">Scene review</span>
            <span className="text-xs text-white/30">{sceneClips.length} scene{sceneClips.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Scene grid */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {sceneClips.map(clip => {
              const sceneCmts  = comments.filter(c => c.scene_index === clip.index && !c.resolved);
              const hasUpdate  = sceneCmts.some(c => c.is_scene_update);
              const isActive = activeScene === clip.index;
              return (
                <div key={clip.index}
                  onClick={() => setActiveScene(isActive ? null : clip.index)}
                  className={`relative rounded-xl overflow-hidden cursor-pointer border transition-all ${
                    isActive
                      ? "border-amber-400/50 ring-1 ring-amber-400/30"
                      : "border-white/[0.08] hover:border-white/[0.2]"
                  }`}>
                  <video
                    key={clip.url}
                    src={clip.url}
                    className={`w-full bg-black object-cover ${(() => {
                      const p = (project.platform || '').toLowerCase();
                      return p.includes('tiktok') || p.includes('shorts') || p.includes('reels') || p.includes('snapchat') || p.includes('pinterest')
                        ? 'aspect-[9/16]' : p.includes('linkedin') ? 'aspect-square' : 'aspect-video';
                    })()}`}
                    muted
                    playsInline
                    preload="metadata"
                    onMouseOver={e => (e.target as HTMLVideoElement).play()}
                    onMouseOut={e => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white/90">{clip.label}</span>
                    {hasUpdate && !pendingEditScenes.has(clip.index) && (
                      <span className="text-[10px] bg-green-400/20 border border-green-400/30 text-green-300 px-1.5 py-0.5 rounded-full font-semibold">
                        ↻ Updated
                      </span>
                    )}
                    {pendingEditScenes.has(clip.index) && (
                      <span className="text-[10px] bg-orange-400/20 border border-orange-400/30 text-orange-300 px-1.5 py-0.5 rounded-full font-semibold">
                        ✎ Edited · needs re-render
                      </span>
                    )}
                    {!hasUpdate && !pendingEditScenes.has(clip.index) && sceneCmts.length > 0 && (
                      <span className="text-[10px] bg-amber-400/20 border border-amber-400/30 text-amber-300 px-1.5 py-0.5 rounded-full font-semibold">
                        {sceneCmts.length} note{sceneCmts.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {isActive && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round"><path d="M2 5h6M5 2l3 3-3 3"/></svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Active scene — full player + comment input */}
          {activeScene !== null && (
            <div className="border-t border-white/[0.06]">
              <div className="p-4">
                {/* Patched video success banner */}
                {patchedVideoUrl && (
                  <div className="mb-3 bg-violet-400/[0.07] border border-violet-400/20 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="w-7 h-7 rounded-full bg-violet-400/15 flex items-center justify-center flex-shrink-0 text-sm">✓</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-violet-300">Scene patched — new video ready</div>
                      <div className="text-[11px] text-white/35 mt-0.5">Only that scene was re-rendered. Full video updated.</div>
                    </div>
                    <a href={patchedVideoUrl} target="_blank" rel="noreferrer"
                      className="text-xs bg-violet-400/15 border border-violet-400/25 text-violet-300 hover:bg-violet-400/20 px-3 py-1.5 rounded-lg transition font-semibold flex-shrink-0">
                      Download
                    </a>
                    <button onClick={() => setPatchedVideoUrl("")}
                      className="text-white/25 hover:text-white/50 transition text-lg leading-none flex-shrink-0">×</button>
                  </div>
                )}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-xs font-semibold text-amber-300">Scene {activeScene + 1} selected</span>
                  <div className="ml-auto flex items-center gap-2">
                    {/* Edit and re-render scene buttons */}
                    {(() => {
                      const isAssigned = project.assigned_to?.includes(currentUser?.id || '');
                      if (canEditVideo) return (
                        <>
                          <button
                            onClick={() => editScene(activeScene)}
                            className="flex items-center gap-1.5 text-[11px] bg-amber-400/15 border border-amber-400/25 text-amber-300 hover:bg-amber-400/20 px-2.5 py-1 rounded-lg transition font-semibold">
                            ✎ Edit scene {activeScene + 1}
                          </button>
                          <button
                            onClick={() => rerenderScene(activeScene)}
                            disabled={rerenderingScene === activeScene}
                            className="flex items-center gap-1.5 text-[11px] bg-violet-400/15 border border-violet-400/25 text-violet-300 hover:bg-violet-400/20 px-2.5 py-1 rounded-lg transition font-semibold disabled:opacity-50">
                            {rerenderingScene === activeScene
                              ? <><div className="w-3 h-3 border border-violet-400/50 border-t-transparent rounded-full animate-spin"/>Re-rendering…</>
                              : <>↻ Re-render scene {activeScene + 1}</>
                            }
                          </button>
                        </>
                      );
                      return null;
                    })()}
                    <button onClick={() => setActiveScene(null)}
                      className="text-xs text-white/25 hover:text-white/60 transition">
                      Deselect
                    </button>
                  </div>
                </div>

                {/* Brand kit status banner */}
                {(project as any).brand_kit_error && (
                  <div className="bg-red-400/[0.08] border border-red-400/20 rounded-xl px-4 py-3 flex items-start gap-3 mb-3">
                    <span className="flex-shrink-0">⚠️</span>
                    <div>
                      <div className="text-xs font-bold text-red-300">Brand kit could not be fully applied</div>
                      <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed">
                        The intro, outro, or watermark failed during rendering. Check that your brand kit URLs are accessible and the video format is compatible.
                      </p>
                    </div>
                  </div>
                )}
                {(project as any).brand_kit_applied && !(project as any).brand_kit_error && (
                  <div className="bg-teal-400/[0.06] border border-teal-400/15 rounded-xl px-4 py-2.5 flex items-center gap-2 mb-3">
                    <span className="text-xs text-teal-300">✓</span>
                    <span className="text-[11px] text-teal-300/70">
                      Brand kit applied —{" "}
                      {[
                        (project as any).brand_kit_applied.intro     && "intro",
                        (project as any).brand_kit_applied.outro     && "outro",
                        (project as any).brand_kit_applied.watermark && "watermark",
                      ].filter(Boolean).join(", ") || "none"}
                    </span>
                  </div>
                )}

                {/* Full video player — aspect ratio from platform */}
                {(() => {
                  const platform = (project.platform || '').toLowerCase();
                  const isPortrait = platform.includes('tiktok') || platform.includes('shorts') ||
                    platform.includes('reels') || platform.includes('snapchat') || platform.includes('pinterest');
                  const isSquare = platform.includes('linkedin') || platform.includes('facebook');
                  const aspectClass = isPortrait ? 'aspect-[9/16]' : isSquare ? 'aspect-square' : 'aspect-video';
                  // Find clip by index (not array position — index may not equal position after filtering)
                  const activeClip = sceneClips.find(c => c.index === activeScene);
                  if (!activeClip?.url) return null;
                  return (
                    <video
                      key={activeClip.url}
                      src={activeClip.url}
                      controls
                      className={`w-full rounded-xl bg-black mb-4 ${aspectClass}`}
                      style={{ maxHeight: isPortrait ? 420 : 280, objectFit: 'contain' }}
                    />
                  );
                })()}

                {/* Existing scene comments */}
                {comments.filter(c => c.scene_index === activeScene).length > 0 && (
                  <div className="space-y-2 mb-4">
                    <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-2">
                      Notes on scene {activeScene + 1}
                    </div>
                    {comments.filter(c => c.scene_index === activeScene).map(c => (
                      <div key={c.id} className={`flex gap-2.5 group ${c.resolved ? "opacity-35" : ""} ${c.is_scene_update ? "bg-green-400/[0.04] border border-green-400/15 rounded-xl px-2.5 py-2 -mx-1" : ""}`}>
                        <div className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                          c.is_scene_update ? "bg-green-400/20 text-green-300"
                          : c.is_client ? "bg-violet-400/20 text-violet-300"
                          : "bg-white/[0.08] text-white/50"
                        }`}>
                          {c.author_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-white/70">{c.author_name}</span>
                            {c.is_scene_update && <span className="text-[10px] text-green-400 font-semibold">↻ Updated</span>}
                            {!c.is_scene_update && c.is_client && <span className="text-[10px] text-violet-400">Client</span>}
                            {c.resolved && <span className="text-[10px] text-white/20">Resolved</span>}
                            {c.edited && <span className="text-[10px] text-white/20 italic">edited</span>}
                          </div>
                          {editingId === c.id ? (
                            <div className="flex gap-1.5 mt-1">
                              <input autoFocus value={editText}
                                onChange={e => setEditText(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveEdit(c.id); if (e.key === "Escape") setEditingId(null); }}
                                className="flex-1 bg-white/[0.06] border border-amber-400/40 rounded-lg px-2.5 py-1 text-white text-xs outline-none" />
                              <button onClick={() => saveEdit(c.id)}
                                className="text-[10px] bg-amber-400 text-black font-bold px-2 py-1 rounded-lg">Save</button>
                              <button onClick={() => setEditingId(null)}
                                className="text-[10px] text-white/30 px-1.5">✕</button>
                            </div>
                          ) : (
                            <p className="text-xs text-white/50 mt-0.5 leading-relaxed">{c.text}</p>
                          )}
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition flex-shrink-0 self-start">
                          {!c.resolved && (
                            <button onClick={() => resolve(c.id)} title="Resolve"
                              className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-emerald-400 text-[10px]">✓</button>
                          )}
                          {c.author_id === currentUser?.id && !c.resolved && editingId !== c.id && (
                            <button onClick={() => startEdit(c)} title="Edit"
                              className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-amber-400 text-[10px]">✎</button>
                          )}
                          {(c.author_id === currentUser?.id || isOwner) && (
                            <button onClick={() => deleteComment(c.id)} title="Delete"
                              className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-rose-400 text-sm leading-none">×</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add scene comment with priority + deadline */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="text"
                      placeholder={`Add note on Scene ${activeScene + 1}…`}
                      value={sceneCommentText}
                      onChange={e => setSceneCommentText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && postSceneComment()}
                      className="flex-1 bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
                    <button onClick={postSceneComment} disabled={!sceneCommentText.trim()}
                      className="bg-amber-400 hover:bg-amber-300 text-black font-bold px-4 py-2 rounded-xl text-sm transition disabled:opacity-40">
                      Note
                    </button>
                  </div>
                  {/* Priority + deadline */}
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg overflow-hidden border border-white/[0.08] text-[11px]">
                      {([["urgent","🔴 Urgent"],["medium","🟡 Medium"],["low","🟢 Low"]] as [string,string][]).map(([p, label]) => (
                        <button key={p} onClick={() => setSceneCommentPriority(p)}
                          className={`px-2.5 py-1 font-semibold transition ${sceneCommentPriority === p ? "bg-white/15 text-white" : "text-white/30 hover:text-white/60"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="datetime-local"
                      value={sceneCommentDeadline}
                      onChange={e => setSceneCommentDeadline(e.target.value)}
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white/40 focus:outline-none focus:border-white/20 focus:text-white"
                      title="Set a deadline (optional)"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comments */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-sm font-bold text-white">All comments</span>
          <div className="flex items-center gap-3">
            {isOwner && comments.filter(c => c.is_client).length > 0 && (
              <span className="text-[10px] bg-violet-400/15 text-violet-300 border border-violet-400/20 px-2 py-0.5 rounded-full font-semibold">
                {comments.filter(c => c.is_client).length} from client
              </span>
            )}
            <span className="text-xs text-white/30">{comments.length} total</span>
          </div>
        </div>

        <div className="divide-y divide-white/[0.04] max-h-80 overflow-y-auto">
          {comments.length === 0 ? (
            <div className="py-10 text-center text-white/20 text-sm">No comments yet</div>
          ) : comments.map(c => (
            <div key={c.id} className={`flex gap-3 px-5 py-3.5 transition group ${
              c.resolved ? "opacity-35" : ""
            } ${c.is_client && !c.resolved && isOwner ? "bg-violet-400/[0.03] border-l-2 border-violet-400/25" : ""}`}>
              <div className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                c.is_client ? "bg-violet-400/20 text-violet-300" : "bg-white/[0.08] text-white/50"
              }`}>
                {c.author_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-bold text-white/80">{c.author_name}</span>
                  {c.is_client && <span className="text-[10px] text-violet-400 font-semibold">Client</span>}
                  {c.scene_index !== null && <span className="text-[10px] text-white/25">Scene {(c.scene_index ?? 0) + 1}</span>}
                  <span className="text-[10px] text-white/20">{timeAgo(c.created_at)}</span>
                  {c.edited && <span className="text-[10px] text-white/20 italic">edited</span>}
                </div>
                {editingId === c.id ? (
                  <div className="flex gap-2 mt-1">
                    <input autoFocus value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveEdit(c.id); if (e.key === "Escape") setEditingId(null); }}
                      className="flex-1 bg-white/[0.06] border border-amber-400/40 rounded-lg px-3 py-1.5 text-white text-sm outline-none" />
                    <button onClick={() => saveEdit(c.id)}
                      className="text-xs bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg hover:bg-amber-300 transition">Save</button>
                    <button onClick={() => setEditingId(null)}
                      className="text-xs text-white/30 hover:text-white px-2 transition">✕</button>
                  </div>
                ) : (
                  <p className="text-sm text-white/55 leading-relaxed">{c.text}</p>
                )}
              </div>
              {/* Actions — visible on hover */}
              <div className="flex items-start gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition mt-0.5">
                {!c.resolved && (
                  <button onClick={() => resolve(c.id)} title="Resolve"
                    className="w-6 h-6 flex items-center justify-center rounded text-white/25 hover:text-emerald-400 hover:bg-emerald-400/10 transition text-xs">✓</button>
                )}
                {c.author_id === currentUser?.id && !c.resolved && editingId !== c.id && (
                  <button onClick={() => startEdit(c)} title="Edit"
                    className="w-6 h-6 flex items-center justify-center rounded text-white/25 hover:text-amber-400 hover:bg-amber-400/10 transition text-xs">✎</button>
                )}
                {(c.author_id === currentUser?.id || isOwner) && (
                  <button onClick={() => deleteComment(c.id)} title="Delete"
                    className="w-6 h-6 flex items-center justify-center rounded text-white/20 hover:text-rose-400 hover:bg-rose-400/10 transition text-sm leading-none">×</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-white/[0.06] flex gap-3">
          <input type="text" placeholder="Add a comment…"
            value={commentText} onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && postComment()}
            className="flex-1 bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition" />
          <button onClick={postComment} disabled={!commentText.trim()}
            className="bg-amber-400 hover:bg-amber-300 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20 disabled:opacity-40">
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
