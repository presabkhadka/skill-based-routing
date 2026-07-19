# Skill-Based Routing — Technical Overview

A complete, interview-grade walkthrough of the system: **what** each part does, **why** it was written that way, the **algorithms**, how **edge cases** and the **hard parts** are handled, and the **trade-offs** behind every choice. If you read this end to end, you can defend the whole codebase to a senior engineer.

> TL;DR — The system assigns an incoming service request to the best-qualified, available technician using a **pure, deterministic decision function** gated on skills → level → availability → working-hours → workload, with a documented tie-breaker. Everything around that function (persistence, current time, HTTP, validation) is deliberately kept *outside* the function so the core stays provably correct and trivially testable.

---

## 1. Problem statement

Match each **service request** (which declares one or more **required skills with minimum proficiency levels**) to the **most suitable technician**, considering: skill coverage, proficiency, availability, and current workload. If nobody qualifies, leave it **unassigned**. Every decision must be explainable. Stack, data model, and API were left open.

---

## 2. Architecture at a glance

```
                 React dispatch console (Vite + React Query + Tailwind/shadcn)
                                   │  HTTP (/api proxy)
                                   ▼
        ┌───────────────────────── NestJS API ─────────────────────────┐
        │  Controllers (HTTP)  →  Services (orchestration + I/O)         │
        │                              │                                 │
        │                    routing.engine.ts  ◄── PURE, no I/O         │
        │                              │                                 │
        │                         Prisma  →  PostgreSQL                  │
        └───────────────────────────────────────────────────────────────┘
                                   ▲
                        packages/shared (Zod contract + engine types + pure helpers)
```

**Layered by responsibility, dependency arrows point inward:**
- **Controllers** — HTTP surface only; delegate to services. No logic.
- **Services** — orchestration: read/write the DB, compute the current time, call the engine, persist results. This is where all *impurity* lives.
- **Engine** (`routing.engine.ts`) — a single pure function. No Nest, no Prisma, no clock. The heart.
- **`packages/shared`** — the one typed contract (Zod schemas + engine types + pure helpers), imported by both API and web.

**Why this shape:** the most important business logic (the routing decision) is isolated into something with *zero dependencies and zero side effects*, so it is deterministic, unit-testable without mocks, and auditable. Everything hard-to-test (DB, time, network) is pushed to the edges.

### Tech stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Monorepo | **pnpm workspaces** (`apps/api`, `apps/web`, `packages/shared`) | Share one typed contract without publishing; fast installs. Not Turborepo — no build-graph/caching need at this size. |
| Backend | **NestJS 11** | DI + modules cleanly separate the pure engine from HTTP/DB; first-class Swagger; easy testing. |
| DB/ORM | **PostgreSQL 16 + Prisma 6** | Relational integrity for the skill/request graph; typed queries; migrations; case-insensitive queries; `Json` column for shift schedules. |
| Frontend | **React 19 + Vite 6 + React Query** | Fast DX; React Query eliminates hand-rolled fetch/cache/invalidation. |
| UI | **Tailwind v4 + shadcn/ui + Recharts** | Token theming, accessible Radix primitives, real dashboard charts. |
| Contract | **Zod** (`packages/shared`) via **nestjs-zod** | One source of truth: API validation, Swagger models, and React types all derive from the same schemas. |

**Determinism note:** there is **no AI/LLM and no external service** anywhere in the routing path. Same inputs always produce the same output. (An earlier iteration had an LLM natural-language intake; it was removed precisely because it added the only source of nondeterminism for a feature the brief never required — see §14.)

---

## 3. Repository structure

```
skill-routing/
├─ apps/
│  ├─ api/
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma          # data model
│  │  │  ├─ migrations/            # 5 migrations (see §4)
│  │  │  └─ seed.ts                # deterministic dataset
│  │  ├─ src/
│  │  │  ├─ routing/
│  │  │  │  ├─ routing.engine.ts       # ★ pure decision function (201 LOC)
│  │  │  │  ├─ routing.engine.spec.ts  # 18 unit tests
│  │  │  │  └─ routing.service.ts      # load → route → persist, batch, reassign
│  │  │  ├─ skills/
│  │  │  │  ├─ skills.service.ts        # catalog + case-insensitive resolve + offered
│  │  │  │  ├─ skill-normalization.ts   # canonical alias map (pure)
│  │  │  │  └─ skill-normalization.spec.ts  # 4 unit tests
│  │  │  ├─ technicians/            # CRUD + availability + skills + working hours
│  │  │  ├─ service-requests/       # create / route / list
│  │  │  ├─ common/swagger-zod.ts   # Zod → OpenAPI
│  │  │  └─ main.ts                 # bootstrap: global Zod pipe, CORS, Swagger
│  │  └─ test/app.e2e-spec.ts       # 15 HTTP integration tests
│  └─ web/  (React console: Dashboard, Technicians, Requests, NewRequest)
└─ packages/shared/src/index.ts     # Zod schemas + engine types + pure helpers
```

---

## 4. Data model (Prisma / PostgreSQL)

```
Skill            id, name (unique), createdAt
Technician       id, name, available, workingHours (Json?), createdAt
TechnicianSkill  (technicianId, skillId) UNIQUE, level 1..5        ← join + payload
ServiceRequest   id, customer, priority, status,
                 scheduledDay (Int?), scheduledTime (String?),
                 assignedTechnicianId?, createdAt, updatedAt
RequiredSkill    (serviceRequestId, skillId) UNIQUE, minLevel       ← join + payload
AssignmentTrace  serviceRequestId, technicianId, eligible, reason, rejectReason?, workload  ← explainability
```

Migrations (chronological, tells the evolution story): `init` → `add_working_hours` → `remove_rawtext` (dropped the dead AI column) → `add_scheduled_for` → `schedule_day_time` (switched request scheduling from a full datetime to day-of-week + time — see §8).

**Why each shape (this is a common interview probe):**

- **`TechnicianSkill` / `RequiredSkill` are join tables carrying a payload** (`level` / `minLevel`), not JSON blobs. This gives referential integrity, a real `@@unique(a, b)` constraint (a technician can't list HVAC twice), and queryability (e.g. "who has HVAC ≥ 4").
- **Workload is DERIVED, never stored.** It's computed as the count of a technician's `ASSIGNED` requests (`TechniciansService.workloadMap()` — a single Prisma `groupBy`). *Why:* a stored counter drifts — you can double-increment, or forget to decrement when a request is reassigned/unassigned. A derived count is correct by construction, always. The cost is one `groupBy` per routing pass, which is negligible. Load is shed by **completing** a request (`PATCH /service-requests/:id/complete` → `COMPLETED`), which removes it from the `ASSIGNED` count with no counter to decrement.
- **`AssignmentTrace` persists the per-candidate evaluation** of the last routing pass. *Why persist it:* the UI's "why was each technician accepted/rejected" table must survive a page reload without re-running the engine. It's rewritten transactionally on every route (drop-old + insert-new) so it never shows a stale mix.
- **`workingHours` is a `Json?` column** holding `[{ day, start, end }]`. *Why JSON over a shift table:* a technician's weekly schedule is a small blob always read together with the technician and never queried independently — a join table would be over-engineering.
- **`scheduledDay` + `scheduledTime` on the request** (0–6 and `"HH:MM"`) — the exact granularity the shift gate needs (see §8), instead of a full timestamp.

---

## 5. The routing engine — the core

**File:** `apps/api/src/routing/routing.engine.ts`. **Entry point:** `routeRequest(requiredSkills, technicians, now?)`.

### 5.1 Design principle: a pure, deterministic function

The engine takes plain data in (required skills, technicians with their skills/availability/workload/hours, and an optional evaluation time) and returns a `RoutingResult` (winner + eligible ids + full per-candidate trace). **No NestJS, no Prisma, no `Date.now()` inside.**

Why purity is the single most important decision here:
- **Deterministic & auditable** — same inputs ⇒ same output. In dispatch, you must be able to justify why a technician was or wasn't sent. A pure function makes that provable and reproducible.
- **Trivially testable** — all brief scenarios + edge cases are plain function calls; no DB, no mocks, no clock stubbing. That's why there are 18 fast unit tests on it.
- **Separation of concerns** — the messy stuff (DB, time, HTTP) is all in the service layer *around* the engine.

Because reading the clock inside would break determinism, **the current time is injected** as `now: { dayOfWeek, minutes }`. The service computes it (from a real `Date` or from the request's schedule) and passes it in.

### 5.2 The evaluation gates (strict, short-circuiting)

For each technician, in this exact order — the first failing gate wins and yields a typed reason:

1. **Skill match** — must have *every* required skill, else `MISSING_SKILL`.
2. **Minimum level** — proficiency ≥ each requirement, else `LEVEL_TOO_LOW`.
3. **Availability** — the manual on/off flag, else `UNAVAILABLE`.
4. **Working hours** — on shift at `now`, else `OUTSIDE_HOURS` (skipped entirely if `now` is undefined).
5. **Workload** — among everyone who passed 1–4 (the *eligible* set), pick the winner (§5.3).

This mirrors the brief's flowchart exactly. **Short-circuiting** means a technician who is both missing a skill *and* unavailable reports `MISSING_SKILL` (the first gate) — efficient and matches how a human would explain it.

**Skill lookup is case-insensitive** (`skillLevel()` trims + lowercases both sides). So a technician's `"Ai Development"` still satisfies a request's `"AI Development"`. This is an intentional robustness gate against inconsistent casing (see §7 and §9).

### 5.3 Selection algorithm & tie-breaker

Among the eligible set, the winner is chosen by a **total ordering** (a comparator sort), applied in priority:

1. **Lowest workload** — the brief's primary rule (balance the team).
2. **Highest summed proficiency across the *required* skills** — if equally free, prefer the better-qualified technician *for this job*.
3. **Lowest technician id** — a stable, deterministic final tiebreak.

```ts
[...eligible].sort((a, b) =>
      a.workload - b.workload                          // 1. least loaded
   || summedProficiency(b) - summedProficiency(a)      // 2. more qualified
   || a.id - b.id                                       // 3. stable, deterministic
)[0]
```

**Why this tie-breaker (frequent interview question):**
- *Workload first* is the brief's explicit criterion.
- *Proficiency second* is a quality signal, and it sums only the **required** skills (not all skills) so it measures fitness for *this* request, not general seniority.
- *Lowest id last* guarantees a **unique, reproducible** winner. Without a final unique key, two identically-ranked technicians would be resolved by array order — fragile and untestable. Id is arbitrary but stable. (Honest caveat: it's fair but not *meaningful*; alternatives like "fewest total skills, to keep specialists free" or seeded round-robin are possible upgrades — documented, not implemented.)

### 5.4 Explainability

Every technician gets a human `reason`. Rejections are specific: `"Missing required skill: HVAC"`, `"HVAC level 3 < required 4"`, `"Outside working hours (no shift on Sat)"`. The **winner's** reason names the exact decisive rung *and the peers it beat*, generated by `explainSelection()`:
- won on workload: *"Selected — lowest workload (1) among 3 eligible technicians."*
- won on proficiency: *"…tied on lowest workload (1) with Sarah, then won on higher total proficiency across the required skills (9 vs 8)."*
- won on id: *"…tied on both workload (2) and total proficiency (5) with X and Y; chosen by lowest technician id (#44) as the final deterministic tiebreak."*

This string is mirrored onto the winner's trace row so the eligibility table itself explains the pick — no guessing.

### 5.5 Complexity

For *R* required skills and *T* technicians: evaluation is **O(T·R)** (small map lookups per gate); selection is **O(T log T)** (one sort). Trivial at any realistic scale; no premature optimization.

---

## 6. The service layer (orchestration around the engine)

**File:** `routing.service.ts` — the deliberately impure layer.

- **`routeAndPersist(id)`** — loads the request's required skills + all technicians (engine-shaped, with derived workload + hours), computes the **evaluation time** (from the request's schedule, or `undefined`), calls the pure engine, then **transactionally** writes: the request's `status` + `assignedTechnicianId`, and a fresh set of `AssignmentTrace` rows (drop-old + create-new in one `$transaction`). The transaction guarantees the trace and the assignment are always consistent.
- **`routePendingBatch(ids)`** — routes several pending requests **in priority order** (`HIGH` first, then oldest first). **Sequential on purpose:** each assignment changes a technician's derived workload, which affects the next request's pick. This is how **priority-based routing** works — priority governs *queue order*, never eligibility. HIGH gets first pick of the least-loaded technicians but still passes every gate.
- **`reassignFor(technicianId)`** — **automatic reassignment**: when a technician is toggled unavailable, their currently `ASSIGNED` requests are **detached first** (→ `PENDING`, unassigned) and then re-routed in priority order. *Why detach first:* so the leaving technician's own workload no longer counts against those requests during the re-route (a subtle correctness point — otherwise the engine would still see them as "busy").

---

## 7. Skills subsystem — matching that's smart but deterministic

Skill names arrive from two places (the structured request form and technician creation) and users type them inconsistently: `"react js"`, `"Ai Development"`, `"agentic ai"`. Two deterministic mechanisms keep the catalog clean and matching robust — **both in the data/skills layer so the engine stays a pure exact-matcher**:

1. **Case-insensitive resolution + dedupe** (`SkillsService.create`): a name is looked up case-insensitively (`mode: "insensitive"`) and the existing canonical skill reused, so `"Ai Development"` never becomes a duplicate of `"AI Development"`.
2. **Canonical alias map** (`skill-normalization.ts`, a pure lookup): synonyms/narrower terms map to a canonical skill — `react`, `reactjs`, `next.js` → **Frontend Development**; `node`, `express` → **Backend Development**; `agentic` → **Agentic AI**; `air conditioning` → **HVAC**; etc. Unknown names pass through unchanged so genuinely new skills can still be created.

**Why an alias table rather than embeddings / an LLM for semantic matching (a deliberate design fork):** for a dispatch system, routing must be **deterministic, auditable, and free of hot-path cost/latency**. A generative model in the *binding match* can silently mis-map (`plumbing → HVAC`) and is hard to test. A canonical taxonomy + alias table is a pure lookup — predictable, cheap, unit-testable. At larger scale you'd move the aliases into admin-managed data and/or add embeddings for the long tail, with a human approving new mappings — noted as future work.

**`GET /skills/offered`** returns the **union of skills at least one technician holds** (skills where `technicianSkills.some` exists). The New Request form's skill picker is driven off this — so a dispatcher **cannot create a request requiring a skill nobody in the workforce has**. (This is enforced at the UI; the API stays permissive so the brief's "no eligible technician → unassigned" scenarios remain reachable, and direct API callers keep flexibility.)

---

## 8. Working hours & scheduling — keeping the engine pure with time

Technicians have an optional weekly schedule: `workingHours = [{ day: 0–6, start: "HH:MM", end: "HH:MM" }]` (empty = always on). A request can optionally be **scheduled for a day-of-week + time** (`scheduledDay`, `scheduledTime`).

- **The engine's working-hours gate** (`isWithinWorkingHours`) checks the technician's shift against the injected `now`. It handles **overnight windows** (if `end < start`, e.g. 22:00–06:00, the check wraps) and treats **no schedule as always available**.
- **Where the time comes from:** the request's `scheduledDay` + `scheduledTime` become the `EvaluationTime` passed into the engine. **If the request has no schedule, the gate is skipped entirely** (the engine is called with `now = undefined`).

**Why day-of-week + time, not a full timestamp (and why skip-when-untimed):** the shift gate only ever needs *which weekday* and *what time* — a calendar date adds nothing. Modeling the request's schedule the same way the recurring shift is modeled keeps them aligned and the UI simple (day chips + a time input, mirroring the technician editor). And a request with *no* time has no basis to be filtered by shift, so rejecting technicians against "now" (e.g. rejecting all Mon–Fri techs because it happens to be Saturday) would be wrong — skipping the gate is the correct behavior. This was a real bug that this design fixes.

**Purity is preserved throughout:** the engine never reads a clock; the service supplies the evaluation time (from the schedule) or nothing. That's what lets the shift logic stay fully unit-testable — the tests pass an explicit `{ dayOfWeek, minutes }`.

**Validation:** `scheduledDay` and `scheduledTime` are enforced **both-or-neither** by a Zod `.refine`, so a half-specified schedule is a `400`.

---

## 9. Edge cases & how they're handled (the part interviewers dig into)

| Edge case | Handling | Why it matters |
|---|---|---|
| **Request with zero required skills** | Engine short-circuits to **unassigned** before evaluating anyone. | Otherwise every technician trivially passes the skill gate (nothing to miss) and the request would match *everyone* — meaningless for a skill router. |
| **Casing mismatch** (`"Ai Development"` vs `"AI Development"`) | Case-insensitive skill lookup in the engine + case-insensitive resolve in the DB layer. | Prevents silent no-matches and duplicate catalog skills. |
| **Synonyms / narrower terms** (`react` vs `Frontend Development`) | Canonical alias normalization (pure lookup) before persistence. | A request for `react` reaches a `Frontend Development` technician — without any AI. |
| **Two aliases of the same skill on one request/technician** (`react` + `vue`) | Collapsed to a single requirement, **keeping the higher level**, before insert. | Avoids violating the `@@unique(a, b)` constraint and double-counting. |
| **Re-routing an already-assigned request** | `routeAndPersist` reads live workload; reassignment **detaches first**. | Prevents a request from counting against its own current assignee during a re-route. |
| **Exact ties** (same workload & proficiency) | Deterministic **lowest-id** tiebreak; the reason states it explicitly. | A unique, reproducible winner every time. |
| **Overnight shift** (22:00–06:00) | `isWithinWorkingHours` wraps when `end < start`. | Correct for night shifts. |
| **No shift schedule** | Treated as always on-shift. | Backward-compatible; seeded John/Sarah/Mike (no hours) always pass. |
| **Untimed request + shift techs** | Shift gate skipped entirely (`now = undefined`). | Fixes the "Saturday rejects all weekday techs" bug. |
| **Half-specified schedule** (day without time) | Zod `.refine` both-or-neither → `400`. | No ambiguous partial state reaches the engine. |
| **Requesting an uncovered skill via the UI** | Skill picker only offers `GET /skills/offered`. | A request can't require a skill nobody holds. |
| **Priority + workload interaction in a batch** | Requests routed **sequentially** in priority order. | Each assignment updates the derived workload the next pick sees. |
| **Trace/assignment consistency** | Written in one `$transaction` (drop-then-insert). | The eligibility table can never show a stale mix. |
| **Invalid input** (level 9, empty customer, empty skills) | Global `ZodValidationPipe` → `400` before any service runs. | Bad data never reaches business logic. |

---

## 10. The hard parts & how they were solved

1. **Supporting time-based shifts without sacrificing engine purity.** *Solution:* inject the evaluation time (`now`) into the engine rather than reading the clock; the service derives it from the request's schedule. The engine stays a pure function, so shift behavior is unit-testable with an explicit time.
2. **"Smart" skill matching without nondeterminism.** *Solution:* a canonical alias table + case-insensitive matching — pure lookups — instead of an LLM/embeddings in the routing path. Fully deterministic and auditable.
3. **Keeping the catalog clean under free-form input.** *Solution:* case-insensitive resolve + normalization + alias dedupe, so synonyms and case variants converge to one canonical skill.
4. **Correct workload during batch routing and reassignment.** *Solution:* derive workload (never store it), route batches **sequentially** so each assignment is visible to the next, and **detach-before-reroute** so a leaving technician doesn't count against their own freed requests.
5. **Explainability that's actually specific.** *Solution:* the winner's reason walks the exact tie-break ladder and names the peers it beat, mirrored onto its trace row.
6. **Scheduling granularity.** *Solution:* model the request's "when" as day-of-week + time (what the gate needs), matching the recurring-shift model, and skip the gate when no time is given.

---

## 11. API surface

Base `http://localhost:4000`; Swagger at `/docs`; spec exported to `apps/api/openapi.json`.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/skills` | List / add a skill |
| GET | `/skills/offered` | **Union of skills held by ≥1 technician** (drives the request picker) |
| GET | `/technicians` · `/technicians/:id` | List / detail (with derived workload + hours) |
| POST | `/technicians` | Create (name, skills, availability, working hours) |
| PATCH | `/technicians/:id` | Update name / availability / working hours |
| PUT | `/technicians/:id/skills` | Replace skill set |
| PATCH | `/technicians/:id/availability` | Toggle availability → triggers auto-reassignment |
| GET | `/service-requests` · `/service-requests/:id` | List / detail (+ eligibility trace) |
| POST | `/service-requests` | Create (skills + optional schedule) + route |
| POST | `/service-requests/:id/route` | Re-run the engine on stored data |
| PATCH | `/service-requests/:id/complete` | Close an `ASSIGNED` request → `COMPLETED`, freeing that technician's workload |

**Validation:** every request body is a Zod schema in `packages/shared`, enforced by a global `nestjs-zod` `ZodValidationPipe` — invalid input returns `400` before hitting a service. The *same* schemas generate the Swagger models (`common/swagger-zod.ts`), so the API can never drift from its docs.

---

## 12. Frontend (dispatch console)

- **State-driven shell** (`App.tsx`) — sidebar nav + top bar; four views switched in state (no router needed), with deep-link into a request's detail.
- **React Query** for all server state — queries for technicians/requests/offered-skills; mutations `invalidateQueries` so the UI stays consistent after create/route/toggle. Mutating a technician's skills also invalidates `offered-skills` so the request picker stays fresh.
- **Dashboard** — KPI cards + a status donut and technician-workload bar (Recharts) + recent requests.
- **Technicians** — create form (skills + a **working-hours editor**: day chips + a start/end window), a table with skill chips, an hours summary column ("Mon–Fri 09:00–17:00"), inline hours editing, availability toggle (surfaces auto-reassignment results).
- **Requests** — list + a detail view with the **full eligibility trace** (color-coded accept/reject with specific reasons, a "Selected" badge on the winner, a re-run button with a result banner).
- **New Request** — customer + priority, a **skill picker limited to offered skills** (no uncovered skills), and an optional **day-chip + time** scheduler (same look as the technician shift editor); the day/time drives the shift gate.

---

## 13. Testing strategy

37 tests total, split by layer to match the architecture:

- **Unit — pure engine** (`routing.engine.spec.ts`, **18**): all six brief scenarios (missing skill, level too low, unavailable, lowest-workload, tie-breaker, no-eligible), plus evaluation order, full-trace, case-insensitive matching, empty-skills guard, and six working-hours cases. Fast, no DB — the payoff of engine purity.
- **Unit — normalization** (`skill-normalization.spec.ts`, **4**): alias mapping, case/whitespace, canonical-to-self, unknown pass-through.
- **Integration/e2e** (`test/app.e2e-spec.ts`, **18**): real HTTP against the DB — canonical scenario → Sarah, missing-skill / level-too-low / unavailable / no-eligible → unassigned, lowest-workload selection, completion freeing workload (plus the `400`s on completing a non-`ASSIGNED` request and on re-routing a `COMPLETED` one), auto-reassignment on toggle, alias normalization, `/skills/offered` union, re-route idempotency, day/time shift gate (inside/outside/untimed), and validation (`400`s).

Run: `pnpm --filter @skill-routing/api test` (unit) and `test:e2e` (needs Postgres).

---

## 14. Key design decisions & trade-offs

1. **Pure engine, impure services.** Core logic isolated into a testable pure function; all I/O at the edges. *Trade-off:* a little plumbing (injecting `now`, engine-shaping technicians) for determinism + testability. Worth it.
2. **Derived workload, not stored.** Can't drift. *Trade-off:* a `groupBy` per pass — negligible.
3. **Deterministic, no AI.** No randomness or external service in the routing path → provable, auditable. The earlier LLM intake was removed because it added the *only* nondeterminism for a non-required feature. *Trade-off:* natural-language intake is gone (never required).
4. **Alias table + case-insensitive matching** for semantic-ish matching instead of LLM/embeddings. Deterministic, cheap. *Trade-off:* manual alias upkeep (→ admin data / embeddings at scale).
5. **Documented tie-breaker ending in lowest-id.** Unique, reproducible winner. *Trade-off:* the final rung is fair but arbitrary.
6. **Working hours: injected clock + day/time schedule + skip-when-untimed.** Keeps the engine pure, matches the shift model, avoids the "now" bug. *Trade-off:* single server timezone (no per-technician tz).
7. **Shared Zod contract.** One definition → API validation + Swagger + React types. *Trade-off:* a `packages/shared` build step; small.
8. **pnpm workspaces over Turborepo.** Right-sized; no build-cache complexity for three packages.

---

## 15. End-to-end walkthroughs (trace these in an interview)

**A) Create a structured request → assignment.** Body validated by the global Zod pipe → `ServiceRequestsService.createAndRoute` resolves skill names to canonical ids (normalization + case-insensitive + alias-dedupe) → persists the request + `RequiredSkill` rows (+ optional schedule) → `RoutingService.routeAndPersist` loads engine-shaped technicians (derived workload + hours), derives the evaluation time from the schedule (or `undefined`), calls the **pure** `routeRequest` → transactionally writes status + assignment + a fresh `AssignmentTrace` set → returns the request with its trace.

**B) Toggle a technician unavailable.** `PATCH /technicians/:id/availability` flips the flag, then `reassignFor` detaches that technician's `ASSIGNED` requests (→ pending), and re-routes them in priority order to other technicians (or leaves them unassigned). The response reports which requests moved.

**C) The brief's canonical case.** Request `HVAC ≥ 4, Electrical ≥ 3` against John (HVAC5/Elec4, workload 3), Sarah (HVAC4/Elec5, workload 1), Mike (HVAC5/Elec5, unavailable): John & Sarah pass all gates; Mike is rejected at the availability gate; **Sarah wins on lowest workload (1 vs 3)**. Mike being fully skilled but rejected proves the gate order and that skills alone don't win.

---

## 16. Known limitations & future work

- **Geographic proximity** and **per-technician timezones** — not implemented (single server tz).
- **Full Dockerization** — only Postgres is containerized; app Dockerfiles + a full `docker compose up` would be the next step.
- **Alias table is a hardcoded constant** — at scale, admin-managed data and/or embeddings for the long tail, with human-approved mappings.
- **Uncovered-skill requests** are prevented at the UI, not the API — a server-side guard could reject them too (trade-off: it would remove one path to the "no eligible → unassigned" scenario).
- **Tie-break final rung** ("lowest id") is fair but not meaningful — could become "keep specialists free" or seeded round-robin.

---

## 17. Anticipated senior-interview questions (with crisp answers)

- **"Walk me through a routing decision."** → §15A: validate → resolve/normalize skills → persist → load engine-shaped techs + derived workload → derive evaluation time → pure `routeRequest` (skills → level → availability → hours → workload, tie-break workload/proficiency/id) → transactionally persist status + trace.
- **"Why a pure function for the engine?"** → Determinism, auditability, testability, separation of concerns. That's why the clock is injected, not read.
- **"How is workload computed and why?"** → Derived count of `ASSIGNED` requests; a stored counter drifts.
- **"Two identical technicians — who wins?"** → Lowest id; a stable, deterministic final tiebreak, stated in the reason.
- **"How do you match `react` to a `Frontend Development` tech?"** → Canonical alias normalization (pure lookup) in the skills layer — not in the engine, so routing stays deterministic.
- **"How do shifts work without breaking determinism?"** → Working hours are an extra gate; the evaluation time is *passed in* (from the request's day/time), never read inside the engine; untimed requests skip the gate.
- **"How do you stop impossible requests?"** → The request skill picker is limited to `/skills/offered` (skills the workforce actually has).
- **"What was the hardest part?"** → Keeping the engine pure while adding time-based shifts, and getting workload correct across batch routing + reassignment (sequential routing + detach-first). See §10.
- **"How would you scale it?"** → §16 — embeddings for skill matching, admin-managed aliases, geo, per-tz, Docker.

---

## 18. Run it

```bash
pnpm install
cp .env.example .env && cp .env.example apps/api/.env
docker-compose up -d                                   # Postgres on :5434
pnpm --filter @skill-routing/api prisma:migrate
pnpm --filter @skill-routing/api seed                  # deterministic dataset
pnpm dev:api        # API :4000, Swagger at /docs
pnpm dev:web        # web :5173
```

Tests: `pnpm --filter @skill-routing/api test` (unit) · `test:e2e` (needs the DB).
