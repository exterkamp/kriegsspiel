import type { Routes } from '@angular/router';

/** Included only through the Angular development configuration's file replacement. */
export const developmentRoutes: Routes = [
  {
    path: 'dev/local-board',
    title: 'Local board · Kriegsspiel',
    loadComponent: () =>
      import('./local-board/local-board.component').then((m) => m.NativeLocalBoardComponent),
  },
];
