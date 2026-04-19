ARG NODE_VERSION=22
ARG NODE_VARIANT=alpine

FROM node:${NODE_VERSION}-${NODE_VARIANT} AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsdown.config.ts ./
COPY src ./src
RUN pnpm build

FROM node:${NODE_VERSION}-${NODE_VARIANT} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    SHRIMP_STATE_DIR=/var/lib/shrimp
COPY --from=builder /app/dist ./dist
RUN mkdir -p "$SHRIMP_STATE_DIR" && chown -R node:node "$SHRIMP_STATE_DIR"
VOLUME ["/var/lib/shrimp"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
