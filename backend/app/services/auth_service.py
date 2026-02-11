"""
Authentication Service V3
JWT-based authentication with Database Persistence.
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import bcrypt
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import crud, models

logger = logging.getLogger(__name__)


class AuthService:
    """
    Handles user authentication and JWT token management using Database.
    """
    
    def __init__(self):
        settings = get_settings()
        self.secret_key = settings.JWT_SECRET
        self.algorithm = settings.JWT_ALGORITHM
        self.access_token_expire_minutes = settings.JWT_EXPIRE_MINUTES
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a plain password against a hash using bcrypt directly."""
        try:
            # checkpw expects bytes
            return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
        except Exception as e:
            logger.error(f"Password verification error: {e}")
            return False
    
    def hash_password(self, password: str) -> str:
        """Hash a password using bcrypt directly."""
        # hashpw returns bytes, we store as string
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        return hashed.decode('utf-8')
    
    async def authenticate_user(self, db: AsyncSession, username: str, password: str) -> Optional[models.User]:
        """
        Authenticate a user with username and password against the database.
        """
        user = await crud.get_user_by_username(db, username)
        if not user:
            return None
        
        if not self.verify_password(password, user.password_hash):
            return None
            
        return user
    
    def create_access_token(self, data: Dict, expires_delta: timedelta = None) -> str:
        """Create a JWT access token."""
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=self.access_token_expire_minutes)
        
        to_encode.update({"exp": expire})
        
        encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
        return encoded_jwt
    
    async def get_current_user(self, db: AsyncSession, token: str) -> Optional[models.User]:
        """Get the current user from a token, verifying against DB."""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            username: str = payload.get("sub")
            if not username:
                return None
        except JWTError:
            return None
        
        user = await crud.get_user_by_username(db, username)
        return user
    
    def check_permission(self, user: models.User, required_role: str) -> bool:
        """Check if user has required role permissions."""
        role_hierarchy = {
            "admin": 3,
            "engineer": 2,
            "operator": 1
        }
        
        # Handle dict or Model object
        user_role = user.role if hasattr(user, 'role') else user.get('role')
        
        user_level = role_hierarchy.get(user_role, 0)
        required_level = role_hierarchy.get(required_role, 0)
        
        return user_level >= required_level
    
    async def create_user(self, db: AsyncSession, username: str, password: str, role: str, full_name: str, email: str) -> models.User:
        """Create a new user."""
        existing = await crud.get_user_by_username(db, username)
        if existing:
            raise ValueError(f"User {username} already exists")
        
        password_hash = self.hash_password(password)
        # Using specific crud for create user
        # crud.create_user signature: db, username, password_hash, role, **kwargs
        return await crud.create_user(
            db, 
            username=username, 
            password_hash=password_hash, 
            role=role, 
            # Passing extra fields as kwargs if model supports them, 
            # but currently User model doesn't store full_name/email except email.
            # Start lines of User model: username, email, password_hash, role...
            # User model does NOT have full_name based on previous view.
            # Let's check crud.create_user again or model.
            email=email
        )

    async def delete_user(self, db: AsyncSession, username: str) -> bool:
        """Delete a user."""
        return await crud.delete_user(db, username)

    async def list_users(self, db: AsyncSession):
        """List all users."""
        return await crud.get_users(db)


# Global singleton
_auth_service: Optional[AuthService] = None


def get_auth_service() -> AuthService:
    """Get or create the global auth service instance."""
    global _auth_service
    if _auth_service is None:
        _auth_service = AuthService()
    return _auth_service
