# node:20 includes python3, gcc, make — required for better-sqlite3 native compilation
FROM node:20

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./

ENV NODE_ENV=production

# Ensure the persistent volume directory exists at image build time.
# Railway mounts the volume here, overriding this empty dir at runtime.
RUN mkdir -p /app/server/data

EXPOSE 3001
CMD ["node", "start.js"]
