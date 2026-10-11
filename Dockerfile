# One image: the game server and the built client it serves. See docs/deployment.md.
FROM node:22.23.3-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY server ./server
COPY client ./client
COPY scripts ./scripts
COPY vendor/settlemaker ./vendor/settlemaker
COPY vendor/settlemaker.snapshot.json ./vendor/settlemaker.snapshot.json
COPY vendor/settlemaker-runtime.canonical.tgz ./vendor/settlemaker-runtime.canonical.tgz
# Source-review build only; combined distribution remains gated by D23.
RUN npm run setup:map-source && npm ci && npm run build \
 && npm prune --omit=dev

FROM build AS client-out
RUN mkdir /out && cp -r client/dist/browser/. /out/

FROM node:22.23.3-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/games.db \
    STATIC_DIR=/app/client/dist \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY server/backup-loop.sh ./server/backup-loop.sh
COPY --from=client-out /out ./client/dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/dist/main.js"]
