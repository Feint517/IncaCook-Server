# syntax=docker/dockerfile:1.7

# ---------- Stage 1: install dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Copy the Prisma schema first so the @prisma/client postinstall hook
# can generate the typed client (otherwise enums like KycDocType end
# up `undefined` at runtime and decorators like @IsEnum() crash boot).
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma:generate || true
RUN pnpm build

# ---------- Stage 3: production runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN addgroup -S incacook && adduser -S incacook -G incacook

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json pnpm-lock.yaml ./

USER incacook

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/v1/health || exit 1

CMD ["node", "dist/main.js"]
