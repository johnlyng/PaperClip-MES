# ─── Build stage ─────────────────────────────────────────────────────────────
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

# Config is mounted at runtime via docker-compose volume
RUN mkdir -p /app/config

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
