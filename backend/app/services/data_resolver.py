"""
Data Resolver Service V3
Plan-aligned source chain with strict mode compatibility.

Priority chain (when configured):
MODBUS LIVE -> CALCULATED -> MANUAL -> DEFAULT

Default compatibility behavior:
- valueMode=LIVE   => strict LIVE only
- valueMode=MANUAL => strict MANUAL only
"""

import logging
import math
import re
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class DataSource(str, Enum):
    LIVE = "LIVE"
    CALCULATED = "CALCULATED"
    MANUAL = "MANUAL"
    DEFAULT = "DEFAULT"
    BAD = "BAD"


class DataQuality(str, Enum):
    GOOD = "GOOD"
    INFERRED = "INFERRED"
    STATIC = "STATIC"
    ASSUMED = "ASSUMED"
    BAD = "BAD"


DYNAMIC_KEYWORDS = [
    "temp", "pressure", "pres", "flow", "rpm", "speed",
    "vibration", "vib", "amp", "current", "power", "load"
]

QUALITY_META = {
    DataSource.LIVE.value: {"label": "Live Modbus", "icon": "LIVE", "color": "green"},
    DataSource.CALCULATED.value: {"label": "Calculated", "icon": "CALC", "color": "blue"},
    DataSource.MANUAL.value: {"label": "Manual", "icon": "MAN", "color": "yellow"},
    DataSource.DEFAULT.value: {"label": "Default", "icon": "DEF", "color": "orange"},
    DataSource.BAD.value: {"label": "Unavailable", "icon": "BAD", "color": "red"},
}


@dataclass
class ResolveResult:
    parameter: str
    value: Optional[float]
    source: str
    quality: str
    timestamp: str
    detail: str


class StaleDataTracker:
    """Tracks value changes to detect frozen/zombie sensors."""

    def __init__(self, staleness_minutes: float = 5.0, change_threshold: float = 0.01):
        self.staleness_minutes = staleness_minutes
        self.change_threshold = change_threshold
        self.last_values: Dict[str, float] = {}
        self.last_change_times: Dict[str, datetime] = {}

    def is_dynamic(self, parameter: str) -> bool:
        return any(kw in parameter.lower() for kw in DYNAMIC_KEYWORDS)

    def is_stale(self, parameter: str, value: float) -> bool:
        if not self.is_dynamic(parameter):
            return False

        now = datetime.utcnow()
        prev = self.last_values.get(parameter)
        if prev is None:
            self.last_values[parameter] = value
            self.last_change_times[parameter] = now
            return False

        if abs(value - prev) >= self.change_threshold:
            self.last_values[parameter] = value
            self.last_change_times[parameter] = now
            return False

        last_change = self.last_change_times.get(parameter, now)
        elapsed_min = (now - last_change).total_seconds() / 60.0
        return elapsed_min >= self.staleness_minutes


class DataResolver:
    """
    Resolves each parameter through the configured source chain.

    Compatibility behavior:
    - If no explicit source chain is configured, valueMode controls strict mode.
    """

    SOURCE_ALIASES = {
        "modbus": "MODBUS",
        "live": "MODBUS",
        "calculated": "CALCULATED",
        "calc": "CALCULATED",
        "manual": "MANUAL",
        "user": "MANUAL",
        "default": "DEFAULT",
    }

    SIMPLE_ALIASES = {
        "engine_oil_press": ["engine_oil_pressure"],
        "engine_oil_pressure": ["engine_oil_press"],
        "comp_oil_press": ["comp_oil_pressure"],
        "comp_oil_pressure": ["comp_oil_press"],
        "stg1_suction_press": ["stg1_suction_pressure"],
        "stg1_suction_pressure": ["stg1_suction_press"],
        "stg2_suction_press": ["stg2_suction_pressure"],
        "stg2_suction_pressure": ["stg2_suction_press"],
        "stg3_suction_press": ["stg3_suction_pressure"],
        "stg3_suction_pressure": ["stg3_suction_press"],
        "stg1_discharge_press": ["stg1_discharge_pressure"],
        "stg1_discharge_pressure": ["stg1_discharge_press"],
        "stg2_discharge_press": ["stg2_discharge_pressure"],
        "stg2_discharge_pressure": ["stg2_discharge_press"],
        "stg3_discharge_press": ["stg3_discharge_pressure"],
        "stg3_discharge_pressure": ["stg3_discharge_press"],
    }

    def __init__(self):
        self.stale_tracker = StaleDataTracker(staleness_minutes=5.0, change_threshold=0.01)
        self.manual_values: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def set_manual_value(self, unit_id: str, parameter: str, value: float, expires_at: datetime = None):
        if unit_id not in self.manual_values:
            self.manual_values[unit_id] = {}
        self.manual_values[unit_id][parameter] = {
            "value": float(value),
            "set_at": datetime.utcnow(),
            "expires_at": expires_at,
        }
        logger.debug("Manual override set: %s.%s = %s", unit_id, parameter, value)

    def clear_manual_value(self, unit_id: str, parameter: str):
        unit_manual = self.manual_values.get(unit_id, {})
        if parameter in unit_manual:
            del unit_manual[parameter]

    def get_manual_value(self, unit_id: str, parameter: str) -> Optional[float]:
        unit_manual = self.manual_values.get(unit_id, {})
        manual = unit_manual.get(parameter)
        if not manual:
            return None
        expires = manual.get("expires_at")
        if expires and expires <= datetime.utcnow():
            del unit_manual[parameter]
            return None
        raw = manual.get("value")
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None

    def _to_float(self, raw: Any) -> Optional[float]:
        if raw in (None, "", "None"):
            return None
        try:
            val = float(raw)
            if math.isnan(val) or math.isinf(val):
                return None
            return val
        except (TypeError, ValueError):
            return None

    def _get_value_with_aliases(self, parameter: str, live_data: Dict[str, Any]) -> Optional[float]:
        candidates = [parameter]
        for alias in self.SIMPLE_ALIASES.get(parameter, []):
            if alias not in candidates:
                candidates.append(alias)

        norm = parameter.strip().lower()
        if norm.startswith("stage"):
            # stage1_suction_temp -> stg1_suction_temp
            m = re.match(r"stage(\d+)_(.+)$", norm)
            if m:
                candidates.append(f"stg{m.group(1)}_{m.group(2)}")

        for key in candidates:
            val = self._to_float(live_data.get(key))
            if val is not None:
                return val
        return None

    def _parse_source_chain(self, config: Dict[str, Any]) -> List[str]:
        raw = config.get("sourcePriority", config.get("source_priority"))
        if isinstance(raw, list):
            tokens = [str(t).strip() for t in raw]
        elif isinstance(raw, str) and raw.strip():
            tokens = [t.strip() for t in re.split(r"->|,|\|", raw) if t.strip()]
        else:
            tokens = []

        chain: List[str] = []
        for token in tokens:
            key = token.split(":", 1)[0].strip().lower()
            mapped = self.SOURCE_ALIASES.get(key)
            if mapped and mapped not in chain:
                chain.append(mapped)

        if chain:
            return chain

        # Backward compatibility: strict value mode unless source chain explicitly provided.
        mode = str(config.get("valueMode", config.get("value_mode", "LIVE"))).upper()
        if mode == "MANUAL":
            return ["MANUAL"]
        return ["MODBUS"]

    def _is_live_value_valid(self, value: float, config: Dict[str, Any]) -> bool:
        min_valid = self._to_float(config.get("minValid", config.get("min_valid", config.get("min"))))
        max_valid = self._to_float(config.get("maxValid", config.get("max_valid", config.get("max"))))

        if min_valid is not None and value < min_valid:
            return False
        if max_valid is not None and value > max_valid:
            return False
        return True

    def _calc_stage_suction_temp(self, live_data: Dict[str, Any], stage: int, cooler_approach_f: float) -> Optional[float]:
        up_discharge = self._get_value_with_aliases(f"stg{stage - 1}_discharge_temp", live_data)
        if up_discharge is None:
            return None
        return up_discharge - cooler_approach_f

    def _calc_stage_suction_press(self, live_data: Dict[str, Any], stage: int, interstage_dp: float) -> Optional[float]:
        up_discharge = self._get_value_with_aliases(f"stg{stage - 1}_discharge_press", live_data)
        if up_discharge is None:
            return None
        return up_discharge - interstage_dp

    def _calculate_value(
        self,
        unit_id: str,
        parameter: str,
        live_data: Dict[str, Any],
        config: Dict[str, Any],
    ) -> Optional[float]:
        calc_key = str(
            config.get("calcFormula", config.get("calculationFormula", config.get("calc_key", parameter)))
        ).strip()

        if not calc_key:
            return None

        cooler_approach_f = self._to_float(config.get("coolerApproachF", config.get("cooler_approach_f")))
        if cooler_approach_f is None:
            cooler_approach_f = self._to_float(live_data.get("cooler_approach_f"))
        if cooler_approach_f is None:
            cooler_approach_f = 15.0

        interstage_dp = self._to_float(config.get("interstageDp", config.get("interstage_dp")))
        if interstage_dp is None:
            interstage_dp = 5.0

        speed_ratio = self._to_float(config.get("speedRatio", config.get("speed_ratio")))
        if speed_ratio is None:
            speed_ratio = 1.0

        # Built-in calculator keys from the architecture plan.
        normalized_key = calc_key.lower()
        if normalized_key in {"stage2_suction_temp", "stg2_suction_temp"}:
            return self._calc_stage_suction_temp(live_data, stage=2, cooler_approach_f=cooler_approach_f)
        if normalized_key in {"stage3_suction_temp", "stg3_suction_temp"}:
            return self._calc_stage_suction_temp(live_data, stage=3, cooler_approach_f=cooler_approach_f)
        if normalized_key in {"stage2_suction_press", "stage2_suction_pressure", "stg2_suction_press"}:
            return self._calc_stage_suction_press(live_data, stage=2, interstage_dp=interstage_dp)
        if normalized_key in {"stage3_suction_press", "stage3_suction_pressure", "stg3_suction_press"}:
            return self._calc_stage_suction_press(live_data, stage=3, interstage_dp=interstage_dp)
        if normalized_key in {"compressor_rpm", "comp_rpm"}:
            rpm = self._get_value_with_aliases("engine_rpm", live_data)
            if rpm is None:
                return None
            return rpm * speed_ratio
        if normalized_key in {"baro_pressure", "barometric_pressure"}:
            elevation_ft = self._to_float(config.get("elevation_ft", live_data.get("elevation_ft")))
            if elevation_ft is None:
                elevation_ft = 0.0
            return 14.696 * (1 - 6.8753e-6 * elevation_ft) ** 5.2559
        if normalized_key in {"gas_k_avg", "k_avg"}:
            k_suction = self._to_float(config.get("k_suction", live_data.get("k_suction")))
            k_discharge = self._to_float(config.get("k_discharge", live_data.get("k_discharge")))
            if k_suction is None or k_discharge is None:
                return None
            return (k_suction + k_discharge) / 2.0

        # Simple expression support (safe eval with numeric namespace only).
        # Example: "stg1_discharge_temp - 15"
        if any(op in calc_key for op in ("+", "-", "*", "/", "(", ")")):
            namespace: Dict[str, float] = {}
            for key, value in live_data.items():
                num = self._to_float(value)
                if num is not None and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", str(key)):
                    namespace[str(key)] = num
            namespace["cooler_approach_f"] = cooler_approach_f
            namespace["interstage_dp"] = interstage_dp
            namespace["speed_ratio"] = speed_ratio
            try:
                val = eval(calc_key, {"__builtins__": {}}, namespace)
                return self._to_float(val)
            except Exception:
                return None

        return None

    def resolve(
        self,
        unit_id: str,
        parameter: str,
        live_value: Optional[float],
        live_data: Optional[Dict[str, Any]] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> ResolveResult:
        now_iso = datetime.utcnow().isoformat()
        cfg = config or {}
        data = live_data or {}

        chain = self._parse_source_chain(cfg)

        for source in chain:
            if source == "MODBUS":
                value = live_value if live_value is not None else self._get_value_with_aliases(parameter, data)
                if value is None:
                    continue
                if not self._is_live_value_valid(value, cfg):
                    continue
                if self.stale_tracker.is_stale(parameter, value):
                    # Frozen dynamic values are treated as invalid for fallback progression.
                    continue
                return ResolveResult(
                    parameter=parameter,
                    value=value,
                    source=DataSource.LIVE.value,
                    quality=DataQuality.GOOD.value,
                    timestamp=now_iso,
                    detail="Live Modbus value",
                )

            if source == "CALCULATED":
                value = self._calculate_value(unit_id, parameter, data, cfg)
                if value is None:
                    continue
                return ResolveResult(
                    parameter=parameter,
                    value=value,
                    source=DataSource.CALCULATED.value,
                    quality=DataQuality.INFERRED.value,
                    timestamp=now_iso,
                    detail=str(cfg.get("calcFormula", cfg.get("calculationFormula", "derived"))),
                )

            if source == "MANUAL":
                value = self.get_manual_value(unit_id, parameter)
                if value is None:
                    value = self._to_float(cfg.get("manualValue", cfg.get("manual_value")))
                if value is None:
                    continue
                return ResolveResult(
                    parameter=parameter,
                    value=value,
                    source=DataSource.MANUAL.value,
                    quality=DataQuality.STATIC.value,
                    timestamp=now_iso,
                    detail="Manual override",
                )

            if source == "DEFAULT":
                value = self._to_float(cfg.get("default", cfg.get("defaultValue", cfg.get("nominal"))))
                if value is None:
                    continue
                return ResolveResult(
                    parameter=parameter,
                    value=value,
                    source=DataSource.DEFAULT.value,
                    quality=DataQuality.ASSUMED.value,
                    timestamp=now_iso,
                    detail="Default fallback",
                )

        return ResolveResult(
            parameter=parameter,
            value=None,
            source=DataSource.BAD.value,
            quality=DataQuality.BAD.value,
            timestamp=now_iso,
            detail="No valid source",
        )

    def resolve_all(
        self,
        unit_id: str,
        live_data: Dict[str, Any],
        parameter_configs: Optional[Dict[str, Dict[str, Any]]] = None,
        parameters: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        configs = parameter_configs or {}
        if parameters is None:
            parameters = list(configs.keys()) if configs else list((live_data or {}).keys())

            # Include runtime manual keys so operator-set values appear in resolved output.
            manual_params = list(self.manual_values.get(unit_id, {}).keys())
            for param in manual_params:
                if param not in parameters:
                    parameters.append(param)

        values: Dict[str, Any] = {}
        sources: Dict[str, str] = {}
        quality: Dict[str, str] = {}
        details: Dict[str, str] = {}

        for param in parameters:
            cfg = configs.get(param, {})
            live_val = self._get_value_with_aliases(param, live_data or {})
            result = self.resolve(
                unit_id=unit_id,
                parameter=param,
                live_value=live_val,
                live_data=live_data or {},
                config=cfg,
            )
            values[param] = result.value
            sources[param] = result.source
            quality[param] = result.quality
            details[param] = result.detail

        return {
            "timestamp": datetime.utcnow().isoformat(),
            "values": values,
            "sources": sources,
            "quality": quality,
            "details": details,
            "quality_meta": QUALITY_META,
        }


_resolver: Optional[DataResolver] = None


def get_data_resolver() -> DataResolver:
    global _resolver
    if _resolver is None:
        _resolver = DataResolver()
    return _resolver
