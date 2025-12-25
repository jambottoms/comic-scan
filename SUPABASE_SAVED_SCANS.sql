-- Supabase Table for Saved Comic Scans
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/YOUR_PROJECT/sql

-- Create saved_scans table
CREATE TABLE IF NOT EXISTS saved_scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  issue TEXT,
  grade TEXT NOT NULL,
  video_url TEXT,
  thumbnail TEXT,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE saved_scans ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow public inserts
CREATE POLICY "Allow public inserts"
ON saved_scans
FOR INSERT
TO public
WITH CHECK (true);

-- Policy 2: Allow public reads
CREATE POLICY "Allow public reads"
ON saved_scans
FOR SELECT
TO public
USING (true);

-- Policy 3: Allow public updates
CREATE POLICY "Allow public updates"
ON saved_scans
FOR UPDATE
TO public
USING (true);

-- Policy 4: Allow public deletes
CREATE POLICY "Allow public deletes"
ON saved_scans
FOR DELETE
TO public
USING (true);

-- Create index for faster queries by created_at
CREATE INDEX IF NOT EXISTS idx_saved_scans_created_at ON saved_scans(created_at DESC);

