# researchflo

A PWA for managing a research paper pipeline. Projects live on a Kanban board organized by pipeline stage (Planning → Data Collection → Preparing → Revision → Awaiting Reviews → On Ice). Includes task triage, a weekly calendar view for scheduling tasks, HotCRP paper review tracking, and a Claude MCP server for AI-assisted project management.

## Tech Stack

- **Framework7 + Vue 3 + Pinia** — component-based UI with iOS native feel
- **Vite + vite-plugin-pwa** — build tool + service worker / PWA manifest
- **Supabase** — backend: Postgres database, auth (magic link + passkeys), real-time subscriptions, Edge Functions
- **Google Calendar** — OAuth via Edge Functions; events linked to tasks
- **CalDAV / iCloud** — server-side CalDAV proxy Edge Function; supports generic CalDAV and iCloud calendars
- **GitHub Actions** (`deploy.yml`) — builds and deploys `dist/` to GitHub Pages on push to `main`
- **Google Fonts CDN** — Inter (UI font) + Phosphor Icons; loaded via `<link>` in `index.html`

### File Structure

```
src/
  main.js           — Vue app entry; F7 + Pinia setup; toggles .dark class on <html>
  config.js         — GCAL_CLIENT_ID constant
  routes.js         — F7 router routes (all pages listed below)
  App.vue           — f7-app root; auth gate (initialized/user); passkey setup modal; tab views
  pages/
    LoginPage.vue         — magic link email entry + passkey authentication
    BoardPage.vue         — main Kanban board with PTR, keyboard shortcuts, sidebar
    ProjectDetailPage.vue — split-panel project detail (/project/:id/)
    NewProjectPage.vue    — create a new project (/project/new/)
    InboxPage.vue         — inbox tasks (no project) + triage entry point (/inbox/)
    TaskDetailPage.vue    — full-page task detail with triage controls (/tasks/:id/)
    TaskTriagePage.vue    — triage/scheduling UI for a single task
    SchedulePage.vue      — weekly calendar view; drag tasks onto time slots (/schedule/)
    SchedulePlacePage.vue — intermediate page for placing a task on the calendar
    ReviewsPage.vue       — HotCRP paper review list, grouped by site (/reviews/)
    HotCRPPage.vue        — HotCRP CORS proxy + site management (/hotcrp/)
    SettingsPage.vue      — full-page settings: theme, stages, passkeys, calendar, HotCRP (/settings/)
    InvitePage.vue        — accept a collaboration invite via token (/invite/:token/)
  components/
    AppSidebar.vue      — shared sidebar: nav links, collaborator/venue filters, collapse toggle
    AppTabbar.vue       — bottom tab bar (Board, Inbox, Schedule, Settings)
    BoardColumn.vue     — single Kanban column
    ProjectCard.vue     — project card with drag-and-drop, inline status edit, energy indicator
    TaskItem.vue        — task row with complete/due date editing
    TaskDetailPanel.vue — task detail side panel shown in ProjectDetailPage
  stores/
    auth.js      — user/session, magic link sign-in, passkey prompt state; onAuthStateChange
    board.js     — projects, tasks, stages, filters, triage state, real-time subscriptions
    calendar.js  — Google Calendar OAuth + CalDAV/iCloud; event CRUD; scheduling
    reviews.js   — HotCRP sites, proxy URL, fetched paper results
    settings.js  — thin Supabase wrapper: load()/save(key, value) for user_settings rows
  lib/
    supabase.js  — createClient() singleton export
    passkey.js   — WebAuthn registration/authentication via passkey-* Edge Functions
    helpers.js   — pure functions: DEFAULT_STAGES, parseLocalDate, formatDate, etc.
    hotcrp.js    — fetchReviewPapers/fetchWhoami via configurable CORS proxy
    sortable.js  — minimal drag-to-reorder for stage list in SettingsPage
    todoist.js   — legacy Todoist API helpers (kept but unused; safe to ignore)
  composables/
    usePullToRefresh.js      — custom PTR (Touch Events, 80px threshold, drag conflict guard)
    useTheme.js              — theme cycling (auto/light/dark); OS change listener
    useSidebar.js            — singleton collapsed state + localStorage persistence
    useSchedulePrefs.js      — loads/caches scheduling preferences from user_settings
    useRelativeDateGroups.js — groups tasks by relative date bucket (Today, Tomorrow, etc.)
    useTaskTriage.js         — triage state machine (urgency + time estimate labels)
    useAccentColor.js        — accent color CSS var management
  assets/
    tokens.css    — CSS design tokens (light + dark)
    shared.css    — shared component styles
    board.css     — board + project card styles
    project.css   — project detail page styles
    schedule.css  — schedule page + calendar styles
    sidebar.css   — sidebar styles
    reviews.css   — reviews page styles
    token-page.css — login page styles
    fonts/        — IBM Plex Mono woff2 (used for .kbd elements only)
supabase/
  functions/
    _shared/
      caldav.ts             — shared CalDAV protocol utilities (used by caldav-proxy and mcp)
    caldav-proxy/           — server-side CalDAV proxy (discover, list, CRUD events)
    google-calendar-auth/   — OAuth authorization redirect
    google-calendar-token/  — OAuth code exchange + token refresh
    hotcrp-proxy/           — HotCRP CORS proxy (adds Authorization header server-side)
    mcp/                    — Model Context Protocol server (15 tools; used by Claude)
    invite-collaborator/    — email invite flow
    account-delete/         — GDPR account deletion
    passkey-register-start/ — WebAuthn credential creation challenge
    passkey-register-finish/— WebAuthn credential creation verification
    passkey-auth-start/     — WebAuthn authentication challenge
    passkey-auth-finish/    — WebAuthn authentication verification
    passkey-delete/         — remove a registered passkey
  migrations/               — timestamped SQL migrations applied to the live project
  templates/                — custom Supabase email templates (magic-link, invite, email-change)
public/
  favicon.ico   — multi-size favicon
  icons/        — PNG icons for PWA manifest (192px + 512px)
index.html      — Vite entry; anti-FOUC script; CSP meta tag
vite.config.js  — Vite + PWA manifest (app name: researchflo)
package.json
```

## Auth

Two sign-in methods, both passwordless:

1. **Magic link** — enter email on LoginPage; Supabase sends a link; clicking it exchanges the URL hash token for a session. After magic-link sign-in, App.vue prompts the user to register a passkey (`pendingPasskeySetup` flag on auth store).
2. **Passkey** — after registering, subsequent sign-ins use Face ID / Touch ID / device PIN via WebAuthn. The `passkey-*` Edge Functions handle challenge generation and credential verification against the `auth_challenges` and `passkeys` tables.

`App.vue` logic:
- `v-if="!authStore.initialized"` — shows nothing until `INITIAL_SESSION` fires (prevents flash on magic-link page load)
- `v-else-if="!authStore.user"` — shows LoginPage view
- Otherwise — shows four tab views: Board, Inbox, Schedule, Settings

## Database Schema

All tables have RLS enabled. Key tables:

**`stages`** — pipeline stages (system defaults have `owner_id IS NULL`; visible to all authenticated users)
- `id`, `owner_id`, `name`, `slug`, `icon`, `sort_order`

**`projects`** — research projects
- `id`, `name`, `owner_id`, `stage_id` (FK → stages), `status_text`, `venue`, `deadline`, `summary`, `submission_url`, `energy` (0/1/2 per-user via `project_energy` table), `is_inbox`, `sort_order`

**`people`** — collaborators decoupled from auth (uninvited people can be named before they join)
- `id`, `display_name`, `email`, `user_id` (FK → auth.users, NULL until they accept invite), `invite_token`, `invited_by`, `joined_at`
- On new auth.users insert: trigger `handle_new_user()` claims an existing `people` row by email or creates one

**`project_members`** — project ↔ person membership
- `(project_id, person_id)` PK, `role` ('owner'/'member'), `added_by`, `added_at`

**`tasks`**
- `id`, `project_id`, `created_by`, `assigned_to`, `content`, `description`, `priority` (1–4), `due_date`, `sort_order`, `is_completed`, `is_private`, `completed_at`
- `caldav_event_uid` — linked calendar event UID
- `caldav_calendar_id` — calendar href where the event lives
- `scheduled_at` — scheduled datetime (mirrors the event start)
- `labels text[]` — triage labels: `time::`, `importance::`, `scheduled`

**`user_settings`** — per-user preferences
- `user_id` (PK), `hotcrp_sites` (jsonb), `gcal_calendar_id`, `mcp_token` (uuid for Claude MCP auth)
- `theme`, `timezone`, `work_start_time`, `work_end_time`, `work_days int[]`, `default_task_duration_minutes`

**`calendar_sources`** — connected calendar accounts (replaces single gcal/caldav columns)
- `id`, `user_id`, `type` (CHECK: `google | caldav | icloud | ical | microsoft`), `name`, `url`, `username`, `password`
- `access_token`, `refresh_token`, `token_expires_at` — OAuth fields for Google
- `is_write_target` (boolean) — task events are written here
- `enabled` (boolean)

**`passkeys`** — WebAuthn credentials
- `id`, `user_id`, `credential_id`, `public_key`, `aaguid`, `sign_count`, `device_label`, `last_used_at`

**`auth_challenges`** — short-lived WebAuthn challenges (5-min TTL, service-role-only)

**`project_stage_history`** — stage transition log (appended by trigger on `projects.stage_id` update)

### RLS notes
- `can_access_project(pid)` — security-definer function used by projects/tasks policies to avoid recursion
- Tasks: visible if `is_private=false OR created_by=auth.uid()` AND user can access the project
- `calendar_sources`: `FOR ALL USING (user_id = auth.uid())` — fully private

## Edge Functions

All deployed to `https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/`.

| Function | Purpose |
|---|---|
| `caldav-proxy` | Server-side CalDAV XML-over-HTTP proxy; actions: `discover`, `list_calendars`, `get_events`, `create_event`, `update_event`, `delete_event`. Reads credentials from `calendar_sources` by `source_id` or accepts inline creds for initial connection testing. |
| `google-calendar-auth` | Generates OAuth authorization URL + PKCE/state |
| `google-calendar-token` | Exchanges authorization code for tokens; refreshes expired tokens |
| `hotcrp-proxy` | Adds `Authorization: Bearer` header server-side for HotCRP API requests |
| `mcp` | Claude MCP server with 15 tools (see below). Auth via `mcp_token` UUID from `user_settings`. |
| `invite-collaborator` | Inserts a `people` row and sends invite email |
| `account-delete` | Deletes user data + auth account |
| `passkey-register-start/finish` | WebAuthn credential registration flow |
| `passkey-auth-start/finish` | WebAuthn authentication flow |
| `passkey-delete` | Remove a registered passkey credential |

### Shared CalDAV module (`_shared/caldav.ts`)

Imported by `caldav-proxy` and `mcp`. Key exports:
- `caldavRequest(url, method, headers, body)` — uses `redirect: 'manual'` and manually follows Location header to preserve PROPFIND/REPORT method through 301 redirects (needed for iCloud well-known URL)
- `discoverCalDAV(server, auth)` — PROPFIND → `current-user-principal` → `calendar-home-set`
- `listCalendarsFromHomeSet(homeSetUrl, auth)` — PROPFIND Depth:1
- `getCalendarEvents(calHref, auth, timeMin, timeMax)` — REPORT with time-range filter
- `parseCalDAVDatetime(str, tzid?)` — handles all-day, UTC (`Z`), and TZID-aware local times
- `buildICS(...)` — produces CRLF-joined ICS; includes `X-RESEARCHBOARD-TASK-ID` property when `taskId` provided

### MCP Server Tools (15 total)

Used by Claude via the MCP protocol. Auth: `Authorization: Bearer {mcp_token}` where `mcp_token` is from `user_settings`.

| Tool | Description |
|---|---|
| `list_projects` | All projects with stage, task count, deadline, venue |
| `list_tasks` | Tasks by project or across all; optional `include_completed` |
| `get_project_stats` | Task completion stats + deadline overview |
| `mark_task_complete` | Mark a task done |
| `add_task` | Create a task; omit `project_id` for inbox |
| `update_task` | Update any task fields; move to different project |
| `add_project` | Create a new project |
| `update_project` | Update project metadata (stage, venue, deadline, status) |
| `get_stage_history` | Pipeline stage history for a project |
| `get_scheduling_preferences` | Timezone, working hours, working days, default duration |
| `update_scheduling_preferences` | Update scheduling prefs |
| `list_calendars` | All connected calendars (Google + CalDAV/iCloud) |
| `get_events` | Events from all connected sources; supports date or range |
| `schedule_task` | Create a linked calendar event and write reference to task |
| `reschedule_task` | Move an existing scheduled event to a new time |

## Calendar Integration

### Google Calendar
- OAuth via `google-calendar-auth` (redirect) → `google-calendar-token` (code exchange)
- Tokens stored in `calendar_sources` row with `type='google'`
- `calendar.js` calls `google-calendar-token` to get a fresh access token before any API call
- Events created via Google Calendar API; event ID stored in `tasks.caldav_event_uid`, calendar ID in `tasks.caldav_calendar_id`

### CalDAV / iCloud
- All CalDAV protocol runs server-side through `caldav-proxy` (CORS bypass)
- iCloud: uses well-known URL `https://caldav.icloud.com/.well-known/caldav` for discovery; requires app-specific password
- Credentials stored in `calendar_sources` row with `type='caldav'` or `type='icloud'`
- Multiple CalDAV sources can coexist; each is fetched in parallel in `loadCalDAVSources()`

### Unified Target Calendar
- `selectedTargetId` uses composite key format `google:::calId` or `caldav:::sourceId:::calHref`
- `:::` separator chosen because it can't appear in either calendar IDs or URLs
- `allCalendars` computed merges Google writables + CalDAV calendars for the "Write events to" dropdown
- Persisted to `localStorage('rb_cal_target_id')`

### Task–Event Link
- When a task is scheduled, `caldav_event_uid` (ICS UID) and `caldav_calendar_id` (calendar href or Google cal ID) are written to the task row
- `scheduledByTaskId` computed in calendar store maps task IDs to their events
- ICS events include `X-RESEARCHBOARD-TASK-ID` property to link back to tasks

## App Behaviour

- **Board** — one column per stage; projects without a stage appear in "Unassigned"
- **Drag and drop** — Pointer Events on `ProjectCard.vue`; updates `stage_id` in Supabase on drop; `cardDragging` flag prevents PTR during drag
- **Inline status edit** — clicking status line on a card opens an `<input>`; blur/Enter saves; Escape cancels
- **Stale indicator** — cards whose project hasn't been updated in >14 days show `!` badge; On Ice exempt
- **Energy indicator** — each project has a per-user energy level (0=none, 1=low, 2=high); shown on card
- **Project detail** — clicking a card navigates to `/project/:id/` (full-page split panel)
- **Quick-add task** — input at bottom of task list; Enter creates task via Supabase
- **Completed tasks** — fetched on demand per project; count shown in project detail header
- **Pull-to-refresh** — custom composable; Touch Events, 80px threshold; ignores events when `cardDragging`
- **Sidebar filters** — click a collaborator or venue to filter cards across all columns
- **Real-time** — `board.js` subscribes to Supabase Realtime on tasks and project_members tables after `loadData()`
- **Triage workflow** — inbox + all tasks flow through `InboxPage` → `TaskDetailPage`/`TaskTriagePage`; tasks get `importance::` and `time::` labels, then can be scheduled

## Sidebar / Navigation

`AppSidebar.vue` is used on Board and ProjectDetail pages (desktop only, `@media (min-width: 768px)`):
- Nav links: Board, Inbox, Schedule, Reviews, Settings
- Filters: Collaborators and Venues sections; clicking sets `store.activeFilter`
- Collapse: `useSidebar.js` singleton; persisted to `localStorage('rb_sidebar_collapsed')`
  - Collapsed = `width: 0; overflow: hidden`
  - Floating `sidebar-expand-btn` appears at `position: absolute; left: 12px` inside `.board-main` / `.project-main`

`AppTabbar.vue` — bottom tab bar visible on mobile (< 768px): Board, Inbox, Schedule, Settings tabs.

## HotCRP Reviews

Reviews page (`/reviews/`) shows papers assigned for review from one or more HotCRP instances.

- **`stores/reviews.js`** — holds `sites[]`, `proxyUrl`, `results[]`, `loading`, `lastUpdated`
- **`lib/hotcrp.js`** — `fetchReviewPapers(siteUrl, token, proxyUrl)` + `fetchWhoami`
- **`pages/HotCRPPage.vue`** — configure CORS proxy URL + add/remove HotCRP sites
- HotCRP API requires `Authorization: Bearer TOKEN` (query param `api_key` does not work)
- CORS proxy routes requests through a Cloudflare Worker (or `hotcrp-proxy` Edge Function); token sent as query param, Worker adds the header server-side

HotCRP sites stored as `[{id, url, token, name}]` in `localStorage('rb_hotcrp_sites')`. Proxy URL in `localStorage('rb_hotcrp_proxy')`.

## Theme

Three modes: **auto**, **light**, **dark**. Stored in `localStorage('rb_theme')`.
- Anti-FOUC inline script in `index.html` sets `data-theme` before Vue mounts
- `useTheme.js` handles cycling and OS change events; called in `App.vue`
- CSS: `:root` = light-first tokens; `html[data-theme="dark"]` overrides
- F7 dark mode: `<html>` gets both `data-theme="dark"` and `.dark` class

Anti-FOUC script: `(function(){var t=localStorage.getItem('rb_theme')||'auto';document.documentElement.dataset.theme=t==='dark'||t==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'})();`

To get its SHA-256 (needed for CSP): `printf '%s' '<script content>' | openssl dgst -sha256 -binary | openssl base64`

## PWA

- App name: **researchflo** (both `name` and `short_name` in manifest)
- `vite.config.js` generates manifest; icons split into separate `"any"` and `"maskable"` entries (combined `"any maskable"` causes macOS dock to apply safe-zone white border)
- `display: standalone`, `display_override: ['window-controls-overlay']`
- `theme_color: '#F5F5F7'`, `background_color: '#F5F5F7'`
- Safe area insets: `env(safe-area-inset-top)` on `.sidebar-brand`, `.board-main`, `.project-meta`, etc.
- `viewport-fit=cover` required for safe area insets

## Security

CSP via `<meta http-equiv="Content-Security-Policy">` in `index.html`:
- `script-src 'self' 'sha256-...'` — hash covers the inline anti-FOUC script
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
- `font-src 'self' data: https://fonts.gstatic.com`
- `connect-src https://oqqevpkeqcbkqrgabpkc.supabase.co https://accounts.google.com https:`

## CSS Notes

- **Design tokens**: `tokens.css` — light-first in `:root`; dark overrides in `html[data-theme="dark"]`. Key tokens: `--bg`, `--bg-surface`, `--bg-sidebar`, `--text`, `--text2`, `--text3`, `--border`, `--accent`, `--font`, `--stage-0` … `--stage-5`
- **Typography**: `--font` = Inter + system stack; IBM Plex Mono (`--font-code`) only for `.kbd`
- **F7 `.card` conflict**: F7 applies `margin: 16px` to all `.card` globally; override with `margin: 0`
- **Scroll-snap + padding**: `.board` uses `scroll-snap-type: x mandatory`; always set `scroll-padding-left` equal to `padding-left` to prevent first column being scrolled off
- **Media query placement**: CSS overrides for `.board` must come *after* the base rule in the file
- **`@keyframes ptr-spin`**: combines `translateX(-50%)` and `rotate(360deg)` — do not split
- **`.board-page .page-content`**: `padding: 0 !important`; safe area handled manually
- **Column scrollbars**: hidden via `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`

## Service Worker

Managed by `vite-plugin-pwa` in `generateSW` mode. Workbox precaches hashed assets; Supabase API calls use `NetworkFirst` strategy.

## Key localStorage Keys

| Key | Value |
|---|---|
| `rb_theme` | `"auto"` / `"light"` / `"dark"` |
| `rb_stages` | JSON array of stage objects (cache; source of truth is Supabase `stages` table) |
| `rb_sidebar_collapsed` | `"1"` (collapsed) or absent |
| `rb_hotcrp_sites` | JSON array of `{id, url, token, name}` |
| `rb_hotcrp_proxy` | CORS proxy URL string |
| `rb_gcal_calendar_id` | Selected Google Calendar ID (legacy; superseded by `rb_cal_target_id`) |
| `rb_cal_target_id` | Composite target calendar ID: `google:::calId` or `caldav:::sourceId:::calHref` |

## Intended Workflow

The app is a **pipeline overview** used on MacBook and tablet. Key use cases:
- **Passive overview** — all research projects at a glance
- **Status meetings** — walk through project states, capture tasks mid-conversation (via MCP or app)
- **Sprint planning** — decide which projects are in focus; set energy levels
- **Task scheduling** — triage inbox tasks (urgency + time estimate), then drag onto the weekly calendar

The MCP server connects to Claude Desktop/Claude.ai, enabling AI-assisted project management: list tasks, schedule them on the calendar, update project status — all from a Claude conversation.

