-- ============================================================
-- Passkey authentication tables
-- Run in Supabase SQL editor after supabase-migration.sql
-- ============================================================

-- Passkeys (WebAuthn credentials)
CREATE TABLE IF NOT EXISTS public.passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    text NOT NULL,   -- base64url-encoded COSE public key (Uint8Array)
  aaguid        text DEFAULT '',
  sign_count    bigint DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  last_used_at  timestamptz DEFAULT now()
);

ALTER TABLE public.passkeys ENABLE ROW LEVEL SECURITY;

-- Users can see their own passkeys (e.g., to list them in settings)
CREATE POLICY "passkeys_select_own" ON public.passkeys
  FOR SELECT USING (user_id = auth.uid());

-- INSERT / UPDATE / DELETE only via edge functions using service role key


-- Short-lived WebAuthn challenges (5-minute TTL)
-- Accessed only via service role key from edge functions — no client policies needed
CREATE TABLE IF NOT EXISTS public.auth_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge  text NOT NULL UNIQUE,
  type       text NOT NULL,   -- 'register' | 'authenticate'
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

ALTER TABLE public.auth_challenges ENABLE ROW LEVEL SECURITY;
-- No policies: all access is via service role key in edge functions
