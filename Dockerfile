# endBuy — image de production (API + WebSocket + interface web)
FROM node:22-alpine AS build
WORKDIR /app
COPY client/package*.json client/
COPY server/package*.json server/
RUN npm --prefix client ci && npm --prefix server ci
COPY client client
COPY server server
RUN npm --prefix client run build && npm --prefix server run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0 DATA_DIR=/data CLIENT_DIR=/app/client/dist
WORKDIR /app
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
VOLUME ["/data"]
EXPOSE 3001
USER node
CMD ["node", "server/dist/endbuy-server.mjs"]
