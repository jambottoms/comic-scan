-- Enable RLS on analysis_jobs with service-role-only access
-- Use this for maximum security - only backend server can access

-- Enable RLS
ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;

-- NO policies = no public access
-- Only service_role key (used in server actions) can access

-- This means:
-- ✅ Server actions (analyze-phase-1.ts, analyze-phase-2.ts) work fine
-- ❌ Client-side queries fail (unless using service_role key)

-- If you need client-side access for specific operations,
-- create targeted policies or use server actions as a proxy

-- Verify that NO policies exist (service_role still works)
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'analysis_jobs';
-- Should return 0 rows (service_role bypasses RLS)

