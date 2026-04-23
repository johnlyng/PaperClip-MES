# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json ./
RUN pnpm install

COPY tsconfig.json ./
COPY src ./src

RUN pnpm build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json ./
RUN pnpm install --prod

COPY --from=builder /app/dist ./dist

# Config is volume-mounted at runtime via docker-compose
RUN mkdir -p /app/config

ENV NODE_ENV=production
ENV HEALTH_PORT=9090

EXPOSE 9090

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:9090/health || exit 1

CMD ["node", "dist/index.js"]
