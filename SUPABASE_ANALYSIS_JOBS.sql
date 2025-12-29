-- Analysis Jobs Table
-- Tracks the state of video analysis jobs through multiple phases

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  video_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  
  -- Phase 1: AI Analysis
  ai_status TEXT DEFAULT 'pending',
  ai_results JSONB,
  ai_completed_at TIMESTAMPTZ,
  
  -- Phase 2: Golden Frames
  frames_status TEXT DEFAULT 'pending',
  golden_frames JSONB,
  frames_completed_at TIMESTAMPTZ,
  
  -- Phase 3: CV Analysis
  cv_status TEXT DEFAULT 'pending',
  cv_results JSONB,
  cv_completed_at TIMESTAMPTZ,
  
  -- Phase 4: Final Grade
  hybrid_grade JSONB,
  final_grade TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  error TEXT
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_jobs_status ON analysis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON analysis_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_ai_status ON analysis_jobs(ai_status);
CREATE INDEX IF NOT EXISTS idx_jobs_cv_status ON analysis_jobs(cv_status);

-- Row Level Security (RLS) - Optional, adjust based on your auth setup
-- ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;

-- Example policy (adjust based on your needs):
-- CREATE POLICY "Users can view their own jobs" ON analysis_jobs
--   FOR SELECT USING (true);  -- Adjust with proper auth check

-- CREATE POLICY "Service role can insert jobs" ON analysis_jobs
--   FOR INSERT WITH CHECK (true);  -- Only service role should insert

-- CREATE POLICY "Service role can update jobs" ON analysis_jobs
--   FOR UPDATE USING (true);  -- Only service role should update

