import uuid
from sqlalchemy import Column, String, Integer, BigInteger, Boolean, DateTime, ForeignKey, Numeric, CheckConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.db.base import Base

class Plan(Base):
    __tablename__ = "plans"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    currency = Column(String(3), nullable=False, default="MXN")
    unit_amount = Column(Numeric(12, 2), nullable=False)
    billing_interval = Column(String(10), nullable=False, default="monthly")
    tax_included = Column(Boolean, nullable=False, default=False)
    max_seats = Column(Integer)
    max_active_publications = Column(Integer)
    max_storage_bytes = Column(BigInteger)
    max_import_jobs_period = Column(Integer)
    max_import_pages_period = Column(Integer)
    is_sellable = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class TenantSubscription(Base):
    __tablename__ = "tenant_subscriptions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id"), nullable=False)
    status = Column(String(20), nullable=False, default="active")
    currency = Column(String(3), nullable=False)
    unit_amount = Column(Numeric(12, 2), nullable=False)
    billing_interval = Column(String(10), nullable=False)
    tax_included = Column(Boolean, nullable=False, default=False)
    limits_snapshot = Column(JSONB, nullable=False, default=dict)
    source = Column(String(20), nullable=False, default="superadmin")
    starts_at = Column(DateTime(timezone=True), server_default=func.now())
    ends_at = Column(DateTime(timezone=True))
    grace_ends_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class TenantUsage(Base):
    __tablename__ = "tenant_usage"
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    storage_bytes = Column(BigInteger, nullable=False, default=0)
    active_publications = Column(Integer, nullable=False, default=0)
    seats = Column(Integer, nullable=False, default=0)
    import_jobs_period = Column(Integer, nullable=False, default=0)
    import_pages_period = Column(Integer, nullable=False, default=0)
    reader_views_period = Column(BigInteger, nullable=False, default=0)
    egress_bytes_period = Column(BigInteger, nullable=False, default=0)
    period_started_at = Column(DateTime(timezone=True), server_default=func.now())
    measured_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class TenantDomain(Base):
    __tablename__ = "tenant_domains"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    hostname = Column(String(255), unique=True, nullable=False)
    kind = Column(String(20), nullable=False, default="platform_subdomain")
    is_primary = Column(Boolean, nullable=False, default=True)
    status = Column(String(20), nullable=False, default="verified")
    verification_token_hash = Column(String(255))
    verified_at = Column(DateTime(timezone=True))
    tls_status = Column(String(20), nullable=False, default="not_requested")
    last_checked_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Role(Base):
    __tablename__ = "roles"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope = Column(String(20), nullable=False)
    code = Column(String(50), nullable=False)
    name = Column(String(100), nullable=False)
    rank = Column(Integer, nullable=False, default=0)
    is_system = Column(Boolean, nullable=False, default=True)
    __table_args__ = (UniqueConstraint("scope", "code", name="uq_roles_scope_code"),)

class UserPlatformRole(Base):
    __tablename__ = "user_platform_roles"
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id = Column(UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    assigned_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class TenantMembership(Base):
    __tablename__ = "tenant_memberships"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_id = Column(UUID(as_uuid=True), ForeignKey("roles.id"), nullable=False)
    status = Column(String(20), nullable=False, default="active")
    invited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    invite_token_hash = Column(String(255))
    invite_expires_at = Column(DateTime(timezone=True))
    accepted_at = Column(DateTime(timezone=True))
    revoked_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_tenant_membership_user"),)
