-- Additional schemas for operational data
CREATE SCHEMA IF NOT EXISTS analysis;

CREATE TABLE IF NOT EXISTS analysis.risk_assessments (
    assessment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_type VARCHAR(100),
    severity INT,
    likelihood INT,
    exposure INT,
    data_confidence FLOAT,
    risk_score FLOAT GENERATED ALWAYS AS (severity * likelihood * exposure * data_confidence) STORED,
    risk_level VARCHAR(20),
    evidence JSONB,
    human_validation BOOLEAN DEFAULT FALSE,
    validated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_risk_score ON analysis.risk_assessments(risk_score);
CREATE INDEX idx_risk_level ON analysis.risk_assessments(risk_level);
CREATE INDEX idx_risk_type ON analysis.risk_assessments(assessment_type);

CREATE TABLE IF NOT EXISTS analysis.incidents (
    incident_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_type VARCHAR(100),
    severity VARCHAR(20),
    detected_at TIMESTAMP WITH TIME ZONE,
    location_id UUID,
    coordinates GEOMETRY(Point, 4326),
    description TEXT,
    status VARCHAR(50),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_incident_severity ON analysis.incidents(severity);
CREATE INDEX idx_incident_status ON analysis.incidents(status);

GRANT USAGE ON SCHEMA analysis TO ops_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA analysis TO ops_user;
