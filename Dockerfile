# node:20 includes python3, gcc, make — required for better-sqlite3 native compilation
FROM node:20

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./

EXPOSE 3001
CMD ["node", "index.js"]
