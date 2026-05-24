-- Per-user task scheduling: moves caldav_event_uid, caldav_calendar_id, scheduled_at
-- off the shared tasks row so each collaborator can independently schedule the same task.
CREATE TABLE public.task_schedule (
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id            uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  caldav_event_uid   text,
  caldav_calendar_id text,
  scheduled_at       timestamptz,
  PRIMARY KEY (user_id, task_id)
);
ALTER TABLE public.task_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedule_own" ON public.task_schedule
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Migrate existing rows to the new table (assigned to the task creator)
INSERT INTO public.task_schedule (user_id, task_id, caldav_event_uid, caldav_calendar_id, scheduled_at)
SELECT created_by, id, caldav_event_uid, caldav_calendar_id, scheduled_at
FROM public.tasks
WHERE scheduled_at IS NOT NULL AND created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- Remove stale 'scheduled' labels from tasks (per-user now; presence in task_schedule is the source of truth)
UPDATE public.tasks SET labels = array_remove(labels, 'scheduled') WHERE 'scheduled' = ANY(labels);

-- Drop the columns that are now per-user
ALTER TABLE public.tasks DROP COLUMN IF EXISTS caldav_event_uid;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS caldav_calendar_id;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS scheduled_at;
