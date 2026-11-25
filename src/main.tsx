import { ChakraProvider } from '@chakra-ui/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './features/shell'
import './global.css'
import { nav, pose, queryClient, settings, telemetry, trip, ui } from './state'
import { applyTheme, enableThemeCrossfade, system } from './theme'

// The single place that applies the theme: features only set `ui.resolvedTheme`.
// Runs before the first render so there is no flash of the wrong theme; every themed colour
// cross-fades on later changes (`themeCrossfade.ts`).
enableThemeCrossfade()
applyTheme(ui.get().resolvedTheme)
ui.subscribe((state) => applyTheme(state.resolvedTheme))

/**
 * Development-only handle for driving the screen by hand, e.g. `__dash.pose.speedMps.set(21)`,
 * or seeding server state for screenshots: `__dash.queryClient.setQueryData(['weather', 0, 0, 'F'], …)`.
 */
interface DashDevHandle {
  pose: typeof pose
  telemetry: typeof telemetry
  settings: typeof settings
  ui: typeof ui
  trip: typeof trip
  nav: typeof nav
  queryClient: typeof queryClient
}

declare global {
  interface Window {
    __dash?: DashDevHandle
  }
}

if (import.meta.env.DEV) {
  window.__dash = { pose, telemetry, settings, ui, trip, nav, queryClient }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ChakraProvider value={system}>
        {/* Respect iOS "Reduce Motion": Motion skips transform/layout animations, keeps opacity/colour. */}
        <MotionConfig reducedMotion="user">
          {/* A render error shows a calm "Something went wrong" card, never a white screen. */}
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </MotionConfig>
      </ChakraProvider>
    </QueryClientProvider>
  </StrictMode>,
)
