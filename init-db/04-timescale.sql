-- TimescaleDB Setup for Time-Series Data
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE SCHEMA IF NOT EXISTS timeseries;

CREATE TABLE IF NOT EXISTS timeseries.telemetry (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    metric_type VARCHAR(100) NOT NULL,
    metric_value FLOAT,
    metric_unit VARCHAR(50),
    metadata JSONB
) PARTITION BY RANGE (time);

SELECT create_hypertable('timeseries.telemetry', 'time', if_not_exists => TRUE);

CREATE INDEX idx_telemetry_source ON timeseries.telemetry (source_id, time DESC);
CREATE INDEX idx_telemetry_metric ON timeseries.telemetry (metric_type, time DESC);

ALTER TABLE timeseries.telemetry SET (
    timescaledb.compress,
    timescaledb.compress_interval = '7 days'
);

CREATE MATERIALIZED VIEW IF NOT EXISTS timeseries.telemetry_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) as bucket,
    source_id,
    metric_type,
    AVG(metric_value) as avg_value,
    MIN(metric_value) as min_value,
    MAX(metric_value) as max_value,
    COUNT(*) as count
FROM timeseries.telemetry
GROUP BY bucket, source_id, metric_type
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS timeseries.telemetry_1hour
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) as bucket,
    source_id,
    metric_type,
    AVG(metric_value) as avg_value,
    MIN(metric_value) as min_value,
    MAX(metric_value) as max_value,
    COUNT(*) as count
FROM timeseries.telemetry
GROUP BY bucket, source_id, metric_type
WITH DATA;

CREATE TABLE IF NOT EXISTS timeseries.position_history (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    altitude_m FLOAT,
    speed_mps FLOAT,
    bearing_deg FLOAT,
    accuracy_m FLOAT
) PARTITION BY RANGE (time);

SELECT create_hypertable('timeseries.position_history', 'time', if_not_exists => TRUE);

CREATE INDEX idx_position_history_source ON timeseries.position_history (source_id, time DESC);

CREATE TABLE IF NOT EXISTS timeseries.alerts (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    alert_id UUID DEFAULT uuid_generate_v4(),
    source_id VARCHAR(100),
    alert_type VARCHAR(100),
    severity VARCHAR(20),
    message TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE
) PARTITION BY RANGE (time);

SELECT create_hypertable('timeseries.alerts', 'time', if_not_exists => TRUE);

CREATE INDEX idx_alerts_severity ON timeseries.alerts (severity, time DESC);

GRANT USAGE ON SCHEMA timeseries TO ts_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA timeseries TO ts_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA timeseries TO ts_user;
