-- Enable RLS on analysis_jobs and add permissive policies
-- Use this for single-user apps or when you don't need user isolation

-- Enable RLS (required for security)
ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;

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

-- Policy 4: Allow anyone to delete analysis jobs (optional, you may want to restrict this)
CREATE POLICY "Allow public delete from analysis_jobs"
  ON analysis_jobs
  FOR DELETE
  USING (true);

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'analysis_jobs';

