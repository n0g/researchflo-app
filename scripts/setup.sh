#!/usr/bin/env bash
# =============================================================
# researchflo — new deployment setup
#
# Prerequisites:
#   - Supabase CLI installed: https://supabase.com/docs/guides/cli
#   - A Supabase project created at https://supabase.com
#   - GitHub repository with Pages enabled (Settings → Pages → Deploy from branch: main)
#
# Usage:
#   ./scripts/setup.sh
# =============================================================

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

info()    { echo -e "${BOLD}$*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
error()   { echo -e "${RED}✗ $*${RESET}"; exit 1; }
step()    { echo; echo -e "${BOLD}── $* ──────────────────────────────────────────${RESET}"; }

# ── Check prerequisites ───────────────────────────────────────

step "Checking prerequisites"

command -v supabase >/dev/null 2>&1 || error "Supabase CLI not found. Install it: https://supabase.com/docs/guides/cli"
command -v node     >/dev/null 2>&1 || error "Node.js not found. Install it: https://nodejs.org"
success "Prerequisites OK"

# ── Collect inputs ────────────────────────────────────────────

step "Project configuration"

read -p "Supabase project ref (from project URL: supabase.com/dashboard/project/<REF>): " PROJECT_REF
read -p "Your app domain (e.g. researchflo.app or username.github.io/repo): " APP_DOMAIN
read -p "App name (shown in passkey prompts, default: researchflo): " APP_NAME
APP_NAME="${APP_NAME:-researchflo}"

# Derive origin — strip trailing slash
APP_ORIGIN="https://${APP_DOMAIN%/}"

# Handle GitHub Pages subpath
if [[ "$APP_DOMAIN" == *"github.io"* && "$APP_DOMAIN" != *"/"* ]]; then
  warn "GitHub Pages subdomain detected. If the app is at a subpath (e.g. /repo-name), re-run and include it in the domain."
fi

# ── Link Supabase project ─────────────────────────────────────

step "Linking Supabase project"
supabase link --project-ref "$PROJECT_REF"
success "Linked to project $PROJECT_REF"

# ── Apply database schema ─────────────────────────────────────

step "Applying database schema"
warn "This will push migrations to the REMOTE Supabase project."
read -p "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { warn "Skipped. Run 'supabase db push' manually later."; }

if [[ "$confirm" =~ ^[Yy]$ ]]; then
  supabase db push
  success "Schema applied"
fi

# ── Deploy edge functions ─────────────────────────────────────

step "Deploying edge functions"

FUNCTIONS=(
  passkey-auth-start
  passkey-auth-finish
  passkey-register-start
  passkey-register-finish
  passkey-delete
  invite-collaborator
  account-delete
  mcp
)

for fn in "${FUNCTIONS[@]}"; do
  echo -n "  Deploying $fn... "
  supabase functions deploy "$fn" --no-verify-jwt 2>/dev/null && echo -e "${GREEN}✓${RESET}" || echo -e "${RED}✗${RESET}"
done

# ── Set edge function secrets ─────────────────────────────────

step "Setting edge function secrets"

supabase secrets set \
  WEBAUTHN_RP_ID="$APP_DOMAIN" \
  WEBAUTHN_RP_ORIGIN="$APP_ORIGIN" \
  WEBAUTHN_RP_NAME="$APP_NAME"

success "Secrets set: WEBAUTHN_RP_ID, WEBAUTHN_RP_ORIGIN, WEBAUTHN_RP_NAME"

# ── Fetch Supabase project keys ───────────────────────────────

step "Fetching project keys"
echo "Fetching from Supabase..."
KEYS=$(supabase status 2>/dev/null || true)

# Extract anon key and URL from status output if available
SUPABASE_URL=$(echo "$KEYS" | grep "API URL" | awk '{print $NF}' || true)
ANON_KEY=$(echo "$KEYS"     | grep "anon key" | awk '{print $NF}' || true)

if [[ -z "$SUPABASE_URL" || -z "$ANON_KEY" ]]; then
  warn "Could not auto-fetch keys. Get them from: https://supabase.com/dashboard/project/${PROJECT_REF}/settings/api"
  read -p "Supabase URL (https://xxxx.supabase.co): " SUPABASE_URL
  read -p "Supabase anon key: " ANON_KEY
fi

# ── Write .env.local ──────────────────────────────────────────

step "Writing .env.local"

if [[ -f ".env.local" ]]; then
  warn ".env.local already exists — backing up to .env.local.bak"
  cp .env.local .env.local.bak
fi

cat > .env.local <<EOF
VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
EOF

success ".env.local written"

# ── GitHub Actions secrets reminder ──────────────────────────

step "GitHub Actions / deployment"

echo
info "Add these secrets to your GitHub repository"
info "(Settings → Secrets and variables → Actions → New repository secret):"
echo
echo "  VITE_SUPABASE_URL        = ${SUPABASE_URL}"
echo "  VITE_SUPABASE_ANON_KEY   = ${ANON_KEY}"
echo
warn "Optional: VITE_GCAL_CLIENT_ID  — Google OAuth client ID for Calendar integration"

# ── Supabase auth settings reminder ──────────────────────────

step "Manual steps required in Supabase dashboard"

echo
info "1. Enable Email OTP / Magic Link:"
echo "   Authentication → Providers → Email → enable 'Magic Link'"
echo
info "2. Set Site URL and redirect URLs:"
echo "   Authentication → URL Configuration"
echo "   Site URL: ${APP_ORIGIN}"
echo "   Redirect URLs: ${APP_ORIGIN}/**"
echo
info "3. Customize invite email template (optional):"
echo "   Authentication → Email Templates → Invite User"
echo "   The default template works; you can customize the wording."
echo

# ── Done ─────────────────────────────────────────────────────

echo
echo -e "${GREEN}${BOLD}Setup complete!${RESET}"
echo
echo "Next steps:"
echo "  1. Complete the manual Supabase dashboard steps above"
echo "  2. Add the GitHub Actions secrets above"
echo "  3. Push to main to trigger a deploy"
echo "  4. Sign in to the app and register a passkey in Settings"
echo
