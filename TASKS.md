# Dash — task list

Orchestrator: Fable. Implementer: Opus subagents. A task is ticked only after the orchestrator has verified it.

## Decisions after mockups (2026-11-25)

- **Look: Glass.** `mockups/glass.html` is the visual reference (tokens, layout, motion). HUD and Sport directions dropped.
- **No speed limit.** No limit sign, no over-limit state, no speed-limit data. Ignore those parts of the mockup.
- Road name stays (top-centre pill).
- Persisted client state is written straight to `localStorage` by the `clientState` helper — no persister packages.

## Phase M — HTML mockups

- [x] M1 `mockups/glass.html` — draft accepted as reference (stopped early at user's request; search/trip sheets have known rough edges)
- [-] M2 HUD direction — dropped
- [-] M3 Sport direction — dropped
- [-] M4/M5 Gallery + hosted page — not needed, user reviewed over local link
- [x] M6 Gate: user picked Glass, removed speed limit, said build

## Phase 0 — Foundation

- [x] T01 Scaffold Vite `react-ts` into `dash/` (keep `mockups/`, `TASKS.md`), `git init`, install deps, strip boilerplate
- [x] T02 Chakra system from Glass tokens (day/night), providers, iOS global CSS
- [x] T03 `types.ts` + `state/`: QueryClient, `clientState` helper (with localStorage persistence), all client-state entries, `pose` Motion values
- [x] T04 `lib/` geo, units, smoothing, sun with vitest tests
- [x] T05 `api/client.ts` (token access, fetch wrapper, retry/backoff defaults)
- [x] T06 PWA plugin config, manifest, icons, apple metas, HTTPS dev script for phone

## Phase 1 — Core cluster

Agent A · `sensors/`
- [x] T07 Geolocation watcher → telemetry cache entry, speed fallback, GPS status/accuracy
- [x] T08 Compass with permission request and landscape correction
- [x] T09 Wake lock with re-acquire
- [x] T10 rAF motion loop (dead reckoning, smoothing, heading source selection)
- [x] T11 Simulator / demo mode

Agent B · `features/map/`
- [x] T12 MapView with Standard style, token-missing state
- [x] T13 Follow camera: heading-up, speed zoom, padding, pause on gesture, recenter
- [x] T14 Puck with heading and accuracy halo
- [x] T15 Day/night light preset from sun position or manual setting

Agent C · `features/shell|speed|status|compass/`
- [x] T16 ClusterLayout over the map, safe-area aware, both landscape directions
- [x] T17 Speedometer: spring digits + arc gauge
- [x] T18 TopBar: clock, GPS signal, settings button
- [x] T19 CompassTape
- [x] T20 StartGate, BootSequence, RotatePrompt
- [x] T21 SettingsSheet: units (mph default), theme auto/day/night, demo

## Phase 2 — Extras

Agent D · road name + weather
- [x] T22 `api/roadName.ts` + `useRoadName`; RoadName pill in TopBar
- [x] T23 `api/weather.ts` + `useWeather`; temp chip in TopBar

Agent E · trip
- [x] T24 Trip accumulation (distance, moving time, avg, max; auto-pause; persisted)
- [x] T25 TripStrip + TripSheet with reset

Agent F · navigation
- [x] T26 `api/search.ts` + DestinationSearch (parked-only, recents)
- [x] T27 `api/directions.ts` + `useRoute`; route layer with draw-in and overview fit
- [x] T28 Route progress: snap, remaining distance/time, off-route → reroute (unit tested)
- [x] T29 ManeuverBanner, EtaChip, arrive/cancel

## Phase 3 — Polish and ship

- [x] T30 Animation audit: every state change animated, reduced-motion respected
- [x] T31 Dockerfile, `nginx.conf`, compose file, `deploy.sh`, README runbook
- [x] T32 Orchestrator review: code review, build, tests, demo-mode walkthrough in Chrome
- [ ] T33 Cloudflare: add tunnel public hostname after user confirms (cf CLI per user's global instruction)
- [ ] T34 On-device checklist handed to user
