ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS timezone                      text,
  ADD COLUMN IF NOT EXISTS work_start_time               text  DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS work_end_time                 text  DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS work_days                     int[] DEFAULT ARRAY[1,2,3,4,5],
  ADD COLUMN IF NOT EXISTS default_task_duration_minutes int   DEFAULT 60;
