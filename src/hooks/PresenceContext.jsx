import { createContext, useContext } from 'react'
import { useAuth } from './useAuth'
import { useGlobalPresence } from './useGlobalPresence'

// Presence lives in its own context so that the Map churn (Supabase emits
// a `sync` event ~every 10s, every visibility flip, and every time another
// user comes online or goes offline) only re-renders the handful of
// components that actually display presence dots — not every page and
// panel that calls useAuth().
//
// Previously `presence` was part of the AuthContext value, which meant
// every presence tick re-built the auth context object and re-rendered
// 60+ useAuth() consumers (TaskDetailPanel, MyTasksPage, AdminOverview,
// the entire layout chrome). On tab return that produced the visible
// "page refreshes when I switch back" the user kept reporting.

const PresenceContext = createContext(null)

export function PresenceProvider({ children }) {
  const { profile } = useAuth()
  const presence = useGlobalPresence(profile)
  return (
    <PresenceContext.Provider value={presence}>
      {children}
    </PresenceContext.Provider>
  )
}

export function usePresence() {
  const ctx = useContext(PresenceContext)
  return ctx ?? new Map()
}
