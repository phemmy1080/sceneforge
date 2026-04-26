# SceneForge — AI Video Content Studio

A full-stack web app that turns a niche + style into a rendered short-form video:
ideas → script → scene breakdown → voice synthesis → visuals → FFmpeg render → export.

---

## Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Web framework | **FastAPI** (Python 3.12) |
| Background jobs | **ARQ** (async Redis queue) |
| AI generation | **Anthropic SDK** — `claude-sonnet-4` |
| Voice synthesis | **ElevenLabs Python SDK** |
| Stock visuals | **Pexels API** (aiohttp) |
| AI images | **OpenAI DALL-E 3** (fallback) |
| Video rendering | **FFmpeg** via subprocess |
| File storage | **AWS S3** (optional; local fallback) |
| Cache / queue | **Redis 7** |
| Validation | **Pydantic v2** |

### Frontend
| Layer | Technology |
|---|---|
| UI framework | **React 18 + TypeScript** |
| Build tool | **Vite 5** |
| Styling | **Tailwind CSS 3** |
| Global state | **Zustand 4** |
| Data fetching | **TanStack Query 5** |
| HTTP client | **Axios** |
| Fonts | Syne (display) + DM Sans (body) |

---

## Project Structure

```
sceneforge/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI entry point
│   │   ├── config.py             # Pydantic Settings (env vars)
│   │   ├── dependencies.py       # Shared FastAPI deps (Redis)
│   │   ├── api/
│   │   │   ├── generate.py       # POST /api/generate/{ideas,script,scenes}
│   │   │   ├── render.py         # POST /api/render/start, GET /status/{id}
│   │   │   └── export.py         # GET /api/export/{full,scenes,capcut}
│   │   ├── services/
│   │   │   ├── ai.py             # Anthropic: ideas / script / scene breakdown
│   │   │   ├── voice.py          # ElevenLabs TTS per scene
│   │   │   ├── visuals.py        # Pexels search + download, DALL-E fallback
│   │   │   ├── ffmpeg.py         # Render scene + concat + music mix
│   │   │   ├── storage.py        # S3 upload / presigned URLs
│   │   │   └── capcut.py         # CapCut draft_content.json builder
│   │   ├── workers/
│   │   │   └── render_worker.py  # ARQ job: full render pipeline
│   │   └── models/
│   │       └── schemas.py        # All Pydantic request/response models
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Root — QueryClient + page routing
│   │   ├── main.tsx              # ReactDOM entry
│   │   ├── store.ts              # Zustand global state
│   │   ├── index.css             # Tailwind + font imports
│   │   ├── lib/
│   │   │   └── api.ts            # Typed API wrappers + SSE stream client
│   │   ├── hooks/
│   │   │   └── useJobPoller.ts   # Polls render job status every 1.5s
│   │   ├── components/
│   │   │   ├── Layout.tsx        # Sidebar nav + main shell
│   │   │   ├── StepNav.tsx       # Horizontal step progress bar
│   │   │   ├── SceneCard.tsx     # Reusable scene list item
│   │   │   └── ui.tsx            # Button, Card, Chip, Badge, ProgressBar…
│   │   └── pages/
│   │       ├── Setup.tsx         # Niche / style / platform config
│   │       ├── Ideas.tsx         # AI idea grid, select + continue
│   │       ├── Script.tsx        # Streaming script display + scene trigger
│   │       ├── SceneEditor.tsx   # Scene list + edit panel + visual search
│   │       ├── VoiceVisuals.tsx  # Voice / subtitles / music config + render
│   │       └── Export.tsx        # Render progress + MP4/ZIP/CapCut downloads
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── Dockerfile
│
└── docker-compose.yml
```

---

## Quick Start

### 1. Clone and configure

```bash
git clone <your-repo>
cd sceneforge
cp backend/.env.example backend/.env
# Fill in your API keys in backend/.env
```

### 2. Required API keys

```env
ANTHROPIC_API_KEY=sk-ant-...        # https://console.anthropic.com
ELEVENLABS_API_KEY=...              # https://elevenlabs.io
PEXELS_API_KEY=...                  # https://www.pexels.com/api (free)
OPENAI_API_KEY=sk-...               # https://platform.openai.com (DALL-E fallback)
```

S3 is optional — if `S3_BUCKET` is empty, rendered videos are served as local static files.

### 3. Run with Docker Compose (recommended)

```bash
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

### 4. Run locally (without Docker)

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Terminal 1 — API server
uvicorn app.main:app --reload --port 8000

# Terminal 2 — ARQ render worker
python -m arq app.workers.render_worker.WorkerSettings
```

**Redis** (required for the job queue):
```bash
docker run -p 6379:6379 redis:7-alpine
# or: brew install redis && redis-server
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

---

## API Reference

### Generate
| Method | Path | Description |
|---|---|---|
| POST | `/api/generate/ideas` | Generate 6 content ideas |
| POST | `/api/generate/script` | Write full voiceover script |
| POST | `/api/generate/script/stream` | Stream script via SSE |
| POST | `/api/generate/scenes` | Break script into scenes |
| POST | `/api/generate/visuals/search` | Search Pexels for a keyword |

### Render
| Method | Path | Description |
|---|---|---|
| POST | `/api/render/start` | Enqueue a render job → returns `job_id` |
| GET | `/api/render/status/{job_id}` | Poll progress (0–100) + stage label |

### Export
| Method | Path | Description |
|---|---|---|
| GET | `/api/export/full/{job_id}` | Download final MP4 |
| GET | `/api/export/scenes/{job_id}` | Download scene bundle ZIP |
| GET | `/api/export/capcut/{job_id}` | Download CapCut package ZIP |
| GET | `/api/export/manifest/{job_id}` | Get scene manifest JSON |

---

## How Rendering Works

```
POST /api/render/start
  └─ Enqueues ARQ job with scenes + voice/visual config
       └─ Worker: synthesize_all_scenes()   → ElevenLabs TTS per scene
       └─ Worker: get_visuals_for_all_scenes() → Pexels / DALL-E per scene
       └─ Worker: render_full_pipeline()    → FFmpeg scene render + concat
       └─ Worker: write_manifest()          → manifest.json
       └─ Worker: build_capcut_draft()      → draft_content.json
       └─ Worker: upload_to_s3()            → (optional)
  └─ Progress stored in Redis as job:{id}:progress
       └─ GET /api/render/status/{id} reads it
            └─ Frontend polls every 1.5s via useJobPoller hook
```

---

## CapCut Export Format

The CapCut package ZIP contains:
- `scene_01.mp4` … `scene_N.mp4` — individual rendered clips
- `draft_content.json` — CapCut project schema with:
  - Track segments with microsecond-precision timing
  - Material references pointing to local scene files
  - Canvas config: 1080×1920, 9:16, 30fps
  - Video + audio track layout

Import: In CapCut, use **File → Import Project** and select the unzipped folder.

---

## Extending

**Add a new voice provider** → implement the same interface in `services/voice.py`

**Add Runway AI video** → add a `runway` branch in `services/visuals.get_visual_for_scene()`

**Add watermark** → extend `services/ffmpeg.render_scene()` with an `overlay` filter

**Persistent projects** → add a `projects` table (PostgreSQL + SQLAlchemy async) and save
`scenes`, `config`, and `job_id` per user session
