import { motion } from 'framer-motion'
import { signInWithGoogle } from '../lib/auth'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">

      <motion.div
        className="bg-white rounded-3xl shadow-panel border border-slate-200 p-6 sm:p-10 w-full max-w-sm text-center"
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <motion.div
          className="w-14 h-14 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-brand-500/30"
          initial={{ rotate: -8 }}
          animate={{ rotate: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-white fill-current">
            <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>
          </svg>
        </motion.div>

        <h1 className="text-2xl font-bold text-slate-900 mb-2">Project Engine</h1>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          Task management for your team.<br />Sign in with your company Google account.
        </p>

        <motion.button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-white hover:border-slate-300 transition-all duration-200 shadow-card"
          whileHover={{ y: -1, boxShadow: '0 8px 30px rgba(26, 39, 68, 0.1)' }}
          whileTap={{ scale: 0.98 }}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </motion.button>

        <p className="mt-6 text-xs text-slate-400">
          By signing in you agree to your organization's terms of use.
        </p>
      </motion.div>
    </div>
  )
}
