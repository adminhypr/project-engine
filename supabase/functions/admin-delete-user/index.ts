// supabase/functions/admin-delete-user/index.ts
// Admin-only: delete a user from auth.users (cascades to profiles, tasks, comments)
// Deploy: npx supabase functions deploy admin-delete-user

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/security.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    // Extract caller's JWT and verify they're an admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: cors })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: cors })
    }

    // Verify caller is Admin
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (callerProfile?.role !== 'Admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: cors })
    }

    const { userId } = await req.json()
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), { status: 400, headers: cors })
    }

    // Prevent self-deletion
    if (userId === caller.id) {
      return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), { status: 400, headers: cors })
    }

    // Prevent deleting the last admin
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'Admin')
      .neq('id', userId)

    if ((count || 0) === 0) {
      return new Response(JSON.stringify({ error: 'Cannot delete the last admin' }), { status: 400, headers: cors })
    }

    // Delete from auth.users — cascades to profiles, tasks, comments, profile_teams
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)
    if (deleteError) {
      console.error('Delete user error:', deleteError)
      return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: cors })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors })
  } catch (err) {
    console.error('admin-delete-user error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors })
  }
})
