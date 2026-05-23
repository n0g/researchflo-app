# Supabase + CalDAV Backend Migration Plan

## Context

The app currently uses Todoist as its entire backend — projects, tasks, stages, metadata (venue, deadline, summary, submission URL) are all encoded as Todoist tasks in special sections, with labels doing the work of a real schema. This works for a single user but can't support collaboration: PhD students would have to share their personal Todoist account, and there's no concept of private vs. shared tasks.

Moving to Supabase gives a real schema, per-row access control (RLS), real-time subscriptions, and user accounts. CalDAV (Radicale) replaces Google Calendar for shared scheduling. The Vue component tree and CSS stay untouched — only the data layer changes.

---

## Phase 1 — Supabase Schema (1–2 days)

**Goal:** Run SQL migrations, no app code yet.

### Tables

**`profiles`** — mirrors `auth.users`, created by trigger
```sql
CREATE TABLE public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email        text,
  created_at   timestamptz DEFAULT now()
);
```

**`stages`** — replaces `rb_stages` localStorage + `stage::` labels
```sql
CREATE TABLE public.stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES auth.users(id),  -- NULL = system default
  name       text NOT NULL,
  slug       text NOT NULL,   -- e.g. 'planning', 'data-collection'
  icon       text DEFAULT 'kanban',
  sort_order int  DEFAULT 0
);
-- Pre-populate with DEFAULT_STAGES from src/lib/helpers.js
```

**`projects`** — all metadata as first-class columns (no more special-section tasks)
```sql
CREATE TABLE public.projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  owner_id       uuid REFERENCES auth.users(id) NOT NULL,
  stage_id       uuid REFERENCES public.stages(id),
  status_text    text DEFAULT '',
  venue          text DEFAULT '',
  deadline       date,
  summary        text DEFAULT '',
  submission_url text DEFAULT '',
  energy         smallint DEFAULT 0,  -- 0=none 1=low 2=high
  is_inbox       boolean DEFAULT false,
  caldav_calendar_href text,          -- per-project shared calendar
  sort_order     int DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
```

**`project_members`** — replaces `person::Name` labels
```sql
CREATE TABLE public.project_members (
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text DEFAULT 'member',  -- 'owner' | 'member'
  joined_at  timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
```

**`tasks`** — CalDAV link and scheduled time as real columns
```sql
CREATE TABLE public.tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) NOT NULL,
  assigned_to         uuid REFERENCES auth.users(id),
  content             text NOT NULL,
  description         text DEFAULT '',
  priority            smallint DEFAULT 1,
  due_date            date,
  sort_order          int DEFAULT 0,
  is_completed        boolean DEFAULT false,
  is_private          boolean DEFAULT false,
  completed_at        timestamptz,
  caldav_event_uid    text,
  caldav_calendar_id  text,
  scheduled_at        timestamptz,
  labels              text[] DEFAULT '{}',  -- triage labels: time::, importance::, scheduled
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
```

**`user_settings`** — replaces all rb_* localStorage keys
```sql
CREATE TABLE public.user_settings (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stages          jsonb,
  hotcrp_sites    jsonb,
  hotcrp_proxy    text,
  caldav_server   text,
  caldav_username text,
  caldav_password text,
  theme           text DEFAULT 'auto',
  updated_at      timestamptz DEFAULT now()
);
```

### RLS Policies (key ones)

```sql
-- Projects: owner + members can read; only owner can write
CREATE POLICY "projects_select" ON public.projects FOR SELECT USING (
  auth.uid() = owner_id OR
  EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = auth.uid())
);
CREATE POLICY "projects_write" ON public.projects FOR ALL USING (auth.uid() = owner_id);

-- Tasks: is_private=false OR created_by=me, AND must be project member
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (
  (is_private = false OR created_by = auth.uid()) AND
  EXISTS (
    SELECT 1 FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id
    WHERE p.id = project_id AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
  )
);

-- All tables: enable RLS
ALTER TABLE public.projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages          ENABLE ROW LEVEL SECURITY;
```

### Triggers
- `set_updated_at()` on `projects` and `tasks`
- `handle_new_user()` on `auth.users` insert → creates `profiles` row

---

## Phase 2 — Auth Migration (0.5–1 day)

**Files:** `src/lib/supabase.js` (new), `src/stores/auth.js` (new), `src/pages/TokenPage.vue` → `LoginPage.vue`, `src/App.vue`

1. `npm install @supabase/supabase-js`, add `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to `.env.local`
2. Create `src/lib/supabase.js` — single shared `createClient()` export
3. Create `src/stores/auth.js` — extracts `user`, `session`, `signInWithEmail(email)`, `signOut()` from board.js; calls `supabase.auth.onAuthStateChange` for session sync
4. Replace `TokenPage.vue` with magic-link email form (`signInWithOtp`) + "check your email" confirmation state
5. `App.vue`: change `v-if="!store.token"` → `v-if="!authStore.user"`, call `authStore.init()` on mount

---

## Phase 3 — Data Layer Rewrite (3–5 days)

**Files:** `src/stores/board.js` (rewrite), `src/lib/todoist.js` (delete), `src/lib/helpers.js` (simplify)

**Public API surface of board.js stays identical** — all method names and reactive refs components use remain unchanged. Only internals change.

### What disappears
| Old | New |
|-----|-----|
| `apiAll('/projects')` + `apiAll('/tasks')` + `apiAll('/sections')` | Single `supabase.from('projects').select('*, stage:stages(*), members:project_members(user:profiles(*))')` |
| 4 special sections per project | Direct columns on `projects` table |
| `getProjectStage()` scanning all tasks | `project.stage_id` FK |
| `getProjectMeta()` | `project.venue` |
| `projectSummaryTask()` | `project.summary` |
| `projectSubmissionTask()` | `project.submission_url` |
| `getProjectDeadline()` | `project.deadline` |
| `excludedSectionIds`, `deadlineSectionIds`, `statusSectionIds` | Deleted |
| `deadlineSectionByProject` etc maps | Deleted |
| Sync API `item_reorder` | `supabase.from('tasks').update({sort_order})` |
| `📅 GCal:` description lines | `tasks.caldav_event_uid` + `caldav_calendar_id` |
| `📅 Scheduled:` description lines | `tasks.scheduled_at` |
| `isPersonLabel`, `stripPersonPrefix` | Deleted (collaborators are `project_members` rows) |

### One-time data migration script
`scripts/migrate-todoist.js` — Node.js script (run once, then archived):
1. Fetch all projects/tasks/sections from Todoist API using existing token
2. For each Research child project: insert `projects` row, map stage label → `stage_id`, extract metadata from special-section task contents
3. For each regular task: insert `tasks` row preserving `labels`, `priority`, `due_date`, `sort_order`
4. Parse `📅 GCal:` lines → set `caldav_event_uid` as placeholder (needs re-sync after Phase 5)

---

## Phase 4 — Collaboration + Real-time (1–2 days)

**Files:** `src/stores/board.js` (add subscription), `src/pages/ProjectDetailPage.vue` (membership UI)

### Real-time
After `loadData()`, subscribe to a Supabase Realtime channel:
```js
supabase.channel('board').on('postgres_changes', { event: '*', table: 'tasks' }, handler).subscribe()
```
Handler: INSERT → push, UPDATE → splice, DELETE → filter. RLS applies to realtime — users only receive rows they can SELECT.

### Membership management
- `addCollaborator(projectId, name)` → search `profiles` by `display_name`, insert `project_members` row
- `removeCollaborator(projectId, name)` → delete `project_members` row
- Method signatures unchanged; `ProjectDetailPage.vue` needs no changes
- Collaborator combo box searches `profiles` table instead of scanning task labels

### Private tasks
- `is_private` toggle in task detail panel
- `quickAddTask()` accepts optional `isPrivate` param
- RLS enforces visibility automatically

---

## Phase 5 — CalDAV Migration (2–3 days)

**Files:** `src/lib/caldav.js` (new), `src/stores/calendar.js` (rewrite internals), `src/pages/SettingsPage.vue` (CalDAV credentials)

### Prerequisite: Radicale CORS
Configure Radicale 3.x `[headers]` section:
```ini
Access-Control-Allow-Origin = *
Access-Control-Allow-Methods = GET, PUT, DELETE, REPORT, PROPFIND, OPTIONS
Access-Control-Allow-Headers = Authorization, Content-Type, Depth
```
**Test this before writing any CalDAV code** — if CORS isn't working in the browser, nothing else will.

### `src/lib/caldav.js`
Thin wrapper around CalDAV XML-over-HTTP:
- `fetchEvents(server, user, pass, calHref, timeMin, timeMax)` — REPORT with time-range filter
- `createEvent(server, user, pass, calHref, uid, icsData)` — PUT to `{calHref}{uid}.ics`
- `updateEvent(server, user, pass, eventHref, icsData, etag)` — PUT with If-Match
- `deleteEvent(server, user, pass, eventHref)` — DELETE
- `listCalendars(server, user, pass)` — PROPFIND depth-1
- `buildICS({ uid, summary, description, start, end, timezone })` — ICS string builder

### `src/stores/calendar.js` — public API unchanged
`isConnected`, `events`, `loading`, `loadWeekEvents`, `createEvent`, `updateEvent`, `deleteAllByTaskId`, `syncEventForTask` all keep same signatures. `SchedulePage.vue` needs zero changes.

Internal changes:
- `isConnected` = `computed(() => !!(settings.caldav_server && settings.caldav_username))`
- `connect()` → `testConnection()` via PROPFIND
- Token refresh / OAuth logic deleted (CalDAV uses Basic Auth)
- `scheduledByTaskId` map: match events by UID against `task.caldav_event_uid` instead of `extendedProperties`
- After creating event: call `boardStore.saveCalDAVEvent(taskId, uid, calHref)` to persist to tasks table

### Settings UI
Replace Google Calendar section with:
- Server URL, Username, Password inputs + Test Connection button
- Calendar list (fetched via `listCalendars`) with checkboxes for which to display

---

## Phase 6 — New Features (à la carte)

Each is independent once Phase 1–5 is done:

- **Meeting log**: New `meetings` table (project_id, title, held_at, notes, attendees[]). New tab in `ProjectDetailPage.vue`.
- **Task assignment**: Add `assigned_to uuid` to `tasks`. Assignee picker in task detail.
- **Resources section**: New `resources` table (project_id, title, url, file_path). Supabase Storage for PDF uploads.
- **Completed task archive**: `is_completed=true` instead of deleting. Archive view in project detail.

---

## Effort Summary

| Phase | Description | Est. Days |
|-------|-------------|-----------|
| 1 | Schema + Supabase setup | 1–2 |
| 2 | Auth (magic link) | 0.5–1 |
| 3 | Data layer rewrite + migration script | 3–5 |
| 4 | Collaboration + real-time | 1–2 |
| 5 | CalDAV | 2–3 |
| **Total 1–5** | | **8–13 days** |

## Key Risks

- **Radicale CORS** — must be solved before any CalDAV browser code works. Test with a raw `fetch()` before writing the store.
- **`caldav_password` in Supabase** — acceptable for a self-hosted tool but consider client-side AES encryption via Web Crypto API if you want defense-in-depth.
- **Reorder N+1** — `reorderTasks` will fire N individual UPDATEs instead of one Sync API batch call. For 5–20 tasks this is fine; use optimistic updates so the UI doesn't wait.
- **Inbox identity** — current app finds inbox by `is_inbox_project` flag from Todoist. Migration script must set `is_inbox=true` on the migrated inbox project.
