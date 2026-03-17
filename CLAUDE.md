# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**Route pattern:** Each file in `src/routes/` exports a `FastifyPluginAsync` and is registered in `src/index.ts`. Planned routes include `auth.ts`, `messages.ts`, `polls.ts`, etc.

**Database:** `prisma/schema.prisma` — PostgreSQL datasource via `DATABASE_URL` env var. Schema is currently empty (no models defined yet).

## Environment Setup

Copy `.env.example` to `.env` and set `DATABASE_URL` to a PostgreSQL connection string before running.
