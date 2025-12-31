-- Drop and recreate RLS policies on analysis_jobs
-- Safe to run multiple times (idempotent)

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public read access to analysis_jobs" ON analysis_jobs;
DROP POLICY IF EXISTS "Allow public insert to analysis_jobs" ON analysis_jobs;
DROP POLICY IF EXISTS "Allow public update to analysis_jobs" ON analysis_jobs;
DROP POLICY IF EXISTS "Allow public delete from analysis_jobs" ON analysis_jobs;

-- Enable RLS (no-op if already enabled)
ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;

-- Recreate policies
-- Policy 1: Allow anyone to read all analysis jobs
CREATE POLICY "Allow public read access to analysis_jobs"
  ON analysis_jobs
  FOR SELECT
  USING (true);

-- Policy 2: Allow anyone to insert analysis jobs
CREATE POLICY "Allow public insert to analysis_jobs"
  ON analysis_jobs
  FOR INSERT
  WITH CHECK (true);

-- Policy 3: Allow anyone to update analysis jobs
CREATE POLICY "Allow public update to analysis_jobs"
  ON analysis_jobs
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Policy 4: Allow anyone to delete analysis jobs
CREATE POLICY "Allow public delete from analysis_jobs"
  ON analysis_jobs
  FOR DELETE
  USING (true);

-- Verify policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd as operation
FROM pg_policies 
WHERE tablename = 'analysis_jobs'
ORDER BY cmd;

