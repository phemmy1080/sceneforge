from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field
from typing import Optional


class SignupRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    coupon_code: Optional[str] = None   # promo code for bonus tokens on signup


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    full_name: str
    email: str
    avatar_initials: str
    plan: str = "free"
    videos_created: int = 0
    tokens_remaining: int = 1000   # credits remaining
    tokens_total: int = 1000       # original allocation
    created_at: str
    email_verified: bool = False
    workspace_id: Optional[str] = None
    workspace_role: Optional[str] = None
    workspace_suspended: Optional[bool] = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = Field(None, min_length=2, max_length=100)
    email: Optional[EmailStr] = None


class TokenBalanceResponse(BaseModel):
    tokens_remaining: int
    tokens_total: int
    videos_created: int
    can_render: bool
    cost_per_video: int = 100      # minimum cost per video (base)
    tokens_per_scene: int = 12     # marginal cost per scene
    renders_today: int = 0         # renders used today
    daily_limit: int = -1          # max renders per day (-1 = unlimited)
    renders_remaining: int = -1    # renders left today (-1 = unlimited)
