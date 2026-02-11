"""
Redis Cache Service
Caches live Modbus data and provides pub/sub for real-time updates.
"""

import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import redis.asyncio as redis

from app.config import get_settings

logger = logging.getLogger(__name__)


class RedisCache:
    """
    Redis-based caching layer for live compressor data.
    Provides fast access to current values and pub/sub for real-time updates.
    """
    
    def __init__(self, redis_url: str = None):
        settings = get_settings()
        self.redis_url = redis_url or settings.REDIS_URL
        self.client: Optional[redis.Redis] = None
        self.pubsub = None
        
        # Key prefixes
        self.LIVE_DATA_KEY = "gcs:live:{unit_id}"
        self.REGISTER_KEY = "gcs:reg:{unit_id}:{address}"
        self.STATUS_KEY = "gcs:status:{unit_id}"
        self.CHANNEL_KEY = "gcs:updates:{unit_id}"
        
        # TTL for cached values (seconds)
        self.DATA_TTL = 30
        
    async def connect(self) -> bool:
        """Connect to Redis server."""
        try:
            self.client = redis.from_url(self.redis_url, decode_responses=True)
            await self.client.ping()
            logger.info(f"Connected to Redis: {self.redis_url}")
            return True
        except Exception as e:
            logger.error(f"Redis connection failed: {e}")
            self.client = None
            return False
    
    async def disconnect(self):
        """Close Redis connection."""
        if self.client:
            await self.client.close()
            logger.info("Disconnected from Redis")
    
    async def set_live_data(self, unit_id: str, data: Dict[str, Any]):
        """Store complete live data snapshot for a unit."""
        if not self.client:
            return False
        
        try:
            key = self.LIVE_DATA_KEY.format(unit_id=unit_id)
            data['cached_at'] = datetime.now().isoformat()
            await self.client.set(key, json.dumps(data), ex=self.DATA_TTL)
            
            # Publish update notification
            channel = self.CHANNEL_KEY.format(unit_id=unit_id)
            await self.client.publish(channel, json.dumps({
                "type": "live_update",
                "unit_id": unit_id,
                "timestamp": data['cached_at']
            }))
            
            return True
        except Exception as e:
            logger.error(f"Redis set error: {e}")
            return False
    
    async def get_live_data(self, unit_id: str) -> Optional[Dict[str, Any]]:
        """Get cached live data for a unit."""
        if not self.client:
            return None
        
        try:
            key = self.LIVE_DATA_KEY.format(unit_id=unit_id)
            data = await self.client.get(key)
            if data:
                return json.loads(data)
            return None
        except Exception as e:
            logger.error(f"Redis get error: {e}")
            return None
    
    async def set_register(self, unit_id: str, address: int, value: float, quality: str = "LIVE"):
        """Store individual register value."""
        if not self.client:
            return False
        
        try:
            key = self.REGISTER_KEY.format(unit_id=unit_id, address=address)
            data = {
                "value": value,
                "quality": quality,
                "timestamp": datetime.now().isoformat()
            }
            await self.client.set(key, json.dumps(data), ex=self.DATA_TTL)
            return True
        except Exception as e:
            logger.error(f"Redis set register error: {e}")
            return False
    
    async def get_register(self, unit_id: str, address: int) -> Optional[Dict[str, Any]]:
        """Get individual register value."""
        if not self.client:
            return None
        
        try:
            key = self.REGISTER_KEY.format(unit_id=unit_id, address=address)
            data = await self.client.get(key)
            if data:
                return json.loads(data)
            return None
        except Exception as e:
            logger.error(f"Redis get register error: {e}")
            return None
    
    async def set_registers_bulk(self, unit_id: str, registers: Dict[int, float], quality: str = "LIVE"):
        """Store multiple register values efficiently using pipeline."""
        if not self.client:
            return False
        
        try:
            pipe = self.client.pipeline()
            timestamp = datetime.now().isoformat()
            
            for address, value in registers.items():
                key = self.REGISTER_KEY.format(unit_id=unit_id, address=address)
                data = json.dumps({
                    "value": value,
                    "quality": quality,
                    "timestamp": timestamp
                })
                pipe.set(key, data, ex=self.DATA_TTL)
            
            await pipe.execute()
            return True
        except Exception as e:
            logger.error(f"Redis bulk set error: {e}")
            return False
    
    async def set_unit_status(self, unit_id: str, status: Dict[str, Any]):
        """Store unit connection/polling status."""
        if not self.client:
            return False
        
        try:
            key = self.STATUS_KEY.format(unit_id=unit_id)
            status['updated_at'] = datetime.now().isoformat()
            await self.client.set(key, json.dumps(status), ex=60)
            return True
        except Exception as e:
            logger.error(f"Redis status set error: {e}")
            return False
    
    async def get_unit_status(self, unit_id: str) -> Optional[Dict[str, Any]]:
        """Get unit connection/polling status."""
        if not self.client:
            return None
        
        try:
            key = self.STATUS_KEY.format(unit_id=unit_id)
            data = await self.client.get(key)
            if data:
                return json.loads(data)
            return None
        except Exception as e:
            logger.error(f"Redis status get error: {e}")
            return None
    
    async def subscribe_to_updates(self, unit_id: str):
        """Subscribe to real-time updates for a unit."""
        if not self.client:
            return None
        
        try:
            self.pubsub = self.client.pubsub()
            channel = self.CHANNEL_KEY.format(unit_id=unit_id)
            await self.pubsub.subscribe(channel)
            logger.info(f"Subscribed to updates for {unit_id}")
            return self.pubsub
        except Exception as e:
            logger.error(f"Redis subscribe error: {e}")
            return None
    
    async def listen_for_updates(self):
        """Listen for pub/sub messages."""
        if not self.pubsub:
            return
        
        async for message in self.pubsub.listen():
            if message['type'] == 'message':
                yield json.loads(message['data'])


# Global singleton
_redis_cache: Optional[RedisCache] = None


def get_redis_cache() -> RedisCache:
    """Get or create the global Redis cache instance."""
    global _redis_cache
    if _redis_cache is None:
        _redis_cache = RedisCache()
    return _redis_cache


async def init_redis_cache() -> Optional[RedisCache]:
    """Initialize and connect the Redis cache."""
    cache = get_redis_cache()
    connected = await cache.connect()
    return cache if connected else None
