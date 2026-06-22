import { useEffect } from 'react'
import { chatViewportHeightPx } from '../lib/chatViewport'

// While mounted, mirrors window.visualViewport.height into a `--chat-vh` CSS
// custom property on <html>. A full-screen chat surface sizes itself to
// `var(--chat-vh, 100dvh)` so it always equals the area NOT covered by the
// on-screen keyboard.
//
// Why this is needed: on iOS Safari the layout viewport (100vh / 100dvh) does
// NOT shrink when the keyboard opens — only the *visual* viewport does. A
// bottom-anchored composer sized to 100dvh therefore hides behind the keyboard.
// Reading visualViewport.height fixes that.
//
// rAF-throttled; clears the var and listeners on unmount. No-ops where
// visualViewport is unavailable (desktop/older browsers fall through to the
// 100dvh CSS fallback). Mount this ONLY on the full-page chat route.
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return undefined
    const root = document.documentElement
    let raf = 0
    const apply = () => {
      raf = 0
      const px = chatViewportHeightPx(vv)
      if (px) root.style.setProperty('--chat-vh', px)
    }
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(apply)
    }
    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      root.style.removeProperty('--chat-vh')
    }
  }, [])
}
