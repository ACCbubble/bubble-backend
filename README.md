# bubble-backend

Simple Fastify backend with TypeScript + Prisma + PostgreSQL.

## Stack

- Node.js + TypeScript (strict, ES2022, NodeNext)
- Fastify (`logger` enabled)
- `@fastify/cors` (origin: `http://localhost:5173`)
- `@fastify/helmet`
- Prisma ORM + PostgreSQL

## Fully Explained - Every component of Backend structure

<pre> ```
bubble-backend/
├── .env.example
├── .gitignore
├── package-lock.json
├── package.json
├── README.md
├── tsconfig.json
├── node_modules/
├── prisma/
│   └── schema.prisma
└── src/
    ├── index.ts
    └── routes/
        └── health.ts 
``` </pre>
## Project Structure

```txt
src/
  index.ts
  routes/
prisma/
  schema.prisma
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file:

   ```bash
   cp .env.example .env
   ```

3. Set `DATABASE_URL` in `.env` to your PostgreSQL connection string.

4. Generate Prisma Client:

   ```bash
   npm run prisma:generate
   ```

5. Run migrations:

   ```bash
   npm run prisma:migrate
   ```

## Scripts

- `npm run dev` - start development server with `tsx watch`
- `npm run build` - compile TypeScript to `dist/`
- `npm run start` - run compiled server from `dist/index.js`
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate` - run Prisma migrations (`prisma migrate dev`)

## API

- `GET /health` -> `{ "ok": true }`
