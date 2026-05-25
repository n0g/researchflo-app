-- On user deletion:
-- 1. Private tasks created by the user are deleted (trigger runs BEFORE DELETE)
-- 2. Public tasks have created_by/assigned_to set to NULL (FK ON DELETE SET NULL)

CREATE OR REPLACE FUNCTION public.delete_private_tasks_on_user_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.tasks WHERE created_by = OLD.id AND is_private = true;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER before_auth_user_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.delete_private_tasks_on_user_delete();

ALTER TABLE public.tasks DROP CONSTRAINT tasks_created_by_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks DROP CONSTRAINT tasks_assigned_to_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
