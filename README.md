# bgmoffice

Internal operations app for managing private fitness/wellness instructors and clients.

## Structure

```
bgmoffice/
├── client/     React + Tailwind + React Router frontend
└── server/     Node.js + Express + SQLite backend
```

## Quick Start

### Server
```bash
cd server
npm install
npm run seed      # create & seed the database
npm run dev       # start with file-watching
```

Server runs on http://localhost:3001

### Client
```bash
cd client
npm install
npm run dev       # start Vite dev server
```

Client runs on http://localhost:5173

## Default Credentials

| Role  | Email                  | Password   |
|-------|------------------------|------------|
| Admin | admin@bgmoffice.com    | admin123   |
| Staff | lyra@bgmoffice.com     | staff123   |
| Staff | maria@bgmoffice.com    | staff123   |
| Staff | sarede@bgmoffice.com   | staff123   |
| Staff | claire@bgmoffice.com   | staff123   |

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, React Router v6
- **Backend**: Node.js, Express 5, better-sqlite3
- **Auth**: bcryptjs, JWT (stored in localStorage)
- **Database**: SQLite (file: `server/db/bgmoffice.db`)
