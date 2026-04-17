import { useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useAvatarUpload } from '../../hooks/useAvatarUpload'
import { Upload, RotateCcw, Loader2 } from 'lucide-react'

export default function AvatarCard() {
  const { profile, session } = useAuth()
  const { uploadAvatar, removeAvatar, uploading } = useAvatarUpload()
  const fileRef = useRef(null)

  if (!profile) return null

  const googleUrl = session?.user?.user_metadata?.avatar_url || null
  const currentUrl = profile.avatar_url || null
  const hasCustomAvatar = !!currentUrl && currentUrl !== googleUrl
  const canReset = hasCustomAvatar && !!googleUrl

  function pickFile() {
    if (!uploading) fileRef.current?.click()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await uploadAvatar(file)
  }

  return (
    <div className="card p-4 mb-6">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Profile photo</h3>
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-brand-500 flex items-center justify-center text-white text-2xl font-bold shrink-0">
          {currentUrl ? (
            <img src={currentUrl} alt={profile.full_name || 'Avatar'} className="w-full h-full object-cover" />
          ) : (
            <span>{profile.full_name?.[0]?.toUpperCase() || '?'}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pickFile}
              disabled={uploading}
              className="btn btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {uploading ? 'Uploading…' : 'Upload new photo'}
            </button>
            {canReset && (
              <button
                type="button"
                onClick={removeAvatar}
                disabled={uploading}
                className="btn btn-ghost text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                <RotateCcw size={12} />
                Reset to default
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            JPEG, PNG, WebP, or GIF. Max 5 MB.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  )
}
