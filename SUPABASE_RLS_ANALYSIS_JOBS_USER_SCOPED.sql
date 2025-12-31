-- Enable RLS on analysis_jobs with user-scoped policies
-- Use this if you want multi-user support with data isolation

-- Enable RLS
ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;

-- First, add a user_id column to track ownership (if it doesn't exist)
ALTER TABLE analysis_jobs 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create an index for performance
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_user_id ON analysis_jobs(user_id);

-- Policy 1: Users can only read their own analysis jobs
CREATE POLICY "Users can read their own analysis jobs"
  ON analysis_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy 2: Users can only insert analysis jobs for themselves
CREATE POLICY "Users can insert their own analysis jobs"
  ON analysis_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy 3: Users can only update their own analysis jobs
CREATE POLICY "Users can update their own analysis jobs"
  ON analysis_jobs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 4: Users can only delete their own analysis jobs
CREATE POLICY "Users can delete their own analysis jobs"
  ON analysis_jobs
  FOR DELETE
  USING (auth.uid() = user_id);

-- Service role can still access everything (for server actions)
-- The service_role key bypasses RLS automatically

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'analysis_jobs';

