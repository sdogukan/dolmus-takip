# QA

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## Test Strategy

### Test levels

**Repos:** dolmus-takip

- Unit — Vitest 5.0.1 (project 'unit'): money parsing/rounding, durations, validation, permission decisions, messages, contrast, plate, client state
- Integration — Vitest + real better-sqlite3/Drizzle on a temporary file with real migrations (project 'integration'): composite FKs, transactions, revisions/confirmations, idempotency, SQL reports, multi-connection/process concurrency; mocks or :memory: not accepted for financial proof
- E2E — Playwright 1.63.0, Chromium + WebKit, against the standalone production build with a real test DB
- Ops / load — isolated Linux drills and the target Lightsail in M6: native modules, systemd, WAL, crash/freeze, backup/restore, release, 100-user capacity
- Manual — Android Chrome + iPhone Safari with representative users (tests/e2e/MANUAL-CHECKS.md)

_Integration level kept deliberately: financial integrity must be proven on real SQLite. In the DIJJI runtime container WebKit cannot run, so package gates run Chromium only; full Chromium+WebKit E2E runs in CI and CI must be green before merge (session decision 2026-09-19)._

### Coverage targets

**Repos:** dolmus-takip

- Unit %: no fixed percentage target — coverage reports only locate missing branches
- Acceptance: every one of the 258 acceptance boxes across 35 stories traced as Sx.y/ACn → test or manual evidence
- E2E: all critical flows (login → entry → confirmation → correction → report → staff support) + 28 PRD §9 items mapped to QA01–QA16
- Performance (normal mixed load): save p95 ≤ 2 s, report p95 ≤ 3 s, unexpected errors < 1%
- Integrity: 0 lost financial writes, 0 duplicates, 0 calculation/confirmation mismatches
- Accessibility: text contrast ≥ 4.5:1 (unit-tested), 320 px width and 200% zoom usable
- Lighthouse: no target defined

_QA-PLAN §1 explicitly rejects an arbitrary coverage % or fixed test count; performance targets from ARCHITECTURE §9 / QA-PLAN §3._

## Test Case List

### E2E scenarios

**Repos:** dolmus-takip

| # | Scenario | Steps |
| --- | --- | --- |
| 1 | Vehicle setup and plate login (implemented: vehicle-login.spec.ts, login-accessibility.spec.ts) | Seeded vehicle → /giris → owner password → /sahip; driver password → /sofor; wrong password / unknown plate → same error, form kept; rate limit → 429 message; keyboard/focus/aria checks at 320 px |
| 2 | Staff login and business management (implemented: platform-login.spec.ts, admin-businesses.spec.ts) | /yonetim/giris → admin → /yonetim list → İşletme aç (name + owner) → detail edit → PATCH saved → no-change 422 text → deactivate with confirm → reactivate; support role sees role label; inactive staff rejected |
| 3 | Daily work entry (planned M3, QA06–QA08) | Driver login → pick active person → 08:00–17:30, 10.000 / 1.500 / 300 → preview 2.000 share, 6.200 hand-over → Kaydet → 'Kaydedildi'; offline during submit → unknown result → retry same request_id → single entry; owner 'Kendim çalıştım' → share 0, not_required |
| 4 | Cash confirmation and correct-and-confirm (planned M4, QA09–QA10) | Owner opens pending entry → received 6.000 → 'Parayı aldım' → confirmed, gross/share unchanged → Düzelt ve onayla with new values → one new version + confirmation; parallel edit → 409 text; driver cannot edit confirmed; staff on behalf shows real staff name |
| 5 | Period reports (planned M5, QA11) | Seed Ahmet (driver) + Görkem (owner) entries → month view shows 20.000 gross, 14.400 remainder, 6.000 verified; persons tab 1 day each; day-by-day filters + 'Daha fazla göster'; renamed/inactive person history intact; empty period text |
| 6 | Logout and access revocation (partly implemented in integration; E2E per S1.4/S2.3) | Login → Çıkış → protected page redirects to login and local draft cleared; staff resets vehicle password / deactivates business → open vehicle session gets 'Oturumun sona erdi' on next action |
| 7 | Daily backup, restore and release (M6 ops drill, QA13–QA15) | Build tarball in CI → release:verify → install on isolated Linux → migrate → smoke (health, login, one entry, confirmation, report) → Backup API copy + verify → restore to new machine → totals 14.400/6.000 and login verified, restored sessions revoked; failed migration → rollback before traffic |

_One row per architecture flow (7 flows ↔ 7 scenarios). Currently 4 E2E spec files exist (vehicle-login, platform-login, admin-businesses, login-accessibility)._

### Unit coverage

**Repos:** dolmus-takip

- Caddy — config/headers verified in M6 ops drill (no unit target)
- Next.js app / HTTP layer (src/server/http) — error envelope, protected-route wrapper: errors.test.ts, handler.test.ts
- Identity/authorization (src/server/auth) — cookie, session, app-origin, permissions, scope, rate-limit, hash-queue unit tests; session-* / scope-* / protected-route integration tests
- Receipts module — replay vs 409 REQUEST_ID_REUSED, scope key: mutation-receipts-scope.test.ts (integration)
- Admin module — business create/update/owner/deactivate: admin-businesses-routes.test.ts, platform-admin-cli.test.ts; planned vehicles/users/audit
- Work/delivery module (planned M3–M4) — share rounding floor((gross×bps+5000)/10000), 0.03 TL → 0.01 share, BigInt/overflow, K3 duration rules, K5 negative remainder, status transitions, version conflicts, atomic correct-and-confirm
- Report module (planned M5) — period boundaries Monday/[start,next), distinct work days, current-version confirmation only, cursor pagination
- Data access (src/server/data) — db.test.ts pragmas (WAL, foreign_keys, synchronous FULL, busy_timeout), schema.test.ts, db-connection, app-db-access, sqlite_version ≥ 3.51.3
- systemd jobs / release scripts — release-shared.test.ts, release-build.test.ts, ci-workflows.test.ts; backup/restore scripts planned M6
- Page: Araç/ekip girişi — LoginForm states, messages.ts mapping, plate.ts normalization/format
- Page: Şoför günlük kayıt / Sahip çalışma kaydı (planned) — client preview math, draft + request_id persistence (use-stored-draft, client-state)
- Page: Kayıt detayı ve teslim onayı (planned) — received ≥ 0, prefill not treated as confirmation
- Page: Sahip özeti / Raporlar (planned) — no 0 while loading, period labels, amount formatting '6.200,00 TL'
- Page: Şoförlerim (planned) — F3 warning, rename note
- Page: Yönetim / işletme formları — use-stored-draft version freeze on unknown result, 422 text; design tokens contrast (contrast.test.ts)

_Existing test files enumerated from src and tests/; planned targets from QA-PLAN critical details._

## CI/CD Integration

### Pipeline flow

**Repos:** dolmus-takip

PR opened / push (ci.yml, ubuntu-24.04, Node from .nvmrc, 30 min timeout, concurrency cancel):
  npm ci → typecheck → lint → test:unit → test:integration → test:e2e (next build + standalone, Chromium + WebKit) → release:build (dirty tree rejected, re-runs quality gate, sqlite_version gate, secret scan, tarball + manifest) → release:verify (hash, platform, db-init, /api/v1/health/live 200).
  Artifacts kept 14 days; Playwright report uploaded only on failure (7 days). No secrets used.
Merge to main: same pipeline; merge only when CI is green (2026-09-19 decision).
Release (release.yml, workflow_dispatch with ref): builds and verifies the release tarball, artifact 30 days; no deploy step. Deployment to Lightsail is a manual SSH procedure (T6.2/T6.5).
Local parity: npm run ci:local executes scripts/ci-steps.json in the same order; tests/unit/ci-workflows.test.ts asserts both lists match.

_Step list single-sourced; runner.temp moved from job env to step level (commit e516c15)._

### Run frequency

**Repos:** dolmus-takip

| Test type | When |
| --- | --- |
| Typecheck, lint, unit, integration | Every push and PR (ci.yml); locally via ci:local |
| E2E Chromium + WebKit | Every push and PR in CI; Chromium-only at package gates inside the DIJJI runtime container |
| Release build + verify | Every push/PR and on manual release.yml dispatch |
| Regression + real phone checks | End of each milestone M1–M5 |
| Ops drills: crash/freeze, backup/restore, migration rollback | M6 on isolated Linux and target Lightsail |
| Load test (3 × 100-user scenarios, ≥ 30 min steady) | M6 before pilot, on target machine with 5-year representative data |
| Post-release smoke | After every controlled release, on a dedicated test business |
| Restore drill | Before and after first release, then monthly |

_QA-PLAN §3 run plan + implemented CI triggers._

## Bug Tracking

### Labels

**Repos:** dolmus-takip

- severity:critical — financial data loss/double count, cross-business leak, wrong confirmation, irreversible corruption; blocks release
- severity:high — core entry/confirmation/login unusable, authorization bypass, unrestorable backup; blocks release
- severity:medium — non-blocking functional gap; impact + workaround written; related AC stays open
- severity:low — cosmetic/secondary text; not low if it harms readability or money meaning
- status:planned / not-run / passed / failed / awaiting-decision
- trace:QAxx / Sx.y / ACn

_No tracker is mandated; the plan does not create GitHub issues._

### Bug template

**Repos:** dolmus-takip

QA group / Story / AC: QAxx · Sx.y/ACn
Severity: critical | high | medium | low
Area:
Steps to reproduce:
Expected:
Actual:
Environment / versions: commit, Node, SQLite, package versions, browser/OS, fixture seed
Evidence: sanitized logs (with request_id) / screenshots
Owner:
Fix:
Re-test result: reproducing test + relevant regression run

_Closing requires the reproducing test and regression to pass, not just a code change._

## Manual Test Checklist

### Manual Test Checklist

**Repos:** dolmus-takip

- Android Chrome + iPhone Safari: open link, log in, pick person, enter times/amounts, single Kaydet; measure 30–60 s target with representative users
- 320 px width, 200% zoom, long Turkish names (İ/ı/Ş/ğ), light background; amounts and buttons readable, no blocking horizontal overflow
- Touch targets ≥ 48 px, numeric/time keyboards, visible focus and keyboard order
- VoiceOver / TalkBack: labels, field errors and status announcements
- Slow network, drop during save, retry, phone switch: no false success, no duplicate entry, unknown result understandable
- Shared phone: after logout the next driver sees no previous data or preselected name
- Owner distinguishes expected 6.200 TL vs received 6.000 TL; after Düzelt ve onayla totals and history not confused; staff action visible as on-behalf
- Empty period, pending/confirmed entries, inactive driver, two people with the same name are understandable
- Staff: first-admin CLI and reset-admin-password on the real server; new owner/driver password handed to the customer over WhatsApp and login succeeds with it
- Real HTTPS via Caddy: Secure cookie set, CSP not breaking pages, maintenance response during release

_Items 1-6/8 from QA-PLAN §5 and tests/e2e/MANUAL-CHECKS.md; 9-10 cover server-only and production-only surface (ARCHITECTURE §8, DECISIONS T1.3/T1.4)._
