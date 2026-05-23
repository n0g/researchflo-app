import { supabase } from './supabase.js'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callFn(name, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${name} failed`)
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

// Try to sign in with a discoverable passkey (no email required).
// Returns true on success, null if no passkey available or cancelled.
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
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') return null
    return null
  }
  if (!cred) return null

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
    console.log('[passkey] register options.user:', JSON.stringify(options.user))
    cred = await navigator.credentials.create({ publicKey: publicKeyOptions })
  } catch (err) {
    if (err.name === 'NotAllowedError') throw new Error('cancelled')
    throw err
  }
  if (!cred) throw new Error('No credential created')

  await callFn(
    'passkey-register-finish',
    { challengeId, credential: encodeAttestationCredential(cred) },
    session.access_token,
  )
  return true
}
