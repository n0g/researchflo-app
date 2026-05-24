-- =============================================================
-- researchflo — complete database schema
-- Consolidated from: schema.sql, supabase-migration.sql,
-- supabase-passkey-migration.sql, and subsequent column additions.
-- =============================================================

-- ── FUNCTIONS ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Auto-link a people row on new auth signup.
-- If an invited people row with matching email exists, claim it;
-- otherwise create a new row for the user.
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
END; $$;

-- Helper used by RLS policies to avoid recursion.
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

-- ── TABLES ───────────────────────────────────────────────────

CREATE TABLE public.stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  slug       text NOT NULL,
  icon       text DEFAULT 'kanban',
  sort_order int  DEFAULT 0
);

CREATE TABLE public.projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  owner_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stage_id       uuid REFERENCES public.stages(id) ON DELETE SET NULL,
  status_text    text DEFAULT '',
  venue          text DEFAULT '',
  deadline       date,
  summary        text DEFAULT '',
  submission_url text DEFAULT '',
  energy         smallint DEFAULT 0,
  is_inbox       boolean DEFAULT false,
  sort_order     int DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- People are decoupled from auth.users so uninvited collaborators
-- can be named before they create an account.
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

CREATE TABLE public.project_members (
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  person_id  uuid REFERENCES public.people(id) ON DELETE CASCADE,
  role       text DEFAULT 'member',
  added_by   uuid REFERENCES auth.users(id),
  added_at   timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE public.tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by         uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  assigned_to        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content            text NOT NULL,
  description        text DEFAULT '',
  priority           smallint DEFAULT 1,
  due_date           date,
  sort_order         int DEFAULT 0,
  is_completed       boolean DEFAULT false,
  is_private         boolean DEFAULT false,
  completed_at       timestamptz,
  caldav_event_uid   text,
  caldav_calendar_id text,
  scheduled_at       timestamptz,
  labels             text[] DEFAULT '{}',
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE public.user_settings (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hotcrp_sites     jsonb,
  gcal_calendar_id text,
  mcp_token        uuid DEFAULT gen_random_uuid(),
  theme            text DEFAULT 'auto',
  updated_at       timestamptz DEFAULT now()
);

-- Short-lived WebAuthn challenge tokens (5-min TTL).
-- Only accessed via service role key from edge functions.
CREATE TABLE public.auth_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge  text NOT NULL UNIQUE,
  type       text NOT NULL,  -- 'register' | 'authenticate'
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

CREATE TABLE public.passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    text NOT NULL,
  aaguid        text DEFAULT '',
  sign_count    bigint DEFAULT 0,
  device_label  text DEFAULT '',
  created_at    timestamptz DEFAULT now(),
  last_used_at  timestamptz DEFAULT now()
);

-- ── INDEXES ──────────────────────────────────────────────────

CREATE INDEX ON public.tasks(project_id);
CREATE INDEX ON public.tasks(created_by);
CREATE INDEX ON public.tasks(is_completed);
CREATE INDEX ON public.tasks(sort_order);
CREATE INDEX ON public.project_members(person_id);

-- ── TRIGGERS ─────────────────────────────────────────────────

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── ROW LEVEL SECURITY ───────────────────────────────────────

ALTER TABLE public.stages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passkeys        ENABLE ROW LEVEL SECURITY;

-- stages: system defaults (owner_id IS NULL) visible to all authenticated users;
-- user-created stages visible only to their owner
CREATE POLICY "stages_select" ON public.stages
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "stages_write" ON public.stages
  FOR ALL USING (owner_id IS NULL OR owner_id = auth.uid());

-- projects
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT USING (public.can_access_project(id));
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE USING (auth.uid() = owner_id);

-- people
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
-- Invite someone to a project
CREATE POLICY "people_insert" ON public.people
  FOR INSERT WITH CHECK (invited_by = auth.uid());
-- Create your own profile row (e.g. owner who predates the trigger)
CREATE POLICY "people_insert_self" ON public.people
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "people_update_own" ON public.people
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "people_claim_invite" ON public.people
  FOR UPDATE USING (invite_token IS NOT NULL AND user_id IS NULL)
  WITH CHECK (user_id = auth.uid());

-- project_members
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

-- tasks
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (
  (is_private = false OR created_by = auth.uid()) AND (
    project_id IS NULL  -- inbox tasks
    OR EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.people pe ON pe.id = pm.person_id
      WHERE pm.project_id = tasks.project_id AND pe.user_id = auth.uid()
    )
  )
);
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT WITH CHECK (
  auth.uid() = created_by AND (
    project_id IS NULL
    OR EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.people pe ON pe.id = pm.person_id
      WHERE pm.project_id = tasks.project_id AND pe.user_id = auth.uid()
    )
  )
);
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE USING (
  created_by = auth.uid()
  OR (is_private = false AND public.can_access_project(project_id))
);
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE USING (created_by = auth.uid());

-- user_settings: each user owns their own row
CREATE POLICY "settings_own" ON public.user_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- passkeys: users can read their own; writes only via service role (edge functions)
CREATE POLICY "passkeys_select_own" ON public.passkeys
  FOR SELECT USING (user_id = auth.uid());

-- auth_challenges: no client access — service role only

-- ── SEED DATA ────────────────────────────────────────────────

INSERT INTO public.stages (name, slug, icon, sort_order) VALUES
  ('Planning',         'planning',            'potted-plant',     0),
  ('Data Collection',  'data-collection',     'flask',            1),
  ('Preparing',        'preparing-to-submit', 'pencil-line',      2),
  ('Revision',         'revision',            'eraser',           3),
  ('Awaiting Reviews', 'under-submission',    'paper-plane-tilt', 4),
  ('On Ice',           'on-ice',              'snowflake',        5);
