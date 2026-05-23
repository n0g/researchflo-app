import { supabase } from './supabase.js'

const PROXY_URL = 'https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/hotcrp-proxy'

export async function fetchWhoami(siteUrl, token) {
  return _hotcrpGet(siteUrl, token, '/api/whoami')
}

export async function fetchReviewPapers(siteUrl, token) {
  const data = await _hotcrpGet(siteUrl, token, '/api/papers?q=re:me')
  return Array.isArray(data) ? data : (data.papers || [])
}

export async function fetchPaperStatus(siteUrl, paperId, token) {
  const data = await _hotcrpGet(siteUrl, token, `/api/papers?q=${paperId}`)
  if (Array.isArray(data)) return data[0] ?? null
  if (data.papers) return data.papers[0] ?? null
  return data.pid ? data : null
}

export function extractPaperId(submissionUrl) {
  const pathMatch = submissionUrl.match(/\/paper(?:\.php)?\/(\d+)/)
  if (pathMatch) return pathMatch[1]
  const queryMatch = submissionUrl.match(/[?&]p=(\d+)/)
  if (queryMatch) return queryMatch[1]
  return null
}

export function matchSiteForUrl(sites, submissionUrl) {
  if (!submissionUrl) return null
  return sites.find(s => submissionUrl.startsWith(s.url)) ?? null
}

function _normalizeError(err) {
  const msg = err.message || ''
  if (/function not found|api function missing/i.test(msg)) return new Error('Paper status not available on this HotCRP version')
  if (/bad request/i.test(msg) || msg === 'HTTP 400') return new Error('Request not supported — this HotCRP version may not support this feature')
  if (msg === 'HTTP 401') return new Error('Unauthorized — check your API token')
  if (msg === 'HTTP 403') return new Error('Access denied — check your API token')
  return err
}

async function _hotcrpGet(siteUrl, token, path) {
  const base = siteUrl.replace(/\/+$/, '')
  try {
    return await _hotcrpFetch(`${base}${path}`, token)
  } catch (err) {
    if (!/function not found/i.test(err.message)) throw _normalizeError(err)
    const phpPath = path.replace(/^\/api\//, '/api.php/')
    try {
      return await _hotcrpFetch(`${base}${phpPath}`, token)
    } catch (retryErr) {
      if (!/function not found/i.test(retryErr.message)) throw _normalizeError(retryErr)
      const singularPath = phpPath.replace('/papers', '/paper')
      if (singularPath === phpPath) throw _normalizeError(retryErr)
      try {
        return await _hotcrpFetch(`${base}${singularPath}`, token)
      } catch (finalErr) {
        throw _normalizeError(finalErr)
      }
    }
  }
}

async function _hotcrpFetch(hotcrpUrl, token) {
  const { data: { session } } = await supabase.auth.getSession()
  const url = `${PROXY_URL}?url=${encodeURIComponent(hotcrpUrl)}&token=${encodeURIComponent(token)}`
  const init = session ? { headers: { Authorization: `Bearer ${session.access_token}` } } : {}

  let r
  try {
    r = await fetch(url, init)
  } catch {
    throw new Error('Network error — check your connection')
  }

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (text.trim().startsWith('<')) throw new Error('Got HTML — check the site URL is correct')
    throw new Error(`HTTP ${r.status}`)
  }

  const data = await r.json()
  if (data.ok === false) {
    const msg = data.message_list?.[0]?.message?.replace(/^<\d+>/, '').trim() || 'HotCRP API error'
    throw new Error(msg)
  }
  return data
}
