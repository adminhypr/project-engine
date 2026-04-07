import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useHubs } from '../hooks/useHubs'
import { PageTransition, FadeIn } from '../components/ui/animations'
import { PageHeader, LoadingScreen } from '../components/ui/index'
import HubList from '../components/hub/HubList'
import HubModuleCard from '../components/hub/HubModuleCard'
import HubMembersPanel from '../components/hub/HubMembersPanel'
import ActivityFeed from '../components/hub/ActivityFeed'
import Attendance from '../components/hub/Attendance'
import Campfire from '../components/hub/Campfire'
import MessageBoard from '../components/hub/MessageBoard'
import CheckIns from '../components/hub/CheckIns'
import Schedule from '../components/hub/Schedule'
import DocsFiles from '../components/hub/DocsFiles'
import {
  Activity, Users, Flame, MessageSquare, ClipboardCheck, Calendar,
  FolderOpen, ArrowLeft, Settings
} from 'lucide-react'

function HubDashboard({ hubId }) {
  const { hubs } = useHubs()
  const navigate = useNavigate()
  const [showMembers, setShowMembers] = useState(false)

  const hub = hubs.find(h => h.id === hubId)
  const hubName = hub?.name || 'Hub'
  const myRole = hub?.my_role || 'member'

  return (
    <PageTransition>
      <PageHeader
        title={hubName}
        subtitle={hub?.description || 'Project hub'}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowMembers(true)} className="btn btn-ghost text-xs flex items-center gap-1.5">
              <Users size={14} />
              Members
            </button>
            <button onClick={() => navigate('/hub')} className="btn btn-ghost text-xs flex items-center gap-1.5">
              <ArrowLeft size={14} />
              All Hubs
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        {/* Row 1: Activity + Attendance */}
        <FadeIn delay={0}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <HubModuleCard title="Activity" icon={Activity}>
                <ActivityFeed hubId={hubId} />
              </HubModuleCard>
            </div>
            <div>
              <HubModuleCard title="Who's Here" icon={Users}>
                <Attendance hubId={hubId} />
              </HubModuleCard>
            </div>
          </div>
        </FadeIn>

        {/* Row 2: Messages + Docs & Files */}
        <FadeIn delay={0.05}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HubModuleCard title="Message Board" icon={MessageSquare}>
              <MessageBoard hubId={hubId} />
            </HubModuleCard>
            <HubModuleCard title="Docs & Files" icon={FolderOpen}>
              <DocsFiles hubId={hubId} />
            </HubModuleCard>
          </div>
        </FadeIn>

        {/* Row 3: Check-ins + Campfire */}
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HubModuleCard title="Check-ins" icon={ClipboardCheck}>
              <CheckIns hubId={hubId} />
            </HubModuleCard>
            <HubModuleCard title="Campfire" icon={Flame}>
              <Campfire hubId={hubId} />
            </HubModuleCard>
          </div>
        </FadeIn>

        {/* Row 4: Schedule */}
        <FadeIn delay={0.15}>
          <HubModuleCard title="Schedule" icon={Calendar} defaultOpen={false}>
            <Schedule hubId={hubId} />
          </HubModuleCard>
        </FadeIn>
      </div>

      <HubMembersPanel
        hubId={hubId}
        isOpen={showMembers}
        onClose={() => setShowMembers(false)}
        myRole={myRole}
      />
    </PageTransition>
  )
}

export default function HubPage() {
  const { hubId } = useParams()
  const navigate = useNavigate()

  if (hubId) {
    return <HubDashboard hubId={hubId} />
  }

  return <HubList onSelectHub={(id) => navigate(`/hub/${id}`)} />
}
