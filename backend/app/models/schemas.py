from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum


# ─── Enums ────────────────────────────────────────────────────────────────────

class SceneType(str, Enum):
    hook = "hook"
    intro = "intro"
    main = "main"
    cta = "cta"


class VisualSource(str, Enum):
    pexels_video = "pexels_video"
    pexels_photo = "pexels_photo"
    dalle = "dalle"
    custom = "custom"       # user-uploaded images per scene
    mixed = "mixed"         # auto-detect per scene


class ExportType(str, Enum):
    full = "full"
    scenes = "scenes"
    capcut = "capcut"


# ─── Generate: Ideas ──────────────────────────────────────────────────────────

class GenerateIdeasRequest(BaseModel):
    niche: str = Field(..., min_length=1, max_length=100)
    style: str = Field(..., min_length=1, max_length=100)
    platform: str = Field(default="TikTok (9:16, 60s)")
    tone: str = Field(default="Energetic & punchy")
    audience: str = Field(default="general audience")
    context: str = Field(default="")
    idea_tags: list[str] = Field(default_factory=list)  # user-supplied topic hints
    prompt: str = Field(default="", description="User-typed topic or direction for ideas")


class IdeaItem(BaseModel):
    title: str
    hook: str
    angle: str


class GenerateIdeasResponse(BaseModel):
    ideas: list[IdeaItem]


# ─── Generate: Script ─────────────────────────────────────────────────────────

class GenerateScriptRequest(BaseModel):
    idea: IdeaItem
    niche: str
    style: str
    platform: str
    tone: str
    audience: str


class GenerateScriptResponse(BaseModel):
    script: str
    word_count: int
    estimated_duration_seconds: int


# ─── Generate: Scenes ─────────────────────────────────────────────────────────

class GenerateScenesRequest(BaseModel):
    script: str
    platform: str


class Scene(BaseModel):
    id: int
    text: str = Field(..., min_length=1, max_length=1000,
                      description="Scene narration text — max 1000 chars")
    visual: str = Field(default="", max_length=500)
    duration: int = Field(default=5, ge=1, le=60)   # max 60s per scene
    type: SceneType = SceneType.main
    visual_keyword: str = Field(default="", max_length=200)
    emotion: Optional[str] = Field(default=None, max_length=100)
    b_roll_note: Optional[str] = Field(default=None, max_length=300)
    custom_image_url: Optional[str] = Field(default=None, max_length=1000,
                                           description="User-uploaded image URL for this scene")


class GenerateScenesResponse(BaseModel):
    scenes: list[Scene]
    total_duration: int


# ─── Render ───────────────────────────────────────────────────────────────────

class RenderRequest(BaseModel):
    scenes: list[Scene] = Field(..., min_length=1, max_length=20,
                                description="1–20 scenes per render")
    voice_name: str = Field(default="Marcus", max_length=50)
    voice_speed: float = Field(default=1.0, ge=0.5, le=2.0)
    visual_source: VisualSource = VisualSource.mixed
    subtitle_style: Literal["viral", "minimal", "karaoke", "none"] = "viral"
    music: Literal["none", "upbeat", "cinematic", "lofi", "inspiring"] = "none"
    project_title: str = Field(default="Untitled")
    platform: str = Field(default="TikTok (9:16, 60s)")
    uploaded_voice_path: Optional[str] = None  # path to user-uploaded voiceover file
    project_id: Optional[str] = None  # active project ID for linking
    motion: str = "auto"            # "auto" | "kenburns_in" | "kenburns_out" | "pan_left" | "pan_right" | "none"
    transition: str = "fade"        # "fade" | "blur" | "none"
    transition_duration: float = 0.4


class RenderJobResponse(BaseModel):
    job_id: str
    status: str = "queued"


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "complete", "failed"]
    progress: int = 0
    stage: str = ""
    result: Optional[dict] = None
    error: Optional[str] = None


# ─── Export ───────────────────────────────────────────────────────────────────

class ExportRequest(BaseModel):
    job_id: str
    export_type: ExportType


# ─── Search visuals ───────────────────────────────────────────────────────────

class SearchVisualsRequest(BaseModel):
    keyword: str
    scene_id: int
    source: VisualSource = VisualSource.pexels_video


class VisualResult(BaseModel):
    id: str
    thumbnail_url: str
    preview_url: str
    source: str
    width: int
    height: int


class SearchVisualsResponse(BaseModel):
    results: list[VisualResult]


# ─── Upload script ────────────────────────────────────────────────────────────

class UploadScriptResponse(BaseModel):
    script: str
    word_count: int
    estimated_duration_seconds: int
    voiceover_path: Optional[str] = None
    upload_id: Optional[str] = None


# ─── Extended idea request with user prompt ───────────────────────────────────
# (GenerateIdeasRequest already exists — we extend it by adding Optional[prompt])
