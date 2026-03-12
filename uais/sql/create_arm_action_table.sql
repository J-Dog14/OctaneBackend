-- Arm Action Fact Table
-- This table stores Action Plus movement analysis data

CREATE TABLE IF NOT EXISTS public.f_arm_action (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL DEFAULT 'arm_action',
    source_athlete_id VARCHAR(100),
    filename TEXT,
    movement_type TEXT,
    foot_contact_frame INTEGER,
    release_frame INTEGER,
    age_at_collection NUMERIC,
    age_group TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Arm Action Metrics
    arm_abduction_at_footplant NUMERIC,
    max_abduction NUMERIC,
    shoulder_angle_at_footplant NUMERIC,
    max_er NUMERIC,
    arm_velo NUMERIC,
    max_torso_rot_velo NUMERIC,
    torso_angle_at_footplant NUMERIC,
    score NUMERIC
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_f_arm_action_uuid ON public.f_arm_action(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_arm_action_date ON public.f_arm_action(session_date);
CREATE INDEX IF NOT EXISTS idx_f_arm_action_movement_type ON public.f_arm_action(movement_type);

-- Add columns to d_athletes if they don't exist
DO $$
BEGIN
    -- Add has_arm_action_data column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'analytics' 
        AND table_name = 'd_athletes' 
        AND column_name = 'has_arm_action_data'
    ) THEN
        ALTER TABLE analytics.d_athletes 
        ADD COLUMN has_arm_action_data BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Add arm_action_session_count column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'analytics' 
        AND table_name = 'd_athletes' 
        AND column_name = 'arm_action_session_count'
    ) THEN
        ALTER TABLE analytics.d_athletes 
        ADD COLUMN arm_action_session_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Update the update_athlete_data_flags function to include arm action
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
        
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Update the trigger function to include arm action
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
        
        updated_at = NOW()
    WHERE a.athlete_uuid = affected_uuid;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for arm action table
DROP TRIGGER IF EXISTS trg_update_flags_arm_action ON public.f_arm_action;
CREATE TRIGGER trg_update_flags_arm_action
    AFTER INSERT OR UPDATE OR DELETE ON public.f_arm_action
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_athlete_flags();

