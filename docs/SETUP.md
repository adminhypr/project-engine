# Project Engine — Developer Setup Guide

## Prerequisites
- Node.js 18+
- npm or yarn
- Git
- A Supabase account (supabase.com)
- A Vercel account (vercel.com)
- A Google Cloud Console account (for OAuth)

---

## Step 1 — Clone and Install

```bash
git clone <your-repo-url>
cd project-engine
npm install
```

---

## Step 2 — Create Supabase Project

1. Go to supabase.com → New project
2. Choose a name, strong password, and your nearest region
3. Wait for provisioning (~2 min)

---

## Step 3 — Run Database Migration

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open `/supabase/migrations/001_initial.sql` from this repo
4. Paste the entire contents and click **Run**
5. You should see "Success" — this creates all tables, policies, and indexes

---

## Step 4 — Configure Google OAuth

### In Google Cloud Console:
1. Go to console.cloud.google.com
2. Create a new project (or select existing)
3. Go to **APIs & Services → OAuth consent screen**
   - User type: Internal (for company use only) or External
   - Fill in app name, support email, developer email
   - Add scope: `email`, `profile`, `openid`
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: Web application
   - Authorized redirect URIs: `https://[YOUR-PROJECT-ID].supabase.co/auth/v1/callback`
5. Copy the **Client ID** and **Client Secret**

### In Supabase:
1. Go to **Authentication → Providers → Google**
2. Toggle to Enable
3. Paste Client ID and Client Secret
4. Save

---

## Step 5 — Local Development Setup

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Find these values in Supabase: **Settings → API → Project URL and anon key**

```bash
npm run dev
```

App runs at http://localhost:5173

---

## Step 6 — First Login

1. Open http://localhost:5173
2. Click "Continue with Google"
3. Sign in with your Google account
4. You'll see "Needs setup" — you need to assign yourself a team and role
5. Go to the Supabase SQL editor and run:

```sql
UPDATE profiles
SET role = 'Admin', team_id = (SELECT id FROM teams WHERE name = 'Operations' LIMIT 1)
WHERE email = 'your@email.com';
```

(Replace email and team name as appropriate)

6. Refresh the app — you now have Admin access

---

## Step 7 — Deploy to Vercel

1. Push code to GitHub
2. Go to vercel.com → New Project → Import from GitHub
3. Framework preset: **Vite**
4. Build command: `npm run build`
5. Output directory: `dist`
6. Add Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. Click **Deploy**

### Add Vercel domain to Supabase Auth:
1. In Supabase: **Authentication → URL Configuration**
2. Site URL: `https://your-app.vercel.app`
3. Redirect URLs: add `https://your-app.vercel.app/**`

---

## Step 8 — Email Alerts (Optional)

The app uses a Supabase Edge Function for sending red task alerts.

### Option A — Use Resend (recommended, free tier available)
1. Sign up at resend.com
2. Get API key
3. In `/supabase/functions/send-alerts/index.ts`, uncomment the Resend block and add your API key
4. Deploy the function:
   ```bash
   npx supabase functions deploy send-alerts
   ```
5. Schedule it:
   ```bash
   npx supabase functions schedule send-alerts --cron "0 */4 * * *"
   ```

### Option B — Skip email alerts
The app works fully without email alerts. Just leave the function undeployed.

---

## Adding Your First Team Members

1. Share the app URL with team members
2. They sign in with Google — a profile is auto-created
3. You (Admin) go to **Settings → Users**
4. Find their name (shown with "Needs setup" badge)
5. Assign their team and role, click Save
6. They reload the app and see their role-appropriate view

---

## File Structure

```
src/
  components/
    layout/     Layout.jsx (sidebar + main wrapper)
    tasks/      TaskTable.jsx, TaskDetailPanel.jsx
    ui/         index.jsx (shared UI components)
  hooks/
    useAuth.jsx     Auth context + hook
    useTasks.js     Task data + actions hook
  lib/
    supabase.js     Supabase client, helpers, priority engine
  pages/
    LoginPage.jsx
    MyTasksPage.jsx
    AssignTaskPage.jsx
    TeamViewPage.jsx
    AdminOverviewPage.jsx
    ReportsPage.jsx
    SettingsPage.jsx
  App.jsx         Router + auth wrapper
  main.jsx        Entry point
  index.css       Tailwind + custom styles

supabase/
  migrations/     001_initial.sql (run once)
  functions/      send-alerts/ (optional email cron)

docs/
  PRODUCT_SPEC.md   Full feature specification
  SETUP.md          This file
```

---

## Environment Variables Reference

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |

---

## Troubleshooting

**"User not found" or auth issues:**
- Make sure your Supabase redirect URL includes the full domain
- Check that Google OAuth is enabled in Supabase Auth settings

**Blank screen after login:**
- User profile exists but has no team/role assigned
- Run the SQL UPDATE above to set yourself as Admin

**Real-time not working:**
- Check that `supabase_realtime` publication includes tasks and comments tables (migration handles this)

**Reports show no data:**
- Make sure tasks have been created within the selected date range
- Check the date range picker

---

## Tech Decisions & Notes

**Why Supabase?**
Row Level Security handles permissions at the database level. Managers genuinely cannot query tasks outside their team — it's not just a UI filter, it's enforced by Postgres.

**Why no Redux/Zustand?**
The app uses Supabase Realtime for live updates and simple component state. No global state manager needed for this complexity level.

**Priority is never stored:**
Priority (Red/Orange/Yellow/Green) is calculated from timestamps at read time. This means it's always accurate and you never have stale priority data in the database.

**Assignment Type is stored:**
Unlike priority, assignment type is stored on task creation. This is intentional — if someone's role changes, you still want the historical record of what type the original assignment was.
