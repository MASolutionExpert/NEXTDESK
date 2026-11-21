# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS monolith-build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm config set registry https://registry.npmjs.org/ \
  && npm config set fetch-retries 5 && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 && npm config set fetch-timeout 300000 \
  && npm install --no-audit --no-fund
COPY tsconfig.json next.config.ts postcss.config.json server.ts ./
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

FROM node:24-bookworm-slim AS worker-deps
WORKDIR /app/worker
COPY worker/package.json ./
RUN npm config set registry https://registry.npmjs.org/ \
  && npm config set fetch-retries 5 && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 && npm config set fetch-timeout 300000 \
  && npm install --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /etc/apt/keyrings \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends ffmpeg postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY --from=monolith-build /app/node_modules ./node_modules
COPY --from=monolith-build /app/.next ./.next
COPY --from=monolith-build /app/public ./public
COPY --from=monolith-build /app/next.config.ts ./next.config.ts
COPY --from=monolith-build /app/tsconfig.json ./tsconfig.json
COPY --from=monolith-build /app/server.ts ./server.ts
COPY --from=monolith-build /app/src ./src
COPY --from=worker-deps /app/worker/node_modules ./worker/node_modules
COPY worker/ ./worker/
COPY scripts/run-data-command.sh ./scripts/run-data-command.sh
RUN chmod 755 /app/scripts/run-data-command.sh
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod 755 /app/scripts/docker-entrypoint.sh
COPY VERSION ./
COPY CHANGELOG.md ./
COPY package.json ./
RUN mkdir -p /app/data /app/data/uploads /app/data/backups
ENV NODE_ENV=production
ENV APP_ENV=production
ENV SERVER_PORT=5174
ENV BIND_ADDRESS=0.0.0.0
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const port = process.env.PORT || process.env.SERVER_PORT || 5174; require('http').get('http://localhost:' + port + '/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.ts"]
