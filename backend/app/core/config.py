"""Application settings loaded from environment variables (.env)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central app configuration.

    Values are read from environment variables or a local `.env` file
    (never commit `.env` — see `.env.example` for the expected keys).
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "NL-COP/DELPHI Backend"
    environment: str = "development"

    # CORS: Next.js dev server + deployed frontend origin(s)
    cors_origins: list[str] = ["http://localhost:3000"]

    # Supabase (same "Delphi" project used by the web-ui frontend)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
