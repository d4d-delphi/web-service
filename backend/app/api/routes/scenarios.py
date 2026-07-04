from fastapi import APIRouter, HTTPException

from app.db.supabase_client import get_supabase
from app.schemas.scenario import Scenario

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("", response_model=list[Scenario])
def list_scenarios() -> list[Scenario]:
    """Read-only list of scenarios from the shared Supabase `scenarios` table."""
    response = get_supabase().table("scenarios").select("*").execute()
    return response.data


@router.get("/{scenario_id}", response_model=Scenario)
def get_scenario(scenario_id: str) -> Scenario:
    response = get_supabase().table("scenarios").select("*").eq("id", scenario_id).maybe_single().execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return response.data
