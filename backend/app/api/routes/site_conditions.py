"""
Site Conditions API - Persist site-specific environmental data
Uses file-based persistence to avoid database schema changes
"""

from fastapi import APIRouter, Depends
from typing import Dict, Optional
from pydantic import BaseModel
import json
import os

from ..routes.auth import require_engineer, get_current_user

router = APIRouter(prefix="/api/config/site", tags=["Site Conditions"])

# File-based storage location
SITE_CONFIG_DIR = "/app/data/site_conditions"


class SiteConditions(BaseModel):
    elevation_ft: float = 0
    barometric_psi: float = 14.7
    ambient_temp_f: float = 75
    design_ambient_f: float = 95
    cooler_approach_f: float = 15
    humidity_pct: float = 50


# In-memory cache
_site_conditions_cache: Dict[str, Dict] = {}


def _get_config_path(unit_id: str) -> str:
    os.makedirs(SITE_CONFIG_DIR, exist_ok=True)
    return os.path.join(SITE_CONFIG_DIR, f"{unit_id}_site.json")


def _load_from_file(unit_id: str) -> Optional[Dict]:
    path = _get_config_path(unit_id)
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return None


def _save_to_file(unit_id: str, data: Dict):
    path = _get_config_path(unit_id)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


@router.get("/{unit_id}")
async def get_site_conditions(
    unit_id: str,
    current_user: dict = Depends(get_current_user)
) -> Dict:
    """Get site conditions for a unit."""
    if unit_id in _site_conditions_cache:
        return {
            "unit_id": unit_id,
            "site_conditions": _site_conditions_cache[unit_id],
            "updated_at": None
        }
    
    file_data = _load_from_file(unit_id)
    if file_data:
        _site_conditions_cache[unit_id] = file_data
        return {
            "unit_id": unit_id,
            "site_conditions": file_data,
            "updated_at": None
        }
    
    return {
        "unit_id": unit_id,
        "site_conditions": SiteConditions().dict(),
        "updated_at": None
    }


@router.put("/{unit_id}")
async def update_site_conditions(
    unit_id: str,
    conditions: SiteConditions,
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Update site conditions for a unit."""
    data = conditions.dict()
    _site_conditions_cache[unit_id] = data
    _save_to_file(unit_id, data)
    
    return {
        "status": "updated",
        "unit_id": unit_id,
        "site_conditions": data
    }


@router.get("/{unit_id}/derating")
async def calculate_derating(unit_id: str) -> Dict:
    """Calculate power derating based on site conditions."""
    conditions = SiteConditions()
    
    if unit_id in _site_conditions_cache:
        conditions = SiteConditions(**_site_conditions_cache[unit_id])
    else:
        file_data = _load_from_file(unit_id)
        if file_data:
            conditions = SiteConditions(**file_data)
    
    altitude_factor = 1.0 - (conditions.elevation_ft / 1000 * 0.03)
    altitude_factor = max(0.7, min(1.0, altitude_factor))
    
    temp_factor = 1.0 - ((conditions.ambient_temp_f - 60) / 10 * 0.01)
    temp_factor = max(0.85, min(1.0, temp_factor))
    
    combined_factor = altitude_factor * temp_factor
    
    return {
        "unit_id": unit_id,
        "altitude_derating": round(altitude_factor * 100, 1),
        "temperature_derating": round(temp_factor * 100, 1),
        "combined_derating": round(combined_factor * 100, 1),
        "conditions": conditions.dict()
    }
