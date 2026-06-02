# node:20 (not slim) includes python3, gcc, make — needed for better-sqlite3
FROM node:20

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 3001
CMD ["node", "index.js"]
