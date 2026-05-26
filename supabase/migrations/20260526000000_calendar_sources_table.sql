-- Replace single caldav_*/gcal_* columns in user_settings with a
-- calendar_sources table supporting multiple sources per user.
-- Old user_settings columns are kept for now and removed when frontend is updated.

CREATE TABLE public.calendar_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type             text NOT NULL CHECK (type IN ('google', 'caldav', 'ical', 'microsoft')),
  name             text NOT NULL DEFAULT '',
  url              text,           -- CalDAV server URL or iCal subscription URL
  username         text,           -- CalDAV username
  password         text,           -- CalDAV password
  access_token     text,           -- OAuth access token (cached)
  refresh_token    text,           -- OAuth refresh token (Google, Microsoft)
  token_expires_at bigint,         -- OAuth token expiry (ms since epoch)
  calendar_id      text,           -- specific calendar within the server to use
  is_write_target  boolean DEFAULT false,  -- task events are written here
  enabled          boolean DEFAULT true,
  sort_order       int DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.calendar_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_sources_own" ON public.calendar_sources
  FOR ALL USING (user_id = auth.uid());

-- Migrate existing Google Calendar connections
INSERT INTO public.calendar_sources (user_id, type, name, access_token, refresh_token, token_expires_at, is_write_target)
SELECT user_id, 'google', 'Google Calendar', gcal_access_token, gcal_refresh_token, gcal_token_expires_at, true
FROM public.user_settings
WHERE gcal_refresh_token IS NOT NULL;

-- Migrate existing CalDAV connections
INSERT INTO public.calendar_sources (user_id, type, name, url, username, password, is_write_target)
SELECT user_id, 'caldav', 'CalDAV', caldav_server, caldav_username, caldav_password, true
FROM public.user_settings
WHERE caldav_server IS NOT NULL;
