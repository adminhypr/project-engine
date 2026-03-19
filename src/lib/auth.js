import { supabase } from './supabase'

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { hd: undefined }
    }
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}
