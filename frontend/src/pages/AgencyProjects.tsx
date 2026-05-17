import { useState, useEffect } from "react";
import { useStore } from '../store';
import { api } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Project {
  id: string;
  title: string;
  client_name: string;
  brand_kit_id: string;
  platform: string;
  status: string;
  assigned_to: string[];
  notes: string;
  render_job_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface Comment {
  id: string;
  author_name: string;
  scene_index: number | null;
  text: string;
  is_client: boolean;
  resolved: boolean;
  created_at: string;
}

interface BrandKit { id: string; client_name: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUSES = [
  { key: "draft",         label: "Draft",         color: "bg-zinc-800 text-zinc-400" },
  { key: "in_review",     label: "In review",     color: "bg-amber-900/40 text-amber-400" },
  { key: "client_review", label: "Client review", color: "bg-violet-900/40 text-violet-300" },
  { key: "approved",      label: "Approved",      color: "bg-green-900/40 text-green-400" },
  { key: "rendering",     label: "Rendering",     color: "bg-blue-900/40 text-blue-400" },
  { key: "exported",      label: "Exported",      color: "bg-teal-900/40 text-teal-400" },
];

function statusStyle(s: string) {
  return STATUSES.find(x => x.key === s)?.color || "bg-zinc-800 text-zinc-400";
}
function statusLabel(s: string) {
  return STATUSES.find(x => x.key === s)?.label || s;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Projects list
// ═══════════════════════════════════════════════════════════════════════════════
export function AgencyProjects() {
  const setStep = useStore((s) => s.setStep);
  const setAgencyProjectId = useStore((s: any) => s.setAgencyProjectId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get("/agency/projects");
      setProjects(res.data.projects);
    } finally {
      setLoading(false);
    }
  }

  const filtered = filter === "all" ? projects
    : projects.filter(p => p.status === filter);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Projects</h1>
        <button
          onClick={() => setStep('agency-new' as any)}
          className="flex items-center gap-2 bg-gold text-black font-semibold px-4 py-2 rounded-xl text-sm hover:bg-gold/90 transition"
        >
          + New project
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap mb-5">
        {[{ key: "all", label: "All" }, ...STATUSES].map(s => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition font-medium ${
              filter === s.key
                ? "bg-gold text-black border-gold"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-zinc-500 text-sm">
          No projects found.{" "}
          <button onClick={() => setStep('agency-new' as any)} className="text-gold hover:underline">
            Create your first project
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="divide-y divide-zinc-800">
            {filtered.map(p => (
              <div
                key={p.id}
                onClick={() => { setAgencyProjectId(p.id); setStep('agency-detail' as any); }}
                className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-800/40 cursor-pointer transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{p.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {p.client_name || "No client"} · {p.platform}
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${statusStyle(p.status)}`}>
                  {statusLabel(p.status)}
                </span>
                <span className="text-xs text-zinc-600 flex-shrink-0 hidden sm:block">
                  {timeAgo(p.updated_at)}
                </span>
                <span className="text-zinc-600 text-sm">›</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// New project form
// ═══════════════════════════════════════════════════════════════════════════════
export function NewProject() {
  const setStep = useStore((s) => s.setStep);
  const setAgencyProjectId = useStore((s: any) => s.setAgencyProjectId);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [form, setForm] = useState({
    title: "", client_name: "", brand_kit_id: "", platform: "TikTok", notes: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/agency/brand-kits").then(r => setKits(r.data.brand_kits)).catch(() => {});
  }, []);

  async function submit() {
    if (!form.title.trim()) { setError("Title is required"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/agency/projects", form);
setAgencyProjectId(res.data.project.id); setStep('agency-detail' as any);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Failed to create project");
      setLoading(false);
    }
  }

  const F = (k: string) => ({
    value: form[k as keyof typeof form],
    onChange: (e: any) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <button onClick={() => setStep('agency-projects' as any)} className="text-zinc-500 text-sm mb-6 hover:text-white transition">
        ← Back to projects
      </button>
      <h1 className="text-xl font-bold text-white mb-6">New project</h1>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <Field label="Project title *">
          <input type="text" placeholder="e.g. AI Trading Shorts — Week 3" {...F("title")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/50" />
        </Field>
        <Field label="Client / brand name">
          <input type="text" placeholder="e.g. CryptoNova" {...F("client_name")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/50" />
        </Field>
        <Field label="Brand kit">
          <select {...F("brand_kit_id")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/50">
            <option value="">— None selected —</option>
            {kits.map(k => <option key={k.id} value={k.id}>{k.client_name}</option>)}
          </select>
        </Field>
        <Field label="Platform">
          <select {...F("platform")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/50">
            {["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn", "Twitter/X"].map(p =>
              <option key={p} value={p}>{p}</option>
            )}
          </select>
        </Field>
        <Field label="Notes">
          <textarea rows={3} placeholder="Brief, tone, special instructions…" {...F("notes")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/50 resize-none" />
        </Field>
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-gold text-black font-bold py-3 rounded-xl text-sm hover:bg-gold/90 transition disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create project"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Project detail
// ═══════════════════════════════════════════════════════════════════════════════
export function ProjectDetail() {
  const setStep = useStore((s) => s.setStep);
  const id = useStore((s: any) => s.agencyProjectId);
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [actionLoading, setActionLoading] = useState("");

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      const res = await api.get(`/agency/projects/${id}`);
      setProject(res.data.project);
      setComments(res.data.comments);
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(newStatus: string) {
    if (!project) return;
    setActionLoading("status");
    setStatusDropdown(false);
    try {
      const res = await api.patch(`/agency/projects/${id}/status`, { status: newStatus });
      setProject(res.data.project);
    } finally {
      setActionLoading("");
    }
  }

  async function generateReviewLink() {
    setActionLoading("review");
    try {
      const res = await api.post(`/agency/projects/${id}/review-link`);
      setReviewUrl(res.data.review_url);
      setProject(p => p ? { ...p, status: "client_review" } : p);
    } finally {
      setActionLoading("");
    }
  }

  async function addComment() {
    if (!commentText.trim()) return;
    try {
      const res = await api.post(`/agency/projects/${id}/comments`, { text: commentText });
      setComments(c => [...c, res.data.comment]);
      setCommentText("");
    } catch {}
  }

  async function resolveComment(cid: string) {
    await api.patch(`/agency/projects/${id}/comments/${cid}/resolve`);
    setComments(cs => cs.map(c => c.id === cid ? { ...c, resolved: true } : c));
  }

  async function copyLink() {
    await navigator.clipboard.writeText(reviewUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!project) return <div className="text-zinc-400 p-8">Project not found</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={() => setStep('agency-projects' as any)} className="text-zinc-500 text-sm hover:text-white transition mb-2 block">
            ← Projects
          </button>
          <h1 className="text-xl font-bold text-white">{project.title}</h1>
          <p className="text-zinc-400 text-sm mt-1">{project.client_name || "No client"} · {project.platform}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status picker */}
          <div className="relative">
            <button
              onClick={() => setStatusDropdown(s => !s)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border border-transparent flex items-center gap-1.5 ${statusStyle(project.status)}`}
            >
              {statusLabel(project.status)} ▾
            </button>
            {statusDropdown && (
              <div className="absolute right-0 top-8 z-20 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl min-w-40">
                {STATUSES.map(s => (
                  <button
                    key={s.key}
                    onClick={() => changeStatus(s.key)}
                    className={`w-full text-left px-4 py-2.5 text-xs hover:bg-zinc-800 transition ${
                      s.key === project.status ? "text-white font-semibold" : "text-zinc-300"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Generate client review link */}
          <button
            onClick={generateReviewLink}
            disabled={actionLoading === "review"}
            className="flex items-center gap-2 text-xs border border-violet-600 text-violet-300 px-3 py-1.5 rounded-full hover:bg-violet-900/20 transition disabled:opacity-50"
          >
            {actionLoading === "review" ? "Generating…" : "🔗 Client review link"}
          </button>

          {/* Start render */}
          <button
            onClick={() => useStore.getState().setStep('setup' as any)}
            className="flex items-center gap-2 text-xs bg-gold text-black font-semibold px-3 py-1.5 rounded-full hover:bg-gold/90 transition"
          >
            ▶ Create video
          </button>
        </div>
      </div>

      {/* Review link card */}
      {reviewUrl && (
        <div className="bg-green-950/30 border border-green-800/40 rounded-2xl p-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-green-400 mb-1">Client review link ready</div>
            <div className="text-xs text-zinc-400 font-mono truncate">{reviewUrl}</div>
          </div>
          <button onClick={copyLink}
            className="text-xs bg-green-900/40 border border-green-700/40 text-green-300 px-3 py-1.5 rounded-xl hover:bg-green-900/60 transition flex-shrink-0">
            {copied ? "Copied ✓" : "Copy link"}
          </button>
        </div>
      )}

      {/* Notes */}
      {project.notes && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Notes</div>
          <p className="text-sm text-zinc-300">{project.notes}</p>
        </div>
      )}

      {/* Status pipeline */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">Workflow status</div>
        <div className="flex items-center gap-0">
          {STATUSES.map((s, i) => {
            const si = STATUSES.findIndex(x => x.key === project.status);
            const done = i < si;
            const active = i === si;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    active ? "bg-gold ring-2 ring-gold/30" :
                    done ? "bg-teal-500" : "bg-zinc-700"
                  }`} />
                  <div className={`text-xs mt-1.5 text-center leading-tight ${
                    active ? "text-gold font-semibold" :
                    done ? "text-teal-400" : "text-zinc-600"
                  }`}>{s.label}</div>
                </div>
                {i < STATUSES.length - 1 && (
                  <div className={`h-px flex-1 mx-1 ${done ? "bg-teal-700" : "bg-zinc-800"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Comments */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 font-semibold text-white text-sm">
          Comments ({comments.length})
        </div>
        <div className="divide-y divide-zinc-800 max-h-80 overflow-y-auto">
          {comments.length === 0 && (
            <div className="px-5 py-8 text-center text-zinc-600 text-sm">No comments yet</div>
          )}
          {comments.map(c => (
            <div key={c.id} className={`flex gap-3 px-5 py-3.5 ${c.resolved ? "opacity-40" : ""}`}>
              <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                c.is_client ? "bg-violet-900/50 text-violet-300" : "bg-zinc-800 text-zinc-300"
              }`}>
                {c.author_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-white">{c.author_name}</span>
                  {c.is_client && <span className="text-xs text-violet-400">Client</span>}
                  {c.scene_index !== null && (
                    <span className="text-xs text-zinc-500">Scene {(c.scene_index ?? 0) + 1}</span>
                  )}
                  <span className="text-xs text-zinc-600">{timeAgo(c.created_at)}</span>
                </div>
                <p className="text-sm text-zinc-300">{c.text}</p>
              </div>
              {!c.resolved && (
                <button onClick={() => resolveComment(c.id)}
                  className="text-xs text-zinc-500 hover:text-green-400 transition flex-shrink-0 self-start mt-1">
                  ✓ Resolve
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-zinc-800 flex gap-3">
          <input
            type="text"
            placeholder="Add a comment…"
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addComment()}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-gold/50"
          />
          <button
            onClick={addComment}
            disabled={!commentText.trim()}
            className="text-sm bg-gold text-black font-semibold px-4 py-2 rounded-xl hover:bg-gold/90 transition disabled:opacity-40"
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared field wrapper ───────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}
