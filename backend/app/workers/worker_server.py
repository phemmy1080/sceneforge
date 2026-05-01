"""
Minimal HTTP server that runs alongside the ARQ worker.
Serves rendered files from the renders directory.
"""
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SceneForge Worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

renders_dir = os.environ.get("RENDERS_DIR", "./renders")
Path(renders_dir).mkdir(parents=True, exist_ok=True)
app.mount("/renders", StaticFiles(directory=renders_dir), name="renders")

@app.get("/health")
def health():
    return {"status": "ok", "service": "worker"}
