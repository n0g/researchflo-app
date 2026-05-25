-- Make all stages global (owner_id = NULL) so they're shared across all users.
-- The stages_own RLS policy already allows any authenticated user to modify
-- rows where owner_id IS NULL, so no policy changes are needed.
UPDATE public.stages SET owner_id = NULL;
