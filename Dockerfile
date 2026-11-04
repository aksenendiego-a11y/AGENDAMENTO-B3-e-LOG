FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

COPY src ./src
COPY migrations ./migrations
RUN npm run build

COPY web ./web
WORKDIR /app/web
RUN npm install && npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Copiar as migrations do builder
COPY --from=builder /app/migrations ./migrations

CMD ["node", "dist/index.js"]
