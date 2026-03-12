-- Add missing angle/accel columns to f_curveball_test table
-- This script adds all the columns that should exist but were missing from the Prisma migration

DO $$
DECLARE
    off INTEGER;
    lbl TEXT;
    col_name TEXT;
    cols_to_add TEXT[];
BEGIN
    -- Generate all column names for offsets -20 to 30
    FOR off IN -20..30 LOOP
        IF off < 0 THEN
            lbl := 'neg' || abs(off);
        ELSE
            lbl := 'pos' || off;
        END IF;
        
        -- Add all 6 columns for this offset (x, y, z, ax, ay, az)
        cols_to_add := array_append(cols_to_add, 'x_' || lbl);
        cols_to_add := array_append(cols_to_add, 'y_' || lbl);
        cols_to_add := array_append(cols_to_add, 'z_' || lbl);
        cols_to_add := array_append(cols_to_add, 'ax_' || lbl);
        cols_to_add := array_append(cols_to_add, 'ay_' || lbl);
        cols_to_add := array_append(cols_to_add, 'az_' || lbl);
    END LOOP;
    
    -- Add each column if it doesn't exist
    FOREACH col_name IN ARRAY cols_to_add
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'f_curveball_test' 
            AND column_name = col_name
        ) THEN
            EXECUTE format('ALTER TABLE public.f_curveball_test ADD COLUMN %I NUMERIC', col_name);
            RAISE NOTICE 'Added column: %', col_name;
        ELSE
            RAISE NOTICE 'Column already exists: %', col_name;
        END IF;
    END LOOP;
END $$;

-- Verify the columns were added
SELECT 
    COUNT(*) as total_columns,
    COUNT(*) FILTER (WHERE column_name LIKE 'x_%' OR column_name LIKE 'y_%' OR column_name LIKE 'z_%' 
                     OR column_name LIKE 'ax_%' OR column_name LIKE 'ay_%' OR column_name LIKE 'az_%') as angle_columns
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'f_curveball_test';

