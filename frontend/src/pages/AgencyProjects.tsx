import { useState, useEffect } from "react";
import { useStore } from '../store';
import { useAuthStore } from '../authStore';
import { api } from '../lib/api';

interface Project {
  id: string; title: string; client_name: string; brand_kit_id: string;
  platform: string; status: string; notes: string; render_job_ids: string[];
  assigned_to: string[]; created_at: string; updated_at: string;
}
interface Comment {
  id: string; author_name: string; author_id: string; scene_index: number | null;
  text: string; is_client: boolean; resolved: boolean; created_at: string;
  edited?: boolean; edited_at?: string;
}
interface SceneClip {
  index: number;
  url: string;
  label: string;
}
interface BrandKit { id: string; client_name: string; }

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
  const wsRole = currentUser?.workspace_role || 'editor';
  const canCreate = wsRole === 'owner' || wsRole === 'admin' || wsRole === 'editor'; // editors CAN create
  const canInvite = wsRole === 'owner' || wsRole === 'admin';
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => { api.get("/api/agency/projects").then(r => setProjects(r.data.projects)).finally(() => setLoading(false)); }, []);

  const filtered = filter === "all" ? projects : projects.filter(p => p.status === filter);

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
        {[{ key: "all", label: "All" }, ...STATUSES].map(s => (
          <button key={s.key} onClick={() => setFilter(s.key)}
            className={`text-xs px-3.5 py-1.5 rounded-full font-semibold border transition-all ${
              filter === s.key
                ? "bg-amber-400 text-black border-amber-400 shadow-md shadow-amber-400/20"
                : "border-white/[0.1] text-white/40 hover:border-white/[0.2] hover:text-white/60"
            }`}>
            {s.label}
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
                  className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] cursor-pointer transition group">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white/80 group-hover:text-amber-300 transition truncate">{p.title}</div>
                    <div className="text-xs text-white/30 mt-0.5">{p.client_name || "No client"} · {p.platform}</div>
                  </div>
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
            {["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn", "Twitter/X"].map(p =>
              <option key={p} value={p}>{p}</option>)}
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
  const currentUser = useAuthStore((s: any) => s.user);
  const wsRole = currentUser?.workspace_role || 'editor';
  const isOwner = wsRole === 'owner';
  const isAdmin = wsRole === 'owner' || wsRole === 'admin';
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [sceneClips, setSceneClips] = useState<SceneClip[]>([]);
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [sceneCommentText, setSceneCommentText] = useState("");

  useEffect(() => { if (id) load(); }, [id]);

  async function load() {
    try {
      const res = await api.get(`/api/agency/projects/${id}`);
      setProject(res.data.project);
      setComments(res.data.comments);

      // Load scene clips from the latest render job
      const jobIds: string[] = res.data.project.render_job_ids || [];
      if (jobIds.length > 0) {
        loadSceneClips(jobIds[jobIds.length - 1]);
      }
      // Note: if render_job_ids is empty, scene review is simply hidden
      // Don't try store jobId — it belongs to whatever project was last rendered
      // which could be a completely different project → causes "Job not found" errors
    } finally { setLoading(false); }
  }

  async function loadSceneClips(jobId: string) {
    if (!jobId) return;
    try {
      const res = await api.get(`/api/render/status/${jobId}`);
      // Job not found or still queued — don't show error, just no scenes
      if (!res.data.result) return;
      const data = res.data;
      const r2 = data.result?.r2_urls || {};
      const workerBase = (data.result?.video_url || '')
        .replace(/\/renders\/.*$/, ''); // e.g. https://worker.../renders/JOB/final.mp4 → base

      const clips: SceneClip[] = [];

      // Primary: R2 URLs — scene_01.mp4 … (1-based, zero-padded from FFmpeg)
      let i = 1;
      while (i <= 50) {
        const pad = String(i).padStart(2, '0');
        const key = `scene_${pad}.mp4`;
        if (r2[key]) {
          clips.push({ index: i - 1, url: r2[key], label: `Scene ${i}` });
          i++;
        } else { break; }
      }

      // Fallback A: unpadded scene_1.mp4 keys (older renders)
      if (clips.length === 0) {
        i = 1;
        while (r2[`scene_${i}.mp4`]) {
          clips.push({ index: i - 1, url: r2[`scene_${i}.mp4`], label: `Scene ${i}` });
          i++;
        }
      }

      // Fallback B: build URLs from worker base if R2 not enabled
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

      setSceneClips(clips);
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
      });
      setComments(c => [...c, res.data.comment]);
      setSceneCommentText("");
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

  if (!project) return <div className="text-white/40 text-sm p-8">Project not found</div>;

  const st = getStatus(project.status);
  const si = STATUSES.findIndex(s => s.key === project.status);

  return (
    <div className="max-w-3xl space-y-5 pb-8">

      {/* Back */}
      <button onClick={() => setStep('agency-projects' as any)}
        className="flex items-center gap-1.5 text-white/30 hover:text-white text-sm transition">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3L5 7l4 4"/></svg>
        Projects
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-white tracking-tight">{project.title}</h1>
          <p className="text-white/35 text-sm mt-1">{project.client_name || "No client"} · {project.platform}</p>
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

          {/* Start video */}
          <button onClick={() => useStore.getState().setStep('setup' as any)}
            className="flex items-center gap-1.5 text-xs bg-amber-400 hover:bg-amber-300 text-black font-bold px-3.5 py-1.5 rounded-full transition shadow-md shadow-amber-400/20">
            ▶ Create video
          </button>
        </div>
      </div>

      {/* Review link card */}
      {reviewUrl && (
        <div className="bg-emerald-400/[0.05] border border-emerald-400/20 rounded-2xl p-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-emerald-400 mb-1 uppercase tracking-wide">Client review link ready</div>
            <div className="text-xs text-white/40 font-mono truncate">{reviewUrl}</div>
          </div>
          <button onClick={copy}
            className="text-xs bg-emerald-400/15 border border-emerald-400/25 text-emerald-300 hover:bg-emerald-400/25 px-4 py-2 rounded-xl transition font-semibold flex-shrink-0">
            {copied ? "Copied ✓" : "Copy link"}
          </button>
        </div>
      )}

      {/* ── Client decision banner (owner only) ── */}
      {isOwner && project.status === 'approved' && (
        <div className="bg-emerald-400/[0.07] border border-emerald-400/25 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-emerald-400/15 flex items-center justify-center text-xl flex-shrink-0">✅</div>
          <div className="flex-1">
            <div className="text-sm font-bold text-emerald-300">Client approved this video</div>
            <div className="text-xs text-white/40 mt-0.5">Ready to render and export. Click "Create video" or start the render from here.</div>
          </div>
          <button onClick={() => useStore.getState().setStep('setup' as any)}
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
              const sceneCmts = comments.filter(c => c.scene_index === clip.index && !c.resolved);
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
                    src={clip.url}
                    className="w-full aspect-video bg-black object-cover"
                    muted
                    playsInline
                    preload="metadata"
                    onMouseOver={e => (e.target as HTMLVideoElement).play()}
                    onMouseOut={e => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white/90">{clip.label}</span>
                    {sceneCmts.length > 0 && (
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
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-xs font-semibold text-amber-300">Scene {activeScene + 1} selected</span>
                  <button onClick={() => setActiveScene(null)}
                    className="ml-auto text-xs text-white/25 hover:text-white/60 transition">
                    Deselect
                  </button>
                </div>

                {/* Full video player */}
                <video
                  key={sceneClips[activeScene]?.url}
                  src={sceneClips[activeScene]?.url}
                  controls
                  className="w-full rounded-xl bg-black mb-4"
                  style={{ maxHeight: 280 }}
                />

                {/* Existing scene comments */}
                {comments.filter(c => c.scene_index === activeScene).length > 0 && (
                  <div className="space-y-2 mb-4">
                    <div className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-2">
                      Notes on scene {activeScene + 1}
                    </div>
                    {comments.filter(c => c.scene_index === activeScene).map(c => (
                      <div key={c.id} className={`flex gap-2.5 group ${c.resolved ? "opacity-35" : ""}`}>
                        <div className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                          c.is_client ? "bg-violet-400/20 text-violet-300" : "bg-white/[0.08] text-white/50"
                        }`}>
                          {c.author_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-white/70">{c.author_name}</span>
                            {c.is_client && <span className="text-[10px] text-violet-400">Client</span>}
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

                {/* Add scene comment */}
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
