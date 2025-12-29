-- Add progress tracking columns to existing analysis_jobs table
-- Run this migration if the table already exists

ALTER TABLE analysis_jobs 
ADD COLUMN IF NOT EXISTS progress_percentage INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS progress_message TEXT,
ADD COLUMN IF NOT EXISTS progress_step TEXT,
ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ;

-- Create index for efficient progress queries
CREATE INDEX IF NOT EXISTS idx_jobs_progress_updated ON analysis_jobs(progress_updated_at DESC);

-- Update existing rows to have 0% progress
UPDATE analysis_jobs 
SET progress_percentage = 0 
WHERE progress_percentage IS NULL;

