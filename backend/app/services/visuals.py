from __future__ import annotations

import os
import asyncio
from pathlib import Path
from dataclasses import dataclass

import aiohttp
import aiofiles
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.schemas import Scene, VisualSource, VisualResult

settings = get_settings()
openai_client = AsyncOpenAI(api_key=settings.openai_api_key)

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
        file = sorted(hd_files, key=lambda x: x.get("width", 0), reverse=True)[0] if hd_files else v["video_files"][0]

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
    """Search and download best Pexels video for a scene."""
    results = await search_pexels_videos(scene.visual_keyword, per_page=3)
    if not results:
        raise ValueError(f"No Pexels results for: {scene.visual_keyword}")

    best = results[0]
    out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_visual.mp4")
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

    response = await openai_client.images.generate(
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

async def get_visual_for_scene(
    scene: Scene,
    output_dir: str,
    source: VisualSource = VisualSource.mixed,
) -> VisualFile:
    """
    Route visual sourcing based on preference.
    mixed: try Pexels first, fall back to DALL-E.
    """
    if source == VisualSource.dalle:
        return await generate_dalle_image(scene, output_dir)

    if source in (VisualSource.pexels_video, VisualSource.pexels_photo):
        return await fetch_pexels_for_scene(scene, output_dir)

    # mixed: Pexels first, DALL-E fallback
    try:
        return await fetch_pexels_for_scene(scene, output_dir)
    except Exception:
        return await generate_dalle_image(scene, output_dir)


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
