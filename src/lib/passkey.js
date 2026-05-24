import { supabase } from './supabase.js'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callFn(name, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error(`[passkey] network error calling ${name}:`, err)
    throw new Error(`Network error: ${err.message}`)
  }
  let data
  try {
    data = await res.json()
  } catch {
    console.error(`[passkey] non-JSON response from ${name}, status ${res.status}`)
    throw new Error(`${name} returned an unexpected response (${res.status})`)
  }
  if (!res.ok) {
    console.error(`[passkey] ${name} error response:`, data)
    throw new Error(data.error || `${name} failed`)
  }
  return data
}

function b64urlToBuffer(b64url) {
  const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function bufferToB64url(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function encodeAssertionCredential(cred) {
  return {
    id: cred.id,
    rawId: bufferToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToB64url(cred.response.clientDataJSON),
      authenticatorData: bufferToB64url(cred.response.authenticatorData),
      signature: bufferToB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bufferToB64url(cred.response.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  }
}

function encodeAttestationCredential(cred) {
  return {
    id: cred.id,
    rawId: bufferToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToB64url(cred.response.clientDataJSON),
      attestationObject: bufferToB64url(cred.response.attestationObject),
      transports: cred.response.getTransports?.() || [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  }
}

export function isPasskeySupported() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get)
}

function getDeviceLabel() {
  const ua = navigator.userAgent
  let device = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Win/.test(navigator.platform || '') ? 'Windows'
    : /Mac/.test(navigator.platform || '') ? 'Mac'
    : 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : ''
  return browser ? `${device} · ${browser}` : device
}

// Try to sign in with a discoverable passkey (no email required).
// Returns true on success, null if no passkey available or cancelled, throws on server error.
export async function tryDiscoverableAuth() {
  if (!isPasskeySupported()) return null

  const { challengeId, options } = await callFn('passkey-auth-start', {})

  let cred
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: b64urlToBuffer(options.challenge),
        rpId: window.location.hostname,
        userVerification: 'preferred',
        timeout: 60000,
      },
    })
  } catch (err) {
    // User cancelled or no passkey available — not an error
    if (err.name === 'NotAllowedError' || err.name === 'AbortError' || err.name === 'NotSupportedError') return null
    return null
  }
  if (!cred) return null

  // Server errors propagate so the UI can show them
  const { access_token, refresh_token } = await callFn('passkey-auth-finish', {
    challengeId,
    credential: encodeAssertionCredential(cred),
  })
  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error) throw error
  return true
}

// Sign in with a passkey for a specific email.
// Returns { hasPasskey: false } if the user has no registered passkey.
// Throws on authentication failure.
export async function authenticateWithPasskey(email) {
  const { challengeId, options, hasPasskey } = await callFn('passkey-auth-start', { email })
  if (!hasPasskey) return { hasPasskey: false }

  const allowCredentials = (options.allowCredentials || []).map((c) => ({
    ...c,
    id: b64urlToBuffer(c.id),
  }))

  let cred
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: b64urlToBuffer(options.challenge),
        rpId: window.location.hostname,
        allowCredentials,
        userVerification: 'preferred',
        timeout: 60000,
      },
    })
  } catch (err) {
    if (err.name === 'NotAllowedError') throw new Error('cancelled')
    throw err
  }
  if (!cred) throw new Error('No credential returned')

  const { access_token, refresh_token } = await callFn('passkey-auth-finish', {
    challengeId,
    credential: encodeAssertionCredential(cred),
  })
  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error) throw error
  return { hasPasskey: true }
}

// Register a new passkey for the currently signed-in user.
// Returns true on success, throws 'cancelled' if user dismissed the dialog.
export async function registerPasskey() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const { challengeId, options } = await callFn(
    'passkey-register-start',
    {},
    session.access_token,
  )

  let cred
  try {
    const publicKeyOptions = {
      ...options,
      challenge: b64urlToBuffer(options.challenge),
      user: {
        id: b64urlToBuffer(options.user.id),
        name: options.user.name || options.user.displayName || 'user',
        displayName: options.user.displayName || options.user.name || 'User',
      },
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({
        ...c,
        id: b64urlToBuffer(c.id),
      })),
    }
    console.log('[passkey] calling credentials.create, rpId:', publicKeyOptions.rp?.id)
    cred = await navigator.credentials.create({ publicKey: publicKeyOptions })
    console.log('[passkey] credentials.create result:', cred ? `ok (id=${cred.id?.slice(0,12)}…)` : 'null')
  } catch (err) {
    console.error('[passkey] credentials.create threw:', err.name, err.message)
    if (err.name === 'NotAllowedError') throw new Error('cancelled')
    throw err
  }
  if (!cred) throw new Error('No credential created')

  console.log('[passkey] calling register-finish')
  await callFn(
    'passkey-register-finish',
    { challengeId, credential: encodeAttestationCredential(cred), deviceLabel: getDeviceLabel() },
    session.access_token,
  )
  return true
}

export async function listPasskeys() {
  const { data, error } = await supabase
    .from('passkeys')
    .select('id, device_label, created_at, last_used_at')
    .order('created_at', { ascending: true })
  if (error) console.error('[passkey] listPasskeys error:', error)
  return data || []
}

export async function deletePasskey(id) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  await callFn('passkey-delete', { passkeyId: id }, session.access_token)
}
