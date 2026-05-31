from __future__ import annotations

import os
from typing import Optional
import asyncio
import logging
from pathlib import Path
from dataclasses import dataclass

import aiohttp
import aiofiles
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.schemas import Scene, VisualSource, VisualResult

settings = get_settings()
logger = logging.getLogger(__name__)
_openai_client = None

def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY not set — DALL-E unavailable. Use 'pexels_video' as your visual source.")
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client

PEXELS_BASE = "https://api.pexels.com"


@dataclass
class VisualFile:
    path: str
    media_type: str   # "video" or "image"
    source: str       # "pexels" or "dalle"


# ─── Pexels ───────────────────────────────────────────────────────────────────

# ── African/Nigerian context injection for DALL-E ─────────────────────────────
# When a niche has strong African relevance, inject context into DALL-E prompts
# so generated images look relevant to Nigerian creators and their audiences.
AFRICAN_CONTEXT = {
    "Finance":     "Nigerian financial context, modern Lagos office, African professional",
    "Business":    "Nigerian entrepreneur, Lagos business district, West African professional",
    "Real Estate": "Nigerian property, modern Lagos apartment, Abuja architecture, African home",
    "Fashion":     "Nigerian fashion, Afrocentric style, Lagos streetwear, African model",
    "Health":      "African wellness, Nigerian healthcare, West African lifestyle",
    "Food":        "Nigerian cuisine, West African food, Lagos street food, Jollof, suya",
    "Education":   "Nigerian student, Lagos classroom, African university, West African learning",
    "E-commerce":  "Nigerian online business, Lagos market, African product photography",
    "Travel":      "Nigerian travel, Lagos skyline, West African landscape, Abuja cityscape",
    "Comedy":      "Nigerian everyday life, relatable African scenes, Lagos hustle",
    "History":     "African history, Nigerian heritage, West African culture and tradition",
    "Mindset":     "African professional, Nigerian success story, West African ambition",
    "General":     "African setting, Nigerian context, West African lifestyle",
}


async def search_pexels_videos(keyword: str, per_page: int = 6) -> list[VisualResult]:
    """Search Pexels for stock videos. Returns thumbnail + preview URLs."""
    headers = {"Authorization": settings.pexels_api_key}
    params = {"query": keyword, "per_page": per_page, "orientation": "portrait"}

    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{PEXELS_BASE}/videos/search", headers=headers, params=params
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()

    results = []
    for v in data.get("videos", []):
        # Pick HD file
        hd_files = [f for f in v["video_files"] if f.get("quality") == "hd"]
        if hd_files:
            # Prefer portrait orientation (height > width) for 9:16 videos
            portrait = [f for f in hd_files if f.get("height", 0) >= f.get("width", 1)]
            if portrait:
                file = sorted(portrait, key=lambda x: x.get("height", 0), reverse=True)[0]
            else:
                # No portrait available — take highest resolution, ffmpeg will crop
                file = sorted(hd_files, key=lambda x: x.get("height", 0), reverse=True)[0]
        else:
            file = v["video_files"][0]

        results.append(VisualResult(
            id=str(v["id"]),
            thumbnail_url=v["image"],
            preview_url=file["link"],
            source="pexels_video",
            width=file.get("width", 1080),
            height=file.get("height", 1920),
        ))
    return results


async def download_pexels_video(video_url: str, output_path: str) -> str:
    """Download a Pexels video file to disk."""
    async with aiohttp.ClientSession() as session:
        async with session.get(video_url) as resp:
            resp.raise_for_status()
            async with aiofiles.open(output_path, "wb") as f:
                async for chunk in resp.content.iter_chunked(65536):
                    await f.write(chunk)
    return output_path


def _score_pexels_result(result: "VisualResult", target_duration: float, prefer_portrait: bool) -> float:
    """Score a Pexels result 0–1. Higher = better match for this scene."""
    score = 0.0

    # Orientation score (0–0.5): portrait (h > w) preferred for 9:16 platforms
    w, h = result.width or 1, result.height or 1
    is_portrait = h >= w
    if prefer_portrait:
        score += 0.5 if is_portrait else 0.1
    else:
        score += 0.5 if not is_portrait else 0.2

    # Resolution bonus (0–0.3): prefer higher resolution source
    px = w * h
    if px >= 1920 * 1080:
        score += 0.3
    elif px >= 1280 * 720:
        score += 0.2
    elif px >= 854 * 480:
        score += 0.1

    # Position bonus (0–0.2): earlier results from Pexels API = more relevant
    # (already handled by Pexels relevance ranking — we just don't always pick [0])
    score += 0.2  # baseline, same for all; differentiated by above factors

    return score


async def fetch_pexels_for_scene(scene: Scene, output_dir: str) -> VisualFile:
    """Search and download best Pexels video for a scene.

    Scoring priority:
      1. Portrait orientation (height ≥ width) for 9:16 platforms
      2. Higher source resolution
    Among the top 3 scored results, one is picked at random — this gives
    variety across re-renders of the same scene.
    """
    import random

    keyword = scene.visual_keyword or "business"
    first_word = keyword.split()[0] if keyword else "people"
    # Fallback chain: specific → simpler → generic content
    fallbacks = [keyword, first_word, "professional people", "city background", "nature"]

    results = []
    used_keyword = keyword
    for kw in fallbacks:
        try:
            # Fetch 6 results so scoring has more options to work with
            results = await search_pexels_videos(kw, per_page=6)
            if results:
                used_keyword = kw
                break
            logger.warning("No Pexels results for '%s', trying next fallback", kw)
        except Exception as e:
            logger.warning("Pexels search error for '%s': %s", kw, str(e)[:80])
            continue

    if not results:
        raise ValueError(f"No Pexels results found after fallbacks for: {keyword}")

    # Score all results and pick randomly from top 3 for variety on re-renders
    target_dur = float(getattr(scene, "duration", 10) or 10)
    prefer_portrait = True  # default: most renders are 9:16

    scored = sorted(
        results,
        key=lambda r: _score_pexels_result(r, target_dur, prefer_portrait),
        reverse=True,
    )
    top3 = scored[:min(3, len(scored))]
    best = random.choice(top3)

    out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_visual.mp4")
    logger.info(
        "Pexels ✓ scene %s | keyword: '%s' | picked %dx%d from top-%d",
        scene.id, used_keyword, best.width, best.height, len(top3),
    )
    await download_pexels_video(best.preview_url, out_path)
    return VisualFile(path=out_path, media_type="video", source="pexels")


# ─── DALL-E 3 ─────────────────────────────────────────────────────────────────

async def generate_dalle_image(scene: Scene, output_dir: str, niche: str = "") -> VisualFile:
    """Generate an AI image via DALL-E 3 for a scene.
    Automatically injects African/Nigerian context for relevant niches so
    generated images feel relevant to Nigerian creators and their audience.
    """
    # Inject African context when the niche maps to one
    context_hint = AFRICAN_CONTEXT.get(niche, "")
    context_clause = f" {context_hint}." if context_hint else ""
    prompt = (
        f"Cinematic vertical video frame (9:16 portrait orientation). "
        f"{scene.visual}.{context_clause} "
        f"Professional stock photo quality. No text, no watermarks, no logos. "
        f"Clean, high contrast, visually striking."
    )

    response = await _get_openai_client().images.generate(
        model="dall-e-3",
        prompt=prompt,
        size="1024x1792",
        quality="standard",
        n=1,
    )

    image_url = response.data[0].url
    out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_visual.png")

    async with aiohttp.ClientSession() as session:
        async with session.get(image_url) as resp:
            resp.raise_for_status()
            async with aiofiles.open(out_path, "wb") as f:
                await f.write(await resp.read())

    return VisualFile(path=out_path, media_type="image", source="dalle")


# ─── Smart router ─────────────────────────────────────────────────────────────

async def generate_placeholder_visual(scene: Scene, output_dir: str) -> VisualFile:
    """
    Generate a solid-colour 1080x1920 MP4 as a fallback visual.
    Used when Pexels is unavailable and no OpenAI key is set.
    Requires only FFmpeg — no external API.
    """
    import subprocess
    from pathlib import Path

    out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_visual.mp4")
    # Cycle through a few dark gradient colours based on scene type
    colour_map = {
        "hook":  "0x1a0533",
        "intro": "0x0a1a2e",
        "main":  "0x0d1117",
        "cta":   "0x1a1a0a",
    }
    colour = colour_map.get(scene.type, "0x111118")

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=c={colour}:size=1080x1920:rate=30",
        "-t", str(scene.duration),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "ultrafast",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"Placeholder visual failed: {result.stderr.decode()[:200]}")
    logger.info("Placeholder visual ✓ scene %s → %s", scene.id, Path(out_path).name)
    return VisualFile(path=out_path, media_type="video", source="placeholder")


async def download_custom_image(url: str, output_dir: str, scene_id: int) -> VisualFile:
    """Download a user-uploaded custom image from URL."""
    import httpx
    ext = ".jpg"
    for suffix in [".png", ".webp", ".gif"]:
        if suffix in url.lower():
            ext = suffix
            break
    out_path = os.path.join(output_dir, f"custom_{scene_id}{ext}")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    with open(out_path, "wb") as f:
        f.write(resp.content)
    return VisualFile(path=out_path, media_type="image", source="custom")


# ── Unsplash ──────────────────────────────────────────────────────────────────
UNSPLASH_BASE = "https://api.unsplash.com"

# Niches where Unsplash has better African content than Pexels
PREFER_UNSPLASH_NICHES = {
    "Finance", "Business", "Real Estate", "Fashion", "Health",
    "Food", "Education", "E-commerce", "General", "Mindset",
}


def _build_unsplash_query(scene: Scene, niche: str) -> str:
    """Build a targeted search query from the scene visual description + niche context."""
    base = (scene.visual or scene.text or "").strip()
    # Take first 6 words max to keep the query focused
    words = base.split()[:6]
    query = " ".join(words)
    # Add African context keywords for relevant niches
    context_map = {
        "Finance":     "African business",
        "Business":    "Nigerian professional",
        "Real Estate": "African property",
        "Fashion":     "African fashion",
        "Health":      "African wellness",
        "Food":        "Nigerian food",
        "Education":   "African student",
        "E-commerce":  "African market",
    }
    suffix = context_map.get(niche, "")
    return f"{query} {suffix}".strip() if suffix else query


async def search_unsplash(query: str, per_page: int = 10) -> list[dict]:
    """Search Unsplash for photos. Returns list of photo dicts."""
    if not settings.unsplash_api_key:
        return []
    headers = {"Authorization": f"Client-ID {settings.unsplash_api_key}"}
    params  = {
        "query":       query,
        "orientation": "portrait",
        "per_page":    per_page,
        "content_filter": "high",
    }
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{UNSPLASH_BASE}/search/photos",
            headers=headers, params=params
        ) as resp:
            if resp.status != 200:
                logger.warning("Unsplash search failed (%s) for query: %s", resp.status, query)
                return []
            data = await resp.json()
            return data.get("results", [])


async def download_unsplash_photo(url: str, output_path: str) -> str:
    """Download a photo from Unsplash to disk."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            resp.raise_for_status()
            async with aiofiles.open(output_path, "wb") as f:
                await f.write(await resp.read())
    return output_path


async def apply_ken_burns(
    photo_path: str,
    output_path: str,
    duration: float = 6.0,
    width: int = 1080,
    height: int = 1920,
) -> str:
    """
    Convert a static photo to a video clip using the Ken Burns effect
    (slow zoom-in with subtle pan) via FFmpeg. Makes photos look cinematic.
    """
    import subprocess, asyncio
    fps    = 30
    frames = int(duration * fps)
    # Zoom from 1.0 to 1.3 over the duration: z = 1 + (0.3/frames)*n
    zoom_step = round(0.3 / frames, 6)
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", photo_path,
        "-vf", (
            f"scale=8000:-1,"
            f"zoompan="
            f"z='min(zoom+{zoom_step},1.3)':"
            f"x='iw/2-(iw/zoom/2)':"
            f"y='ih/2-(ih/zoom/2)':"
            f"d={frames}:"
            f"s={width}x{height},"
            f"setsar=1"
        ),
        "-t", str(duration),
        "-r", str(fps),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        output_path,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"Ken Burns FFmpeg failed: {stderr.decode()[-300:]}")
    return output_path


async def fetch_unsplash_for_scene(
    scene: Scene, output_dir: str, niche: str = ""
) -> VisualFile:
    """
    Search Unsplash for a portrait photo matching the scene, then apply
    Ken Burns zoom/pan to produce a cinematic video clip.
    Falls back to Pexels if Unsplash is unavailable or returns no results.
    """
    if not settings.unsplash_api_key:
        logger.info("Unsplash API key not set — falling back to Pexels")
        return await fetch_pexels_for_scene(scene, output_dir)

    query   = _build_unsplash_query(scene, niche)
    results = await search_unsplash(query, per_page=10)

    if not results:
        # Retry with simpler query
        simple = " ".join((scene.text or "").split()[:3])
        results = await search_unsplash(simple, per_page=5)

    if not results:
        logger.info("Unsplash returned no results for '%s' — falling back to Pexels", query)
        return await fetch_pexels_for_scene(scene, output_dir)

    photo     = results[0]
    photo_url = photo["urls"].get("regular") or photo["urls"]["full"]
    photo_id  = photo.get("id", "photo")

    photo_path  = str(Path(output_dir) / f"scene_{scene.id:02d}_unsplash_{photo_id}.jpg")
    video_path  = str(Path(output_dir) / f"scene_{scene.id:02d}_unsplash.mp4")

    await download_unsplash_photo(photo_url, photo_path)
    await apply_ken_burns(photo_path, video_path, duration=scene.duration or 6.0)

    logger.info(
        "Unsplash Ken Burns ✓ scene=%s query='%s' photo=%s",
        scene.id, query, photo_id,
    )
    return VisualFile(path=video_path, media_type="video", source="unsplash")


async def get_visual_for_scene(
    scene: Scene,
    output_dir: str,
    source: VisualSource = VisualSource.mixed,
    user_plan: str = "free",
    custom_image_url: Optional[str] = None,
    niche: str = "",
) -> VisualFile:
    """
    Route visual sourcing based on preference.
    custom_image_url: per-scene user-uploaded image (highest priority).
    DALL-E is only available for pro and studio plans.
    mixed: try Pexels first, fall back to placeholder.
    """
    # Custom uploaded image takes priority over everything else
    if custom_image_url or getattr(scene, "custom_image_url", None):
        url = custom_image_url or scene.custom_image_url
        try:
            return await download_custom_image(url, output_dir, scene.id)
        except Exception as e:
            logger.warning("Custom image download failed for scene %s: %s — falling back", scene.id, e)

    if source == VisualSource.unsplash:
        return await fetch_unsplash_for_scene(scene, output_dir, niche=niche)

    if source == VisualSource.dalle:
        # DALL-E requires Studio or Agency plan
        if user_plan not in {"studio", "agency"}:
            logger.info("DALL-E requires studio/agency plan (user is '%s') — using Pexels", user_plan)
            return await fetch_pexels_for_scene(scene, output_dir)
        if not settings.openai_api_key:
            logger.warning("OPENAI_API_KEY not set — falling back to Pexels for scene %s", scene.id)
            return await fetch_pexels_for_scene(scene, output_dir)
        try:
            return await generate_dalle_image(scene, output_dir, niche=niche)
        except Exception as e:
            logger.warning("DALL-E failed for scene %s: %s — falling back to Pexels", scene.id, e)
            return await fetch_pexels_for_scene(scene, output_dir)

    if source in (VisualSource.pexels_video, VisualSource.pexels_photo):
        # For African-context niches, try Unsplash first if API key is available
        if niche in PREFER_UNSPLASH_NICHES and settings.unsplash_api_key:
            try:
                return await fetch_unsplash_for_scene(scene, output_dir, niche=niche)
            except Exception as e:
                logger.info("Unsplash failed for scene %s (%s) — using Pexels", scene.id, e)
        return await fetch_pexels_for_scene(scene, output_dir)

    # mixed: Pexels first, solid-color placeholder fallback (no DALL-E needed)
    try:
        return await fetch_pexels_for_scene(scene, output_dir)
    except Exception:
        return await generate_placeholder_visual(scene, output_dir)


async def get_visuals_for_all_scenes(
    scenes: list[Scene],
    output_dir: str,
    source: VisualSource = VisualSource.mixed,
    on_progress=None,
) -> list[VisualFile]:
    """Fetch visuals for all scenes with concurrency limit."""
    total = len(scenes)
    completed = 0
    results = [None] * total
    semaphore = asyncio.Semaphore(4)

    async def _fetch(i: int, scene: Scene):
        nonlocal completed
        async with semaphore:
            visual = await get_visual_for_scene(scene, output_dir, source)
            results[i] = visual
            completed += 1
            if on_progress:
                await on_progress(completed, total)

    await asyncio.gather(*[_fetch(i, s) for i, s in enumerate(scenes)])
    return results
