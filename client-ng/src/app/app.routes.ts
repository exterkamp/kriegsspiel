import type { Routes } from '@angular/router';

/** One workspace, four pages. Admin, map authoring and the benchmark are lazy so the game bundle stays small. */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./game/game.component').then((m) => m.GameComponent),
  },
  {
    path: 'admin',
    loadComponent: () => import('./placeholder.component').then((m) => m.PlaceholderComponent),
    data: { title: 'Admin (not yet ported)' },
  },
  {
    path: 'map-authoring',
    loadComponent: () => import('./placeholder.component').then((m) => m.PlaceholderComponent),
    data: { title: 'Map authoring (not yet ported)' },
  },
  {
    path: 'map-benchmark',
    loadComponent: () => import('./placeholder.component').then((m) => m.PlaceholderComponent),
    data: { title: 'Map benchmark (not yet ported)' },
  },
  { path: '**', redirectTo: '' },
];
