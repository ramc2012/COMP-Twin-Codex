"""
Seed Users Script
Creates default users if they don't exist.
"""
import asyncio
import logging
import asyncio
import logging
import bcrypt
from app.db.database import async_session_factory
from app.db import crud

# Setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def seed_users():
    async with async_session_factory() as db:
        users = [
            {"username": "admin", "password": "admin123", "role": "admin"},
            {"username": "engineer", "password": "eng123", "role": "engineer"},
            {"username": "operator", "password": "op123", "role": "operator"}
        ]
        
        print("Seeding users...")
        for u in users:
            # Check if user exists
            existing = await crud.get_user_by_username(db, u["username"])
            if existing:
                print(f"User {u['username']} already exists - updating password")
                # Update password for existing users to ensure new hash format
                password_hash = bcrypt.hashpw(u["password"].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                await crud.update_user(db, u["username"], password_hash=password_hash)
                print(f"Updated password for user: {u['username']}")
                continue
                
            password_hash = bcrypt.hashpw(u["password"].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            try:
                await crud.create_user(db, u["username"], password_hash, u["role"])
                print(f"Created user: {u['username']}")
            except Exception as e:
                print(f"Failed to create user {u['username']}: {e}")
                
        print("User seeding complete.")

if __name__ == "__main__":
    asyncio.run(seed_users())
