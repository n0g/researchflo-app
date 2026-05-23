-- ============================================================
-- Collaboration system migration
-- Run this in your Supabase SQL editor (or supabase db push)
-- ============================================================

-- 1. People table (decoupled from auth.users)
CREATE TABLE public.people (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email        text UNIQUE,
  user_id      uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_token uuid UNIQUE DEFAULT gen_random_uuid(),
  invited_by   uuid REFERENCES auth.users(id),
  invited_at   timestamptz,
  joined_at    timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- 2. Project members
CREATE TABLE public.project_members (
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  person_id   uuid REFERENCES public.people(id) ON DELETE CASCADE,
  role        text DEFAULT 'member',
  added_by    uuid REFERENCES auth.users(id),
  added_at    timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, person_id)
);

-- 3. Enable RLS
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- 4. SECURITY DEFINER function (bypasses RLS to avoid recursion)
CREATE OR REPLACE FUNCTION public.can_access_project(pid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.projects WHERE id = pid AND owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.people pe ON pe.id = pm.person_id
      WHERE pm.project_id = pid AND pe.user_id = auth.uid()
    );
$$;

-- Update is_project_owner to use can_access_project
CREATE OR REPLACE FUNCTION public.is_project_owner(pid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT public.can_access_project(pid);
$$;

-- 5. Update projects_select to allow members too
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT USING (public.can_access_project(id));

-- 6. People policies
CREATE POLICY "people_select" ON public.people
  FOR SELECT USING (
    user_id = auth.uid()
    OR invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.projects p ON p.id = pm.project_id
      WHERE pm.person_id = people.id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "people_insert" ON public.people
  FOR INSERT WITH CHECK (invited_by = auth.uid());

CREATE POLICY "people_update_own" ON public.people
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "people_claim_invite" ON public.people
  FOR UPDATE USING (invite_token IS NOT NULL AND user_id IS NULL)
  WITH CHECK (user_id = auth.uid());

-- 7. Project members policies
CREATE POLICY "pm_select" ON public.project_members
  FOR SELECT USING (public.can_access_project(project_id));

CREATE POLICY "pm_insert" ON public.project_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
  );

CREATE POLICY "pm_delete" ON public.project_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
  );

-- 8. Auto-link people on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.people
  SET user_id = NEW.id, joined_at = now()
  WHERE email = NEW.email AND user_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO public.people (user_id, display_name, email, joined_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email,
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 9. Migrate existing collaborators text[] data
DO $$
DECLARE
  p record;
  collab text;
  pid uuid;
BEGIN
  FOR p IN
    SELECT id, owner_id, collaborators
    FROM projects
    WHERE collaborators IS NOT NULL AND array_length(collaborators, 1) > 0
  LOOP
    FOREACH collab IN ARRAY p.collaborators LOOP
      SELECT id INTO pid
      FROM people
      WHERE display_name = collab AND invited_by = p.owner_id
      LIMIT 1;

      IF pid IS NULL THEN
        INSERT INTO people (display_name, invited_by)
        VALUES (collab, p.owner_id)
        RETURNING id INTO pid;
      END IF;

      INSERT INTO project_members (project_id, person_id, added_by)
      VALUES (p.id, pid, p.owner_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 10. Drop old column
ALTER TABLE public.projects DROP COLUMN IF EXISTS collaborators;
