"""
Enhanced Authentication Service with Database Persistence
Users are stored in PostgreSQL with bcrypt password hashing.
"""
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from passlib.context import CryptContext
from jose import jwt, JWTError
import logging
import os

logger = logging.getLogger(__name__)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT settings
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "gcs-digital-twin-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours


class AuthService:
    """Authentication service with database persistence."""
    
    def __init__(self):
        self._db = None
        self._token_blacklist: set = set()
    
    def set_database(self, db):
        """Set database session for persistence."""
        self._db = db
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using bcrypt."""
        return pwd_context.hash(password)
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash."""
        return pwd_context.verify(plain_password, hashed_password)
    
    def create_access_token(self, data: dict, expires_delta: timedelta = None) -> str:
        """Create a JWT access token."""
        to_encode = data.copy()
        expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
        to_encode.update({
            "exp": expire,
            "iat": datetime.utcnow()
        })
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt
    
    def decode_token(self, token: str) -> Optional[Dict]:
        """Decode and validate a JWT token."""
        if token in self._token_blacklist:
            return None
        
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            return payload
        except JWTError as e:
            logger.warning(f"Token decode error: {e}")
            return None
    
    def revoke_token(self, token: str):
        """Add token to blacklist (for logout)."""
        self._token_blacklist.add(token)
    
    async def authenticate_user(self, username: str, password: str) -> Optional[Dict]:
        """
        Authenticate a user against the database.
        Returns user dict on success, None on failure.
        """
        if self._db:
            # Database authentication
            from app.db import crud
            user = await crud.get_user_by_username(self._db, username)
            if user and self.verify_password(password, user.password_hash):
                # Update last login
                await crud.update_user(self._db, username, last_login=datetime.utcnow())
                return {
                    "username": user.username,
                    "role": user.role,
                    "email": user.email
                }
        else:
            # Fallback to in-memory users (for backward compatibility)
            return self._authenticate_memory(username, password)
        
        return None
    
    def _authenticate_memory(self, username: str, password: str) -> Optional[Dict]:
        """Fallback to in-memory authentication."""
        # Default users for development
        default_users = {
            "admin": {"password": "admin123", "role": "admin"},
            "engineer": {"password": "eng123", "role": "engineer"},
            "operator": {"password": "op123", "role": "operator"}
        }
        
        if username in default_users:
            user = default_users[username]
            if password == user["password"]:
                return {"username": username, "role": user["role"], "email": None}
        
        return None
    
    async def create_user(self, username: str, password: str, role: str = "operator",
                          email: str = None) -> Optional[Dict]:
        """Create a new user in the database."""
        if not self._db:
            logger.error("Database not available for user creation")
            return None
        
        from app.db import crud
        
        # Check if user exists
        existing = await crud.get_user_by_username(self._db, username)
        if existing:
            logger.warning(f"User {username} already exists")
            return None
        
        # Create user with hashed password
        password_hash = self.hash_password(password)
        user = await crud.create_user(
            self._db,
            username=username,
            password_hash=password_hash,
            role=role,
            email=email
        )
        
        return {
            "username": user.username,
            "role": user.role,
            "email": user.email
        }
    
    async def update_password(self, username: str, new_password: str) -> bool:
        """Update user's password."""
        if not self._db:
            return False
        
        from app.db import crud
        
        password_hash = self.hash_password(new_password)
        user = await crud.update_user(self._db, username, password_hash=password_hash)
        return user is not None
    
    async def get_users(self) -> List[Dict]:
        """Get all users (without sensitive data)."""
        if not self._db:
            return [
                {"username": "admin", "role": "admin"},
                {"username": "engineer", "role": "engineer"},
                {"username": "operator", "role": "operator"}
            ]
        
        from app.db import crud
        
        users = await crud.get_users(self._db)
        return [
            {
                "username": u.username,
                "role": u.role,
                "email": u.email,
                "is_active": u.is_active,
                "last_login": u.last_login.isoformat() if u.last_login else None
            }
            for u in users
        ]
    
    def check_role(self, user_role: str, required_roles: List[str]) -> bool:
        """Check if user has required role."""
        role_hierarchy = {"admin": 3, "engineer": 2, "operator": 1}
        
        user_level = role_hierarchy.get(user_role, 0)
        required_level = min(role_hierarchy.get(r, 0) for r in required_roles)
        
        return user_level >= required_level


# Singleton instance
_auth_service: Optional[AuthService] = None


def get_auth_service() -> AuthService:
    """Get or create auth service singleton."""
    global _auth_service
    if _auth_service is None:
        _auth_service = AuthService()
    return _auth_service
