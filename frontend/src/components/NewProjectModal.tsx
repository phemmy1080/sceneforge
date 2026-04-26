import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { getNiches, type Niche } from '../lib/api'

// Niches loaded from API
const PLATFORMS = ['TikTok (9:16, 60s)', 'YouTube Shorts (9:16, 60s)', 'Instagram Reels (9:16, 30s)', 'YouTube (16:9, 3–10 min)', 'LinkedIn (1:1, 60s)']

interface Props {
  open: boolean
  onClose: () => void
}

export default function NewProjectModal({ open, onClose }: Props) {
  const addProject = useStore((s) => s.addProject)
  const folders = useStore((s) => s.folders)
  const config = useStore((s) => s.config)
  const [niches, setNiches] = useState<Niche[]>([])
  useEffect(() => { getNiches().then(setNiches).catch(()=>{}) }, [])


  const [name, setName] = useState('')
  const [niche, setNiche] = useState(config.niche || '')
  const [folder, setFolder] = useState(config.niche || '')
  const [newFolderName, setNewFolderName] = useState('')
  const [platform, setPlatform] = useState('TikTok (9:16, 60s)')
  const [error, setError] = useState('')

  const existingFolders = Object.keys(folders).filter((f) => f !== '__all')

  useEffect(() => { setFolder(niche) }, [niche])

  function handleCreate() {
    if (!name.trim()) { setError('Please enter a project name.'); return }
    const resolvedFolder = folder === '__new' ? (newFolderName.trim() || 'New folder') : folder
    addProject({ name: name.trim(), niche, style: 'Educational', platform, folder: resolvedFolder })
    setName(''); setError(''); onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate()
    if (e.key === 'Escape') onClose()
  }

  if (!open) return null

  const previewFolder = folder === '__new' ? (newFolderName || 'New folder') : folder

  return (
    <div
      className="fixed inset-0 bg-black/65 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-[#13131D] border border-white/10 rounded-2xl p-6 w-full max-w-md"
        onKeyDown={handleKeyDown}
      >
        <h2 className="font-display font-bold text-[18px] tracking-tight mb-1">New project</h2>
        <p className="text-[12.5px] text-white/40 mb-5">Name your project and pick a niche — SceneForge auto-saves as you work.</p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/25 rounded-lg p-3 text-[12.5px] text-red-300 mb-4">{error}</div>
        )}

        <div className="mb-4">
          <label className="block text-[11px] font-medium text-white/45 mb-1.5">Project name</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder="e.g. 5 productivity hacks for busy people"
            className="w-full bg-white/5 border border-white/12 rounded-lg text-[13px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60 placeholder-white/20"
          />
        </div>

        <div className="mb-4">
          <label className="block text-[11px] font-medium text-white/45 mb-1.5">Niche</label>
          <div className="flex flex-wrap gap-2">
            {niches.map((n) => (
              <button
                key={n.key}
                onClick={() => { setNiche(n.key); setFolder(n.key) }}
                className={`px-3 py-1 rounded-full text-[11.5px] font-medium border transition-all ${
                  niche === n.key
                    ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                    : 'bg-white/4 border-white/10 text-white/45 hover:border-white/25 hover:text-white/75'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[11px] font-medium text-white/45 mb-1.5">Save to folder</label>
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full bg-white/5 border border-white/12 rounded-lg text-[13px] text-white/85 px-3 py-2.5 outline-none focus:border-violet-500/60 cursor-pointer"
            >
              {existingFolders.length === 0 && folder !== '__new' && (
                <option value={niche || 'General'}>{niche || 'General'}</option>
              )}
              {existingFolders.map((f) => <option key={f} value={f}>{f}</option>)}
              <option value="__new">+ Create new folder…</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-white/45 mb-1.5">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full bg-white/5 border border-white/12 rounded-lg text-[13px] text-white/85 px-3 py-2.5 outline-none focus:border-violet-500/60 cursor-pointer"
            >
              {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {folder === '__new' && (
          <div className="mb-4">
            <label className="block text-[11px] font-medium text-white/45 mb-1.5">New folder name</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Travel series"
              className="w-full bg-white/5 border border-white/12 rounded-lg text-[13px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60 placeholder-white/20"
            />
          </div>
        )}

        {/* Preview */}
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg px-3.5 py-2.5 mb-5">
          <p className="text-[9.5px] text-white/30 uppercase tracking-widest font-semibold mb-1">Preview</p>
          <p className="text-[12.5px] text-white/55">
            {niche} project · {platform.split(' ')[0]} · saved to /{previewFolder}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-white/5 border border-white/12 rounded-lg text-[13px] text-white/55 cursor-pointer hover:bg-white/8 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="flex-[2] py-2.5 bg-violet-600 rounded-lg text-[13px] font-semibold text-white cursor-pointer hover:bg-violet-500 transition-colors"
          >
            Create project →
          </button>
        </div>
      </div>
    </div>
  )
}
