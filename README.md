# bubble-backend

Simple Fastify backend with TypeScript + Prisma + PostgreSQL.

## Stack

- Node.js + TypeScript (strict, ES2022, NodeNext)
- Fastify (`logger` enabled)
- `@fastify/cors` (origin: `http://localhost:5173`)
- `@fastify/helmet`
- Prisma ORM + PostgreSQL

## Fully Explained - Every component of Backend structure

<pre> 
bubble-backend/          
├── .env.example       // template for environment variables (PORT, DATABASE_URL, DB_HOST, DB_USER, etc) - b/c it is example, all fields are placeholders to show checklist of what app needs. Eventually every team member needs to make their own .env with real secrets
├── .gitignore         // tells Git what files/folders to ignore such as (node_modules) - these files are not shared on GitHub b/c they are too large or secret
├── package.json       // lists out (dependencies, scripts, metadata) the backend uses
├── package-lock.json  // exact versions of dependencies (ex: 13.0.2)
├── README.md          
├── tsconfig.json      // typescript configuration - tells typescript how to compile code correctly
├── node_modules/      // all installed libraries (HUGE - contains tons of pre-made tools, all of them were auto-installed) not on github b/c this only shows on your pc after you use npm to download modules
├── prisma/            // prisma talks to DB and handles fetching/updating data 
│   └── schema.prisma  // describes relationships, tables, fields, etc within database
└── src/               // ALL actual backend code is here. In future, additional folders (services, controllers, helpers, etc) will be inside src 
    ├── index.ts       // entry point of backend (1st file that runs when you start the backend server). Purpose: starts fastify registers routes, listens on a port. (Ties everything together)
    └── routes/        // every file inside routes defines HTTP Endpoints. In future, we want auth.ts, messages.ts, polls.ts, etc.
        └── health.ts  // defines /health route. Purpose: checks if backend is running. 
</pre>






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
