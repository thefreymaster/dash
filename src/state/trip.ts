/**
 * Trip computer accumulators, persisted (`dash:v1:trip`) so a trip survives the PWA being
 * killed in the background. Reset with `trip.reset()`.
 */
import type { Trip } from '../types';
import { defineClientState } from './clientState';

export const initialTrip: Trip = {
  startedAt: null,
  distanceM: 0,
  movingMs: 0,
  maxSpeedMps: 0,
  lastMovedAt: null,
};

export const trip = defineClientState<Trip>('trip', initialTrip, {
  persist: true,
  sanitize: (stored, initial) => {
    const finite = (n: number) => Number.isFinite(n) && n >= 0;
    return finite(stored.distanceM) && finite(stored.movingMs) && finite(stored.maxSpeedMps)
      ? stored
      : initial;
  },
});
