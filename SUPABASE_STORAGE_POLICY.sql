-- Supabase Storage Policies for comic-videos bucket
-- Run these in Supabase SQL Editor: https://app.supabase.com/project/YOUR_PROJECT/sql

-- Policy 1: Allow public uploads (INSERT)
CREATE POLICY "Allow public uploads"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'comic-videos');

-- Policy 2: Allow public reads (SELECT)
CREATE POLICY "Allow public reads"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'comic-videos');

-- Policy 3: Allow public updates (UPDATE) - optional, for file updates
CREATE POLICY "Allow public updates"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'comic-videos');

-- Policy 4: Allow public deletes (DELETE) - optional, for cleanup
CREATE POLICY "Allow public deletes"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'comic-videos');

