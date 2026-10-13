import type { Routes } from '@angular/router';

/**
 * One Angular workspace with lazy tool pages. Admin, map authoring and the benchmarks are lazy so the game bundle stays small.
 * Angular's router ignores a trailing slash, so `/admin` and `/admin/` both resolve; `/admin/api` is not a route, it is
 * proxied (dev server) or served (API) before the app is reached.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
  },
  {
    path: 'style-guide',
    title: 'Style guide · Kriegsspiel',
    loadComponent: () =>
      import('./style-guide/style-guide.component').then((m) => m.StyleGuideComponent),
  },
  {
    path: 'spike/board',
    title: 'Board spike · Kriegsspiel',
    loadComponent: () =>
      import('./spike-board/spike-board.component').then((m) => m.SpikeBoardComponent),
  },
  {
    path: 'admin',
    title: 'Kriegsspiel admin',
    loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
  },
  {
    path: 'map-table',
    title: 'Saved map inspection · Kriegsspiel',
    loadComponent: () => import('./map-table/map-table.component').then((m) => m.MapTableComponent),
  },
  {
    path: 'map-authoring',
    title: 'Map authoring · Kriegsspiel',
    loadComponent: () =>
      import('./map-authoring/map-authoring.component').then((m) => m.MapAuthoringComponent),
  },
  {
    path: 'map-benchmark',
    title: 'Local map performance verification',
    loadComponent: () =>
      import('./benchmarks/map-benchmark.component').then((m) => m.MapBenchmarkComponent),
  },
  {
    path: 'table-benchmark',
    title: 'Local table performance verification',
    loadComponent: () =>
      import('./benchmarks/table-benchmark.component').then((m) => m.TableBenchmarkComponent),
  },
  // Old multi-page URLs are linked from docs and bookmarks.
  { path: 'map-table.html', redirectTo: 'map-table' },
  { path: 'map-authoring.html', redirectTo: 'map-authoring' },
  { path: 'map-benchmark.html', redirectTo: 'map-benchmark' },
  { path: 'table-benchmark.html', redirectTo: 'table-benchmark' },
  { path: '**', redirectTo: '' },
];
