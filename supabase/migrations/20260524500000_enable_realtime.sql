-- Enable Supabase Realtime postgres_changes for collaboration
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
