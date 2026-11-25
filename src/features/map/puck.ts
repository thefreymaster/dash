/**
 * Vehicle puck (T14): the accent chevron from the mockup with a softly pulsing accuracy halo,
 * as a Mapbox `Marker` laid flat on the map plane (`pitchAlignment: 'map'`) and rotated with
 * the map (`rotationAlignment: 'map'`, rotation = heading). Position, heading and halo size are
 * written every frame from `pose` by the map's frame loop; nothing goes through React.
 *
 * Because the marker is projected by Mapbox it stays correct while the user pans away from
 * the vehicle. Colours come from the Chakra CSS variables, so day/night switch by themselves;
 * the look lives in `map.css` (`.dash-puck*`). Greyed out while `telemetry.status` is `stale`.
 */
import mapboxgl from 'mapbox-gl';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import { angleDiffDeg } from '../../lib';
import { telemetry } from '../../state';
import { metersPerPixel, type PoseSnapshot } from './camera';

/** Smallest halo radius, px — the halo always shows a little around the chevron. */
export const PUCK_MIN_HALO_PX = 36;
/** Largest halo radius, px — a poor fix should not paint half the screen. */
export const PUCK_MAX_HALO_PX = 140;

/** Accuracy halo radius on screen for an accuracy radius in metres at a latitude/zoom, clamped. */
export function haloRadiusPx(accuracyM: number, latDeg: number, zoom: number): number {
  const mpp = metersPerPixel(latDeg, zoom);
  const r = accuracyM > 0 && mpp > 0 && Number.isFinite(accuracyM) ? accuracyM / mpp : 0;
  return Math.min(PUCK_MAX_HALO_PX, Math.max(PUCK_MIN_HALO_PX, r));
}

const PUCK_HTML = `
<div class="dash-puck__body">
  <div class="dash-puck__halo">
    <div class="dash-puck__ring"></div>
    <div class="dash-puck__ring dash-puck__ring--late"></div>
  </div>
  <div class="dash-puck__shadow"></div>
  <svg class="dash-puck__arrow" viewBox="0 0 38 44" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="dash-puck-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color: var(--chakra-colors-accent-alt, #20c4d4)" />
        <stop offset="1" style="stop-color: var(--chakra-colors-accent-solid, #0a84ff)" />
      </linearGradient>
    </defs>
    <path d="M19 3 L34 38 L19 30 L4 38 Z" fill="url(#dash-puck-fill)" stroke="#fff" stroke-width="3.2" stroke-linejoin="round" />
  </svg>
</div>`;

export interface Puck {
  /** Position / rotate / size the puck for this frame. Hidden while `pose.has` is false. */
  update(pose: PoseSnapshot): void;
  destroy(): void;
}

export function createPuck(map: MapboxMap): Puck {
  const root = document.createElement('div');
  root.className = 'dash-puck';
  root.setAttribute('aria-hidden', 'true');
  // Set explicitly so Mapbox's marker opacity logic leaves pointer events alone: the puck must
  // never swallow a pan gesture.
  root.style.pointerEvents = 'none';
  root.innerHTML = PUCK_HTML;

  let marker: Marker | null = null;
  let visible = false;
  let lastLng = Number.NaN;
  let lastLat = Number.NaN;
  let lastHeading = Number.NaN;
  let lastRadius = Number.NaN;

  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    root.dataset.visible = String(next);
  };

  const setStale = (status: string) => {
    root.dataset.stale = String(status === 'stale');
  };
  setStale(telemetry.get().status);
  const unsubscribeTelemetry = telemetry.subscribe((t) => setStale(t.status));

  return {
    update(p) {
      if (!p.has) {
        setVisible(false);
        return;
      }
      if (!marker) {
        marker = new mapboxgl.Marker({
          element: root,
          anchor: 'center',
          pitchAlignment: 'map',
          rotationAlignment: 'map',
          rotation: p.headingDeg,
        })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        lastLng = p.lng;
        lastLat = p.lat;
        lastHeading = p.headingDeg;
        // Stays hidden for this first frame; the next update shows it, so the entrance animates.
      } else {
        if (Math.abs(p.lng - lastLng) > 1e-10 || Math.abs(p.lat - lastLat) > 1e-10) {
          marker.setLngLat([p.lng, p.lat]);
          lastLng = p.lng;
          lastLat = p.lat;
        }
        if (!(Math.abs(angleDiffDeg(lastHeading, p.headingDeg)) < 0.05)) {
          marker.setRotation(p.headingDeg);
          lastHeading = p.headingDeg;
        }
        setVisible(true);
      }

      const radius = haloRadiusPx(p.accuracyM, p.lat, map.getZoom());
      if (!(Math.abs(radius - lastRadius) < 0.5)) {
        root.style.setProperty('--dash-puck-r', `${radius.toFixed(1)}px`);
        lastRadius = radius;
      }
    },
    destroy() {
      unsubscribeTelemetry();
      marker?.remove();
      marker = null;
    },
  };
}
