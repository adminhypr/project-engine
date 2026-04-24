// supabase/functions/_shared/security.ts
// Shared auth + CORS helpers for edge functions.
//
// - verifyJWT(req): validates the caller's Supabase JWT and returns { userId, role }
// - verifyWebhookSecret(req): constant-time compares X-Webhook-Secret header to
//   the WEBHOOK_SHARED_SECRET env var. Soft-fails open if the env var is not set
//   (logs a warning) so deploys don't break prod mid-rollout. Strict when set.
// - corsHeaders(origin?): returns an origin-allow-list CORS header map (no wildcards).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── CORS allow-list ───────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://tasks.hyprstaffing.com',
  'https://project-engine-six.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
]

// Vercel preview deploys: project-engine-git-<branch>-admin-85372593s-projects.vercel.app
const VERCEL_PREVIEW_RE = /^https:\/\/project-engine-git-[\w-]+-admin-85372593s-projects\.vercel\.app$/

function pickOrigin(origin: string | null | undefined): string {
  if (!origin) return ALLOWED_ORIGINS[0]
  if (ALLOWED_ORIGINS.includes(origin)) return origin
  if (VERCEL_PREVIEW_RE.test(origin)) return origin
  // Not in allow-list — echo back our canonical prod origin so browsers block.
  return ALLOWED_ORIGINS[0]
}

export function corsHeaders(origin?: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': pickOrigin(origin),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// Convenience — for a Request, extract the Origin header and build CORS headers.
export function corsHeadersFor(req: Request): Record<string, string> {
  return corsHeaders(req.headers.get('origin'))
}

// ── Webhook shared-secret verification ────────────────────────
// Soft-fail policy: if WEBHOOK_SHARED_SECRET is NOT set, log a warning and
// ALLOW the request. This lets us ship the check without dashboard access.
// Once the env var is set, we enforce strict, constant-time comparison.
export function verifyWebhookSecret(req: Request): boolean {
  const expected = Deno.env.get('WEBHOOK_SHARED_SECRET')
  if (!expected) {
    console.warn('[security] WEBHOOK_SHARED_SECRET not set — allowing request. Set this env var to enforce webhook auth.')
    return true
  }
  const got = req.headers.get('x-webhook-secret')
  if (!got) return false
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

// ── JWT verification ──────────────────────────────────────────
// Returns { userId, role } on success, null on failure.
// `role` is the global profiles.role (Admin/Manager/Staff/Agent/Client).
export interface JWTResult {
  userId: string
  email: string | null
  role: string | null
}

// Module-level admin client — reused across calls.
const _adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

export async function verifyJWT(req: Request): Promise<JWTResult | null> {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const { data: { user }, error } = await _adminClient.auth.getUser(token)
  if (error || !user) return null

  const { data: profile } = await _adminClient
    .from('profiles')
    .select('role, email')
    .eq('id', user.id)
    .maybeSingle()

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? null,
    role: profile?.role ?? null,
  }
}
