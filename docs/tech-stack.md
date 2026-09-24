# Tech Stack

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## Frontend

### Selection

**Repos:** dolmus-takip

Next.js 16.3.5 (App Router) + React 19.3.0 + TypeScript 5.9.3, Tailwind CSS 4.3.3, system font stack

_One TypeScript project for phone UI and server keeps a single codebase and deploy unit (familiarity/hiring: React/TS mainstream; lock-in: self-hosted, Vercel not required). Versions pinned in K9 with evidence (next 16 peer react ^19; TS 5.9.3 because typescript-eslint peer <6.1.0)._

### Candidates

**Repos:** dolmus-takip

| Candidate | Familiarity | Community | Maturity | Cost | Lock-in | Perf | Hiring | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Next.js + React + TypeScript (chosen) | not scored | not scored | not scored | self-hosted, no license | low (self-host) | to be measured | not scored | not scored |
| Django server-rendered HTML | not scored | not scored | not scored | self-hosted, no license | low | not measured | not scored | not scored |

_TECH-STACK.md explicitly refuses invented 1-5 scores ('deneyim, piyasa ve ölçüm verileri eksik'); comparison is qualitative against the 7 criteria._

### Rejected notes

**Repos:** dolmus-takip

- Django server-rendered HTML — not chosen for v1; a single TypeScript project for UI + server was preferred
- Heavy UI kit / downloaded web fonts — not required; Tailwind + system font keep the phone UI light

_Kept so the settled debate is not reopened._

## Backend

### Selection

**Repos:** dolmus-takip

Node.js 24 LTS + Next.js Route Handlers (/api/v1) calling server-only use cases; zod 4.6.5 validation

_Single Node process serves pages and API; route handlers use plain Request/Response and call src/server/usecases directly (no HTTP loop). engines node >=24, .nvmrc 24. Cost: runs on own machine; Vercel not required._

### Candidates

**Repos:** dolmus-takip

| Candidate | Familiarity | Community | Maturity | Cost | Lock-in | Perf | Hiring | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Node.js 24 LTS on Next.js (chosen) | not scored | not scored | LTS | own machine | low | to be measured | not scored | not scored |
| Django full-stack | not scored | not scored | not scored | own machine | low | not measured | not scored | not scored |
| Supabase | not scored | not scored | not scored | hosted service | high | not measured | not scored | not scored |

_Qualitative only, per TECH-STACK.md decision criteria note._

### Rejected notes

**Repos:** dolmus-takip

- Django — not chosen for v1; UI and backend kept in one TypeScript project
- Supabase — rejected by the product owner
- Microservices / separate back-office app — not built; back office uses the same use cases

_ARCHITECTURE §2: no microservices, no duplicated business rules for back office._

## Database

### Selection

**Repos:** dolmus-takip

SQLite 3.53.4 (embedded in better-sqlite3 13.0.3) + Drizzle ORM 0.45.2 + Drizzle Kit 0.31.10 migrations

_Fewest services for ≤500 total users; relational reports and transactions. WAL + foreign_keys=ON + synchronous=FULL + busy_timeout 2000 ms. Version gate: SQLite ≥3.51.3 (WAL-reset fix) verified with SELECT sqlite_version(). Exit path to PostgreSQL is documented, not automatic._

### Candidates

**Repos:** dolmus-takip

| Candidate | Familiarity | Community | Maturity | Cost | Lock-in | Perf | Hiring | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SQLite + Drizzle + better-sqlite3 (chosen) | not scored | not scored | mature | no extra service | medium (migration to PG is manual) | single writer; load test pending | not scored | not scored |
| PostgreSQL (same machine) | not scored | not scored | mature | extra service + RAM | low | strong for concurrent writes | not scored | not scored |
| MySQL | not scored | not scored | mature | extra service | low | not compared | not scored | not scored |
| DynamoDB / MongoDB | not scored | not scored | mature | per-request billing (DynamoDB) | high | access patterns must be pre-designed | not scored | not scored |
| Prisma (ORM alternative) | not scored | not scored | mature | free | medium | not compared | not scored | not scored |

_Qualitative comparison from TECH-STACK.md §3; numeric scores intentionally not invented._

### Rejected notes

**Repos:** dolmus-takip

- PostgreSQL — not chosen for v1; upgrade path if sustained write waits or multiple app servers are needed
- MySQL — not chosen; no detailed comparison done
- DynamoDB / MongoDB — SQL is more direct for this relational model and reports
- Prisma — not chosen; Drizzle picked for explicit SQL/schema control in a small data-access module

_Triggers for re-evaluation recorded in ADR-001._

## Auth / Identity

### Selection

**Repos:** dolmus-takip

In-house revocable server sessions stored in SQLite; argon2 0.45.1 (Argon2id m=19456, t=2, p=1); HttpOnly SameSite=Lax cookie

_Vehicle login = plate + owner or driver password (role derived from which hash matches); personal platform_users for staff (admin/support). 32-byte random token, only SHA-256 stored. Custom crypto not written; library primitives only._

### Candidates

**Repos:** dolmus-takip

| Candidate | Familiarity | Community | Maturity | Cost | Lock-in | Perf | Hiring | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Database-backed server sessions (chosen) | not scored | Next.js guide | mature pattern | free | none | one DB read per request | not scored | not scored |
| External auth provider | not scored | not scored | mature | service fee | high | n/a | not scored | not scored |
| JWT sessions | not scored | not scored | mature | free | low | stateless | not scored | not scored |

_Revocation on password reset / deactivation is a hard requirement, which favours server-side sessions._

### Rejected notes

**Repos:** dolmus-takip

- External auth provider — not added
- OTP / national ID — not added (ADR-003)
- Public self-signup — not added; staff creates accounts
- Email password recovery — not added; reset via back office
- JWT sessions — not chosen; server sessions are revocable

_Recorded in TECH-STACK §4 and ARCHITECTURE §6 row 'JWT / e-posta tokenları'._

## Infrastructure / Deployment

### Selection

**Repos:** dolmus-takip

Single AWS Lightsail (Frankfurt, Linux, 2 vCPU / 2 GB RAM / 60 GB SSD / IPv4 / 3 TB, 12 USD/month), Ubuntu LTS, Caddy reverse proxy + HTTPS, systemd, Next.js standalone output on 127.0.0.1:3000

_Cost-first single machine (ADR-001); no HA claim. Next listens on localhost only; Caddy exposes 80/443. Capacity not guaranteed: 100-concurrent-user load test planned on the target machine (M6). Not yet provisioned (PROGRESS: M6 open). Deployment config now lives in the repo (deploy/): Caddyfile with site address {$DOLMUS_DOMAIN} (automatic certificate + HTTP→HTTPS), reverse_proxy to 127.0.0.1:3000 only; dolmus-takip.service (User dolmus-takip, WorkingDirectory /opt/dolmus-takip/current, HOSTNAME=127.0.0.1 PORT=3000, APP_ORIGIN=https://${DOLMUS_DOMAIN}, ProtectSystem=strict with only /var/lib/dolmus-takip/data writable); Caddy drop-in reads the same /etc/dolmus-takip/domain.env. Marked prepared but not tried on a real server (ISSUE-29)._

### Candidates

**Repos:** dolmus-takip

| Candidate | Familiarity | Community | Maturity | Cost | Lock-in | Perf | Hiring | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: Lightsail 2 vCPU / 2 GB / 60 GB + SQLite (chosen) | not scored | not scored | n/a | 12 USD/month | low | to be load-tested | not scored | not scored |
| B: Lightsail 2 vCPU / 4 GB / 80 GB + SQLite | not scored | not scored | n/a | 24 USD/month | low | more RAM; same single writer | not scored | not scored |
| C: Lightsail 4 GB + PostgreSQL on same machine | not scored | not scored | n/a | 24 USD/month | low | better concurrent writes | not scored | not scored |
| Caddy (chosen web server) | not scored | not scored | mature | free | low | n/a | not scored | not scored |
| Nginx | not scored | not scored | mature | free | low | n/a | not scored | not scored |
| Apache | not scored | not scored | mature | free | low | n/a | not scored | not scored |

_Prices from 2026-09-15 Linux/IPv4 packages; snapshots, tax, domain and overage excluded. Table is not a measured capacity comparison._

### Rejected notes

**Repos:** dolmus-takip

- Docker / Compose — removed to reduce complexity; native systemd services
- Plan B (4 GB) — conditional upgrade on memory pressure only
- Plan C (PostgreSQL) — conditional on sustained write waits or multi-server need
- Nginx / Apache — not chosen; Caddy has built-in certificate management and simpler config
- Building on the production machine — not done; 2 GB may not fit a Next.js build

_TECH-STACK §5 decision note and ADR-001 re-evaluation triggers._

### Production account and domain

**Repos:** dolmus-takip

Not decided yet — no production AWS account or domain name chosen; deferred by the product owner

_Product owner answer: none yet, to be determined later. Server provisioning (M6) and the production APP_ORIGIN, which must equal the real public https origin, stay blocked until this is set (DECISIONS.md K9 remaining items, PROGRESS M6 pre-gate)._

## Storage / Object Store

### Selection

**Repos:** dolmus-takip

No object store. Persistent local disk (/var/lib/dolmus-takip/data/app.sqlite) + daily Lightsail automatic snapshot, keep last 7; nightly SQLite Backup API copy placed in the snapshot

_Backup copy prepared at 02:30 Europe/Istanbul, verified (integrity_check, foreign_key_check, totals) and published before 02:55; snapshot targeted 03:00. Snapshot retention ≠ 5-year record retention. Manual snapshot before deleting the instance._

### Candidates

**Repos:** dolmus-takip

| Candidate | Familiarity | Community | Maturity | Cost | Lock-in | Perf | Hiring | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Daily Lightsail snapshot, last 7 (chosen) | not scored | not scored | managed | 0.05 USD/GB-month | medium (Lightsail) | n/a | not scored | not scored |
| S3 copies | not scored | not scored | managed | extra service | medium | n/a | not scored | not scored |
| Hourly backups | not scored | not scored | n/a | extra cost | n/a | smaller loss window | not scored | not scored |

_Owner accepted the daily loss window (approval 2026-09-15)._

### Rejected notes

**Repos:** dolmus-takip

- S3 — not set up; no new object store
- Hourly backups — not set up; daily loss window accepted
- Raw copy of the live DB file — not a valid backup; SQLite Backup API is used

_TECH-STACK §6, ARCHITECTURE §8.3._

## Queue / Async Messaging

### Selection

**Repos:** dolmus-takip

None (no external queue, no Redis); in-process bounded Argon2 hash queue (4 concurrent / 100 waiting / 10 s, overflow → 429)

_PRD needs no async messaging. The in-process hash queue protects the 2 GB machine from login bursts (ARCHITECTURE §6 'Hash yükü')._

### Candidates

**Repos:** dolmus-takip

| Candidate | Familiarity | Community | Maturity | Cost | Lock-in | Perf | Hiring | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| No external queue (chosen) | n/a | n/a | n/a | free | none | n/a | n/a | not scored |
| Redis / external queue | not scored | not scored | mature | extra service + RAM | low | n/a | not scored | not scored |

_SQLite write waits are explicitly not treated as a messaging need._

### Rejected notes

**Repos:** dolmus-takip

- Redis / external queue — not needed by the current PRD; not a permanent ban

_TECH-STACK §7._

## Observability

### Selection

**Repos:** dolmus-takip

journald + structured app logs carrying request_id; Lightsail CPU/network metrics; local RAM/disk/WAL checks; /api/v1/health/live polled by a separate systemd timer every 30 s

_Disk warn 80% / critical 90%, log cap ~200 MB; hash-queue and rate-limit counters to be added to OPS in T6.3 (F13). Secrets/hashes/tokens never logged._

### Rejected notes

**Repos:** dolmus-takip

- Paid observability service — not chosen
- systemd WatchdogSec alone — not used; an independent timer detects event-loop freezes
- External health check + team alert channel — not set up for now (product owner decision 2026-09-21)

_TECH-STACK §8, ARCHITECTURE §8.2; last item from the product owner's answer on alerting._

### Alert channel and external health check

**Repos:** dolmus-takip

None for now — no external health check and no team alert channel; only the local 30 s systemd health timer

_Conflict: the approved rationale says an external probe on /api/v1/health/live 'can be added later without code changes', but the code written for this task (deploy/caddy/Caddyfile, matcher @health on /api/v1/health and /api/v1/health/*) answers 404 to every request from outside, and tests/unit/deploy-config.test.ts asserts it. The API Endpoint List already marks the health endpoints 'Localhost only via Caddy'. Existing value kept unchanged — keep the Caddy block and correct the note, or expose /api/v1/health/live publicly?_

## CI/CD

### Selection

**Repos:** dolmus-takip

GitHub Actions: ci.yml (push + pull_request, ubuntu-24.04) and release.yml (workflow_dispatch, artifact only); manual SSH release into versioned /opt/dolmus-takip/releases/<id> with systemd

_Step list single-sourced in scripts/ci-steps.json (typecheck → lint → unit → integration → e2e → release:build → release:verify), mirrored by npm run ci:local. Least-privilege token, no secrets, artifact retention 14/30 days. No deploy step yet (T6.2/T6.5)._

### Rejected notes

**Repos:** dolmus-takip

- Automatic production deploy on push — not done; release is manually triggered
- Docker / Compose packaging — not used
- Copying macOS node_modules to the server — forbidden; native modules built for target Linux

_TECH-STACK §9, ARCHITECTURE §8.4._

## Email / Notification

### Selection

**Repos:** dolmus-takip

None — no customer email/SMS service in v1

_MVP has no notification need; password reset is done by staff in the back office._

### Rejected notes

**Repos:** dolmus-takip

- Customer email/SMS service — not added in v1
- Automatic password messages — not sent; reset screen states no message is sent

_TECH-STACK §10, DESIGN §2.9._

### Password delivery to customers

**Repos:** dolmus-takip

Manual handover by platform staff over WhatsApp, outside the app; no WhatsApp integration, the app sends no message

_Product owner answer (closes DECISIONS.md F14). No new service or API: staff copy the password they set in the back office and send it themselves. Affects S2.3 back-office reset screen copy and OPS handover step._

## Summary (TL;DR)

### Stack summary

**Repos:** dolmus-takip

| Layer | Selection | Version | Monthly cost | Repo |
| --- | --- | --- | --- | --- |
| Frontend | Next.js + React + TypeScript + Tailwind CSS | 16.3.5 / 19.3.0 / 5.9.3 / 4.3.3 | 0 | dolmus-takip |
| Backend | Node.js on Next.js route handlers, zod | Node 24 LTS / zod 4.6.5 | 0 | dolmus-takip |
| Database | SQLite + Drizzle ORM + better-sqlite3 + Drizzle Kit | SQLite 3.53.4 / 0.45.2 / 13.0.3 / 0.31.10 | 0 (on the VM) | dolmus-takip |
| Auth / Identity | Revocable SQLite server sessions, Argon2id | argon2 0.45.1 | 0 | dolmus-takip |
| Infrastructure / Deployment | Single AWS Lightsail Frankfurt, Ubuntu LTS, Caddy, systemd | 2 vCPU / 2 GB / 60 GB | 12 USD | dolmus-takip |
| Storage / Object Store | Local disk + daily Lightsail snapshot (keep 7) | n/a | 0.05 USD/GB-month (billed volume) | dolmus-takip |
| Queue / Async Messaging | None | n/a | 0 | dolmus-takip |
| Observability | journald, app logs, Lightsail CPU/network, local checks | n/a | 0 | dolmus-takip |
| CI/CD | GitHub Actions + manual SSH release | ubuntu-24.04 runners | within Actions quota | dolmus-takip |
| Email / Notification | None | n/a | 0 | dolmus-takip |

_Running total ≈ 12 USD/month + snapshot storage; taxes, domain and transfer overage excluded (TECH-STACK §5)._
