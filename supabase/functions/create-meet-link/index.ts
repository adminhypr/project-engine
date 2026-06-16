// supabase/functions/create-meet-link/index.ts
//
// Frontend-invoked (supabase.functions.invoke). Starts a video call in a chat
// conversation: verifies the caller is a participant, mints a Google Meet
// space via a company bot account, and posts a kind='call' message (authored
// by the caller) carrying the join link. Realtime then fans the card out to
// every participant; the starter's browser opens the link.
//
// Deploy: npx supabase functions deploy create-meet-link
// Required secrets (set once after the Google Cloud setup — see
//   docs/plans/2026-06-16-chat-video-calls-design.md):
//   GOOGLE_MEET_CLIENT_ID, GOOGLE_MEET_CLIENT_SECRET, GOOGLE_MEET_REFRESH_TOKEN
//
// Responses:
//   200 { url }                       — call started
//   200 { error: 'not_configured' }   — Google secrets absent (feature dark)
//   401 { error }                     — bad/missing JWT
//   403 { error: 'forbidden' }        — caller not a participant
//   400 { error }                     — bad request
//   502 { error: 'meet_failed' }      — Google API failure

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor, verifyJWT } from '../_shared/security.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CALL_PREFIX = '📞 Started a call: '

async function getAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get('GOOGLE_MEET_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_MEET_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_MEET_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) return null

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    console.error('[create-meet-link] token exchange failed', res.status, await res.text())
    return null
  }
  const json = await res.json()
  return json.access_token ?? null
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const caller = await verifyJWT(req)
    if (!caller) return json({ error: 'unauthorized' }, 401)

    const { conversation_id: conversationId } = await req.json().catch(() => ({}))
    if (!conversationId) return json({ error: 'conversation_id is required' }, 400)

    // Caller must be an active participant of the conversation.
    const { data: membership } = await admin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', caller.userId)
      .maybeSingle()
    if (!membership) return json({ error: 'forbidden' }, 403)

    // Feature is dark until the Google secrets are configured.
    const accessToken = await getAccessToken()
    if (!accessToken) return json({ error: 'not_configured' }, 200)

    // Create an OPEN Meet space so anyone with the link (incl. externals /
    // password users without a Google account) can join without knocking.
    const meetRes = await fetch('https://meet.googleapis.com/v2/spaces', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { accessType: 'OPEN', entryPointAccess: 'ALL' } }),
    })
    if (!meetRes.ok) {
      console.error('[create-meet-link] spaces.create failed', meetRes.status, await meetRes.text())
      return json({ error: 'meet_failed' }, 502)
    }
    const space = await meetRes.json()
    const url: string | undefined = space.meetingUri
    if (!url) return json({ error: 'meet_failed' }, 502)

    // Post the call card AS the caller (real sender → normal unread +
    // notification behavior). Inserted only after Google succeeds, so there's
    // never a dead card pointing at no meeting.
    const { error: insErr } = await admin.from('dm_messages').insert({
      conversation_id: conversationId,
      author_id: caller.userId,
      kind: 'call',
      content: `${CALL_PREFIX}${url}`,
    })
    if (insErr) {
      console.error('[create-meet-link] message insert failed', insErr)
      return json({ error: 'insert_failed' }, 500)
    }

    return json({ url })
  } catch (e) {
    console.error('[create-meet-link] unexpected', e)
    return json({ error: 'unexpected' }, 500)
  }
})
