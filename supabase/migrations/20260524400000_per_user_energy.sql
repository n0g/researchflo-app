-- Move energy from shared project column to per-user table
CREATE TABLE public.project_focus (
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  energy     smallint DEFAULT 0 NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

ALTER TABLE public.project_focus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focus_own" ON public.project_focus
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Migrate non-zero energy values from projects to project_focus for existing owners
INSERT INTO public.project_focus (user_id, project_id, energy)
SELECT owner_id, id, energy
FROM public.projects
WHERE energy > 0
ON CONFLICT DO NOTHING;

ALTER TABLE public.projects DROP COLUMN IF EXISTS energy;
