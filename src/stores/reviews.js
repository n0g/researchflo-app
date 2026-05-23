import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchReviewPapers, fetchPaperStatus, extractPaperId, matchSiteForUrl } from '../lib/hotcrp.js'

const SITES_KEY = 'rb_hotcrp_sites'

export const useReviewsStore = defineStore('reviews', () => {
  const sites = ref(JSON.parse(localStorage.getItem(SITES_KEY) || '[]'))
  const results = ref([])
  const loading = ref(false)
  const lastUpdated = ref(null)
  const submissionStatuses = ref({})

  function saveSites() {
    localStorage.setItem(SITES_KEY, JSON.stringify(sites.value))
  }

  function setSites(newSites) {
    sites.value = newSites
    saveSites()
  }

  function addSite(url, token, name) {
    const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
    sites.value.push({
      id: Date.now().toString(),
      url: url.replace(/\/+$/, ''),
      token,
      name: name.trim() || hostname,
    })
    saveSites()
  }

  function removeSite(id) {
    sites.value = sites.value.filter(s => s.id !== id)
    results.value = results.value.filter(r => r.site.id !== id)
    saveSites()
  }

  async function loadAll() {
    if (!sites.value.length) return
    loading.value = true
    try {
      const settled = await Promise.allSettled(
        sites.value.map(site => fetchReviewPapers(site.url, site.token))
      )
      results.value = settled.map((r, i) => ({
        site: sites.value[i],
        papers: r.status === 'fulfilled' ? r.value : [],
        error: r.status === 'rejected' ? (r.reason?.message || 'Failed to load') : null,
      }))
      lastUpdated.value = new Date()
    } finally {
      loading.value = false
    }
  }

  async function loadSubmissionStatuses(projects) {
    if (!sites.value.length) return
    const TEN_MIN = 10 * 60 * 1000
    const now = Date.now()
    const toFetch = projects.filter(({ id, submissionUrl }) => {
      if (!submissionUrl) return false
      const site = matchSiteForUrl(sites.value, submissionUrl)
      if (!site || !extractPaperId(submissionUrl)) return false
      const cached = submissionStatuses.value[id]
      return !cached || now - cached.fetchedAt > TEN_MIN
    })
    if (!toFetch.length) return
    await Promise.allSettled(toFetch.map(async ({ id, submissionUrl }) => {
      const site = matchSiteForUrl(sites.value, submissionUrl)
      const pid = extractPaperId(submissionUrl)
      try {
        const paper = await fetchPaperStatus(site.url, pid, site.token)
        if (paper) {
          submissionStatuses.value = {
            ...submissionStatuses.value,
            [id]: { status: paper.status || (paper.submitted ? 'submitted' : 'not submitted'), fetchedAt: Date.now() },
          }
        }
      } catch (err) {
        submissionStatuses.value = {
          ...submissionStatuses.value,
          [id]: { status: null, error: err.message || 'Status unavailable', fetchedAt: Date.now() },
        }
      }
    }))
  }

  return { sites, results, loading, lastUpdated, submissionStatuses, addSite, removeSite, setSites, loadAll, loadSubmissionStatuses }
})
