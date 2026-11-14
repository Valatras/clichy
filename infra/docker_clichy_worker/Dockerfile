# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app


FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/jobs/package.json ./packages/jobs/package.json
COPY packages/ui/package.json ./packages/ui/package.json

RUN pnpm fetch


FROM deps AS builder

COPY . .

RUN pnpm install --offline --frozen-lockfile
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter @clichy/db db:generate
RUN pnpm --filter worker build
RUN pnpm --filter worker deploy --prod --legacy /out


FROM base AS runner

ENV NODE_ENV="production"
ENV PHOTO_STORAGE_PATH="/data/photos"

WORKDIR /app

COPY --from=builder --chown=node:node /out/ ./
COPY --from=builder --chown=node:node /app/apps/worker/dist ./dist

RUN mkdir -p "${PHOTO_STORAGE_PATH}" \
    && chown -R node:node "${PHOTO_STORAGE_PATH}"

VOLUME ["/data/photos"]

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/live').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.mjs"]
