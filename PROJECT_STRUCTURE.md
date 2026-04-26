# SceneForge — Full Project Structure

```
sceneforge/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app entry point
│   │   ├── config.py                # Settings / env vars
│   │   ├── dependencies.py          # Shared FastAPI deps
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── generate.py          # /api/generate/* routes
│   │   │   ├── render.py            # /api/render/* routes
│   │   │   └── export.py            # /api/export/* routes
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── ai.py                # Anthropic SDK — ideas/script/scenes
│   │   │   ├── voice.py             # ElevenLabs TTS
│   │   │   ├── visuals.py           # Pexels + DALL-E
│   │   │   ├── ffmpeg.py            # fluent-ffmpeg wrapper (subprocess)
│   │   │   ├── storage.py           # S3 upload/download
│   │   │   └── capcut.py            # CapCut JSON builder
│   │   ├── workers/
│   │   │   ├── __init__.py
│   │   │   └── render_worker.py     # ARQ async job worker
│   │   └── models/
│   │       ├── __init__.py
│   │       └── schemas.py           # Pydantic models
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Root app + router
│   │   ├── main.tsx
│   │   ├── lib/
│   │   │   └── api.ts               # API client (fetch wrappers)
│   │   ├── hooks/
│   │   │   └── useJobPoller.ts      # Poll render job status
│   │   ├── components/
│   │   │   ├── Layout.tsx
│   │   │   ├── StepNav.tsx
│   │   │   └── SceneCard.tsx
│   │   └── pages/
│   │       ├── Setup.tsx
│   │       ├── Ideas.tsx
│   │       ├── Script.tsx
│   │       ├── SceneEditor.tsx
│   │       ├── VoiceVisuals.tsx
│   │       └── Export.tsx
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
└── docker-compose.yml
```

## Tech Stack

### Backend
- **FastAPI** — async Python web framework
- **ARQ** — async job queue (backed by Redis), replaces BullMQ
- **Anthropic Python SDK** — Claude AI calls
- **ElevenLabs Python SDK** — TTS voice synthesis
- **aiohttp** — async HTTP for Pexels / DALL-E
- **boto3** — AWS S3 uploads
- **ffmpeg-python** — FFmpeg subprocess wrapper
- **Pydantic v2** — request/response validation
- **Redis** — job queue + progress storage

### Frontend
- **React 18 + TypeScript** — UI framework
- **Vite** — build tool
- **Zustand** — global state (project/scenes)
- **TanStack Query** — data fetching + caching
- **Tailwind CSS** — utility styling
