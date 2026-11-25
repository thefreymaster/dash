/**
 * Navigation intent: the chosen destination and a nonce that forces a new route request.
 * Not persisted — navigation ends when the app is closed. The route geometry itself is
 * server state: a `useQuery` keyed on the destination, origin and `rerouteNonce`.
 */
import type { NavState } from '../types';
import { defineClientState } from './clientState';

export const initialNav: NavState = {
  destination: null,
  rerouteNonce: 0,
};

export const nav = defineClientState<NavState>('nav', initialNav);
