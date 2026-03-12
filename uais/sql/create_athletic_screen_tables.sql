-- Create Athletic Screen tables with all required columns
-- This script creates the tables if they don't exist, or adds missing columns if they do

-- Main Athletic Screen table (summary table for athlete flags)
CREATE TABLE IF NOT EXISTS "public"."f_athletic_screen" (
    "id" SERIAL NOT NULL,
    "athlete_uuid" VARCHAR(36) NOT NULL,
    "session_date" DATE NOT NULL,
    "source_system" VARCHAR(50) NOT NULL DEFAULT 'athletic_screen',
    "source_athlete_id" VARCHAR(100),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "f_athletic_screen_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_uuid" ON "public"."f_athletic_screen"("athlete_uuid");
CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_date" ON "public"."f_athletic_screen"("session_date");

-- CMJ Table
CREATE TABLE IF NOT EXISTS "public"."f_athletic_screen_cmj" (
    "id" SERIAL NOT NULL,
    "athlete_uuid" VARCHAR(36) NOT NULL,
    "session_date" DATE NOT NULL,
    "source_system" VARCHAR(50) NOT NULL DEFAULT 'athletic_screen',
    "source_athlete_id" VARCHAR(100),
    "trial_name" TEXT,
    "age_at_collection" DECIMAL,
    "age_group" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jh_in" DECIMAL,
    "peak_power" DECIMAL,
    "pp_forceplate" DECIMAL,
    "force_at_pp" DECIMAL,
    "vel_at_pp" DECIMAL,
    "pp_w_per_kg" DECIMAL,
    "peak_power_w" DECIMAL,
    "time_to_peak_s" DECIMAL,
    "rpd_max_w_per_s" DECIMAL,
    "time_to_rpd_max_s" DECIMAL,
    "rise_time_10_90_s" DECIMAL,
    "fwhm_s" DECIMAL,
    "auc_j" DECIMAL,
    "work_early_pct" DECIMAL,
    "decay_90_10_s" DECIMAL,
    "t_com_norm_0to1" DECIMAL,
    "skewness" DECIMAL,
    "kurtosis" DECIMAL,
    "spectral_centroid_hz" DECIMAL,
    "demographic" TEXT,
    CONSTRAINT "f_athletic_screen_cmj_pkey" PRIMARY KEY ("id")
);

-- Add missing columns if table exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_cmj' AND column_name = 'age_at_collection') THEN
        ALTER TABLE "public"."f_athletic_screen_cmj" ADD COLUMN "age_at_collection" DECIMAL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_cmj' AND column_name = 'age_group') THEN
        ALTER TABLE "public"."f_athletic_screen_cmj" ADD COLUMN "age_group" TEXT;
    END IF;
END $$;

-- DJ Table
CREATE TABLE IF NOT EXISTS "public"."f_athletic_screen_dj" (
    "id" SERIAL NOT NULL,
    "athlete_uuid" VARCHAR(36) NOT NULL,
    "session_date" DATE NOT NULL,
    "source_system" VARCHAR(50) NOT NULL DEFAULT 'athletic_screen',
    "source_athlete_id" VARCHAR(100),
    "trial_name" TEXT,
    "age_at_collection" DECIMAL,
    "age_group" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jh_in" DECIMAL,
    "peak_power" DECIMAL,
    "pp_forceplate" DECIMAL,
    "force_at_pp" DECIMAL,
    "vel_at_pp" DECIMAL,
    "pp_w_per_kg" DECIMAL,
    "ct" DECIMAL,
    "rsi" DECIMAL,
    "peak_power_w" DECIMAL,
    "time_to_peak_s" DECIMAL,
    "rpd_max_w_per_s" DECIMAL,
    "time_to_rpd_max_s" DECIMAL,
    "rise_time_10_90_s" DECIMAL,
    "fwhm_s" DECIMAL,
    "auc_j" DECIMAL,
    "work_early_pct" DECIMAL,
    "decay_90_10_s" DECIMAL,
    "t_com_norm_0to1" DECIMAL,
    "skewness" DECIMAL,
    "kurtosis" DECIMAL,
    "spectral_centroid_hz" DECIMAL,
    "demographic" TEXT,
    CONSTRAINT "f_athletic_screen_dj_pkey" PRIMARY KEY ("id")
);

-- Add missing columns if table exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_dj' AND column_name = 'age_at_collection') THEN
        ALTER TABLE "public"."f_athletic_screen_dj" ADD COLUMN "age_at_collection" DECIMAL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_dj' AND column_name = 'age_group') THEN
        ALTER TABLE "public"."f_athletic_screen_dj" ADD COLUMN "age_group" TEXT;
    END IF;
END $$;

-- SLV Table
CREATE TABLE IF NOT EXISTS "public"."f_athletic_screen_slv" (
    "id" SERIAL NOT NULL,
    "athlete_uuid" VARCHAR(36) NOT NULL,
    "session_date" DATE NOT NULL,
    "source_system" VARCHAR(50) NOT NULL DEFAULT 'athletic_screen',
    "source_athlete_id" VARCHAR(100),
    "trial_name" TEXT,
    "side" TEXT,
    "age_at_collection" DECIMAL,
    "age_group" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jh_in" DECIMAL,
    "pp_forceplate" DECIMAL,
    "force_at_pp" DECIMAL,
    "vel_at_pp" DECIMAL,
    "pp_w_per_kg" DECIMAL,
    "peak_power_w" DECIMAL,
    "time_to_peak_s" DECIMAL,
    "rpd_max_w_per_s" DECIMAL,
    "time_to_rpd_max_s" DECIMAL,
    "rise_time_10_90_s" DECIMAL,
    "fwhm_s" DECIMAL,
    "auc_j" DECIMAL,
    "work_early_pct" DECIMAL,
    "decay_90_10_s" DECIMAL,
    "t_com_norm_0to1" DECIMAL,
    "skewness" DECIMAL,
    "kurtosis" DECIMAL,
    "spectral_centroid_hz" DECIMAL,
    "demographic" TEXT,
    CONSTRAINT "f_athletic_screen_slv_pkey" PRIMARY KEY ("id")
);

-- Add missing columns if table exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_slv' AND column_name = 'age_at_collection') THEN
        ALTER TABLE "public"."f_athletic_screen_slv" ADD COLUMN "age_at_collection" DECIMAL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_slv' AND column_name = 'age_group') THEN
        ALTER TABLE "public"."f_athletic_screen_slv" ADD COLUMN "age_group" TEXT;
    END IF;
END $$;

-- NMT Table
CREATE TABLE IF NOT EXISTS "public"."f_athletic_screen_nmt" (
    "id" SERIAL NOT NULL,
    "athlete_uuid" VARCHAR(36) NOT NULL,
    "session_date" DATE NOT NULL,
    "source_system" VARCHAR(50) NOT NULL DEFAULT 'athletic_screen',
    "source_athlete_id" VARCHAR(100),
    "trial_name" TEXT,
    "age_at_collection" DECIMAL,
    "age_group" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "num_taps_10s" DECIMAL,
    "num_taps_20s" DECIMAL,
    "num_taps_30s" DECIMAL,
    "num_taps" DECIMAL,
    "demographic" TEXT,
    CONSTRAINT "f_athletic_screen_nmt_pkey" PRIMARY KEY ("id")
);

-- Add missing columns if table exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_nmt' AND column_name = 'age_at_collection') THEN
        ALTER TABLE "public"."f_athletic_screen_nmt" ADD COLUMN "age_at_collection" DECIMAL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_nmt' AND column_name = 'age_group') THEN
        ALTER TABLE "public"."f_athletic_screen_nmt" ADD COLUMN "age_group" TEXT;
    END IF;
END $$;

-- PPU Table
CREATE TABLE IF NOT EXISTS "public"."f_athletic_screen_ppu" (
    "id" SERIAL NOT NULL,
    "athlete_uuid" VARCHAR(36) NOT NULL,
    "session_date" DATE NOT NULL,
    "source_system" VARCHAR(50) NOT NULL DEFAULT 'athletic_screen',
    "source_athlete_id" VARCHAR(100),
    "trial_name" TEXT,
    "age_at_collection" DECIMAL,
    "age_group" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jh_in" DECIMAL,
    "peak_power" DECIMAL,
    "pp_forceplate" DECIMAL,
    "force_at_pp" DECIMAL,
    "vel_at_pp" DECIMAL,
    "pp_w_per_kg" DECIMAL,
    "peak_power_w" DECIMAL,
    "time_to_peak_s" DECIMAL,
    "rpd_max_w_per_s" DECIMAL,
    "time_to_rpd_max_s" DECIMAL,
    "rise_time_10_90_s" DECIMAL,
    "fwhm_s" DECIMAL,
    "auc_j" DECIMAL,
    "work_early_pct" DECIMAL,
    "decay_90_10_s" DECIMAL,
    "t_com_norm_0to1" DECIMAL,
    "skewness" DECIMAL,
    "kurtosis" DECIMAL,
    "spectral_centroid_hz" DECIMAL,
    "demographic" TEXT,
    CONSTRAINT "f_athletic_screen_ppu_pkey" PRIMARY KEY ("id")
);

-- Add missing columns if table exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_ppu' AND column_name = 'age_at_collection') THEN
        ALTER TABLE "public"."f_athletic_screen_ppu" ADD COLUMN "age_at_collection" DECIMAL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'f_athletic_screen_ppu' AND column_name = 'age_group') THEN
        ALTER TABLE "public"."f_athletic_screen_ppu" ADD COLUMN "age_group" TEXT;
    END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_cmj_uuid" ON "public"."f_athletic_screen_cmj"("athlete_uuid");
CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_cmj_date" ON "public"."f_athletic_screen_cmj"("session_date");

CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_dj_uuid" ON "public"."f_athletic_screen_dj"("athlete_uuid");
CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_dj_date" ON "public"."f_athletic_screen_dj"("session_date");

CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_slv_uuid" ON "public"."f_athletic_screen_slv"("athlete_uuid");
CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_slv_date" ON "public"."f_athletic_screen_slv"("session_date");

CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_nmt_uuid" ON "public"."f_athletic_screen_nmt"("athlete_uuid");
CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_nmt_date" ON "public"."f_athletic_screen_nmt"("session_date");

CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_ppu_uuid" ON "public"."f_athletic_screen_ppu"("athlete_uuid");
CREATE INDEX IF NOT EXISTS "idx_f_athletic_screen_ppu_date" ON "public"."f_athletic_screen_ppu"("session_date");

