from pydantic import BaseModel


class Scenario(BaseModel):
    """Mirrors the `scenarios` table defined in
    `web-ui/supabase/migrations/20260704071600_init_nl_cop_schema.sql`.
    """

    id: str
    name: str
    description: str
    start_time: str
    duration_seconds: int
    camera_lat: float
    camera_lng: float
    camera_alt: float | None = None
    camera_heading: float | None = None
    camera_pitch: float | None = None
    camera_range: float | None = None
    created_at: str | None = None
    updated_at: str | None = None
