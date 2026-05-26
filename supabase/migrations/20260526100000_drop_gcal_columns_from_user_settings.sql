-- gcal_* token columns moved to calendar_sources table
ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS gcal_access_token,
  DROP COLUMN IF EXISTS gcal_refresh_token,
  DROP COLUMN IF EXISTS gcal_token_expires_at;
