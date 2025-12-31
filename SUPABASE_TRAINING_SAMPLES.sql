-- Create training_samples table in Supabase
-- This stores all training data submitted via the Train AI tab

CREATE TABLE IF NOT EXISTS training_samples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Image data
  image_url TEXT NOT NULL,
  image_path TEXT NOT NULL, -- Storage path in 'training-data' bucket
  
  -- Label information
  label TEXT NOT NULL,
  label_type TEXT NOT NULL, -- 'defect' | 'region' | 'grade'
  
  -- Nyckel information
  nyckel_function_id TEXT, -- Which Nyckel function this was sent to
  nyckel_sample_id TEXT, -- ID returned by Nyckel (if available)
  nyckel_status TEXT DEFAULT 'submitted', -- 'submitted' | 'accepted' | 'rejected' | 'error'
  
  -- Metadata
  user_agent TEXT,
  device_info JSONB,
  
  -- Training context (optional)
  source_scan_id UUID, -- If this was from a grading result
  region_name TEXT, -- If this is a region crop (spine, corner_tl, etc.)
  
  -- Crop information
  crop_data JSONB, -- Stores crop coordinates if relevant
  
  -- Quality metrics (optional, can be populated later)
  image_width INTEGER,
  image_height INTEGER,
  file_size_bytes INTEGER,
  
  CONSTRAINT valid_label_type CHECK (label_type IN ('defect', 'region', 'grade'))
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_training_samples_created_at ON training_samples(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_samples_label ON training_samples(label);
CREATE INDEX IF NOT EXISTS idx_training_samples_label_type ON training_samples(label_type);
CREATE INDEX IF NOT EXISTS idx_training_samples_source_scan ON training_samples(source_scan_id);

-- Row Level Security
ALTER TABLE training_samples ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (for anonymous training submissions)
CREATE POLICY "Anyone can insert training samples" ON training_samples
  FOR INSERT
  WITH CHECK (true);

-- Allow anyone to read (for analytics/review)
CREATE POLICY "Anyone can view training samples" ON training_samples
  FOR SELECT
  USING (true);

COMMENT ON TABLE training_samples IS 'Stores all training data submitted via Train AI tab for backup and analytics';
COMMENT ON COLUMN training_samples.label_type IS 'defect = specific defect type, region = region location, grade = condition/quality';
COMMENT ON COLUMN training_samples.nyckel_status IS 'Tracks whether Nyckel successfully accepted the sample';

