# bubble-backend

Fastify + TypeScript + Prisma + PostgreSQL backend for Bubble.

## Stack

- **Node.js + TypeScript** (strict, ES2022, NodeNext)
- **Fastify 5** — HTTP server (`logger` enabled)
- **`@fastify/jwt`** — JWT signing and verification via httpOnly cookies
- **`@fastify/cookie`** — cookie parsing/setting
- **`@fastify/cors`** — CORS for `http://localhost:5173`
- **`@fastify/helmet`** — security headers
- **bcrypt** — password hashing (12 rounds)
- **Prisma ORM + PostgreSQL** — database access

---

## Authentication

Bubble uses **JWT in httpOnly cookies** — the industry standard for web messaging apps.

### How it works

```
Register   POST /auth/register  { name, phone, password }
           → 201 { id, name, phone }

Login      POST /auth/login     { phone, password }
           → 200 { id, name }
           → Sets two httpOnly cookies:
               access_token  (JWT, 15 min)
               refresh_token (opaque random string, 30 days)

Refresh    POST /auth/refresh   (no body — uses refresh_token cookie)
           → 200 { ok: true }
           → Rotates both cookies silently
           → Called automatically by the frontend on any 401

Logout     DELETE /auth/logout  (no body)
           → 200 { ok: true }
           → Revokes refresh token in DB, clears both cookies
```

### Why httpOnly cookies (not localStorage)

| Approach | Risk |
|---|---|
| `localStorage` | Readable by any JS — XSS steals token permanently |
| httpOnly cookie | JS cannot read it — immune to XSS |

### Token design

- **Access token** — short-lived JWT (15 min). Verified on every protected request with no DB hit.
- **Refresh token** — long-lived opaque random string (30 days). Stored as a SHA-256 hash in the `refresh_tokens` table. Rotated on every use (old token is revoked, new one issued).

### Protecting a route

Add `{ preHandler: [app.authenticate] }` to any route. `request.user` is typed as `{ userId, name }`.

```ts
app.get('/example', { preHandler: [app.authenticate] }, async (request) => {
  return { hello: request.user.name }
})
```

---

## Project Structure

```
bubble-backend/
├── .env.example            ← copy to .env and fill in secrets
├── prisma/
│   └── schema.prisma       ← DB models: User, Group, GroupMember, Message, RefreshToken
└── src/
    ├── index.ts            ← Fastify setup, plugin registration, authenticate decorator
    ├── lib/
    │   └── prisma.ts       ← shared PrismaClient singleton
    ├── routes/
    │   ├── auth.ts         ← /auth/register, /auth/login, /auth/refresh, /auth/logout
    │   ├── users.ts        ← /users, /users/:id, /users/me  (all protected)
    │   ├── groups.ts       ← /groups, /groups/:id  (all protected)
    │   ├── groupMembers.ts ← /groupMembers, /groups/:id/members  (all protected)
    │   └── health.ts       ← /health  (public)
    └── types/
        └── fastify.d.ts    ← JWT payload type + authenticate decorator declaration
```

---

## API Reference

### Public (no token needed)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok: true }` |
| `POST` | `/auth/register` | `{ name, phone, password }` | `201 { id, name, phone }` |
| `POST` | `/auth/login` | `{ phone, password }` | `{ id, name }` + sets cookies |
| `POST` | `/auth/refresh` | — | `{ ok: true }` + rotates cookies |
| `DELETE` | `/auth/logout` | — | `{ ok: true }` + clears cookies |

### Protected (requires valid `access_token` cookie)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/users/me` | Returns `{ userId, name }` from the access token |
| `GET` | `/users` | All users (passwordHash never returned) |
| `GET` | `/users/:id` | Single user (passwordHash never returned) |
| `POST` | `/groups` | Body: `{ name }` — `creatorId` comes from token |
| `GET` | `/groups` | All groups |
| `GET` | `/groups/:id` | Single group |
| `GET` | `/groupMembers` | All memberships |
| `POST` | `/groups/:id/members` | Body: `{ userId, role? }` |
| `GET` | `/groups/:id/members` | Members of a group |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Set values in `.env`:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — generate a strong random secret:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```

### 3. Run database migration

```bash
npm run prisma:migrate    # creates all tables including refresh_tokens
npm run prisma:generate   # generates the typed Prisma client
```

### 4. Start dev server

```bash
npm run dev    # tsx watch, hot reload, listens on :3000
```

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Dev server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled server from `dist/index.js` |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:migrate` | Apply DB migrations (`prisma migrate dev`) |
