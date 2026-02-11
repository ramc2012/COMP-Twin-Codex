"""
InfluxDB Writer Service
Writes time-series data to InfluxDB for historical trending.
"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime

from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

from app.config import get_settings

logger = logging.getLogger(__name__)


class InfluxDBWriter:
    """
    Writes compressor data to InfluxDB for historical storage and trending.
    """
    
    def __init__(
        self,
        url: str = None,
        token: str = None,
        org: str = None,
        bucket: str = None
    ):
        settings = get_settings()
        self.url = url or settings.INFLUX_URL
        self.token = token or settings.INFLUX_TOKEN
        self.org = org or settings.INFLUX_ORG
        self.bucket = bucket or settings.INFLUX_BUCKET_RAW
        
        self.client: Optional[InfluxDBClient] = None
        self.write_api = None
        self.query_api = None
        self.connected = False
        
    def connect(self) -> bool:
        """Connect to InfluxDB."""
        try:
            self.client = InfluxDBClient(
                url=self.url,
                token=self.token,
                org=self.org
            )
            
            # Test connection
            self.client.ping()
            
            # Use synchronous writes for deterministic persistence in API/poller callbacks.
            # The prior batched mode could drop points in short-lived/background thread scenarios.
            self.write_api = self.client.write_api(write_options=SYNCHRONOUS)
            
            self.query_api = self.client.query_api()
            self.connected = True
            
            logger.info(f"Connected to InfluxDB: {self.url}")
            return True
            
        except Exception as e:
            logger.error(f"InfluxDB connection failed: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Close InfluxDB connection."""
        if self.write_api:
            self.write_api.close()
        if self.client:
            self.client.close()
        self.connected = False
        logger.info("Disconnected from InfluxDB")
    
    def write_live_data(self, unit_id: str, data: Dict[str, Any]):
        """Write live compressor data as a batch of points."""
        if not self.connected:
            return False
        
        try:
            points = []
            timestamp = datetime.utcnow()
            
            # Engine vitals
            engine_point = Point("engine_vitals") \
                .tag("unit_id", unit_id) \
                .field("rpm", float(data.get('engine_rpm', 0))) \
                .field("oil_pressure", float(data.get('engine_oil_press', data.get('engine_oil_pressure', 0)))) \
                .field("oil_temp", float(data.get('engine_oil_temp', 0))) \
                .field("jacket_water_temp", float(data.get('jacket_water_temp', 0))) \
                .field("state", int(data.get('engine_state', 0))) \
                .time(timestamp)
            points.append(engine_point)
            
            # Compressor vitals
            comp_point = Point("compressor_vitals") \
                .tag("unit_id", unit_id) \
                .field("oil_pressure", float(data.get('comp_oil_press', data.get('compressor_oil_pressure', data.get('comp_oil_pressure', 0))))) \
                .field("oil_temp", float(data.get('comp_oil_temp', data.get('compressor_oil_temp', 0)))) \
                .field("overall_ratio", float(data.get('overall_ratio', 0))) \
                .field("total_bhp", float(data.get('total_bhp', 0))) \
                .time(timestamp)
            points.append(comp_point)
            
            # Stage data
            for stage in data.get('stages', []):
                stage_num = stage.get('stage', 0)
                stage_point = Point("stage_data") \
                    .tag("unit_id", unit_id) \
                    .tag("stage", str(stage_num)) \
                    .field("suction_press", float(stage.get('suction_press', 0))) \
                    .field("discharge_press", float(stage.get('discharge_press', 0))) \
                    .field("suction_temp", float(stage.get('suction_temp', 0))) \
                    .field("discharge_temp", float(stage.get('discharge_temp', 0))) \
                    .field("ratio", float(stage.get('ratio', 0))) \
                    .field("isentropic_eff", float(stage.get('isentropic_eff', 0))) \
                    .field("volumetric_eff", float(stage.get('volumetric_eff', 0))) \
                    .time(timestamp)
                points.append(stage_point)
            
            # Exhaust temps
            exhaust_temps = data.get('exhaust_temps', {})
            if exhaust_temps:
                for key, value in exhaust_temps.items():
                    exhaust_point = Point("exhaust_temp") \
                        .tag("unit_id", unit_id) \
                        .tag("cylinder", key) \
                        .field("temperature", float(value)) \
                        .time(timestamp)
                    points.append(exhaust_point)
            
            # Bearing temps
            bearing_temps = data.get('bearing_temps', [])
            for i, temp in enumerate(bearing_temps):
                bearing_point = Point("bearing_temp") \
                    .tag("unit_id", unit_id) \
                    .tag("bearing", str(i + 1)) \
                    .field("temperature", float(temp)) \
                    .time(timestamp)
                points.append(bearing_point)
            
            # Write all points
            self.write_api.write(bucket=self.bucket, org=self.org, record=points)
            
            return True
            
        except Exception as e:
            logger.error(f"InfluxDB write error: {e}")
            return False
    
    def query_trend(
        self,
        unit_id: str,
        measurement: str,
        field: str,
        start: str = "-1h",
        stop: str = "now()",
        aggregate_window: str = "1m"
    ) -> List[Dict]:
        """
        Query historical trend data.
        
        Args:
            unit_id: Unit identifier
            measurement: InfluxDB measurement name
            field: Field to query
            start: Start time (Flux duration or timestamp)
            stop: End time (Flux duration or timestamp)
            aggregate_window: Aggregation window for downsampling
        
        Returns:
            List of data points with time and value
        """
        if not self.connected:
            return []
        
        try:
            query = f'''
            from(bucket: "{self.bucket}")
                |> range(start: {start}, stop: {stop})
                |> filter(fn: (r) => r["_measurement"] == "{measurement}")
                |> filter(fn: (r) => r["unit_id"] == "{unit_id}")
                |> filter(fn: (r) => r["_field"] == "{field}")
                |> aggregateWindow(every: {aggregate_window}, fn: mean, createEmpty: false)
                |> yield(name: "mean")
            '''
            
            tables = self.query_api.query(query, org=self.org)
            
            results = []
            for table in tables:
                for record in table.records:
                    results.append({
                        'time': record.get_time().isoformat(),
                        'value': record.get_value()
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"InfluxDB query error: {e}")
            return []
    
    def query_multi_trend(
        self,
        unit_id: str,
        measurements: List[Dict[str, str]],
        start: str = "-1h",
        aggregate_window: str = "1m"
    ) -> Dict[str, List[Dict]]:
        """
        Query multiple trends at once.
        
        Args:
            unit_id: Unit identifier
            measurements: List of {"measurement": "...", "field": "..."} dicts
            start: Start time
            aggregate_window: Aggregation window
        
        Returns:
            Dict of field_name -> list of data points
        """
        results = {}
        
        for m in measurements:
            key = f"{m['measurement']}.{m['field']}"
            results[key] = self.query_trend(
                unit_id=unit_id,
                measurement=m['measurement'],
                field=m['field'],
                start=start,
                aggregate_window=aggregate_window
            )
        
        return results


# Global singleton
_influx_writer: Optional[InfluxDBWriter] = None


def get_influx_writer() -> InfluxDBWriter:
    """Get or create the global InfluxDB writer instance."""
    global _influx_writer
    if _influx_writer is None:
        _influx_writer = InfluxDBWriter()
    return _influx_writer


async def init_influx_writer() -> Optional[InfluxDBWriter]:
    """Initialize and connect the InfluxDB writer."""
    writer = get_influx_writer()
    connected = writer.connect()
    return writer if connected else None
