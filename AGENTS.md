# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Local Setup (MUST follow this order)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Set DATABASE_URL to a PostgreSQL connection string

# 3. Run migrations + generate Prisma client (REQUIRED)
npx prisma migrate dev
# If "drift detected" error: run `npx prisma migrate reset` (drops and recreates all tables)

# 4. Start dev server
npm run dev   # hot reload on :3000
```

**CRITICAL:** `npm install` does NOT generate the Prisma client. You MUST run `npx prisma migrate dev` (or `npx prisma generate`) after cloning or after any schema change. Without this, Prisma models like `prisma.refreshToken` will be `undefined` and cause runtime errors like `Cannot read properties of undefined (reading 'create')`.

## Commands

```bash
npm run dev              # Start dev server with hot reload (tsx watch)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled server from dist/index.js
npm run prisma:generate  # Regenerate Prisma client after schema changes
npm run prisma:migrate   # Run migrations (prisma migrate dev)
```

There are no tests configured yet.

## Architecture

**Stack:** Node.js + TypeScript (strict, ES2022, NodeNext) · Fastify 5 · Prisma ORM · PostgreSQL

**Entry point:** `src/index.ts` — starts Fastify, registers CORS (`http://localhost:5173`), Helmet, and route plugins, then listens on `PORT`/`HOST` (defaults: `0.0.0.0:3000`).

**Route pattern:** Each file in `src/routes/` exports a `FastifyPluginAsync` and is registered in `src/index.ts`.

**Database:** `prisma/schema.prisma` — PostgreSQL datasource via `DATABASE_URL` env var. Models: User, Group, GroupMember, Message, RefreshToken.

## Environment Setup

Copy `.env.example` to `.env` and set `DATABASE_URL` to a PostgreSQL connection string before running.
