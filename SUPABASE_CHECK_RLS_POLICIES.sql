-- Check existing RLS policies on analysis_jobs
-- Run this first to see what's already there

-- 1. Check if RLS is enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'analysis_jobs';

-- 2. List all existing policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd as operation,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies 
WHERE tablename = 'analysis_jobs'
ORDER BY cmd;

-- 3. If you need to see the full policy definitions
SELECT
  polname as policy_name,
  CASE polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END as operation,
  CASE polpermissive
    WHEN true THEN 'PERMISSIVE'
    ELSE 'RESTRICTIVE'
  END as policy_type,
  pg_get_expr(polqual, polrelid) as using_expression,
  pg_get_expr(polwithcheck, polrelid) as with_check_expression
FROM pg_policy
WHERE polrelid = 'analysis_jobs'::regclass
ORDER BY polname;

