-- Add 'icloud' as a distinct calendar source type (differentiated from generic 'caldav' for UX)
ALTER TABLE public.calendar_sources DROP CONSTRAINT IF EXISTS calendar_sources_type_check;
ALTER TABLE public.calendar_sources ADD CONSTRAINT calendar_sources_type_check
  CHECK (type IN ('google', 'caldav', 'icloud', 'ical', 'microsoft'));
