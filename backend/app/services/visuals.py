from __future__ import annotations

import os
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


async def fetch_pexels_for_scene(scene: Scene, output_dir: str) -> VisualFile:
    """Search and download best Pexels video for a scene.
    Tries the exact keyword first, then progressively simpler fallback terms.
    """
    # Build a chain of fallback keywords — from specific to generic
    keyword = scene.visual_keyword or "business"
    # Strip down to just the first word as a last resort
    first_word = keyword.split()[0] if keyword else "people"
    fallbacks = [keyword, first_word, "people talking", "city background", "nature"]

    results = []
    used_keyword = keyword
    for kw in fallbacks:
        try:
            results = await search_pexels_videos(kw, per_page=3)
            if results:
                used_keyword = kw
                break
            logger.warning("No Pexels results for '%s', trying next fallback", kw)
        except Exception as e:
            logger.warning("Pexels search error for '%s': %s", kw, str(e)[:80])
            continue

    if not results:
        raise ValueError(f"No Pexels results found after fallbacks for: {keyword}")

    best = results[0]
    out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_visual.mp4")
    logger.info("Pexels ✓ scene %s | keyword: '%s' → %s", scene.id, used_keyword, Path(out_path).name)
    await download_pexels_video(best.preview_url, out_path)
    return VisualFile(path=out_path, media_type="video", source="pexels")


# ─── DALL-E 3 ─────────────────────────────────────────────────────────────────

async def generate_dalle_image(scene: Scene, output_dir: str) -> VisualFile:
    """Generate an AI image via DALL-E 3 for a scene."""
    prompt = (
        f"Cinematic vertical video frame (9:16 portrait orientation). "
        f"{scene.visual}. "
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


async def get_visual_for_scene(
    scene: Scene,
    output_dir: str,
    source: VisualSource = VisualSource.mixed,
    user_plan: str = "free",
) -> VisualFile:
    """
    Route visual sourcing based on preference.
    DALL-E is only available for pro and studio plans.
    mixed: try Pexels first, fall back to placeholder.
    """
    if source == VisualSource.dalle:
        # Gate DALL-E to pro and studio plans only
        if user_plan not in {"pro", "studio"}:
            logger.info("DALL-E requires pro/studio plan (user is '%s') — using Pexels", user_plan)
            return await fetch_pexels_for_scene(scene, output_dir)
        if not settings.openai_api_key:
            logger.warning("OPENAI_API_KEY not set — falling back to Pexels for scene %s", scene.id)
            return await fetch_pexels_for_scene(scene, output_dir)
        try:
            return await generate_dalle_image(scene, output_dir)
        except Exception as e:
            logger.warning("DALL-E failed for scene %s: %s — falling back to Pexels", scene.id, e)
            return await fetch_pexels_for_scene(scene, output_dir)

    if source in (VisualSource.pexels_video, VisualSource.pexels_photo):
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
