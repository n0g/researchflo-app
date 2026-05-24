-- Track when projects move between pipeline stages

CREATE TABLE public.project_stage_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  stage_id   uuid REFERENCES public.stages(id) ON DELETE SET NULL,
  entered_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX project_stage_history_project_idx
  ON public.project_stage_history(project_id, entered_at DESC);

ALTER TABLE public.project_stage_history ENABLE ROW LEVEL SECURITY;

-- Same visibility as the project itself (owner or collaborator)
CREATE POLICY "stage_history_select" ON public.project_stage_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.project_members pm ON pm.project_id = p.id
      WHERE p.id = project_stage_history.project_id
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
    )
  );

-- Record stage transitions on UPDATE
CREATE OR REPLACE FUNCTION public.record_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO public.project_stage_history(project_id, stage_id, entered_at)
    VALUES (NEW.id, NEW.stage_id, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_project_stage_change
  AFTER UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.record_stage_change();

-- Record the initial stage when a project is created
CREATE OR REPLACE FUNCTION public.record_initial_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    INSERT INTO public.project_stage_history(project_id, stage_id, entered_at)
    VALUES (NEW.id, NEW.stage_id, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_project_insert_stage
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.record_initial_stage();

-- Backfill existing projects (use created_at as best approximation)
INSERT INTO public.project_stage_history(project_id, stage_id, entered_at)
SELECT id, stage_id, created_at
FROM public.projects
WHERE stage_id IS NOT NULL;
