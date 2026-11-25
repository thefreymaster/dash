/**
 * Low-rate (≈1 Hz) sensor summary. Written by the geolocation/compass/simulator modules
 * (`sensors/`), read by UI that only needs human-speed updates (GPS status, compass tape
 * labels, trip accumulation). Not persisted — a fresh launch starts `idle`.
 * Smoothed per-frame values for the camera and speedometer are in `pose.ts`.
 */
import type { Telemetry } from '../types';
import { defineClientState } from './clientState';

export const initialTelemetry: Telemetry = {
  status: 'idle',
  source: 'gps',
  fix: null,
  speedMps: 0,
  speedKnown: false,
  headingDeg: null,
  compassDeg: null,
};

export const telemetry = defineClientState<Telemetry>('telemetry', initialTelemetry);
