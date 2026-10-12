import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { applyContrast } from './app/ui/contrast';

applyContrast();

bootstrapApplication(AppComponent, appConfig).catch((err: unknown) => console.error(err));
