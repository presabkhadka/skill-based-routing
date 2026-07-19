# Skill-Based Routing System

Automatically matches incoming service requests to the best-qualified, available
technician by evaluating **skills → proficiency level → availability → workload**,
in that strict order. If nobody qualifies, the request is left **unassigned**.

Built as a pnpm monorepo:

| Package            | Stack                                   | Role                                    |
| ------------------ | --------------------------------------- | --------------------------------------- |
| `apps/api`         | NestJS 11 · Prisma 6 · PostgreSQL 16    | REST API + deterministic routing engine |
| `apps/web`         | React 19 · Vite 6 · React Query         | Dispatcher UI                           |
| `packages/shared`  | Zod                                     | Shared request/skill contract & types   |

---

## Quick start

**Prerequisites:** Node ≥ 22, pnpm 10, Docker (for Postgres).

```bash
# 1. Install
pnpm install

# 2. Env (root + api both read the same values)
cp .env.example .env
cp .env.example apps/api/.env

# 3. Start Postgres  (docker compose up -d also works if you have the v2 plugin)
docker-compose up -d

# 4. Migrate + seed the brief's scenario (John / Sarah / Mike)
pnpm --filter @skill-routing/api prisma:migrate
pnpm --filter @skill-routing/api seed

# 5. Run API (:4000, Swagger at /docs) and web (:5173) in two terminals
pnpm dev:api
pnpm dev:web
```

Open **http://localhost:5173** for the UI and **http://localhost:4000/docs** for Swagger.

> The Postgres host port is **5434** (not 5432) to avoid clashing with a local
> Postgres. Change it in `docker-compose.yml` + the `DATABASE_URL` if needed.

---

## The routing engine (the heart of the system)

The decision logic lives in a **pure, framework-free function**:
[`apps/api/src/routing/routing.engine.ts`](apps/api/src/routing/routing.engine.ts).
No NestJS, no database, no I/O — which is exactly what makes it trivially testable.

For each technician, evaluated in strict short-circuit order:

1. **Skill match** — must have *every* required skill, else `MISSING_SKILL`.
2. **Minimum level** — level must meet/exceed each requirement, else `LEVEL_TOO_LOW`.
3. **Availability** — must be available, else `UNAVAILABLE`.
4. **Working hours** — if the request carries a scheduled day + time, the technician must be on shift then, else `OUTSIDE_HOURS`. An **untimed request skips this gate entirely** (there's no basis to filter by shift without a time).
5. **Workload** — among the eligible, pick the **lowest** workload.

### Tie-breaker (documented)

When eligible technicians tie on workload:

1. **Highest summed proficiency** across the *required* skills (better-qualified wins), then
2. **Lowest technician id** (stable, fully deterministic).

If no technician passes all gates, the request is stored `UNASSIGNED` with a full
per-candidate trace explaining *why* each was rejected.

### Example (matches the brief)

Request `HVAC ≥ 4, Electrical ≥ 3` against the seeded technicians:

| Technician | HVAC | Electrical | Available | Workload | Result       |
| ---------- | ---- | ---------- | --------- | -------- | ------------ |
| John       | 5    | 4          | ✅        | 3        | Eligible     |
| Sarah      | 4    | 5          | ✅        | 1        | **Assigned** |
| Mike       | 5    | 5          | ❌        | 0        | Rejected     |

→ **Sarah** — lowest workload (1 vs 3).

---

## Design decisions

- **Workload is derived, never stored** — it's the count of a technician's
  `ASSIGNED` requests (`TechniciansService.workloadMap()`). This can't drift out
  of sync the way a manual counter can. Closing a request via
  `PATCH /service-requests/:id/complete` moves it to `COMPLETED`, which drops it
  out of that count — that is how a technician sheds load. `COMPLETED` is
  **terminal**: re-routing a completed request is rejected (`400`), since that
  would resurrect closed work and silently re-add load to the assignee.
- **Fully deterministic.** Same inputs always produce the same assignment — there
  is no randomness or external service in the routing path, which is what makes
  the engine trivially testable and auditable.
- **Skill normalization (deterministic).** Skill names are normalized to a
  canonical vocabulary via a pure alias lookup (`react`/`reactjs`/`next.js` →
  `Frontend Development`), and matched case-insensitively, so a request for
  `react` reaches a technician with `Frontend Development` without any LLM. See
  [`apps/api/src/skills/skill-normalization.ts`](apps/api/src/skills/skill-normalization.ts).
- **Priority governs queue order, not eligibility.** When several pending
  requests are (re)routed together, `HIGH` is routed first so it gets first pick
  of the lowest-workload technicians. It never overrides the skill/level/availability gates.
- **Auto-reassignment.** Toggling a technician unavailable detaches their
  `ASSIGNED` requests and re-routes them (priority order) to other technicians,
  or leaves them unassigned. See `RoutingService.reassignFor()`.
- **Working hours (shifts).** Each technician can carry a weekly schedule
  (`[{ day, start, end }]`, empty = always on). It's an extra eligibility gate
  *after* the manual availability toggle: a technician outside their shift is
  rejected with a specific reason (e.g. *“Outside working hours (Mon 08:00 is
  outside shift 09:00–17:00)”*, or *“Outside working hours (no shift on Sat)”*).
  The evaluation time comes from the **request's** `scheduledDay`/`scheduledTime`
  and is **passed into** `routeRequest` (never read inside), so the engine stays
  pure and the shift logic is fully deterministic and unit-testable. A request
  with no schedule skips the gate. Single (server) timezone.
- **Single source of truth for the contract.** All request/skill DTOs are Zod
  schemas in `packages/shared`, reused by the API's validation pipe (via
  `nestjs-zod`) and the React forms.

---

## Data model

`Skill`, `Technician` (with optional `workingHours`), `TechnicianSkill (level 1–5)`,
`ServiceRequest` (`priority`, `status`), `RequiredSkill (minLevel)`, and
`AssignmentTrace` (persisted per-candidate explanation of the last routing pass).
Schema: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).

---

## API

Base URL `http://localhost:4000`. Interactive docs at **`/docs`**; the OpenAPI
spec is exported to `apps/api/openapi.json` (`pnpm --filter @skill-routing/api openapi`)
and can be imported directly into Postman.

| Method | Path                                | Purpose                                   |
| ------ | ----------------------------------- | ----------------------------------------- |
| GET    | `/skills`                           | List skill catalog                        |
| POST   | `/skills`                           | Add a skill                               |
| GET    | `/technicians`                      | List technicians (with derived workload)  |
| POST   | `/technicians`                      | Create technician + skills                |
| PATCH  | `/technicians/:id`                  | Update name / availability / working hours |
| PUT    | `/technicians/:id/skills`           | Replace skill set                         |
| PATCH  | `/technicians/:id/availability`     | Toggle availability (triggers reassignment) |
| GET    | `/service-requests`                 | List requests                             |
| GET    | `/service-requests/:id`             | Request detail + eligibility trace        |
| POST   | `/service-requests`                 | Create (structured) + route               |
| POST   | `/service-requests/:id/route`       | Re-run the engine                         |
| PATCH  | `/service-requests/:id/complete`    | Close an assigned request, freeing load   |

### Example

```bash
curl -X POST localhost:4000/service-requests \
  -H 'Content-Type: application/json' \
  -d '{"customer":"ABC Corp","requiredSkills":{"HVAC":4,"Electrical":3}}'
# => assignedTechnician: Sarah, with a full per-technician evaluation trace
```

---

## Testing

```bash
pnpm --filter @skill-routing/api test        # unit: pure engine + normalization (22 tests)
pnpm --filter @skill-routing/api test:e2e    # e2e: full HTTP flows against the DB (18 tests)
```

- **Unit** ([`routing.engine.spec.ts`](apps/api/src/routing/routing.engine.spec.ts),
  [`skill-normalization.spec.ts`](apps/api/src/skills/skill-normalization.spec.ts)) —
  all 6 brief scenarios, evaluation order, tie-breakers, case-insensitive
  matching, empty-skills guard, working-hours gate, and alias normalization.
- **E2E** ([`test/app.e2e-spec.ts`](apps/api/test/app.e2e-spec.ts)) — drives the
  real API against the database: the canonical scenario → Sarah, missing-skill /
  level-too-low / unavailable / no-eligible → unassigned, lowest-workload
  selection, auto-reassignment on availability toggle, alias normalization, and
  input validation. Requires the Postgres container running.

---

## Assumptions

- Proficiency / minimum level scale is **1–5** (from the brief's examples).
- **Workload** = count of currently `ASSIGNED` requests (derived).
- **Priority** affects routing *order* among pending requests, not per-request eligibility.
- Skill names are free-form strings; the catalog auto-grows as technicians/requests
  reference new skills.

---

## Project structure

```
skill-routing/
├─ apps/
│  ├─ api/   NestJS · Prisma
│  │  ├─ src/routing/routing.engine.ts   ← pure engine (start here)
│  │  ├─ src/routing/routing.service.ts  ← load → route → persist + reassignment
│  │  ├─ src/skills/skill-normalization.ts ← canonical alias map
│  │  ├─ src/{skills,technicians,service-requests}/
│  │  └─ prisma/{schema.prisma,seed.ts}
│  └─ web/   React · Vite · React Query
│     └─ src/pages/{Dashboard,Technicians,Requests,NewRequest}.tsx
└─ packages/shared/  Zod schemas + shared types
```
