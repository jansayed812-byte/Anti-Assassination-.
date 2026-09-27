-- PostGIS Extensions Setup
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS postgis_raster;

CREATE SCHEMA IF NOT EXISTS geographic;

CREATE TABLE IF NOT EXISTS geographic.locations (
    location_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255),
    description TEXT,
    location_type VARCHAR(50),
    coordinates GEOMETRY(Point, 4326) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    altitude_m FLOAT,
    accuracy_m FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_locations_geom ON geographic.locations USING GIST(coordinates);
CREATE INDEX idx_locations_type ON geographic.locations(location_type);
CREATE INDEX idx_locations_created ON geographic.locations(created_at);

CREATE TABLE IF NOT EXISTS geographic.areas (
    area_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    area_name VARCHAR(255) NOT NULL,
    area_type VARCHAR(50),
    risk_level VARCHAR(20),
    boundary GEOMETRY(Polygon, 4326) NOT NULL,
    center_point GEOMETRY(Point, 4326),
    area_sqm FLOAT GENERATED ALWAYS AS (ST_Area(boundary::geography)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_areas_geom ON geographic.areas USING GIST(boundary);
CREATE INDEX idx_areas_type ON geographic.areas(area_type);
CREATE INDEX idx_areas_risk ON geographic.areas(risk_level);

CREATE TABLE IF NOT EXISTS geographic.routes (
    route_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_name VARCHAR(255),
    description TEXT,
    route_type VARCHAR(50),
    waypoints GEOMETRY(LineString, 4326) NOT NULL,
    distance_m FLOAT GENERATED ALWAYS AS (ST_Length(waypoints::geography)) STORED,
    estimated_time_minutes INTEGER,
    risk_score FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_routes_geom ON geographic.routes USING GIST(waypoints);
CREATE INDEX idx_routes_type ON geographic.routes(route_type);

CREATE TABLE IF NOT EXISTS geographic.position_tracks (
    track_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id VARCHAR(100) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    position GEOMETRY(Point, 4326) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    altitude_m FLOAT,
    speed_mps FLOAT,
    bearing_deg FLOAT,
    accuracy_m FLOAT,
    hdop FLOAT,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_position_tracks_geom ON geographic.position_tracks USING GIST(position);
CREATE INDEX idx_position_tracks_source ON geographic.position_tracks(source_id);
CREATE INDEX idx_position_tracks_time ON geographic.position_tracks(recorded_at);

CREATE TABLE IF NOT EXISTS geographic.proximity_events (
    proximity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id VARCHAR(100),
    area_id UUID REFERENCES geographic.areas(area_id) ON DELETE CASCADE,
    event_type VARCHAR(50),
    position GEOMETRY(Point, 4326),
    distance_m FLOAT,
    event_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_proximity_source ON geographic.proximity_events(source_id);
CREATE INDEX idx_proximity_area ON geographic.proximity_events(area_id);
CREATE INDEX idx_proximity_time ON geographic.proximity_events(event_time);

CREATE OR REPLACE FUNCTION geographic.nearby_locations(
    center_lon FLOAT,
    center_lat FLOAT,
    radius_meters FLOAT
)
RETURNS TABLE(location_id UUID, name VARCHAR, distance_m FLOAT) AS $$
BEGIN
    RETURN QUERY
    SELECT
        l.location_id,
        l.name,
        ST_Distance(l.coordinates, ST_MakePoint(center_lon, center_lat)::geography)::FLOAT
    FROM geographic.locations l
    WHERE ST_DWithin(l.coordinates::geography, ST_MakePoint(center_lon, center_lat)::geography, radius_meters)
    ORDER BY distance_m ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION geographic.point_in_area(
    point_lon FLOAT,
    point_lat FLOAT,
    area_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS(
        SELECT 1 FROM geographic.areas
        WHERE areas.area_id = point_in_area.area_id
        AND ST_Contains(boundary, ST_MakePoint(point_lon, point_lat))
    );
END;
$$ LANGUAGE plpgsql;

GRANT USAGE ON SCHEMA geographic TO ops_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA geographic TO ops_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA geographic TO ops_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA geographic TO ops_user;
