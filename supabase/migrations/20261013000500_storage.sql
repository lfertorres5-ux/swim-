-- =============================================================================
-- Phase 1 · Storage buckets & policies
--   instructor-photos  public read; instructor writes own folder <uid>/...
--   certifications     private; instructor writes/reads own folder; admin reads all
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('instructor-photos', 'instructor-photos', true, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']),
  ('certifications', 'certifications', false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "instructor photos: public read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'instructor-photos');

create policy "instructor photos: owner write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'instructor-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.caller_role()) = 'instructor'
  );

create policy "instructor photos: owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'instructor-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "instructor photos: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'instructor-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "certifications: owner or admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'certifications'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin()))
  );

create policy "certifications: owner upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.caller_role()) = 'instructor'
  );
