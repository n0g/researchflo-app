-- Fix joined_at being set at invite time instead of when the user actually confirms.
--
-- Previously handle_new_user fired on INSERT into auth.users and always wrote
-- joined_at = now(). But inviteUserByEmail creates the auth row immediately
-- (email_confirmed_at IS NULL), so joined_at was set before the person ever
-- clicked the invite link.
--
-- New behaviour:
--   INSERT: claim the people row, set joined_at only if email is already confirmed
--           (e.g. social auth providers that verify email at signup).
--   UPDATE: when email_confirmed_at transitions NULL → non-null, set joined_at.

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

-- New trigger: set joined_at when the user actually confirms their email
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

CREATE TRIGGER on_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_email_confirmed();
