import { useState } from 'react'
import { Volume2, VolumeX, Play } from 'lucide-react'
import {
  isTaskSoundEnabled,
  isMessageSoundEnabled,
  writePref,
  previewTaskSound,
  previewMessageSound,
  SOUND_PREF_KEYS,
} from '../../lib/notificationSounds'

function Row({ label, description, enabled, onToggle, onPreview }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onPreview}
          className="p-1.5 rounded-md text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Preview sound"
          title="Preview"
        >
          <Play className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            enabled ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
          aria-label={`${label} ${enabled ? 'on' : 'off'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0.5'
          }`} />
        </button>
      </div>
    </div>
  )
}

export default function NotificationSoundCard() {
  const [taskOn, setTaskOn]       = useState(isTaskSoundEnabled())
  const [messageOn, setMessageOn] = useState(isMessageSoundEnabled())

  function toggleTask() {
    const next = !taskOn
    writePref(SOUND_PREF_KEYS.task, next)
    setTaskOn(next)
    if (next) previewTaskSound()
  }
  function toggleMessage() {
    const next = !messageOn
    writePref(SOUND_PREF_KEYS.message, next)
    setMessageOn(next)
    if (next) previewMessageSound()
  }

  const anyOn = taskOn || messageOn

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        {anyOn
          ? <Volume2 className="w-4 h-4 text-brand-500" />
          : <VolumeX className="w-4 h-4 text-slate-400" />}
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Notification sounds</h3>
      </div>
      <Row
        label="New task"
        description="Plays when a task is assigned to you."
        enabled={taskOn}
        onToggle={toggleTask}
        onPreview={previewTaskSound}
      />
      <Row
        label="New message"
        description="Plays when you receive a direct message."
        enabled={messageOn}
        onToggle={toggleMessage}
        onPreview={previewMessageSound}
      />
    </div>
  )
}
