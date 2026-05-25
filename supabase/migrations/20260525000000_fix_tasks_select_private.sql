-- Fix tasks_select RLS: private tasks must only be visible to their creator.
-- The previous policy used can_access_project() alone, which let all project
-- members see every task regardless of is_private.

DROP POLICY "tasks_select" ON public.tasks;

CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (
  (is_private = false OR created_by = auth.uid())
  AND (
    project_id IS NULL
    OR public.can_access_project(project_id)
  )
);
