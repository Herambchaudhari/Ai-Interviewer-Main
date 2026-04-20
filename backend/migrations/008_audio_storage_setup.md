# Migration 008 — Supabase Storage: `interview-audio` bucket

## What this sets up

A private Supabase Storage bucket that stores per-question audio clips recorded
during interviews.  The clips are used for "Review the Tape" playback on the
report page.

Storage path pattern: `interview-audio/{session_id}/{question_id}.webm`

Signed URLs are generated at report-generation time (24-hour TTL) so the clips
are never publicly accessible without a valid token.

---

## Option A — Automatic (recommended)

The backend auto-creates the bucket on the first audio upload via
`_ensure_audio_bucket()` in `services/db_service.py`.  No manual steps needed
if the `SUPABASE_KEY` has `storage.buckets.create` permission (service-role key
does by default).

---

## Option B — Manual via Supabase Dashboard

1. Go to **Storage** in your Supabase project dashboard.
2. Click **New bucket**.
3. Name: `interview-audio`
4. Toggle **Public bucket** → **OFF** (keep private).
5. Set **File size limit** → `10 MB`.
6. Click **Save**.

---

## RLS Policies (apply after bucket creation)

Run in the SQL editor:

```sql
-- Allow authenticated users to upload their own clips
CREATE POLICY "Users can upload own audio clips"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'interview-audio' AND auth.uid()::text = split_part(name, '/', 1));

-- Allow authenticated users to read their own clips
CREATE POLICY "Users can read own audio clips"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'interview-audio' AND auth.uid()::text = split_part(name, '/', 1));
```

> Note: the storage path uses `{session_id}/{question_id}.ext` not `{user_id}/...`
> so these policies rely on the signed-URL approach rather than direct object access.
> If you want user-scoped paths, change `upload_audio_clip()` in `db_service.py`
> to use `{user_id}/{session_id}/{question_id}.ext` and update the policies above.

---

## Environment variables

No new variables needed — uses the existing `SUPABASE_URL` + `SUPABASE_KEY`.
