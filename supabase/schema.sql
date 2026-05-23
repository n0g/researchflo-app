-- Research Board App — Supabase schema
-- Run this in the Supabase SQL Editor to set up the database from scratch.

-- ── TRIGGERS ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);
  RETURN NEW;
END; $$;

-- ── TABLES ────────────────────────────────────────────────────────────────

CREATE TABLE public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email        text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE public.stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES auth.users(id),
  name       text NOT NULL,
  slug       text NOT NULL,
  icon       text DEFAULT 'kanban',
  sort_order int  DEFAULT 0
);

CREATE TABLE public.projects (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  owner_id             uuid REFERENCES auth.users(id) NOT NULL,
  stage_id             uuid REFERENCES public.stages(id),
  status_text          text DEFAULT '',
  venue                text DEFAULT '',
  deadline             date,
  summary              text DEFAULT '',
  submission_url       text DEFAULT '',
  energy               smallint DEFAULT 0,
  is_inbox             boolean DEFAULT false,
  caldav_calendar_href text,
  sort_order           int DEFAULT 0,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE TABLE public.project_members (
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text DEFAULT 'member',
  joined_at  timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE public.tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) NOT NULL,
  assigned_to         uuid REFERENCES auth.users(id),
  content             text NOT NULL,
  description         text DEFAULT '',
  priority            smallint DEFAULT 1,
  due_date            date,
  sort_order          int DEFAULT 0,
  is_completed        boolean DEFAULT false,
  is_private          boolean DEFAULT false,
  completed_at        timestamptz,
  caldav_event_uid    text,
  caldav_calendar_id  text,
  scheduled_at        timestamptz,
  labels              text[] DEFAULT '{}',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE public.user_settings (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stages          jsonb,
  hotcrp_sites    jsonb,
  hotcrp_proxy    text,
  caldav_server   text,
  caldav_username text,
  caldav_password text,
  theme           text DEFAULT 'auto',
  updated_at      timestamptz DEFAULT now()
);

-- ── INDEXES ───────────────────────────────────────────────────────────────

CREATE INDEX ON public.tasks(project_id);
CREATE INDEX ON public.tasks(created_by);
CREATE INDEX ON public.tasks(is_completed);

-- ── UPDATED_AT TRIGGERS ───────────────────────────────────────────────────

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings   ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "profiles_own" ON public.profiles
  FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- stages
CREATE POLICY "stages_select" ON public.stages
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "stages_own" ON public.stages
  FOR ALL USING (owner_id IS NULL OR owner_id = auth.uid());

-- projects
CREATE POLICY "projects_select" ON public.projects FOR SELECT USING (
  auth.uid() = owner_id OR
  EXISTS (SELECT 1 FROM public.project_members WHERE project_id = projects.id AND user_id = auth.uid())
);
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE USING (auth.uid() = owner_id);

-- project_members
CREATE POLICY "members_select" ON public.project_members FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
);
CREATE POLICY "members_manage" ON public.project_members FOR ALL USING (
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
);

-- tasks
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (
  (is_private = false OR created_by = auth.uid()) AND (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.project_members WHERE project_id = tasks.project_id AND user_id = auth.uid())
  )
);
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT WITH CHECK (
  auth.uid() = created_by AND (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.project_members WHERE project_id = tasks.project_id AND user_id = auth.uid())
  )
);
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE USING (
  created_by = auth.uid() OR (
    is_private = false AND
    EXISTS (SELECT 1 FROM public.project_members WHERE project_id = tasks.project_id AND user_id = auth.uid())
  )
);
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE USING (created_by = auth.uid());

-- user_settings
CREATE POLICY "settings_own" ON public.user_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── SEED DATA ─────────────────────────────────────────────────────────────

INSERT INTO public.stages (name, slug, icon, sort_order) VALUES
  ('Planning',         'planning',            'potted-plant',     0),
  ('Data Collection',  'data-collection',     'flask',            1),
  ('Preparing',        'preparing-to-submit', 'pencil-line',      2),
  ('Revision',         'revision',            'eraser',           3),
  ('Awaiting Reviews', 'under-submission',    'paper-plane-tilt', 4),
  ('On Ice',           'on-ice',              'snowflake',        5);
