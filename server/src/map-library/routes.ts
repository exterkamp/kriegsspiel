import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { LibraryNameSchema, type LibraryMapDescriptor } from '@kriegsspiel/protocol';
import type { Auth } from '../auth/routes.js';
import { LibraryBusyError, type LibraryLease } from './admission.js';
import { LibraryStoreError } from './store.js';
import { MapLibraryService } from './service.js';
import { LIBRARY_ASSET_BYTES } from './validation.js';
const TYPE = 'application/vnd.kriegsspiel.map+json';
const ref = z
  .object({ kind: z.enum(['owned', 'included']), id: z.string().min(1).max(128) })
  .strict();
const key = z.uuid();
const query = z
  .object({
    source: z.enum(['owned', 'included']),
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_.-]+$/)
      .optional(),
  })
  .strict();
interface Operation {
  owner: string;
  lease?: LibraryLease;
  abort: AbortController;
  cleanup: () => void;
  retirement?: Promise<void>;
}
export async function mapLibraryRoutes(
  server: FastifyInstance,
  auth: Auth,
  library: MapLibraryService,
): Promise<void> {
  await server.register(
    async (app) => {
      const operations = new Map<FastifyRequest, Operation>();
      const retire = (req: FastifyRequest): Promise<void> => {
        const op = operations.get(req);
        if (!op) return Promise.resolve();
        if (op.retirement) return op.retirement;
        let complete!: () => void;
        let fail!: (error: unknown) => void;
        const retirement = new Promise<void>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        });
        // Install before abort can synchronously reenter; keep it discoverable through actual exit.
        op.retirement = retirement;
        const settled = () => {
          if (operations.get(req) === op) operations.delete(req);
        };
        try {
          op.abort.abort();
          op.cleanup();
          void (op.lease?.release() ?? Promise.resolve()).then(
            () => {
              settled();
              complete();
            },
            (error) => {
              settled();
              fail(error);
            },
          );
        } catch (error) {
          settled();
          fail(error);
        }
        return retirement;
      };
      const principal = (req: FastifyRequest) => {
        const op = operations.get(req);
        if (!op || auth.userOf(req)?.id !== op.owner) throw new LibraryStoreError('owner_changed');
        return op;
      };
      app.addHook('onRequest', async (req, reply) => {
        reply.header('Cache-Control', 'private, no-store');
        const user = auth.userOf(req);
        if (!user) return reply.code(401).send({ error: 'not_signed_in' });
        const abort = new AbortController();
        const departed = () => {
          void retire(req).catch(() => {});
        };
        const responseClosed = () => {
          if (!reply.raw.writableFinished) departed();
        };
        req.raw.once('aborted', departed);
        reply.raw.once('close', responseClosed);
        const op: Operation = {
          owner: user.id,
          abort,
          cleanup: () => {
            req.raw.off('aborted', departed);
            reply.raw.off('close', responseClosed);
          },
        };
        operations.set(req, op);
        try {
          if (req.method === 'PUT') {
            key.parse((req.params as { requestId: string }).requestId);
            metadata(req);
            if (
              req.headers['content-type'] !== TYPE ||
              (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
            )
              return reply.code(415).send({ error: 'unsupported_map_format' });
            const length = req.headers['content-length'];
            if (length && (!/^\d+$/.test(length) || Number(length) > LIBRARY_ASSET_BYTES))
              return reply.code(413).send({ error: 'map_too_large' });
            op.lease = library.admission.acquire(user.id);
          } else if (req.routeOptions.url?.includes('/maps/:kind/')) {
            const parsed = ref.parse(req.params);
            if (parsed.kind === 'owned') key.parse(parsed.id);
            else if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(parsed.id)) throw new Error('bad ref');
            op.lease = library.admission.acquire(user.id);
          }
        } catch (e) {
          if (e instanceof LibraryBusyError)
            return reply.code(429).send({ error: 'map_library_busy' });
          return reply.code(400).send({ error: 'invalid_map_request' });
        }
      });
      app.addHook('onResponse', retire);
      app.addHook('onError', async (req) => {
        await retire(req);
      });
      app.addHook('onClose', async () => {
        await Promise.all([...operations.keys()].map(retire));
      });
      app.setErrorHandler((error, _req, reply) => {
        const code = error instanceof LibraryStoreError ? error.code : undefined;
        const status =
          code === 'owner_changed'
            ? 401
            : code?.includes('conflict') || code?.includes('ambiguous')
              ? 409
              : code === 'map_request_removed'
                ? 410
                : code === 'restart_map_list'
                  ? 400
                  : code === 'map_library_full'
                    ? 422
                    : code === 'map_identity_mismatch'
                      ? 400
                      : code?.includes('recovery')
                        ? 503
                        : ((error as { statusCode?: number }).statusCode ??
                          (error instanceof z.ZodError ||
                          (error instanceof Error && error.message === 'map_validation_failed') ||
                          error instanceof TypeError
                            ? 400
                            : 503));
        reply
          .code(status >= 400 && status <= 599 ? status : 503)
          .send({ error: code ?? 'map_operation_failed' });
      });
      app.addContentTypeParser(TYPE, (req, payload, done) => {
        const op = operations.get(req);
        if (!op?.lease) {
          done(new Error('Missing map admission'));
          return;
        }
        const read = async () => {
          const stream = payload as Readable;
          const chunks: Buffer[] = [];
          let bytes = 0;
          let count = 0;
          const abort = () =>
            stream.destroy(Object.assign(new Error('Map upload cancelled'), { statusCode: 408 }));
          const timer = setTimeout(abort, 30000);
          op.abort.signal.addEventListener('abort', abort, { once: true });
          try {
            if (op.abort.signal.aborted) throw new Error('Cancelled');
            for await (const value of stream) {
              const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
              bytes += chunk.byteLength;
              if (bytes > LIBRARY_ASSET_BYTES || ++count > 1048576)
                throw Object.assign(new Error('Map too large'), { statusCode: 413 });
              chunks.push(chunk);
            }
            if (op.abort.signal.aborted) throw new Error('Cancelled');
            return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
              Buffer.concat(chunks, bytes),
            );
          } finally {
            clearTimeout(timer);
            op.abort.signal.removeEventListener('abort', abort);
          }
        };
        void read().then(
          (value) => done(null, value),
          (error) => done(error as Error),
        );
      });
      app.get('/maps', async (req) => {
        const op = principal(req);
        const q = query.parse(req.query);
        return library.list(op.owner, q.source, q.cursor);
      });
      app.get('/saves/:requestId', async (req, reply) => {
        const op = principal(req);
        const id = key.parse((req.params as { requestId: string }).requestId);
        const item = library.store.operation(op.owner, id);
        return item ?? reply.code(404).send({ error: 'map_save_unknown' });
      });
      app.get('/maps/:kind/:id', async (req, reply) => {
        const op = principal(req);
        const r = ref.parse(req.params);
        const result = await library.read(op.owner, r.kind, r.id, op.lease!, op.abort.signal);
        principal(req);
        if (!result) return reply.code(404).send({ error: 'map_not_found' });
        headers(reply, result.item);
        return reply.type(TYPE).send(result.canonicalJson);
      });
      app.put('/saves/:requestId', { bodyLimit: LIBRARY_ASSET_BYTES }, async (req) => {
        const op = principal(req);
        const id = key.parse((req.params as { requestId: string }).requestId);
        const m = metadata(req);
        if (typeof req.body !== 'string') throw new Error('Invalid map body');
        const item = await library.save(
          op.owner,
          id,
          m.name,
          req.body,
          m.identity,
          op.lease!,
          op.abort.signal,
          () => {
            principal(req);
          },
        );
        principal(req);
        return item;
      });
    },
    { prefix: '/map-library' },
  );
}
function metadata(req: FastifyRequest) {
  for (const name of Object.keys(req.headers))
    if (name.startsWith('x-map-') && !['x-map-name', 'x-map-identity'].includes(name))
      throw new Error('Unknown map metadata');
  const encoded = req.headers['x-map-name'];
  const identity = req.headers['x-map-identity'];
  if (
    typeof encoded !== 'string' ||
    encoded.length > 1920 ||
    !/^[\x20-\x7e]+$/.test(encoded) ||
    typeof identity !== 'string' ||
    !/^[a-f0-9]{64}$/.test(identity)
  )
    throw new Error('Invalid map metadata');
  return { name: LibraryNameSchema.parse(decodeURIComponent(encoded)), identity };
}
function headers(reply: FastifyReply, item: LibraryMapDescriptor) {
  reply
    .header('X-Map-Kind', item.ref.kind)
    .header('X-Map-Id', item.ref.id)
    .header('X-Map-Name', encodeURIComponent(item.name))
    .header('X-Map-Identity', item.assetIdentity)
    .header('X-Map-Width-M', String(item.widthM))
    .header('X-Map-Height-M', String(item.heightM));
  if (item.createdAtMs !== undefined) reply.header('X-Map-Created-At-Ms', String(item.createdAtMs));
  reply.header('Cache-Control', 'private, no-store');
}
