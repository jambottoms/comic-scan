-- Create a bucket for training data
insert into storage.buckets (id, name, public)
values ('training-data', 'training-data', true);

-- Allow public read (for Nyckel to access)
create policy "Public Access Training"
  on storage.objects for select
  using ( bucket_id = 'training-data' );

-- Allow authenticated uploads
create policy "Authenticated Upload Training"
  on storage.objects for insert
  with check ( bucket_id = 'training-data' );


