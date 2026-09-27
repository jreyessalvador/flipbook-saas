from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
import uuid

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(UserBase):
    id: uuid.UUID
    role: str
    is_active: bool
    is_superadmin: bool = False
    created_at: datetime
    tenant_id: Optional[uuid.UUID] = None
    tenant_name: Optional[str] = None
    acting_as_tenant: bool = False
    tenant_role: Optional[str] = None
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    email: Optional[str] = None
