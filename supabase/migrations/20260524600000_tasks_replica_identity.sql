-- Ensure DELETE events include all columns so the project_id filter
-- on Realtime subscriptions matches correctly.
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
