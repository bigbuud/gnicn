FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV NODE_ENV=production \
    PORT=8080 \
    VIDEO_DIR=/videos

EXPOSE 8080

# draait standaard als 'node' (uid 1000); zie 'user:' in docker-compose.yml
# als de map op je server een andere eigenaar heeft
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
