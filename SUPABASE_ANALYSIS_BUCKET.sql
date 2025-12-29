-- ============================================
-- Create 'analysis-images' bucket for CV results
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Create the bucket (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'analysis-images',
  'analysis-images',
  true,  -- Public bucket so images can be displayed
  52428800,  -- 50MB limit
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- 2. Enable public read access
CREATE POLICY "Public read access for analysis images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'analysis-images');

-- 3. Enable service role uploads (for Modal worker)
CREATE POLICY "Service role upload access for analysis images"
ON storage.objects FOR INSERT
TO authenticated, service_role
WITH CHECK (bucket_id = 'analysis-images');

-- 4. Enable service role updates
CREATE POLICY "Service role update access for analysis images"
ON storage.objects FOR UPDATE
TO authenticated, service_role
USING (bucket_id = 'analysis-images');



