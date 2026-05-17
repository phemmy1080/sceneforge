import { useState, useEffect } from "react";
import { useStore } from '../store';
import { api } from '../lib/api';

interface Project {
  id: string; title: string; client_name: string; brand_kit_id: string;
  platform: string; status: string; notes: string; render_job_ids: string[];
  assigned_to: string[]; created_at: string; updated_at: string;
}
interface Comment {
  id: string; author_name: string; scene_index: number | null;
  text: string; is_client: boolean; resolved: boolean; created_at: string;
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
        <button onClick={() => setStep('agency-new' as any)}
          className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 active:scale-95 text-black font-bold px-4 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-amber-400/20">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
          New project
        </button>
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
          <button onClick={() => setStep('agency-new' as any)}
            className="text-sm bg-amber-400/10 border border-amber-400/25 text-amber-300 px-5 py-2 rounded-xl hover:bg-amber-400/15 transition font-medium">
            Create your first project →
          </button>
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
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => { if (id) load(); }, [id]);

  async function load() {
    try {
      const res = await api.get(`/api/agency/projects/${id}`);
      setProject(res.data.project);
      setComments(res.data.comments);
    } finally { setLoading(false); }
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

          {/* Status picker */}
          <div className="relative">
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
          </div>

          {/* Review link */}
          <button onClick={genReviewLink} disabled={busy === "review"}
            className="flex items-center gap-1.5 text-xs border border-violet-400/30 text-violet-300 px-3 py-1.5 rounded-full hover:bg-violet-400/10 transition font-semibold disabled:opacity-50">
            🔗 {busy === "review" ? "Generating…" : "Client review link"}
          </button>

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
                      boxShadow: active ? `0 0 10px ${s.dot}80` : undefined,
                      ringColor: active ? s.dot + "40" : undefined,
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

      {/* Comments */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-sm font-bold text-white">Comments</span>
          <span className="text-xs text-white/30">{comments.length} total</span>
        </div>

        <div className="divide-y divide-white/[0.04] max-h-80 overflow-y-auto">
          {comments.length === 0 ? (
            <div className="py-10 text-center text-white/20 text-sm">No comments yet</div>
          ) : comments.map(c => (
            <div key={c.id} className={`flex gap-3 px-5 py-3.5 ${c.resolved ? "opacity-35" : ""}`}>
              <div className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${c.is_client ? "bg-violet-400/20 text-violet-300" : "bg-white/[0.08] text-white/50"}`}>
                {c.author_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-bold text-white/80">{c.author_name}</span>
                  {c.is_client && <span className="text-[10px] text-violet-400 font-semibold">Client</span>}
                  {c.scene_index !== null && <span className="text-[10px] text-white/25">Scene {(c.scene_index ?? 0) + 1}</span>}
                  <span className="text-[10px] text-white/20">{timeAgo(c.created_at)}</span>
                </div>
                <p className="text-sm text-white/55 leading-relaxed">{c.text}</p>
              </div>
              {!c.resolved && (
                <button onClick={() => resolve(c.id)}
                  className="text-[10px] text-white/20 hover:text-emerald-400 transition self-start mt-1 flex-shrink-0 font-medium">
                  ✓ Resolve
                </button>
              )}
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
