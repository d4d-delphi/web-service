"""Supabase client factory.

Reuses the same Supabase project ("Delphi") that `web-ui` already talks to —
no new database or schema is created here. Table definitions live in
`web-ui/supabase/migrations/`.
"""

from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """Read-only client using the anon key (safe for RLS-protected reads)."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_anon_key)


@lru_cache
def get_supabase_admin() -> Client:
    """Privileged client using the service_role key.

    Bypasses RLS — use only for trusted server-side writes, never expose
    this client or its key to the frontend.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
