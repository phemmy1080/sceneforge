from __future__ import annotations
"""
Plan feature limits — single source of truth.
All limits are checked here so changing them is one place.
"""

PLAN_LIMITS = {
    "free": {
        "max_scenes": -1,
        "max_renders_per_day": 3,
        "max_resolution": "720p",
        "ai_voices": False,
        "upload_footage": False,
        "max_saved_videos": 5,
        "dalle_images": False,
        "unsplash_photos": False,
        "watermark": True,
        "video_retention_days": 3,
        "priority_queue": False,
        "agency_workspace": False,
        "label": "Free",
    },
    "starter": {
        "max_saved_videos": -1,
        "max_scenes": 20,
        "max_renders_per_day": -1,
        "max_resolution": "1080p",
        "ai_voices": True,
        "upload_footage": True,
        "dalle_images": False,
        "unsplash_photos": True,
        "watermark": False,
        "video_retention_days": 7,
        "priority_queue": False,
        "agency_workspace": False,
        "label": "Starter",
    },
    "pro": {
        "max_saved_videos": -1,
        "max_scenes": -1,
        "max_renders_per_day": -1,
        "max_resolution": "1080p",
        "ai_voices": True,
        "upload_footage": True,
        "dalle_images": False,
        "unsplash_photos": True,
        "watermark": False,
        "video_retention_days": 30,
        "priority_queue": True,
        "agency_workspace": False,
        "label": "Pro",
    },
    "studio": {
        "max_saved_videos": -1,
        "max_scenes": -1,
        "max_renders_per_day": -1,
        "max_resolution": "1080p",
        "ai_voices": True,
        "upload_footage": True,
        "dalle_images": True,
        "unsplash_photos": True,
        "watermark": False,
        "video_retention_days": 45,
        "priority_queue": True,
        "agency_workspace": False,
        "label": "Studio",
    },
    "agency": {
        "max_saved_videos": -1,
        "max_scenes": -1,
        "max_renders_per_day": -1,
        "max_resolution": "1080p",
        "ai_voices": True,
        "upload_footage": True,
        "dalle_images": True,
        "unsplash_photos": True,
        "watermark": False,
        "video_retention_days": 45,
        "priority_queue": True,
        "agency_workspace": True,
        "team_seats": 5,
        "label": "Agency",
    },
}


def get_limits(plan: str) -> dict:
    """Return limits for a plan. Defaults to free if unknown."""
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])


def is_paid(plan: str) -> bool:
    return plan in ("starter", "pro", "studio", "agency")


def check_scene_limit(plan: str, scene_count: int) -> tuple[bool, int]:
    """Returns (allowed, max_scenes). max_scenes=-1 means unlimited."""
    limits = get_limits(plan)
    max_s = limits["max_scenes"]
    if max_s == -1:
        return True, -1
    return scene_count <= max_s, max_s


def check_ai_voices(plan: str) -> bool:
    return get_limits(plan)["ai_voices"]


def check_upload_footage(plan: str) -> bool:
    return get_limits(plan)["upload_footage"]


def get_resolution(plan: str) -> str:
    return get_limits(plan)["max_resolution"]

def resolution_to_dims(resolution: str):
    """Convert resolution string to (max_width, max_height) cap.
    Returns None for 1080p (no cap needed — all platforms are <= 1920x1080).
    """
    mapping = {
        "720p":  (1280, 720),
        "480p":  (854,  480),
    }
    return mapping.get(resolution)


def check_daily_limit(plan: str, used_today: int) -> tuple:
    """Returns (allowed, max_daily). max_daily=-1 means unlimited."""
    max_daily = get_limits(plan)["max_renders_per_day"]
    if max_daily == -1:
        return True, -1
    return used_today < max_daily, max_daily
