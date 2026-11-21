# One image serves the api, worker, migrate and mock-whatsapp containers;
# docker-compose picks the entrypoint.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm install --no-save prisma@6
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/certificates && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
