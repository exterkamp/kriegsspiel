import { writable } from 'svelte/store';
import { initialState, type ClientState } from '../net/state.js';
import type { ViewId } from './views.js';

/** The shared app store: both the Three.js table and the Svelte desk read from and write to these. */
export const gameState = writable<ClientState>(initialState);
export const activeView = writable<ViewId>('table');
