import { DefaultUrlSerializer, type UrlTree } from '@angular/router';

/**
 * Angular parses `/admin/` as segments `admin` and `` and finds no route. The Svelte build served `/admin/` (the page)
 * and redirected `/admin`, so both must reach the same route; this drops a trailing slash before parsing.
 */
export class TrailingSlashUrlSerializer extends DefaultUrlSerializer {
  override parse(url: string): UrlTree {
    return super.parse(
      url.replace(/^([^?#]*?)\/+(?=[?#]|$)/, (match, path: string) => path || match),
    );
  }
}
