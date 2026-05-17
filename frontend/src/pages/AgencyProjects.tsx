import { useState, useEffect } from "react";
import axios from "axios";

const BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || "https://sceneforge-production-8d19.up.railway.app";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ReviewData {
  review: {
    token: string;
    status: string;
    expires_at: string;
  };
  project: {
    id: string;
    title: string;
    client_name: string;
    platform: string;
    render_job_ids: string[];
    video_url?: string;
  };
  comments: Comment[];
}

interface Comment {
  id: string;
  author_name: string;
  scene_index: number | null;
  text: string;
  created_at: string;
}
interface SceneClip { index: number; url: string; }

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
export default function ClientReview({ token }: { token: string }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [authorName, setAuthorName] = useState(() => localStorage.getItem("review_name") || "");
  const [sceneIndex, setSceneIndex] = useState<number | null>(null);
  const [sceneClips, setSceneClips] = useState<SceneClip[]>([]);
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decision, setDecision] = useState<"approved" | "changes_requested" | "">("");
  const [decisionMsg, setDecisionMsg] = useState("");
  const [decided, setDecided] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string>("");

  useEffect(() => { load(); }, [token]);

  async function load() {
    try {
      const res = await axios.get(`${BASE}/api/agency/review/${token}`);
      setData(res.data);
      setComments(res.data.comments || []);

      // Backend now returns video_url directly — no separate job status call needed
      const directUrl = res.data.project?.video_url || '';
      if (directUrl) {
        setVideoUrl(directUrl);
      } else {
        // Fallback: try job status API for older projects
        const jobIds: string[] = res.data.project.render_job_ids || [];
        for (let i = jobIds.length - 1; i >= 0; i--) {
          try {
            const jobRes = await axios.get(`${BASE}/api/render/status/${jobIds[i]}`);
            const d = jobRes.data;
            const url = d.result?.video_url
                     || d.result?.r2_urls?.['final_video_music.mp4']
                     || d.result?.r2_urls?.['final_video.mp4']
                     || '';
            if (url) { setVideoUrl(url); break; }
          } catch {}
        }
      }

      if (res.data.review.status !== "pending") {
        setDecided(true);
        setDecision(res.data.review.status as any);
      }

      // Load individual scene clips
      const jobIds: string[] = res.data.project.render_job_ids || [];
      if (jobIds.length > 0) {
        try {
          const jobRes = await axios.get(`${BASE}/api/render/status/${jobIds[jobIds.length - 1]}`);
          const r2 = jobRes.data.result?.r2_urls || {};
          const clips: SceneClip[] = [];
          let i = 0;
          while (r2[`scene_${i}.mp4`]) {
            clips.push({ index: i, url: r2[`scene_${i}.mp4`] });
            i++;
          }
          if (clips.length === 0) {
            i = 0;
            while (r2[`scene_${i}_with_subs.mp4`]) {
              clips.push({ index: i, url: r2[`scene_${i}_with_subs.mp4`] });
              i++;
            }
          }
          setSceneClips(clips);
        } catch {}
      }
    } catch (e: any) {
      setError(
        e.response?.status === 404
          ? "This review link has expired or doesn't exist."
          : "Failed to load review."
      );
    } finally {
      setLoading(false);
    }
  }

  async function postComment() {
    if (!commentText.trim()) return;
    if (!authorName.trim()) { alert("Please enter your name first"); return; }
    localStorage.setItem("review_name", authorName);
    setSubmitting(true);
    try {
      const res = await axios.post(`${BASE}/api/agency/review/${token}/comment`, {
        text: commentText,
        author_name: authorName,
        scene_index: sceneIndex,
      });
      setComments(c => [...c, res.data.comment]);
      setCommentText("");
      setSceneIndex(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDecision(d: "approved" | "changes_requested") {
    if (!authorName.trim()) { alert("Please enter your name first"); return; }
    if (!confirm(d === "approved"
      ? "Approve this video? The agency will be notified."
      : "Request changes? The agency will be notified to revise.")) return;

    setSubmitting(true);
    try {
      await axios.post(`${BASE}/api/agency/review/${token}/decide`, {
        decision: d,
        message: decisionMsg,
      });
      setDecision(d);
      setDecided(true);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to submit decision");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-[#07070e] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#07070e] flex items-center justify-center px-4">
      <div className="text-center space-y-3">
        <div className="text-5xl">🔗</div>
        <div className="text-white font-semibold text-lg">{error}</div>
        <p className="text-zinc-500 text-sm">Contact the agency for a new link.</p>
      </div>
    </div>
  );

  if (!data) return null;

  const { project, review } = data;

  // ── Decided state ──────────────────────────────────────────────────────────
  if (decided) return (
    <div className="min-h-screen bg-[#07070e] flex items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="text-6xl">{decision === "approved" ? "✅" : "📝"}</div>
        <h1 className="text-white text-xl font-bold">
          {decision === "approved" ? "Video approved!" : "Changes requested"}
        </h1>
        <p className="text-zinc-400 text-sm">
          {decision === "approved"
            ? "The agency has been notified and will export your video shortly."
            : "The agency has been notified and will make the revisions."}
        </p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-left">
          <div className="text-xs text-zinc-500 mb-1">Project</div>
          <div className="text-white font-medium text-sm">{project.title}</div>
          <div className="text-zinc-500 text-xs">{project.client_name}</div>
        </div>
      </div>
    </div>
  );

  // ── Main review UI ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#07070e] text-white">

      {/* Header */}
      <div className="border-b border-white/5 px-5 py-4 flex items-center justify-between max-w-3xl mx-auto">
        <div>
          <div className="text-xs text-zinc-500 font-mono mb-0.5">scenraforge.com</div>
          <div className="text-sm font-semibold">{project.title}</div>
          <div className="text-xs text-zinc-500">{project.client_name} · {project.platform}</div>
        </div>
        <div className="text-xs text-zinc-600">
          Expires {new Date(review.expires_at).toLocaleDateString()}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">

        {/* ── Full video ── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          {videoUrl ? (
            <video src={videoUrl} controls className="w-full aspect-video bg-black" />
          ) : (
            <div className="aspect-video bg-zinc-950 flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="white" opacity="0.4"><path d="M6 4l12 6-12 6V4z"/></svg>
              </div>
              <div className="text-zinc-500 text-sm">
                {project.render_job_ids.length === 0 ? "Video is being prepared — check back soon" : "Loading video…"}
              </div>
            </div>
          )}
        </div>

        {/* ── Scene-by-scene review ── */}
        {sceneClips.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Review scene by scene</div>
                <div className="text-xs text-zinc-500 mt-0.5">Click a scene to watch it and leave a note</div>
              </div>
              <span className="text-xs text-zinc-600">{sceneClips.length} scenes</span>
            </div>

            {/* Scene grid */}
            <div className="p-4 grid grid-cols-2 gap-3">
              {sceneClips.map(clip => {
                const hasNotes = comments.some(c => c.scene_index === clip.index);
                const isActive = activeScene === clip.index;
                return (
                  <div key={clip.index}
                    onClick={() => { setActiveScene(isActive ? null : clip.index); setSceneIndex(isActive ? null : clip.index); }}
                    className={`relative rounded-xl overflow-hidden cursor-pointer border transition-all ${
                      isActive ? "border-[#c9a84c]/60 ring-1 ring-[#c9a84c]/30" : "border-zinc-800 hover:border-zinc-600"
                    }`}>
                    <video
                      src={clip.url}
                      className="w-full aspect-video bg-black object-cover"
                      muted playsInline preload="metadata"
                      onMouseOver={e => (e.target as HTMLVideoElement).play()}
                      onMouseOut={e => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-white/90">Scene {clip.index + 1}</span>
                      {hasNotes && (
                        <span className="text-[10px] bg-[#c9a84c]/20 border border-[#c9a84c]/30 text-[#c9a84c] px-1.5 py-0.5 rounded-full">noted</span>
                      )}
                    </div>
                    {isActive && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#c9a84c] flex items-center justify-center">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round"><path d="M2 5l2.5 2.5L8 2"/></svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Active scene player + note input */}
            {activeScene !== null && (
              <div className="border-t border-zinc-800 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#c9a84c]" />
                  <span className="text-xs font-semibold text-[#c9a84c]">Scene {activeScene + 1}</span>
                  <button onClick={() => { setActiveScene(null); setSceneIndex(null); }}
                    className="ml-auto text-xs text-zinc-600 hover:text-zinc-400 transition">Deselect</button>
                </div>

                {/* Full scene player */}
                <video
                  key={sceneClips[activeScene]?.url}
                  src={sceneClips[activeScene]?.url}
                  controls
                  className="w-full rounded-xl bg-black"
                  style={{ maxHeight: 260 }}
                />

                {/* Existing notes on this scene */}
                {comments.filter(c => c.scene_index === activeScene).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10.5px] font-bold text-zinc-600 uppercase tracking-wider">Notes on scene {activeScene + 1}</div>
                    {comments.filter(c => c.scene_index === activeScene).map(c => (
                      <div key={c.id} className="flex gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {c.author_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold text-zinc-300">{c.author_name}</div>
                          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{c.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add note input — pre-pinned to this scene */}
                <div className="flex gap-2">
                  <input type="text"
                    placeholder={`Note on Scene ${activeScene + 1}…`}
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && postComment()}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#c9a84c]/50 placeholder:text-zinc-600 transition" />
                  <button onClick={postComment} disabled={!commentText.trim()}
                    className="bg-[#c9a84c] hover:bg-[#d4b45c] text-black font-bold px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-40">
                    Note
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Your name */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <label className="block text-xs text-zinc-400 mb-2 font-semibold uppercase tracking-wide">Your name</label>
          <input
            type="text"
            placeholder="e.g. Sarah — CryptoNova"
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-gold/40"
          />
        </div>

        {/* Approval section */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="font-semibold text-sm">Your decision</div>
          <textarea
            rows={3}
            placeholder="Optional message (e.g. 'Looks great!' or 'Please shorten the hook in scene 1')"
            value={decisionMsg}
            onChange={e => setDecisionMsg(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-gold/40 resize-none"
          />
          <div className="flex gap-3">
            <button
              onClick={() => submitDecision("approved")}
              disabled={submitting}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl text-sm transition disabled:opacity-50"
            >
              ✓ Approve video
            </button>
            <button
              onClick={() => submitDecision("changes_requested")}
              disabled={submitting}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-3 rounded-xl text-sm border border-zinc-700 transition disabled:opacity-50"
            >
              ✎ Request changes
            </button>
          </div>
        </div>

        {/* Comments */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 font-semibold text-sm">
            Comments ({comments.length})
          </div>

          {comments.length === 0 && (
            <div className="px-5 py-8 text-center text-zinc-600 text-sm">No comments yet</div>
          )}

          <div className="divide-y divide-zinc-800 max-h-72 overflow-y-auto">
            {comments.map(c => (
              <div key={c.id} className="flex gap-3 px-5 py-3.5">
                <div className="w-8 h-8 rounded-full bg-violet-900/40 text-violet-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {c.author_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold">{c.author_name}</span>
                    {c.scene_index !== null && (
                      <span className="text-xs text-zinc-500">· Scene {(c.scene_index ?? 0) + 1}</span>
                    )}
                    <span className="text-xs text-zinc-600">{timeAgo(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-zinc-300">{c.text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Overall comment — not tied to a scene */}
          <div className="px-5 py-4 border-t border-zinc-800">
            <div className="text-[10.5px] font-bold text-zinc-600 uppercase tracking-wider mb-2">Overall feedback</div>
            <div className="flex gap-2">
              <input type="text"
                placeholder="General comment on the whole video…"
                value={commentText}
                onChange={e => { setSceneIndex(null); setCommentText(e.target.value); }}
                onKeyDown={e => e.key === "Enter" && postComment()}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#c9a84c]/40 placeholder:text-zinc-600 transition" />
              <button onClick={postComment} disabled={submitting || !commentText.trim()}
                className="bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-40">
                Post
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-zinc-600 text-xs">
          Powered by SceneForge · scenraforge.com
        </p>
      </div>
    </div>
  );
}
