"""
Performance & Analytics API
Tier-4 style KPIs and degradation views aligned to the architecture plan.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import crud
from app.db.database import get_db
from app.services.influxdb_writer import get_influx_writer
from app.services.unit_manager import get_unit_manager

router = APIRouter(prefix="/api/units", tags=["performance"])


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        val = float(value)
        return val
    except Exception:
        return default


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _current_live_data(unit_id: str) -> Dict[str, Any]:
    manager = get_unit_manager()
    return manager.get_live_data(unit_id) or {}


def _stage_rows(live_data: Dict[str, Any], stage_count: int) -> List[Dict[str, float]]:
    rows = []
    raw_stages = live_data.get("stages", [])
    if isinstance(raw_stages, list) and raw_stages:
        for stage in raw_stages:
            rows.append({
                "stage": int(_to_float(stage.get("stage"), 0)),
                "suction_temp": _to_float(stage.get("suction_temp")),
                "discharge_temp": _to_float(stage.get("discharge_temp")),
                "suction_press": _to_float(stage.get("suction_press")),
                "discharge_press": _to_float(stage.get("discharge_press")),
                "ideal_temp": _to_float(stage.get("ideal_temp", stage.get("suction_temp"))),
                "isentropic_eff": _to_float(stage.get("isentropic_eff")),
                "volumetric_eff": _to_float(stage.get("volumetric_eff")),
            })
        return rows

    for i in range(1, max(1, stage_count) + 1):
        rows.append({
            "stage": i,
            "suction_temp": _to_float(live_data.get(f"stg{i}_suction_temp")),
            "discharge_temp": _to_float(live_data.get(f"stg{i}_discharge_temp")),
            "suction_press": _to_float(live_data.get(f"stg{i}_suction_press", live_data.get(f"stg{i}_suction_pressure"))),
            "discharge_press": _to_float(live_data.get(f"stg{i}_discharge_press", live_data.get(f"stg{i}_discharge_pressure"))),
            "ideal_temp": _to_float(live_data.get(f"stg{i}_suction_temp")),
            "isentropic_eff": _to_float(live_data.get(f"stg{i}_isentropic_eff")),
            "volumetric_eff": _to_float(live_data.get(f"stg{i}_volumetric_eff")),
        })
    return rows


def _interstage_cooler_approach(stage_rows: List[Dict[str, float]]) -> float:
    if len(stage_rows) < 2:
        return 0.0
    deltas = []
    for i in range(1, len(stage_rows)):
        upstream_discharge = stage_rows[i - 1]["discharge_temp"]
        suction = stage_rows[i]["suction_temp"]
        deltas.append(max(0.0, upstream_discharge - suction))
    if not deltas:
        return 0.0
    return sum(deltas) / len(deltas)


def _average(values: List[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _parse_time(ts: str) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def _trend_slope_per_day(points: List[Dict[str, Any]]) -> float:
    xs: List[float] = []
    ys: List[float] = []
    if len(points) < 2:
        return 0.0

    t0 = _parse_time(points[0].get("time", ""))
    if not t0:
        return 0.0

    for p in points:
        t = _parse_time(p.get("time", ""))
        if not t:
            continue
        y = _to_float(p.get("value"))
        x_hours = (t - t0).total_seconds() / 3600.0
        xs.append(x_hours)
        ys.append(y)

    n = len(xs)
    if n < 2:
        return 0.0
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    numer = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom <= 1e-9:
        return 0.0
    slope_per_hour = numer / denom
    return slope_per_hour * 24.0


def _status_from_slope(slope_per_day: float) -> str:
    if slope_per_day <= -0.2:
        return "declining"
    if slope_per_day >= 0.2:
        return "improving"
    return "stable"


@router.get("/{unit_id}/performance/summary")
async def performance_summary(unit_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return await _compute_summary(unit_id, db)


async def _compute_summary(unit_id: str, db: AsyncSession) -> Dict[str, Any]:
    manager = get_unit_manager()
    unit = manager.get_unit(unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")

    live = _current_live_data(unit_id)
    spec = await crud.get_equipment_spec(db, unit_id)

    stage_count = int(getattr(unit, "stage_count", 3) or 3)
    stages = _stage_rows(live, stage_count)

    rated_hp = _to_float(getattr(spec, "rated_hp", None), 1250.0)
    rpm = _to_float(live.get("engine_rpm"))
    total_bhp = _to_float(live.get("total_bhp"), (rpm / 1000.0) * 1247.5)
    engine_load_pct = (total_bhp / rated_hp * 100.0) if rated_hp > 0 else 0.0
    engine_load_pct = max(0.0, min(engine_load_pct, 200.0))

    isen = _average([s["isentropic_eff"] for s in stages if s["isentropic_eff"] > 0])
    vol = _average([s["volumetric_eff"] for s in stages if s["volumetric_eff"] > 0])
    thermal_delta = _average([
        max(0.0, s["discharge_temp"] - s["ideal_temp"])
        for s in stages
    ])

    cooler_approach = _interstage_cooler_approach(stages)
    bearing_temps = [float(_to_float(v)) for v in (live.get("bearing_temps", []) or [])]
    exhaust_vals = [float(_to_float(v)) for v in (live.get("exhaust_temps", {}) or {}).values()]

    compression_work_hp = total_bhp * max(0.0, min(1.0, (isen / 100.0 if isen > 0 else 0.72)))
    aux_hp = total_bhp * 0.05
    mechanical_loss_hp = max(0.0, total_bhp - compression_work_hp - aux_hp)

    # Simple estimated energy balance (placeholder until fuel rate is mapped).
    output_btu_hr = total_bhp * 2544.0
    estimated_bte = max(0.01, min(0.45, isen / 100.0 if isen > 0 else 0.30))
    input_fuel_btu_hr = output_btu_hr / estimated_bte

    return {
        "unit_id": unit_id,
        "timestamp": _now_iso(),
        "kpis": {
            "total_bhp": round(total_bhp, 2),
            "rated_hp": round(rated_hp, 2),
            "engine_load_pct": round(engine_load_pct, 2),
            "avg_isentropic_eff_pct": round(isen, 2),
            "avg_volumetric_eff_pct": round(vol, 2),
            "thermal_delta_f": round(thermal_delta, 2),
            "cooler_approach_f": round(cooler_approach, 2),
            "max_bearing_temp_f": round(max(bearing_temps) if bearing_temps else 0.0, 2),
            "exhaust_spread_f": round(
                _to_float(live.get("exhaust_spread"), max(exhaust_vals) - min(exhaust_vals) if len(exhaust_vals) >= 2 else 0.0),
                2,
            ),
        },
        "power_distribution_hp": {
            "compression_work_hp": round(compression_work_hp, 2),
            "mechanical_loss_hp": round(mechanical_loss_hp, 2),
            "auxiliary_hp": round(aux_hp, 2),
        },
        "energy_balance": {
            "input_fuel_btu_hr_est": round(input_fuel_btu_hr, 2),
            "useful_compression_btu_hr": round(output_btu_hr, 2),
            "estimated_brake_thermal_eff_pct": round((output_btu_hr / input_fuel_btu_hr) * 100.0 if input_fuel_btu_hr > 0 else 0.0, 2),
        },
        "stages": stages,
    }


@router.get("/{unit_id}/performance/efficiency")
async def performance_efficiency(
    unit_id: str,
    start: str = Query("-24h"),
    aggregate: str = Query("5m"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    manager = get_unit_manager()
    if not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")

    influx = get_influx_writer()
    isen: List[Dict[str, Any]] = []
    vol: List[Dict[str, Any]] = []
    ratio: List[Dict[str, Any]] = []

    if influx.connected:
        isen = influx.query_trend(unit_id, "stage_data", "isentropic_eff", start=start, aggregate_window=aggregate)
        vol = influx.query_trend(unit_id, "stage_data", "volumetric_eff", start=start, aggregate_window=aggregate)
        ratio = influx.query_trend(unit_id, "compressor_vitals", "overall_ratio", start=start, aggregate_window=aggregate)

    if not isen and not vol and not ratio:
        summary = await _compute_summary(unit_id, db)
        now = _now_iso()
        kpi = summary.get("kpis", {})
        isen = [{"time": now, "value": _to_float(kpi.get("avg_isentropic_eff_pct"))}]
        vol = [{"time": now, "value": _to_float(kpi.get("avg_volumetric_eff_pct"))}]
        ratio = [{"time": now, "value": _to_float(kpi.get("overall_ratio", 0.0))}]
        source = "live_fallback"
    else:
        source = "influx"

    return {
        "unit_id": unit_id,
        "timestamp": _now_iso(),
        "start": start,
        "aggregate": aggregate,
        "source": source,
        "series": {
            "isentropic_eff_pct": isen,
            "volumetric_eff_pct": vol,
            "overall_ratio": ratio,
        },
    }


@router.get("/{unit_id}/performance/power")
async def performance_power(
    unit_id: str,
    start: str = Query("-24h"),
    aggregate: str = Query("5m"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    manager = get_unit_manager()
    if not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")

    influx = get_influx_writer()
    bhp_series: List[Dict[str, Any]] = []
    rpm_series: List[Dict[str, Any]] = []

    if influx.connected:
        bhp_series = influx.query_trend(unit_id, "compressor_vitals", "total_bhp", start=start, aggregate_window=aggregate)
        rpm_series = influx.query_trend(unit_id, "engine_vitals", "rpm", start=start, aggregate_window=aggregate)

    if not bhp_series and not rpm_series:
        live = _current_live_data(unit_id)
        now = _now_iso()
        bhp_series = [{"time": now, "value": _to_float(live.get("total_bhp"))}]
        rpm_series = [{"time": now, "value": _to_float(live.get("engine_rpm"))}]
        source = "live_fallback"
    else:
        source = "influx"

    summary = await _compute_summary(unit_id, db)

    return {
        "unit_id": unit_id,
        "timestamp": _now_iso(),
        "start": start,
        "aggregate": aggregate,
        "source": source,
        "series": {
            "total_bhp": bhp_series,
            "engine_rpm": rpm_series,
        },
        "distribution": summary.get("power_distribution_hp", {}),
    }


@router.get("/{unit_id}/performance/degradation")
async def performance_degradation(
    unit_id: str,
    start: str = Query("-7d"),
    aggregate: str = Query("30m"),
) -> Dict[str, Any]:
    manager = get_unit_manager()
    if not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")

    influx = get_influx_writer()
    isen: List[Dict[str, Any]] = []
    vol: List[Dict[str, Any]] = []

    if influx.connected:
        isen = influx.query_trend(unit_id, "stage_data", "isentropic_eff", start=start, aggregate_window=aggregate)
        vol = influx.query_trend(unit_id, "stage_data", "volumetric_eff", start=start, aggregate_window=aggregate)

    if not isen and not vol:
        eff = await performance_efficiency(unit_id=unit_id, start="-24h", aggregate="5m")
        isen = eff.get("series", {}).get("isentropic_eff_pct", [])
        vol = eff.get("series", {}).get("volumetric_eff_pct", [])
        source = "live_fallback"
    else:
        source = "influx"

    isen_slope = _trend_slope_per_day(isen)
    vol_slope = _trend_slope_per_day(vol)

    current_isen = _to_float(isen[-1]["value"]) if isen else 0.0
    current_vol = _to_float(vol[-1]["value"]) if vol else 0.0
    target_isen = 70.0
    target_vol = 75.0

    def days_to_threshold(current: float, threshold: float, slope_per_day: float) -> Optional[float]:
        if slope_per_day >= 0:
            return None
        remaining = current - threshold
        if remaining <= 0:
            return 0.0
        return remaining / abs(slope_per_day) if abs(slope_per_day) > 1e-9 else None

    return {
        "unit_id": unit_id,
        "timestamp": _now_iso(),
        "start": start,
        "aggregate": aggregate,
        "source": source,
        "indicators": {
            "isentropic_eff": {
                "current_pct": round(current_isen, 2),
                "slope_pct_per_day": round(isen_slope, 4),
                "status": _status_from_slope(isen_slope),
                "days_to_70_pct": (
                    round(days_to_threshold(current_isen, target_isen, isen_slope), 1)
                    if days_to_threshold(current_isen, target_isen, isen_slope) is not None else None
                ),
            },
            "volumetric_eff": {
                "current_pct": round(current_vol, 2),
                "slope_pct_per_day": round(vol_slope, 4),
                "status": _status_from_slope(vol_slope),
                "days_to_75_pct": (
                    round(days_to_threshold(current_vol, target_vol, vol_slope), 1)
                    if days_to_threshold(current_vol, target_vol, vol_slope) is not None else None
                ),
            },
        },
    }
