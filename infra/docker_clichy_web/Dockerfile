# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app


FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/ui/package.json ./packages/ui/package.json

RUN pnpm fetch


FROM deps AS builder

COPY . .

RUN pnpm install --offline --frozen-lockfile
ARG VITE_SERVER_URL
RUN pnpm --filter web build
RUN pnpm --filter web deploy --prod --legacy /out


FROM base AS runner

ENV NODE_ENV="production"
ENV PORT="3000"
ENV HOST="0.0.0.0"

WORKDIR /app

COPY --from=builder --chown=node:node /out/ ./
COPY --from=builder --chown=node:node /app/apps/web/build ./build

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./node_modules/.bin/react-router-serve", "./build/server/index.js"]
