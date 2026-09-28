-- PostgreSQL Initial Setup
-- سیستم ارزیابی امنیتی محیط‌های عملیاتی (Security Assessment)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "hstore";

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.audit_log (
    audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name TEXT NOT NULL,
    operation VARCHAR(8) NOT NULL,
    user_id UUID,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    row_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    session_id UUID
);

CREATE INDEX idx_audit_table ON audit.audit_log(table_name);
CREATE INDEX idx_audit_time ON audit.audit_log(changed_at);
CREATE INDEX idx_audit_user ON audit.audit_log(user_id);

CREATE SCHEMA IF NOT EXISTS security;

CREATE TABLE IF NOT EXISTS security.users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON security.users(email);
CREATE INDEX idx_users_username ON security.users(username);

CREATE TABLE IF NOT EXISTS security.roles (
    role_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    permission_level INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security.user_roles (
    user_role_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES security.users(user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES security.roles(role_id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON security.user_roles(user_id);
CREATE INDEX idx_user_roles_role ON security.user_roles(role_id);

CREATE TABLE IF NOT EXISTS security.api_keys (
    key_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES security.users(user_id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    key_name VARCHAR(100),
    last_used TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user ON security.api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON security.api_keys(key_hash);

CREATE SCHEMA IF NOT EXISTS operational;

CREATE TABLE IF NOT EXISTS operational.events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id VARCHAR(100) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sequence BIGINT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    quality JSONB,
    payload JSONB NOT NULL,
    integrity JSONB,
    processing_status VARCHAR(50) DEFAULT 'pending',
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_source ON operational.events(source_id, source_type);
CREATE INDEX idx_events_time ON operational.events(received_at);
CREATE INDEX idx_events_type ON operational.events(event_type);
CREATE INDEX idx_events_status ON operational.events(processing_status);

CREATE TABLE IF NOT EXISTS operational.environmental_data (
    env_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES operational.events(event_id) ON DELETE CASCADE,
    temperature_c FLOAT,
    humidity_percent FLOAT,
    wind_speed_mps FLOAT,
    visibility_m FLOAT,
    precipitation_mm FLOAT,
    atmospheric_pressure_hpa FLOAT,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_env_event ON operational.environmental_data(event_id);
CREATE INDEX idx_env_time ON operational.environmental_data(recorded_at);

GRANT CONNECT ON DATABASE ops_database TO ops_user;
GRANT USAGE ON SCHEMA operational, security, audit TO ops_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA operational, security, audit TO ops_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA operational, security, audit TO ops_user;
