-- Curveball Test Fact Table
-- This table stores curveball/pitch design analysis data
-- Structure matches the original pitch_data table with all individual columns

-- Drop existing table if it exists (to recreate with proper structure)
DROP TABLE IF EXISTS public.f_curveball_test CASCADE;

-- Generate all angle/accel column definitions
DO $$
DECLARE
    angle_cols TEXT := '';
    off INTEGER;
    lbl TEXT;
BEGIN
    FOR off IN -20..30 LOOP
        IF off < 0 THEN
            lbl := 'neg' || abs(off);
        ELSE
            lbl := 'pos' || off;
        END IF;
        
        angle_cols := angle_cols || 
            'x_' || lbl || ' NUMERIC, ' ||
            'y_' || lbl || ' NUMERIC, ' ||
            'z_' || lbl || ' NUMERIC, ' ||
            'ax_' || lbl || ' NUMERIC, ' ||
            'ay_' || lbl || ' NUMERIC, ' ||
            'az_' || lbl || ' NUMERIC, ';
    END LOOP;
    
    -- Remove trailing comma and space
    angle_cols := rtrim(angle_cols, ', ');
    
    -- Create table with all columns
    EXECUTE format('
        CREATE TABLE public.f_curveball_test (
            id SERIAL PRIMARY KEY,
            athlete_uuid VARCHAR(36) NOT NULL,
            session_date DATE NOT NULL,
            source_system VARCHAR(50) NOT NULL DEFAULT ''curveball_test'',
            source_athlete_id VARCHAR(100),
            filename TEXT,
            pitch_type TEXT,
            foot_contact_frame INTEGER,
            release_frame INTEGER,
            pitch_stability_score NUMERIC,
            age_at_collection NUMERIC,
            age_group TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            %s
        )', angle_cols);
END $$;

-- Foreign key constraint to d_athletes
ALTER TABLE public.f_curveball_test
    ADD CONSTRAINT fk_curveball_test_athlete
    FOREIGN KEY (athlete_uuid) 
    REFERENCES analytics.d_athletes(athlete_uuid) 
    ON DELETE CASCADE;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_f_curveball_test_uuid ON public.f_curveball_test(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_curveball_test_date ON public.f_curveball_test(session_date);
CREATE INDEX IF NOT EXISTS idx_f_curveball_test_pitch_type ON public.f_curveball_test(pitch_type);

-- Add columns to d_athletes if they don't exist
DO $$
BEGIN
    -- Add has_curveball_test_data column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'analytics' 
        AND table_name = 'd_athletes' 
        AND column_name = 'has_curveball_test_data'
    ) THEN
        ALTER TABLE analytics.d_athletes 
        ADD COLUMN has_curveball_test_data BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Add curveball_test_session_count column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'analytics' 
        AND table_name = 'd_athletes' 
        AND column_name = 'curveball_test_session_count'
    ) THEN
        ALTER TABLE analytics.d_athletes 
        ADD COLUMN curveball_test_session_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Update the update_athlete_data_flags function to include curveball test
CREATE OR REPLACE FUNCTION update_athlete_data_flags()
RETURNS void AS $$
BEGIN
    -- Update flags and counts for all athletes
    UPDATE analytics.d_athletes a
    SET
        -- Pitching data
        has_pitching_data = EXISTS (
            SELECT 1 FROM public.f_kinematics_pitching p 
            WHERE p.athlete_uuid = a.athlete_uuid
        ),
        pitching_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_kinematics_pitching p 
            WHERE p.athlete_uuid = a.athlete_uuid
        ),
        
        -- Athletic Screen data
        has_athletic_screen_data = EXISTS (
            SELECT 1 FROM public.f_athletic_screen s 
            WHERE s.athlete_uuid = a.athlete_uuid
        ),
        athletic_screen_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_athletic_screen s 
            WHERE s.athlete_uuid = a.athlete_uuid
        ),
        
        -- Pro-Sup data
        has_pro_sup_data = EXISTS (
            SELECT 1 FROM public.f_pro_sup ps 
            WHERE ps.athlete_uuid = a.athlete_uuid
        ),
        pro_sup_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_pro_sup ps 
            WHERE ps.athlete_uuid = a.athlete_uuid
        ),
        
        -- Readiness Screen data
        has_readiness_screen_data = EXISTS (
            SELECT 1 FROM public.f_readiness_screen rs 
            WHERE rs.athlete_uuid = a.athlete_uuid
        ),
        readiness_screen_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_readiness_screen rs 
            WHERE rs.athlete_uuid = a.athlete_uuid
        ),
        
        -- Mobility data
        has_mobility_data = EXISTS (
            SELECT 1 FROM public.f_mobility m 
            WHERE m.athlete_uuid = a.athlete_uuid
        ),
        mobility_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_mobility m 
            WHERE m.athlete_uuid = a.athlete_uuid
        ),
        
        -- Proteus data
        has_proteus_data = EXISTS (
            SELECT 1 FROM public.f_proteus pr 
            WHERE pr.athlete_uuid = a.athlete_uuid
        ),
        proteus_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_proteus pr 
            WHERE pr.athlete_uuid = a.athlete_uuid
        ),
        
        -- Hitting data
        has_hitting_data = EXISTS (
            SELECT 1 FROM public.f_kinematics_hitting h 
            WHERE h.athlete_uuid = a.athlete_uuid
        ),
        hitting_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_kinematics_hitting h 
            WHERE h.athlete_uuid = a.athlete_uuid
        ),
        
        -- Arm Action data
        has_arm_action_data = EXISTS (
            SELECT 1 FROM public.f_arm_action aa 
            WHERE aa.athlete_uuid = a.athlete_uuid
        ),
        arm_action_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_arm_action aa 
            WHERE aa.athlete_uuid = a.athlete_uuid
        ),
        
        -- Curveball Test data
        has_curveball_test_data = EXISTS (
            SELECT 1 FROM public.f_curveball_test ct 
            WHERE ct.athlete_uuid = a.athlete_uuid
        ),
        curveball_test_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_curveball_test ct 
            WHERE ct.athlete_uuid = a.athlete_uuid
        ),
        
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Update the trigger function to include curveball test
CREATE OR REPLACE FUNCTION trigger_update_athlete_flags()
RETURNS TRIGGER AS $$
DECLARE
    affected_uuid VARCHAR(36);
BEGIN
    -- Get the athlete UUID from the changed row
    affected_uuid := COALESCE(NEW.athlete_uuid, OLD.athlete_uuid);
    
    -- Update flags for only the affected athlete
    UPDATE analytics.d_athletes a
    SET
        -- Pitching data
        has_pitching_data = EXISTS (
            SELECT 1 FROM public.f_kinematics_pitching p 
            WHERE p.athlete_uuid = a.athlete_uuid
        ),
        pitching_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_kinematics_pitching p 
            WHERE p.athlete_uuid = a.athlete_uuid
        ),
        
        -- Athletic Screen data
        has_athletic_screen_data = EXISTS (
            SELECT 1 FROM public.f_athletic_screen s 
            WHERE s.athlete_uuid = a.athlete_uuid
        ),
        athletic_screen_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_athletic_screen s 
            WHERE s.athlete_uuid = a.athlete_uuid
        ),
        
        -- Pro-Sup data
        has_pro_sup_data = EXISTS (
            SELECT 1 FROM public.f_pro_sup ps 
            WHERE ps.athlete_uuid = a.athlete_uuid
        ),
        pro_sup_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_pro_sup ps 
            WHERE ps.athlete_uuid = a.athlete_uuid
        ),
        
        -- Readiness Screen data
        has_readiness_screen_data = EXISTS (
            SELECT 1 FROM public.f_readiness_screen rs 
            WHERE rs.athlete_uuid = a.athlete_uuid
        ),
        readiness_screen_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_readiness_screen rs 
            WHERE rs.athlete_uuid = a.athlete_uuid
        ),
        
        -- Mobility data
        has_mobility_data = EXISTS (
            SELECT 1 FROM public.f_mobility m 
            WHERE m.athlete_uuid = a.athlete_uuid
        ),
        mobility_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_mobility m 
            WHERE m.athlete_uuid = a.athlete_uuid
        ),
        
        -- Proteus data
        has_proteus_data = EXISTS (
            SELECT 1 FROM public.f_proteus pr 
            WHERE pr.athlete_uuid = a.athlete_uuid
        ),
        proteus_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_proteus pr 
            WHERE pr.athlete_uuid = a.athlete_uuid
        ),
        
        -- Hitting data
        has_hitting_data = EXISTS (
            SELECT 1 FROM public.f_kinematics_hitting h 
            WHERE h.athlete_uuid = a.athlete_uuid
        ),
        hitting_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_kinematics_hitting h 
            WHERE h.athlete_uuid = a.athlete_uuid
        ),
        
        -- Arm Action data
        has_arm_action_data = EXISTS (
            SELECT 1 FROM public.f_arm_action aa 
            WHERE aa.athlete_uuid = a.athlete_uuid
        ),
        arm_action_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_arm_action aa 
            WHERE aa.athlete_uuid = a.athlete_uuid
        ),
        
        -- Curveball Test data
        has_curveball_test_data = EXISTS (
            SELECT 1 FROM public.f_curveball_test ct 
            WHERE ct.athlete_uuid = a.athlete_uuid
        ),
        curveball_test_session_count = (
            SELECT COUNT(DISTINCT session_date) 
            FROM public.f_curveball_test ct 
            WHERE ct.athlete_uuid = a.athlete_uuid
        ),
        
        updated_at = NOW()
    WHERE a.athlete_uuid = affected_uuid;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for curveball test table
DROP TRIGGER IF EXISTS trg_update_flags_curveball_test ON public.f_curveball_test;
CREATE TRIGGER trg_update_flags_curveball_test
    AFTER INSERT OR UPDATE OR DELETE ON public.f_curveball_test
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_athlete_flags();
