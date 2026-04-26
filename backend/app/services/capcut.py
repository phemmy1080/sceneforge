from __future__ import annotations

import json
import uuid
from pathlib import Path

from app.models.schemas import Scene


def build_capcut_draft(
    scenes: list[Scene],
    scene_files: list[str],
    project_title: str = "SceneForge Export",
) -> dict:
    """
    Build a CapCut-compatible draft_content.json.
    CapCut uses microseconds (µs) for all time values.
    """
    cursor_us = 0
    video_segments = []
    audio_segments = []
    materials_videos = []
    materials_audios = []

    for i, (scene, file_path) in enumerate(zip(scenes, scene_files)):
        duration_us = scene.duration * 1_000_000
        seg_id = str(uuid.uuid4())
        mat_id = str(uuid.uuid4())
        audio_mat_id = str(uuid.uuid4())

        # Video segment
        video_segments.append({
            "id": seg_id,
            "material_id": mat_id,
            "target_timerange": {
                "start": cursor_us,
                "duration": duration_us,
            },
            "source_timerange": {
                "start": 0,
                "duration": duration_us,
            },
            "speed": 1.0,
            "volume": 1.0,
            "extra_material_refs": [audio_mat_id],
        })

        # Audio segment (voiceover embedded in clip)
        audio_segments.append({
            "id": str(uuid.uuid4()),
            "material_id": audio_mat_id,
            "target_timerange": {
                "start": cursor_us,
                "duration": duration_us,
            },
            "source_timerange": {
                "start": 0,
                "duration": duration_us,
            },
            "volume": 1.0,
        })

        # Material references
        materials_videos.append({
            "id": mat_id,
            "type": "video",
            "path": f"./{Path(file_path).name}",
            "duration": duration_us,
            "width": 1080,
            "height": 1920,
            "name": f"Scene {i+1:02d} — {scene.type}",
        })

        materials_audios.append({
            "id": audio_mat_id,
            "type": "audio",
            "path": f"./{Path(file_path).name}",
            "duration": duration_us,
            "name": f"VO Scene {i+1:02d}",
        })

        cursor_us += duration_us

    draft = {
        "id": str(uuid.uuid4()),
        "name": project_title,
        "version": "5.0.0",
        "fps": 30.0,
        "canvas_config": {
            "width": 1080,
            "height": 1920,
            "ratio": "9:16",
        },
        "duration": cursor_us,
        "tracks": [
            {
                "id": str(uuid.uuid4()),
                "type": "video",
                "segments": video_segments,
            },
            {
                "id": str(uuid.uuid4()),
                "type": "audio",
                "segments": audio_segments,
            },
        ],
        "materials": {
            "videos": materials_videos,
            "audios": materials_audios,
            "texts": [],
            "stickers": [],
        },
        "keyframes": {},
        "mutable_config": {
            "export_range": {"start": 0, "duration": cursor_us},
        },
    }

    return draft


def write_manifest(
    scenes: list[Scene],
    scene_files: list[str],
    final_path: str,
    project_title: str,
    output_path: str,
) -> str:
    """Write a human-readable JSON manifest for the scene bundle."""
    manifest = {
        "project": project_title,
        "total_duration_seconds": sum(s.duration for s in scenes),
        "scene_count": len(scenes),
        "final_video": Path(final_path).name,
        "scenes": [
            {
                "index": i + 1,
                "file": Path(f).name,
                "duration": scene.duration,
                "type": scene.type,
                "voiceover": scene.text,
                "visual_keyword": scene.visual_keyword,
            }
            for i, (scene, f) in enumerate(zip(scenes, scene_files))
        ],
    }

    with open(output_path, "w") as f:
        json.dump(manifest, f, indent=2)

    return output_path
