"""
Trends API V2 - Parameter-based historical data queries.
Maps friendly parameter names to InfluxDB measurements/fields.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional, Dict
from pydantic import BaseModel
from datetime import datetime

from app.services.influxdb_writer import get_influx_writer

router = APIRouter(prefix="/api/trends", tags=["Historical Trends"])


# Parameter to measurement/field mapping
PARAMETER_MAPPING = {
    # Engine vitals
    "engine_rpm": {"measurement": "engine_vitals", "field": "rpm"},
    "engine_oil_pressure": {"measurement": "engine_vitals", "field": "oil_pressure"},
    "engine_oil_temp": {"measurement": "engine_vitals", "field": "oil_temp"},
    "jacket_water_temp": {"measurement": "engine_vitals", "field": "jacket_water_temp"},
    
    # Compressor vitals
    "compressor_oil_pressure": {"measurement": "compressor_vitals", "field": "oil_pressure"},
    "compressor_oil_temp": {"measurement": "compressor_vitals", "field": "oil_temp"},
    "overall_ratio": {"measurement": "compressor_vitals", "field": "overall_ratio"},
    "total_bhp": {"measurement": "compressor_vitals", "field": "total_bhp"},
    
    # Stage pressures (stage 1-3)
    "stg1_suction_pressure": {"measurement": "stage_data", "field": "suction_press", "tags": {"stage": "1"}},
    "stg1_discharge_pressure": {"measurement": "stage_data", "field": "discharge_press", "tags": {"stage": "1"}},
    "stg2_suction_pressure": {"measurement": "stage_data", "field": "suction_press", "tags": {"stage": "2"}},
    "stg2_discharge_pressure": {"measurement": "stage_data", "field": "discharge_press", "tags": {"stage": "2"}},
    "stg3_suction_pressure": {"measurement": "stage_data", "field": "suction_press", "tags": {"stage": "3"}},
    "stg3_discharge_pressure": {"measurement": "stage_data", "field": "discharge_press", "tags": {"stage": "3"}},
    
    # Stage temperatures
    "stg1_suction_temp": {"measurement": "stage_data", "field": "suction_temp", "tags": {"stage": "1"}},
    "stg1_discharge_temp": {"measurement": "stage_data", "field": "discharge_temp", "tags": {"stage": "1"}},
    "stg2_suction_temp": {"measurement": "stage_data", "field": "suction_temp", "tags": {"stage": "2"}},
    "stg2_discharge_temp": {"measurement": "stage_data", "field": "discharge_temp", "tags": {"stage": "2"}},
    "stg3_suction_temp": {"measurement": "stage_data", "field": "suction_temp", "tags": {"stage": "3"}},
    "stg3_discharge_temp": {"measurement": "stage_data", "field": "discharge_temp", "tags": {"stage": "3"}},
    
    # Vibration
    "frame_vibration": {"measurement": "vibration", "field": "frame"},
    "crosshead_vibration": {"measurement": "vibration", "field": "crosshead"},
}


class TrendPoint(BaseModel):
    time: str
    value: float


class ParameterTrendRequest(BaseModel):
    parameters: List[str]
    start: str = "-1h"
    stop: str = "now()"
    aggregate: str = "1m"


class TrendResponse(BaseModel):
    unit_id: str
    measurement: str
    field: str
    start: str
    stop: str
    data: List[TrendPoint]


class MultiTrendRequest(BaseModel):
    unit_id: str
    measurements: List[dict]
    start: str = "-1h"
    aggregate_window: str = "1m"


def get_aggregation_for_range(start: str) -> str:
    """Determine appropriate aggregation window based on time range."""
    if start.endswith("m"):
        return "10s"
    elif start.endswith("h"):
        hours = int(start.replace("-", "").replace("h", ""))
        if hours <= 1:
            return "30s"
        elif hours <= 6:
            return "1m"
        elif hours <= 24:
            return "5m"
        else:
            return "15m"
    elif start.endswith("d"):
        days = int(start.replace("-", "").replace("d", ""))
        if days <= 1:
            return "5m"
        elif days <= 7:
            return "15m"
        else:
            return "1h"
    return "1m"


@router.get("/{unit_id}")
async def get_parameter_trends(
    unit_id: str,
    parameters: str = Query(..., description="Comma-separated parameter names"),
    start: str = Query("-1h", description="Start time (e.g., -1h, -24h, -7d)"),
    stop: str = Query("now()", description="End time"),
    aggregate: Optional[str] = Query(None, description="Aggregation window (auto if not specified)")
) -> Dict:
    """
    Get historical trends for multiple parameters by friendly name.
    
    Example: /api/trends/GCS-001?parameters=engine_rpm,stg1_suction_pressure,stg1_discharge_pressure&start=-6h
    """
    writer = get_influx_writer()
    
    param_list = [p.strip() for p in parameters.split(",")]
    agg = aggregate if aggregate else get_aggregation_for_range(start)
    
    results = {}
    
    for param in param_list:
        if param not in PARAMETER_MAPPING:
            results[param] = {"error": f"Unknown parameter: {param}", "data": []}
            continue
        
        mapping = PARAMETER_MAPPING[param]
        
        if not writer.connected:
            results[param] = {"data": [], "source": "unavailable"}
            continue
        
        data = writer.query_trend(
            unit_id=unit_id,
            measurement=mapping["measurement"],
            field=mapping["field"],
            start=start,
            stop=stop,
            aggregate_window=agg
        )
        
        results[param] = {
            "data": data,
            "measurement": mapping["measurement"],
            "field": mapping["field"]
        }
    
    return {
        "unit_id": unit_id,
        "start": start,
        "stop": stop,
        "aggregate": agg,
        "parameters": results,
        "timestamp": datetime.now().isoformat()
    }


@router.get("/{unit_id}/{measurement}/{field}", response_model=TrendResponse)
async def get_trend(
    unit_id: str,
    measurement: str,
    field: str,
    start: str = Query("-1h", description="Start time"),
    stop: str = Query("now()", description="End time"),
    aggregate: str = Query("1m", description="Aggregation window")
):
    """Get historical trend data for a specific measurement and field."""
    writer = get_influx_writer()
    
    if not writer.connected:
        return TrendResponse(
            unit_id=unit_id,
            measurement=measurement,
            field=field,
            start=start,
            stop=stop,
            data=[]
        )
    
    data = writer.query_trend(
        unit_id=unit_id,
        measurement=measurement,
        field=field,
        start=start,
        stop=stop,
        aggregate_window=aggregate
    )
    
    return TrendResponse(
        unit_id=unit_id,
        measurement=measurement,
        field=field,
        start=start,
        stop=stop,
        data=[TrendPoint(**p) for p in data]
    )


@router.post("/multi", response_model=dict)
async def get_multi_trends(request: MultiTrendRequest):
    """Get multiple trends in a single request."""
    writer = get_influx_writer()
    
    if not writer.connected:
        return {"error": "InfluxDB not connected", "data": {}}
    
    results = writer.query_multi_trend(
        unit_id=request.unit_id,
        measurements=request.measurements,
        start=request.start,
        aggregate_window=request.aggregate_window
    )
    
    return {"data": results}


@router.get("/{unit_id}/overview")
async def get_overview_trends(
    unit_id: str,
    start: str = Query("-6h", description="Start time")
):
    """Get commonly used trends for dashboard overview."""
    writer = get_influx_writer()
    
    if not writer.connected:
        return {
            "unit_id": unit_id,
            "status": "InfluxDB not connected",
            "trends": {}
        }
    
    measurements = [
        {"measurement": "engine_vitals", "field": "rpm"},
        {"measurement": "engine_vitals", "field": "oil_pressure"},
        {"measurement": "compressor_vitals", "field": "overall_ratio"},
        {"measurement": "compressor_vitals", "field": "total_bhp"},
    ]
    
    results = writer.query_multi_trend(
        unit_id=unit_id,
        measurements=measurements,
        start=start,
        aggregate_window="5m"
    )
    
    return {
        "unit_id": unit_id,
        "status": "ok",
        "trends": results
    }


@router.get("/parameters/list")
async def list_available_parameters():
    """List all available parameter names for trending."""
    return {
        "parameters": list(PARAMETER_MAPPING.keys()),
        "count": len(PARAMETER_MAPPING)
    }
