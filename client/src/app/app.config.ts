import { type ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, UrlSerializer } from '@angular/router';
import { routes } from './app.routes';
import { TrailingSlashUrlSerializer } from './trailing-slash';

/** Zoneless: state lives in signals, and the Three.js loop runs outside Angular's change detection. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    { provide: UrlSerializer, useClass: TrailingSlashUrlSerializer },
  ],
};
