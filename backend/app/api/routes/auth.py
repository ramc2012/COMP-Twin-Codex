"""
Authentication API Routes V3
Login, token refresh, and user management endpoints with DB integration.
"""

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.services.auth_service import get_auth_service
from app.db.database import get_db

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# Schemas
class Token(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user: dict


class UserCreate(BaseModel):
    username: str
    password: str
    role: str
    full_name: str
    email: str


class UserResponse(BaseModel):
    username: str
    role: str
    full_name: str = "Unknown" 
    email: str = ""


# Dependencies
async def get_current_user(
    token: str = Depends(oauth2_scheme), 
    db: AsyncSession = Depends(get_db)
):
    """Dependency to get current authenticated user."""
    auth = get_auth_service()
    user = await auth.get_current_user(db, token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Convert SQLAlchemy model to dict-like for compatibility with existing code
    # Or return model directly if downstream supports it. 
    # Current code expects a dict/model that can be accessed via .role or ["role"]
    # The AuthService.check_permission logic handles both.
    return {
        "username": user.username,
        "role": user.role,
        "full_name": "Unknown",  # Model missing this field currently
        "email": user.email if user.email else ""
    }


async def require_admin(current_user: dict = Depends(get_current_user)):
    """Dependency to require admin role."""
    auth = get_auth_service()
    if not auth.check_permission(current_user, "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user


async def require_engineer(current_user: dict = Depends(get_current_user)):
    """Dependency to require engineer or higher role."""
    auth = get_auth_service()
    if not auth.check_permission(current_user, "engineer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Engineer access required"
        )
    return current_user


# Routes
@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """
    Authenticate user and return JWT token.
    """
    auth = get_auth_service()
    user = await auth.authenticate_user(db, form_data.username, form_data.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token = auth.create_access_token(
        data={"sub": user.username, "role": user.role}
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": 60 * 60,  # 1 hour
        "user": {
            "username": user.username,
            "role": user.role,
            "full_name": "Unknown",
            "email": user.email
        }
    }


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user information."""
    return current_user


@router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new user (admin only)."""
    auth = get_auth_service()
    
    try:
        new_user = await auth.create_user(
            db,
            username=user_data.username,
            password=user_data.password,
            role=user_data.role,
            full_name=user_data.full_name,
            email=user_data.email
        )
        return {
            "username": new_user.username,
            "role": new_user.role,
            "full_name": getattr(new_user, "full_name", user_data.full_name), # Fallback since model might lack it
            "email": new_user.email
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """List all users (admin only)."""
    auth = get_auth_service()
    users = await auth.list_users(db)
    
    return [
        {
            "username": u.username,
            "role": u.role,
            "full_name": "Unknown", # Model gap
            "email": u.email if u.email else ""
        }
        for u in users
    ]


@router.delete("/users/{username}")
async def delete_user_endpoint(
    username: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete a user (admin only)."""
    # Prevent deleting self
    if username == current_user["username"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
        
    auth = get_auth_service()
    # auth.delete_user calls crud.delete_user
    success = await auth.delete_user(db, username)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return {"message": f"User {username} deleted successfully"}
