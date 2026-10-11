import { type ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

/** Zoneless: state lives in signals, and the Three.js loop runs outside Angular's change detection. */
export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideRouter(routes)],
};
