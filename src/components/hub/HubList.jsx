import { useState } from 'react'
import { useHubs } from '../../hooks/useHubs'
import { PageTransition, FadeIn, StaggerChildren, StaggerItem } from '../ui/animations'
import { PageHeader, LoadingScreen, Spinner } from '../ui/index'
import HubCard from './HubCard'
import CreateHubModal from './CreateHubModal'
import { Plus } from 'lucide-react'

export default function HubList({ onSelectHub }) {
  const { hubs, loading, createHub } = useHubs()
  const [showCreate, setShowCreate] = useState(false)

  if (loading) return <LoadingScreen />

  async function handleCreate(data) {
    const hub = await createHub(data)
    if (hub) {
      setShowCreate(false)
      onSelectHub(hub.id)
    }
  }

  return (
    <PageTransition>
      <PageHeader
        title="Project Hubs"
        subtitle="Team spaces and group channels"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn btn-primary text-sm flex items-center gap-1.5">
            <Plus size={15} />
            New Hub
          </button>
        }
      />

      <div className="p-4 sm:p-6">
        {hubs.length === 0 ? (
          <FadeIn>
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center mx-auto mb-4">
                <Plus size={28} className="text-brand-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">No hubs yet</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Create a hub to start collaborating with your team.</p>
              <button onClick={() => setShowCreate(true)} className="btn btn-primary text-sm">
                Create your first hub
              </button>
            </div>
          </FadeIn>
        ) : (
          <StaggerChildren className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hubs.map(hub => (
              <StaggerItem key={hub.id}>
                <HubCard hub={hub} onClick={() => onSelectHub(hub.id)} />
              </StaggerItem>
            ))}
          </StaggerChildren>
        )}
      </div>

      {showCreate && (
        <CreateHubModal
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </PageTransition>
  )
}
