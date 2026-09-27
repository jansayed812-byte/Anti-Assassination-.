# Operations console: built dashboard + backend API/WebSocket on one port.
FROM node:20-bookworm AS web
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

FROM node:20-bookworm AS api
WORKDIR /app/services
COPY services/package.json services/package-lock.json ./
RUN npm ci
COPY services/ ./
RUN npx tsc --noEmit

FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=8000 STATIC_DIR=/app/dashboard/dist
WORKDIR /app
COPY --from=api /app/services /app/services
COPY --from=web /app/dashboard/dist /app/dashboard/dist
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "--prefix", "/app/services", "tsx", "/app/services/server/index.ts"]
