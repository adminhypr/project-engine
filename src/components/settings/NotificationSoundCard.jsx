import { useState } from 'react'
import { Volume2, VolumeX, Play } from 'lucide-react'
import {
  isTaskSoundEnabled,
  isMessageSoundEnabled,
  getTaskPreset,
  getMessagePreset,
  getVolume,
  writePref,
  writeBoolPref,
  previewTaskSound,
  previewMessageSound,
  TASK_PRESET_OPTIONS,
  MESSAGE_PRESET_OPTIONS,
  VOLUME_OPTIONS,
  SOUND_PREF_KEYS,
} from '../../lib/notificationSounds'

function Toggle({ enabled, onToggle, label }) {
  return (
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
  )
}

function PresetRow({ label, description, enabled, onToggle, preset, onPresetChange, options, onPreview }) {
  return (
    <div className="py-2 border-b border-slate-100 dark:border-dark-border last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{description}</div>
        </div>
        <Toggle enabled={enabled} onToggle={onToggle} label={label} />
      </div>
      <div className={`flex items-center gap-2 mt-2 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <select
          value={preset}
          onChange={e => onPresetChange(e.target.value)}
          className="flex-1 px-2 py-1 rounded-md border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
          aria-label={`${label} sound`}
        >
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button
          type="button"
          onClick={onPreview}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-600 dark:text-slate-300 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Preview"
        >
          <Play className="w-3 h-3" /> Preview
        </button>
      </div>
    </div>
  )
}

export default function NotificationSoundCard() {
  const [taskOn,     setTaskOn]     = useState(isTaskSoundEnabled())
  const [messageOn,  setMessageOn]  = useState(isMessageSoundEnabled())
  const [taskPreset, setTaskPreset] = useState(getTaskPreset())
  const [msgPreset,  setMsgPreset]  = useState(getMessagePreset())
  const [volume,     setVolume]     = useState(getVolume())

  function toggleTask() {
    const next = !taskOn
    writeBoolPref(SOUND_PREF_KEYS.task, next)
    setTaskOn(next)
    if (next) previewTaskSound(taskPreset, volume)
  }
  function toggleMessage() {
    const next = !messageOn
    writeBoolPref(SOUND_PREF_KEYS.message, next)
    setMessageOn(next)
    if (next) previewMessageSound(msgPreset, volume)
  }
  function changeTaskPreset(v) {
    setTaskPreset(v)
    writePref(SOUND_PREF_KEYS.taskPreset, v)
    previewTaskSound(v, volume)
  }
  function changeMsgPreset(v) {
    setMsgPreset(v)
    writePref(SOUND_PREF_KEYS.messagePreset, v)
    previewMessageSound(v, volume)
  }
  function changeVolume(v) {
    setVolume(v)
    writePref(SOUND_PREF_KEYS.volume, v)
    // Preview whichever channel is enabled; prefer task to disambiguate.
    if (taskOn) previewTaskSound(taskPreset, v)
    else if (messageOn) previewMessageSound(msgPreset, v)
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
      <PresetRow
        label="New task"
        description="Plays when a task is assigned to you."
        enabled={taskOn}
        onToggle={toggleTask}
        preset={taskPreset}
        onPresetChange={changeTaskPreset}
        options={TASK_PRESET_OPTIONS}
        onPreview={() => previewTaskSound(taskPreset, volume)}
      />
      <PresetRow
        label="New message"
        description="Plays when you receive a direct message."
        enabled={messageOn}
        onToggle={toggleMessage}
        preset={msgPreset}
        onPresetChange={changeMsgPreset}
        options={MESSAGE_PRESET_OPTIONS}
        onPreview={() => previewMessageSound(msgPreset, volume)}
      />
      <div className="mt-3">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">Volume</div>
        <div className="inline-flex rounded-md border border-slate-200 dark:border-dark-border overflow-hidden">
          {VOLUME_OPTIONS.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => changeVolume(o.id)}
              className={`px-3 py-1 text-xs font-medium ${
                volume === o.id
                  ? 'bg-brand-500 text-white'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
