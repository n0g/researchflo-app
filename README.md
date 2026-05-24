# researchflo

A self-hosted PWA for academic researchers to track research projects across a customizable pipeline — from planning through submission and revision. Designed to be the one-screen overview you open in meetings and sprint planning sessions.

Built with Vue 3, Supabase, and Framework7. Runs on GitHub Pages with a Supabase backend.

## Features

### Pipeline board
Kanban board with one column per stage. Default stages: Planning → Data Collection → Preparing → Revision → Awaiting Reviews → On Ice. Stages are fully configurable per user. Drag projects between columns to move them through the pipeline.

### Project detail
Tap any card to open a split-panel view. Left pane: metadata (status, collaborators, venue, deadline, submission URL, energy level, summary). Right pane: task list with quick-add, due dates, and priority.

### Task inbox & triage
Tasks not assigned to a project land in the Inbox. Drag to reorder. Triage tasks by urgency and time estimate before execution.

### Schedule
Calendar view for scheduling tasks to specific time slots. Integrates with Google Calendar.

### Collaboration
Invite collaborators to projects by name. Add their email address in Settings and send them an invite — they receive a sign-in link that automatically claims their spot.

### Authentication
- **Passkeys** — Touch ID / Face ID via iCloud Keychain. No password needed after the first sign-in.
- **Magic link** — fallback email sign-in for any device.

### HotCRP integration (optional)
Connect one or more HotCRP instances to display paper review status on project cards and in the detail view.

### PWA
Installable on iPhone, iPad, and Mac. Works offline using the last cached state. Optimized for both desktop (sidebar navigation) and mobile (bottom tab bar).

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | Vue 3 + Pinia + Framework7 |
| Build | Vite + vite-plugin-pwa |
| Backend | Supabase (Postgres + Auth + Edge Functions) |
| Hosting | GitHub Pages |
| Auth | WebAuthn (passkeys) + Supabase magic link |

## Deploying your own instance

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- A free [Supabase](https://supabase.com) account and project
- A GitHub repository with Pages enabled

### 1. Fork and clone

```bash
git clone https://github.com/YOUR_USERNAME/researchflo-app.git
cd researchflo-app
npm install
```

### 2. Run the setup script

```bash
./scripts/setup.sh
```

The script will ask for your Supabase project ref and app domain, then:
- Apply the database schema (`supabase db push`)
- Deploy all edge functions
- Set WebAuthn secrets
- Write `.env.local` with your project keys
- Print the remaining manual steps

### 3. Manual steps in the Supabase dashboard

**Authentication → Providers → Email**: enable **Magic Link**.

**Authentication → URL Configuration**:
- Site URL: `https://your-domain.com`
- Redirect URLs: `https://your-domain.com/**`

### 4. Add GitHub Actions secrets

In your repo: **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `VITE_SUPABASE_URL` | From Supabase: Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | From Supabase: Project Settings → API |

Optional:

| Secret | Value |
|--------|-------|
| `VITE_GCAL_CLIENT_ID` | Google OAuth client ID for Calendar integration |

### 5. Deploy

Push to `main`. GitHub Actions builds and deploys to Pages automatically (~1 minute).

### 6. First sign-in

1. Open the app and enter your email — you'll receive a magic link.
2. After signing in, go to **Settings → Account → Add passkey** to set up Touch ID / Face ID for future logins.

## Local development

```bash
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Edge functions run on Supabase's servers (no local emulation needed unless you install Docker).

## HotCRP setup (optional)

To show paper review statuses from a HotCRP conference system, go to **Settings → Review Sites** and add your HotCRP base URL and API token (found in your HotCRP profile). The app proxies requests through a Supabase Edge Function so no separate CORS proxy is needed.

## Accessibility

The app targets WCAG 2.1 AA. Focus is managed on all interactive elements, dialogs have proper ARIA roles and labels, live regions announce loading state changes, and all animations are suppressed under `prefers-reduced-motion`.

## Security & privacy

**Your data stays yours.** Everything is stored in your own Supabase project — the app has no analytics, no telemetry, and no third-party data collection.

**Authentication** uses WebAuthn passkeys (Touch ID / Face ID via the device's secure enclave) with magic-link email as a fallback. Passwords are never stored. Sessions are JWT-based and managed by Supabase Auth.

**Row-level security** is enforced at the database level: every query is constrained to rows the authenticated user owns or has been explicitly invited to. Edge functions that need elevated access use a service role key that never reaches the client.

**Content Security Policy** is set via a `<meta>` tag in `index.html`, restricting script execution to hashed inline scripts and same-origin sources.
