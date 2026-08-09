# AFROJ GLOBAL VENTURES - Production Dockerfile
# Works on Koyeb, Render, Fly.io, Railway, and any container platform.
FROM node:20-slim

WORKDIR /app

# Copy app files
COPY package.json server.js ./
COPY deploy ./deploy

# Data directory (persisted via volume on platforms that support it)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=8090
ENV NODE_ENV=production

EXPOSE 8090

CMD ["node", "server.js"]
