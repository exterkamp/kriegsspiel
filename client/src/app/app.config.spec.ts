import { TestBed } from '@angular/core/testing';
import { Router, UrlSerializer } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { appConfig } from './app.config';
import { TrailingSlashUrlSerializer } from './trailing-slash';

describe('appConfig', () => {
  it('registers the trailing-slash serializer, so /admin/ resolves in production', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(UrlSerializer)).toBeInstanceOf(TrailingSlashUrlSerializer);
    expect(TestBed.inject(Router).parseUrl('/admin/').toString()).toBe('/admin');
  });
});
