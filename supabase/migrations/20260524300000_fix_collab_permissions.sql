-- Fix 1: Allow project members (not just owner) to update project metadata
DROP POLICY "projects_update" ON public.projects;
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE USING (public.can_access_project(id));

-- Fix 2: Allow project members to see people rows of co-members and project owners
DROP POLICY "people_select" ON public.people;
CREATE POLICY "people_select" ON public.people
  FOR SELECT USING (
    -- own row
    user_id = auth.uid()
    -- people you invited
    OR invited_by = auth.uid()
    -- members of any project you have access to
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.person_id = people.id AND public.can_access_project(pm.project_id)
    )
    -- owners of any project you have access to
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.owner_id = people.user_id AND public.can_access_project(p.id)
    )
  );
