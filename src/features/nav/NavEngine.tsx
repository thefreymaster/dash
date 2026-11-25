/**
 * The navigation engine — renders nothing; mounted once by the overlay slot next to
 * `DestinationSearch`. It is the only place that:
 *
 *   - observes the route query (`useRoute`; one observer → one 2-minute refresh timer);
 *   - tracks progress from `telemetry` fixes (~1 Hz, never the 60 Hz pose) with the pure
 *     functions in `progress.ts`, and bumps `nav.rerouteNonce` when off-route;
 *   - publishes `navView` (status + progress) for `ManeuverBanner` and `EtaChip`;
 *   - draws the route line + destination pin, shows the route overview on a new destination;
 *   - ends navigation by itself after the arrival moment;
 *   - in demo mode only, hands the route to the simulator so the simulated car drives it.
 */
import { useEffect, useRef, useState } from 'react';
import { ROUTE_QUERY_ROOT, isRouteUnavailable, useRoute, type RouteOrigin, type RouteResult } from '../../api/directions';
import { isDemo } from '../../sensors';
import { simDriveRoute, simReleaseRoute } from '../../sensors/simulator';
import { nav, queryClient, telemetry, ui } from '../../state';
import type { Fix, Place, Telemetry } from '../../types';
import { routeErrorMessage } from './actions';
import { navView, type RouteStatus } from './navState';
import { showRouteOverview, type Overview } from './overview';
import { INITIAL_REROUTE_POLICY, decideReroute, initialProgress, prepareRoute, startTracker, trackProgress } from './progress';
import { createRouteLayer, type RouteLayer } from './routeLayer';
import { navToken } from './token';

/** How long the "arrived" moment shows before navigation ends by itself, ms. */
export const ARRIVED_HOLD_MS = 4_500;
/** The vehicle heading is sent to Directions only above this speed, m/s. */
export const ROUTE_HEADING_MIN_SPEED_MPS = 2;

/** Where to route from right now: the latest fix (`fresh` while tracking), or `null` before the first one. */
function currentOrigin(): RouteOrigin | null {
  const t = telemetry.get();
  if (!t.fix) return null;
  return {
    point: [t.fix.lng, t.fix.lat],
    at: t.fix.timestamp,
    headingDeg: t.speedMps >= ROUTE_HEADING_MIN_SPEED_MPS ? t.headingDeg : null,
    fresh: t.status === 'tracking',
  };
}

export function NavEngine() {
  const destination = nav.use((n) => n.destination);
  const rerouteNonce = nav.use((n) => n.rerouteNonce);
  // Stable once the first fix arrives (a stale GPS must not toggle the query on and off).
  const hasFix = telemetry.use((t) => t.fix !== null);
  const source = telemetry.use((t) => t.source);
  const token = navToken();

  const [arrivedFor, setArrivedFor] = useState<Place | null>(null);
  const arrived = destination !== null && arrivedFor === destination;

  const query = useRoute({ destination, rerouteNonce, token, getOrigin: currentOrigin, enabled: hasFix && !arrived });
  const route: RouteResult | null = destination ? (query.data ?? null) : null;
  const isPlaceholder = query.isPlaceholderData;

  // ---- status ---------------------------------------------------------------------------
  let status: RouteStatus;
  let message: string | null = null;
  if (!destination) status = 'idle';
  else if (arrived) status = 'arrived';
  else if (!token) status = 'no-token';
  else if (route) status = isPlaceholder ? 'rerouting' : 'active';
  else if (query.isError) {
    status = isRouteUnavailable(query.error) ? 'no-route' : 'error';
    message = routeErrorMessage(query.error);
  } else if (!hasFix) status = 'waiting-gps';
  else if (query.fetchStatus === 'paused') status = 'offline';
  else status = 'routing';

  useEffect(() => {
    navView.set((v) => (v.status === status && v.message === message ? v : { ...v, status, message }));
  }, [status, message]);

  // Navigation ended: forget its routes, so choosing the same place again routes from HERE
  // (the cache is keyed without the origin). The disabled no-destination entry stays.
  useEffect(() => {
    if (destination) return;
    queryClient.removeQueries({ queryKey: ROUTE_QUERY_ROOT, predicate: (q) => q.queryKey[2] !== null });
  }, [destination]);

  // Reroutes only while a settled, current route is on screen.
  const canRerouteRef = useRef(false);
  const canReroute = route !== null && !isPlaceholder && !query.isFetching && !arrived;
  useEffect(() => {
    canRerouteRef.current = canReroute;
  }, [canReroute]);

  // ---- progress from telemetry fixes (~1 Hz) ----------------------------------------------
  const policyRef = useRef(INITIAL_REROUTE_POLICY);
  useEffect(() => {
    policyRef.current = INITIAL_REROUTE_POLICY;
  }, [destination]);

  useEffect(() => {
    if (!destination || !route) {
      navView.set((v) => (v.progress ? { ...v, progress: null } : v));
      return undefined;
    }
    const prepared = prepareRoute(route, [destination.lng, destination.lat]);
    let tracker = startTracker(route);
    let lastFix: Fix | null = null;
    navView.set((v) => ({ ...v, progress: initialProgress(prepared, route.originAt) }));

    const onTelemetry = (t: Telemetry) => {
      if (!t.fix || t.fix === lastFix) return;
      lastFix = t.fix;
      const r = trackProgress(prepared, tracker, {
        lng: t.fix.lng,
        lat: t.fix.lat,
        speedMps: t.speedMps,
        headingDeg: t.headingDeg,
        accuracyM: t.fix.accuracyM,
        timestamp: t.fix.timestamp,
      });
      tracker = r.tracker;
      navView.set((v) => ({ ...v, progress: r.progress }));
      if (r.progress.arrived) {
        setArrivedFor(destination);
        return;
      }
      const decision = decideReroute(policyRef.current, r.progress, t.fix.timestamp, canRerouteRef.current);
      policyRef.current = decision.policy;
      if (decision.reroute) {
        nav.set((n) => (n.destination === destination ? { ...n, rerouteNonce: n.rerouteNonce + 1 } : n));
      }
    };
    onTelemetry(telemetry.get());
    return telemetry.subscribe(onTelemetry);
  }, [route, destination]);

  // Arrival moment, then navigation ends by itself.
  useEffect(() => {
    if (!arrived || !destination) return undefined;
    const timer = setTimeout(() => {
      nav.set((n) => (n.destination === destination ? { ...n, destination: null } : n));
    }, ARRIVED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [arrived, destination]);

  // ---- map: route line, pin, theme, trim ------------------------------------------------
  const layerRef = useRef<RouteLayer | null>(null);
  useEffect(() => {
    const layer = createRouteLayer(ui.get().resolvedTheme);
    layerRef.current = layer;
    const offTheme = ui.subscribe((s) => layer.setTheme(s.resolvedTheme));
    const offProgress = navView.subscribe((v) => layer.setProgress(v.progress?.fraction ?? 0));
    return () => {
      offTheme();
      offProgress();
      layer.destroy();
      layerRef.current = null;
    };
  }, []);

  const routeKey = destination ? `${destination.id}:${destination.lat},${destination.lng}:${rerouteNonce}` : null;
  const drawnRef = useRef<{ route: RouteResult | null; key: string | null }>({ route: null, key: null });
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (!route) {
      if (drawnRef.current.route) layer.setRoute(null);
      drawnRef.current = { route: null, key: null };
      return;
    }
    if (route === drawnRef.current.route) return;
    // Draw in for a new destination or a reroute; a periodic refresh just swaps the line.
    const drawIn = !isPlaceholder && drawnRef.current.key !== routeKey;
    layer.setRoute(route.line, { drawIn });
    layer.setProgress(navView.get().progress?.fraction ?? 0);
    drawnRef.current = { route, key: isPlaceholder ? drawnRef.current.key : routeKey };
  }, [route, routeKey, isPlaceholder]);

  useEffect(() => {
    layerRef.current?.setDestination(destination ? [destination.lng, destination.lat] : null);
  }, [destination]);

  // ---- overview on a new destination's first route ----------------------------------------
  const overviewRef = useRef<{ forDestination: Place | null; overview: Overview | null }>({ forDestination: null, overview: null });
  useEffect(() => {
    const current = overviewRef.current;
    if (!destination) {
      current.overview?.cancel(true);
      overviewRef.current = { forDestination: null, overview: null };
      return;
    }
    if (!route || isPlaceholder || current.forDestination === destination) return;
    current.overview?.cancel(false);
    overviewRef.current = { forDestination: destination, overview: showRouteOverview(route.line) };
  }, [destination, route, isPlaceholder]);
  useEffect(() => () => overviewRef.current.overview?.cancel(false), []);

  // ---- demo mode: the simulated car drives the route --------------------------------------
  const demo = source === 'sim' && isDemo();
  useEffect(() => {
    if (demo && destination && route && !arrived) simDriveRoute(route.line);
  }, [demo, destination, route, arrived]);
  useEffect(() => {
    if (demo && !destination) simReleaseRoute();
  }, [demo, destination]);

  return null;
}
