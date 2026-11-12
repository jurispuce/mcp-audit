# syntax=docker/dockerfile:1

# ---- Build: install all dependencies, build the app, then drop dev dependencies
# The full image already has python3, make and g++, which node-gyp needs for better-sqlite3.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
RUN npm run build && npm prune --omit=dev

# ---- Runtime: only what the server needs
FROM node:22-bookworm-slim AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/jurispuce/mcp-audit" \
	org.opencontainers.image.description="Audit planning and running app with an MCP server" \
	org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
	APP_VERSION=${APP_VERSION} \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATA_DIR=/data \
	MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/server.js /app/server-env.js ./
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/seed ./seed
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
