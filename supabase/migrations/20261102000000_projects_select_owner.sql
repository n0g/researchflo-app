-- Fix: "new row violates row-level security policy for table projects" on create.
--
-- createProject() does INSERT ... RETURNING. The RETURNING row must pass the
-- SELECT policy, but can_access_project(id) is STABLE and re-queries `projects`,
-- so it cannot see the row being inserted by the same statement.
-- Checking owner_id directly on the row avoids the lookup.

DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT USING (
    owner_id = auth.uid()
    OR public.can_access_project(id)
  );
