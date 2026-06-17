-- AlterTable: f_mobility new format columns (2026-06-08)
-- Adds demographics from expanded A6:E7 grid, and optimal_ranges JSON storage

ALTER TABLE "public"."f_mobility"
  ADD COLUMN IF NOT EXISTS "primary_position" TEXT,
  ADD COLUMN IF NOT EXISTS "throwing_side" TEXT,
  ADD COLUMN IF NOT EXISTS "hitting_side" TEXT,
  ADD COLUMN IF NOT EXISTS "throwing_velo_max" DECIMAL,
  ADD COLUMN IF NOT EXISTS "hitting_velo_max" DECIMAL,
  ADD COLUMN IF NOT EXISTS "optimal_ranges" JSONB;
