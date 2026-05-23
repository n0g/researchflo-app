#!/usr/bin/env node
/**
 * One-time migration: Todoist Research projects → Supabase
 *
 * Usage:
 *   TODOIST_TOKEN=xxx \
 *   SUPABASE_URL=xxx \
 *   SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   USER_ID=xxx \
 *   node scripts/migrate-todoist.mjs
 *
 * Find your USER_ID in Supabase dashboard → Authentication → Users.
 */

import { createClient } from '@supabase/supabase-js'

const { TODOIST_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USER_ID } = process.env
if (!TODOIST_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !USER_ID) {
  console.error('Missing env vars: TODOIST_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USER_ID')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Todoist helpers ──────────────────────────────────────────────────────────

async function tGet(path) {
  const res = await fetch(`https://api.todoist.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  })
  if (!res.ok) throw new Error(`Todoist ${res.status}: ${path}`)
  return res.json()
}

async function tGetAll(path) {
  const results = []
  let cursor = null
  do {
    const url = cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${cursor}` : path
    const data = await tGet(url)
    if (Array.isArray(data)) { results.push(...data); break }
    results.push(...(data.results || []))
    cursor = data.next_cursor ?? null
  } while (cursor)
  return results
}

// Completed tasks come from the Sync API (REST API only returns active tasks)
async function tGetCompleted(projectId) {
  const results = []
  let cursor = null
  do {
    const params = new URLSearchParams({ project_id: projectId, limit: '200' })
    if (cursor) params.set('cursor', cursor)
    const res = await fetch(`https://api.todoist.com/sync/v9/items/completed/get_all?${params}`, {
      headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
    })
    if (!res.ok) break
    const data = await res.json()
    results.push(...(data.items || []))
    cursor = data.has_more ? data.next_cursor : null
  } while (cursor)
  return results
}

// ── Parse Todoist encoding ───────────────────────────────────────────────────

const STAGE_LABELS = new Set([
  'stage::planning', 'stage::data-collection', 'stage::preparing-to-submit',
  'stage::revision', 'stage::under-submission', 'stage::on-ice',
])
const ENERGY_LOW  = 'sprint::energy-1'
const ENERGY_HIGH = 'sprint::energy-2'

function parseGCalLine(desc) {
  const line = (desc || '').split('\n').find(l => l.startsWith('📅 GCal:'))
  if (!line) return null
  const parts = line.slice('📅 GCal: '.length).split('|')
  return parts.length === 2 ? { eventId: parts[0], calId: parts[1] } : null
}

function parseScheduledLine(desc) {
  const line = (desc || '').split('\n').find(l => l.startsWith('📅 Scheduled:'))
  if (!line) return null
  const m = line.match(/\(([^)]+)\)$/)
  return m ? m[1] : null
}

function cleanDescription(desc) {
  return (desc || '').split('\n')
    .filter(l => !l.startsWith('📅 GCal:') && !l.startsWith('📅 Scheduled:'))
    .join('\n').trim()
}

function taskToRow(t, supabaseProjectId, order) {
  const gcal = parseGCalLine(t.description)
  const scheduledAt = parseScheduledLine(t.description)
  return {
    project_id: supabaseProjectId,
    created_by: USER_ID,
    content: t.content,
    description: cleanDescription(t.description),
    priority: t.priority ?? 1,
    due_date: t.due?.date ?? null,
    sort_order: t.order ?? order,
    is_completed: !!(t.is_completed || t.checked),
    completed_at: t.completed_at ?? null,
    labels: (t.labels || []).filter(l =>
      !STAGE_LABELS.has(l) && l !== ENERGY_LOW && l !== ENERGY_HIGH && !l.startsWith('person::')
    ),
    caldav_event_uid: gcal?.eventId ?? null,
    caldav_calendar_id: gcal?.calId ?? null,
    scheduled_at: scheduledAt ?? null,
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Fetching Todoist data…')
  const allProjects = await tGetAll('/projects')
  const root = allProjects.find(p => !p.parent_id && p.name === 'Research')
  if (!root) throw new Error('No "Research" project found in Todoist')

  const researchProjects = allProjects.filter(p => p.parent_id === root.id)
  console.log(`   Found ${researchProjects.length} research projects\n`)

  const allSections = await tGetAll('/sections')

  // Build per-project section ID maps
  const statusSec   = new Map()
  const deadlineSec = new Map()
  const summarySec  = new Map()
  const submSec     = new Map()
  for (const s of allSections) {
    if (!researchProjects.find(p => p.id === s.project_id)) continue
    if (s.name === '📌 Current Status') statusSec.set(s.project_id, s.id)
    if (s.name === '📌 Deadlines')      deadlineSec.set(s.project_id, s.id)
    if (s.name === '📌 Summary')        summarySec.set(s.project_id, s.id)
    if (s.name === '📌 Submission')     submSec.set(s.project_id, s.id)
  }

  const excludedSectionIds = new Set([
    ...statusSec.values(), ...deadlineSec.values(),
    ...summarySec.values(), ...submSec.values(),
  ])

  // Fetch Supabase stages to map label → UUID
  const { data: supStages, error: stagesErr } = await supabase.from('stages').select('id, slug')
  if (stagesErr) throw new Error(`Could not fetch stages: ${stagesErr.message}`)
  const stageByLabel = new Map(supStages.map(s => [`stage::${s.slug}`, s.id]))

  // ── Migrate user settings ────────────────────────────────────────────────
  console.log('⚙️  Migrating user settings…')
  try {
    const allProjectsForSettings = allProjects
    const settingsProject = allProjectsForSettings.find(
      p => !p.parent_id && (p.name === 'Settings' || p.name === 'Research Runway Settings')
    )
    if (settingsProject) {
      const settingsTasks = await tGetAll(`/tasks?project_id=${settingsProject.id}`)
      const settingsTask = settingsTasks.find(t => t.content === 'app-settings') ?? settingsTasks[0] ?? null
      if (settingsTask?.description) {
        const parsed = JSON.parse(settingsTask.description)
        const { error: settingsErr } = await supabase.from('user_settings').upsert({
          user_id: USER_ID,
          stages: parsed.stages ?? null,
          hotcrp_sites: parsed.hotcrp_sites ?? null,
          hotcrp_proxy: parsed.hotcrp_proxy ?? null,
        }, { onConflict: 'user_id', ignoreDuplicates: false })
        if (settingsErr) {
          console.error(`   ✗ Settings upsert failed: ${settingsErr.message}`)
        } else {
          console.log(`   ✓ stages, hotcrp_sites, hotcrp_proxy`)
        }
      } else {
        console.log('   (no app-settings task found — skipping)')
      }
    } else {
      console.log('   (no Settings project found — skipping)')
    }
  } catch (e) {
    console.warn('   (settings migration failed:', e.message + ')')
  }

  console.log('\n📦 Migrating projects…')

  for (const project of researchProjects) {
    console.log(`\n  ${project.name}`)

    // Fetch active tasks for this project
    const activeTasks = await tGetAll(`/tasks?project_id=${project.id}`)

    // ── Extract metadata from special sections ──
    const statusTask = activeTasks.find(t => t.section_id === statusSec.get(project.id))
    const deadlineTask = activeTasks.find(t => t.section_id === deadlineSec.get(project.id))
    const summaryTask  = activeTasks.find(t => t.section_id === summarySec.get(project.id))
    const submTask     = activeTasks.find(t => t.section_id === submSec.get(project.id))

    let stageId = null, statusText = '', energy = 0
    if (statusTask) {
      const stageLabel = (statusTask.labels || []).find(l => STAGE_LABELS.has(l))
      stageId = stageLabel ? (stageByLabel.get(stageLabel) ?? null) : null
      statusText = statusTask.content || ''
      const lbs = statusTask.labels || []
      energy = lbs.includes(ENERGY_HIGH) ? 2 : lbs.includes(ENERGY_LOW) ? 1 : 0
    }

    const venue       = deadlineTask?.content?.trim() || ''
    const deadline    = deadlineTask?.due?.date ?? null
    const summary     = summaryTask?.content?.trim() || ''
    const submissionUrl = submTask?.content?.trim() || ''

    console.log(`    stage: ${stageId ? stageByLabel.has([...stageByLabel.entries()].find(([,v]) => v === stageId)?.[0] ?? '') ? 'mapped' : 'mapped' : 'none'}  venue: ${venue || '—'}  deadline: ${deadline || '—'}`)

    // ── Insert project row ──
    const { data: inserted, error: projErr } = await supabase
      .from('projects')
      .insert({
        name: project.name,
        owner_id: USER_ID,
        stage_id: stageId,
        status_text: statusText,
        venue,
        deadline,
        summary,
        submission_url: submissionUrl,
        energy,
        is_inbox: false,
        sort_order: project.child_order ?? 0,
      })
      .select('id')
      .single()

    if (projErr) {
      console.error(`    ✗ Insert failed: ${projErr.message}`)
      continue
    }

    const sbProjectId = inserted.id

    // Add user as project owner
    await supabase.from('project_members').insert({
      project_id: sbProjectId,
      user_id: USER_ID,
      role: 'owner',
    })

    // ── Migrate active tasks ──
    const regularActive = activeTasks.filter(t => !excludedSectionIds.has(t.section_id))

    // ── Migrate completed tasks ──
    let completedTasks = []
    try {
      const raw = await tGetCompleted(project.id)
      // Completed task items from sync API have slightly different shape
      completedTasks = raw
        .filter(t => !excludedSectionIds.has(t.section_id))
        .map(t => ({ ...t, is_completed: true }))
    } catch {
      console.log('    (could not fetch completed tasks — Sync API may be unavailable)')
    }

    const allRegularTasks = [...regularActive, ...completedTasks]

    if (allRegularTasks.length > 0) {
      const rows = allRegularTasks.map((t, i) => taskToRow(t, sbProjectId, i))
      const { error: taskErr } = await supabase.from('tasks').insert(rows)
      if (taskErr) {
        console.error(`    ✗ Tasks insert failed: ${taskErr.message}`)
      } else {
        console.log(`    ✓ ${regularActive.length} active + ${completedTasks.length} completed tasks`)
      }
    } else {
      console.log(`    ✓ no tasks`)
    }
  }

  console.log('\n✅ Migration complete!')
  console.log('   Check your Supabase dashboard to verify before cutting over.')
}

main().catch(e => { console.error('\n💥 Migration failed:', e.message); process.exit(1) })
