-- Add MCP API token to user_settings for MCP server authentication
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS mcp_token uuid DEFAULT gen_random_uuid();

UPDATE public.user_settings
  SET mcp_token = gen_random_uuid()
  WHERE mcp_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_settings_mcp_token_idx
  ON public.user_settings(mcp_token);
