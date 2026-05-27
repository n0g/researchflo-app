-- ============================================================
-- researchflo — consolidated database baseline
-- Generated from live schema 2026-05-26
-- Replaces: 20260101000000 through 20260526300000
-- ============================================================

-- ── FUNCTIONS ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Creates or claims a people row when a new auth user signs up.
-- If an invited people row with matching email exists, claims it;
-- otherwise creates a new row. Sets joined_at only if email is already confirmed.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  confirmed_at timestamptz := CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN now() ELSE NULL END;
BEGIN
  UPDATE public.people
  SET user_id = NEW.id, joined_at = confirmed_at
  WHERE email = NEW.email AND user_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO public.people (user_id, display_name, email, joined_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email,
      confirmed_at
    );
  END IF;

  RETURN NEW;
END; $$;

-- Sets joined_at when a user confirms their email (magic link flow).
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.people
    SET joined_at = now()
    WHERE user_id = NEW.id AND joined_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;

-- Keeps people.email in sync when auth email changes.
CREATE OR REPLACE FUNCTION public.sync_email_on_auth_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.people SET email = NEW.email WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

-- Cleans up private tasks before a user account is deleted.
CREATE OR REPLACE FUNCTION public.delete_private_tasks_on_user_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.tasks WHERE created_by = OLD.id AND is_private = true;
  RETURN OLD;
END; $$;

-- Security-definer helper used by RLS policies to avoid infinite recursion.
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

-- Alias used by task policies (same logic as can_access_project).
CREATE OR REPLACE FUNCTION public.is_project_owner(pid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT public.can_access_project(pid);
$$;

-- Records the initial stage when a project is created.
CREATE OR REPLACE FUNCTION public.record_initial_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    INSERT INTO public.project_stage_history(project_id, stage_id, entered_at)
    VALUES (NEW.id, NEW.stage_id, NEW.created_at);
  END IF;
  RETURN NEW;
END; $$;

-- Appends a stage history row whenever a project moves to a new stage.
CREATE OR REPLACE FUNCTION public.record_stage_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO public.project_stage_history(project_id, stage_id, entered_at)
    VALUES (NEW.id, NEW.stage_id, now());
  END IF;
  RETURN NEW;
END; $$;

-- ── TABLES ────────────────────────────────────────────────────

-- Pipeline stages. System defaults have owner_id IS NULL and are visible to all users.
CREATE TABLE public.stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES auth.users(id),
  name       text NOT NULL,
  icon       text DEFAULT 'kanban',
  sort_order int  DEFAULT 0
);

CREATE TABLE public.projects (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  owner_id             uuid NOT NULL REFERENCES auth.users(id),
  stage_id             uuid REFERENCES public.stages(id),
  status_text          text DEFAULT '',
  venue                text DEFAULT '',
  deadline             date,
  summary              text DEFAULT '',
  submission_url       text DEFAULT '',
  caldav_calendar_href text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- Collaborators decoupled from auth.users: an uninvited person can be
-- named on a project before they create an account. On signup, the
-- handle_new_user trigger claims the row by matching email.
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
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to     uuid REFERENCES public.people(id) ON DELETE SET NULL,
  estimated_time  integer,
  content      text NOT NULL,
  description  text DEFAULT '',
  priority     smallint DEFAULT 1,
  due_date     date,
  sort_order   int DEFAULT 0,
  is_completed boolean DEFAULT false,
  is_private   boolean DEFAULT false,
  completed_at timestamptz,
  labels       text[] DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- Per-user energy level per project (0=none, 1=low, 2=high).
CREATE TABLE public.project_focus (
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  energy     smallint NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- Per-user calendar event link for each scheduled task.
CREATE TABLE public.task_schedule (
  user_id            uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id            uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  caldav_event_uid   text,
  caldav_calendar_id text,
  scheduled_at       timestamptz,
  PRIMARY KEY (user_id, task_id)
);

-- Append-only log of stage transitions per project.
CREATE TABLE public.project_stage_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id   uuid REFERENCES public.stages(id) ON DELETE SET NULL,
  entered_at timestamptz NOT NULL DEFAULT now()
);

-- Short-lived WebAuthn challenge tokens (5-min TTL).
-- No public RLS policies — only accessible via service role from Edge Functions.
CREATE TABLE public.auth_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge  text NOT NULL UNIQUE,
  type       text NOT NULL,
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

CREATE TABLE public.user_settings (
  user_id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stages                        jsonb,
  hotcrp_sites                  jsonb,
  caldav_server                 text,
  caldav_username               text,
  caldav_password               text,
  theme                         text DEFAULT 'auto',
  updated_at                    timestamptz DEFAULT now(),
  mcp_token                     uuid DEFAULT gen_random_uuid(),
  timezone                      text,
  work_start_time               text DEFAULT '09:00',
  work_end_time                 text DEFAULT '17:00',
  work_days                     int[] DEFAULT ARRAY[1, 2, 3, 4, 5],
  default_task_duration_minutes int DEFAULT 60
);

-- Connected calendar accounts. Supports multiple providers per user.
-- type='google' uses OAuth fields; type='caldav'/'icloud' uses url/username/password.
CREATE TABLE public.calendar_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('google', 'caldav', 'icloud', 'ical', 'microsoft')),
  name             text NOT NULL DEFAULT '',
  url              text,
  username         text,
  password         text,
  access_token     text,
  refresh_token    text,
  token_expires_at bigint,
  calendar_id      text,
  is_write_target  boolean DEFAULT false,
  enabled          boolean DEFAULT true,
  sort_order       int DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

-- ── INDEXES ───────────────────────────────────────────────────

CREATE INDEX tasks_project_id_idx ON public.tasks(project_id);
CREATE INDEX tasks_created_by_idx ON public.tasks(created_by);
CREATE INDEX tasks_is_completed_idx ON public.tasks(is_completed);
CREATE UNIQUE INDEX user_settings_mcp_token_idx ON public.user_settings(mcp_token);
CREATE INDEX project_stage_history_project_idx ON public.project_stage_history(project_id, entered_at DESC);

-- ── TRIGGERS ──────────────────────────────────────────────────

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER on_project_insert_stage
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.record_initial_stage();

CREATE TRIGGER on_project_stage_change
  AFTER UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.record_stage_change();

-- Triggers on auth.users (run as superuser via migration)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_email_confirmed();

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_email_on_auth_update();

CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.delete_private_tasks_on_user_delete();

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────

ALTER TABLE public.stages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_focus         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_schedule         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_challenges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passkeys              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sources      ENABLE ROW LEVEL SECURITY;

-- stages: system defaults (owner_id IS NULL) + user's own custom stages
CREATE POLICY "stages_select" ON public.stages
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "stages_own" ON public.stages
  FOR ALL USING (owner_id IS NULL OR owner_id = auth.uid());

-- projects
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT USING (public.can_access_project(id));
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE USING (public.can_access_project(id));
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE USING (auth.uid() = owner_id);

-- people
CREATE POLICY "people_select" ON public.people
  FOR SELECT USING (
    user_id = auth.uid()
    OR invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.person_id = people.id AND public.can_access_project(pm.project_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.owner_id = people.user_id AND public.can_access_project(p.id)
    )
  );
CREATE POLICY "people_insert" ON public.people
  FOR INSERT WITH CHECK (invited_by = auth.uid());
CREATE POLICY "people_insert_self" ON public.people
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "people_update_own" ON public.people
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "people_update_invited" ON public.people
  FOR UPDATE USING (invited_by = auth.uid());
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

-- tasks: visible if non-private (or owned) AND project is accessible
CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT USING (
    (is_private = false OR created_by = auth.uid())
    AND (project_id IS NULL OR public.can_access_project(project_id))
  );
CREATE POLICY "tasks_insert" ON public.tasks
  FOR INSERT WITH CHECK (
    public.is_project_owner(project_id) OR (project_id IS NULL AND created_by = auth.uid())
  );
CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE USING (
    public.is_project_owner(project_id) OR (project_id IS NULL AND created_by = auth.uid())
  );
CREATE POLICY "tasks_delete" ON public.tasks
  FOR DELETE USING (
    public.is_project_owner(project_id) OR (project_id IS NULL AND created_by = auth.uid())
  );

-- project_focus, task_schedule: fully private per user
CREATE POLICY "focus_own" ON public.project_focus
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "schedule_own" ON public.task_schedule
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- project_stage_history: readable by project owner and members
CREATE POLICY "stage_history_select" ON public.project_stage_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.project_members pm ON pm.project_id = p.id
      LEFT JOIN public.people pe ON pe.id = pm.person_id
      WHERE p.id = project_stage_history.project_id
        AND (p.owner_id = auth.uid() OR pe.user_id = auth.uid())
    )
  );

-- auth_challenges: no public policies — service role only via Edge Functions
-- passkeys: users can only see their own
CREATE POLICY "passkeys_select_own" ON public.passkeys
  FOR SELECT USING (user_id = auth.uid());

-- user_settings and calendar_sources: fully private per user
CREATE POLICY "settings_own" ON public.user_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "calendar_sources_own" ON public.calendar_sources
  FOR ALL USING (user_id = auth.uid());

-- ── REALTIME ──────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_members;

-- Full row data in realtime DELETE payloads (needed so RLS filters can match old rows)
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
