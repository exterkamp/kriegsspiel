import type { FastifyInstance } from 'fastify';

/** Pages the Angular client routes itself; the server answers each (and anything below it) with `index.html`. */
const SPA_ROOTS = ['/admin', '/map-authoring', '/map-benchmark'];

/** The Svelte client's separate pages, which the Angular client serves as routes instead. */
const OLD_PAGES: Record<string, string> = {
  '/map-authoring.html': '/map-authoring',
  '/map-benchmark.html': '/map-benchmark',
  '/table-benchmark.html': '/map-benchmark',
};

const isApi = (path: string) => path === '/admin/api' || path.startsWith('/admin/api/');
const isRoute = (path: string) =>
  !isApi(path) && SPA_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));

/**
 * SPA fallback for the Angular client (#271). Runs only for requests nothing else answered, so
 * `/games`, `/scenarios`, `/auth` and `/admin/api` keep their own handlers and their JSON 404s.
 * Register after `@fastify/static`, and only when it has a root.
 */
export function spaFallback(server: FastifyInstance): void {
  const notFound = (method: string, path: string) => ({
    message: `Route ${method}:${path} not found`,
    error: 'Not Found',
    statusCode: 404,
  });
  server.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '/';
    const at = url.indexOf('?');
    const path = at < 0 ? url : url.slice(0, at);
    const query = at < 0 ? '' : url.slice(at);
    const readOnly = request.method === 'GET' || request.method === 'HEAD';
    const moved = readOnly ? OLD_PAGES[path] : undefined;
    if (moved) return reply.redirect(moved + query, 301);
    if (readOnly && isRoute(path)) return reply.sendFile('index.html');
    return reply.code(404).send(notFound(request.method, path));
  });
}
