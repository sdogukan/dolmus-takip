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
| 1 | Vehicle setup and plate login (implemented: vehicle-login.spec.ts, login-accessibility.spec.ts, admin-vehicles.spec.ts) | Seeded vehicle → /giris → owner password → /sahip; driver password → /sofor; wrong password / unknown plate → same error, form kept; rate limit → 429 message; keyboard/focus/aria checks at 320 px. Staff opens /yonetim/isletmeler/:id/araclar/yeni → creates vehicle → new plate logs in with owner and driver passwords separately; duplicate plate (other spacing/case) → 'Bu plaka zaten kayıtlı.'; identical passwords → field error, nothing created; connection lost during submit → result check, password fields locked, retry with the same passwords → single vehicle; 409 REQUEST_ID_REUSED text with business link; passwords never written to localStorage/sessionStorage; vehicle sessions and anonymous users cannot open the page; staff resets the owner password in 'Şifre sıfırlama' on /yonetim/araclar/:id → success text names plate, 'Mal sahibi şifresi' and WhatsApp, field cleared → old owner password rejected, new one opens /sahip, driver password still opens /sofor; new password equal to the other role's → field error, nothing changed; connection lost during reset → result check with selection and password locked, same password retried → completed; after reload the choice is kept and the password must be re-entered; different password on retry → form-specific REQUEST_ID_REUSED text; reset by another staff context meanwhile → 409, reload → new reset works; new password never in localStorage/sessionStorage; inactive vehicle → section shows the unavailable text |
| 2 | Staff login and business management (implemented: platform-login.spec.ts, admin-businesses.spec.ts, admin-vehicles.spec.ts, admin-support-audit.spec.ts, team-accounts.spec.ts) | /yonetim/giris → admin → /yonetim list → İşletme aç (name + owner) → detail edit → PATCH saved → no-change 422 text → deactivate with confirm → reactivate; support role sees role label; inactive staff rejected. Vehicle detail /yonetim/araclar/:id: brand-model, year, route stop and note edited and kept after reload; stale second tab → 'Bu kayıt değişmiş'; stale local draft replaced by current server values; unknown vehicle → 404. Search on /yonetim: plate typed with other spacing/case or a business name → vehicle cards; no-result text; q/active mirrored in the URL; loading never shows 'Sonuç yok', an error keeps the typed text and 'Tekrar dene' works; 'Daha fazla göster' appends the next page, a new query resets the list and a stale response never overwrites it. Support area /yonetim/araclar/:id/destek shows the target and the real staff identity (admin and support role labels), offers no entry/delivery/report links, unknown vehicle → 404, owner and driver sessions cannot open it; an unsaved field or a typed-but-unsent new password + 'Hedefi değiştir' → confirm dialog, Vazgeç keeps the value, continuing clears the drafts and writes nothing. History /yonetim/islem-gecmisi lists performed actions with the real username and before/after values, never shows passwords, owner/driver cannot open it (API 403); empty, error and 'Daha fazla göster' states are distinct. Team accounts on /yonetim/ekip (admin): an account opened from the UI gets a lower-cased username and a different-case duplicate is refused; full name and role edits persist after reload; a lost response replays the same body after reload (200, version +1 once, single audit rows); a stale tab shows the conflict text and 'Güncel halini aç' loads the server values; deactivation asks for confirmation, ends the account's open session and blocks login, reactivation restores no session; password reset ends the open session, the old password is refused, the new one logs in and the password does not stay on screen; an admin deactivating their own account lands on the login page with the session-ended note; the history shows the target account's username and no password; support sees the unauthorized text, the link is hidden and the API answers 403, owner and driver sessions cannot open the pages; passwords are never written to localStorage/sessionStorage; list, create form and detail are usable at 320 px without horizontal scroll |
| 3 | Daily work entry (partly implemented T3.1: driver-daily-form.spec.ts — form without saving; amounts, save and offline retry planned M3, QA06–QA08) | Implemented (T3.1): driver login → /sofor shows the fixed plate, today's Istanbul date and only active drivers with none preselected; live duration 08:00–17:30 → 9 saat 30 dakika, equal or reversed same-day times → error, 'Bitiş ertesi gün' 22:00–06:00 → 8 saat; missing person or time → error under that field with the other values kept; a valid 'Kontrol et' re-reads the driver list once and shows the not-saved note, never 'Kaydedildi', and the form can be filled again for the same person and day; person no longer selectable on the re-read → field error, list refreshed, times kept; re-read answering 401 → session-ended text, not a person error; a list error never shows the empty-list text and 'Tekrar dene' reloads it; a vehicle without drivers → empty-list text and a disabled picker; no horizontal scroll at 320 px. Planned (M3): 10.000 / 1.500 / 300 → preview 2.000 share, 6.200 hand-over → Kaydet → 'Kaydedildi'; offline during submit → unknown result → retry same request_id → single entry; owner 'Kendim çalıştım' → share 0, not_required |
| 4 | Cash confirmation and correct-and-confirm (planned M4, QA09–QA10) | Owner opens pending entry → received 6.000 → 'Parayı aldım' → confirmed, gross/share unchanged → Düzelt ve onayla with new values → one new version + confirmation; parallel edit → 409 text; driver cannot edit confirmed; staff on behalf shows real staff name |
| 5 | Period reports (planned M5, QA11) | Seed Ahmet (driver) + Görkem (owner) entries → month view shows 20.000 gross, 14.400 remainder, 6.000 verified; persons tab 1 day each; day-by-day filters + 'Daha fazla göster'; renamed/inactive person history intact; empty period text |
| 6 | Logout and access revocation (vehicle deactivation implemented in admin-vehicles.spec.ts; vehicle password reset revoking only that access's sessions covered in reset-vehicle-password-route.test.ts; rest in integration; E2E per S1.4/S2.3) | Login → Çıkış → protected page redirects to login and local draft cleared; staff deactivates vehicle on /yonetim/araclar/:id after ConfirmDialog → login with its passwords rejected, vehicle still reachable from the business page; staff resets vehicle password / deactivates business → open vehicle session gets 'Oturumun sona erdi' on next action |
| 7 | Daily backup, restore and release (M6 ops drill, QA13–QA15) | Build tarball in CI → release:verify → install on isolated Linux → migrate → smoke (health, login, one entry, confirmation, report) → Backup API copy + verify → restore to new machine → totals 14.400/6.000 and login verified, restored sessions revoked; failed migration → rollback before traffic |
| 8 | Driver management — Şoförlerim (implemented S2.4: drivers.spec.ts) | Staff creates a business with two vehicles → owner of vehicle A opens 'Şoförlerim' from /sahip (empty-list text; no 'Tüm araçlarda' control) → '+ Şoför ekle' 'Ali Veli' → row appears → 'Düzenle' shows the rename note → renamed → 'Bu araçta pasife al' shows the shared driver password warning and empties the list → 'Pasif şoförleri göster' → 'Yeniden aktifleştir'. Owner of vehicle B types 'ali veli' → similar-name hint → 'Bu araca bağla' links the same person (no duplicate), candidate list disappears. Staff on /yonetim/araclar/:id/soforler sees plate · business · owner and username; 'Şifre sıfırla' links to #sifre-sifirlama; 'Tüm araçlarda pasife al' dialog lists both plates → 'Kişi tüm araçlarda pasife alındı.' → 'Kişiyi yeniden aktifleştir' offered; owner list empty after reload. Two same-named seeded people stay two rows; /sahip keeps its heading and text and gains the Şoförlerim link; anonymous, driver and owner sessions cannot open pages they are not allowed to |

_One row per architecture flow (7 flows ↔ rows 1–7); row 8 covers driver management (S2.4), whose flow card is an open question in this draft. Currently 8 E2E spec files exist (vehicle-login, platform-login, admin-businesses, admin-vehicles, login-accessibility, drivers, admin-support-audit, team-accounts). Search, support area and audit history are added to row 2 because they extend the staff flow; that flow card is an open question in this change. drivers.spec.ts now expects '<username> · Yönetici' because the staff identity also appears in the support target header. Team accounts (S2.6) are added to row 2 as well; row 6 (access revocation) is unchanged because team-account revocation is proven inside team-accounts.spec.ts. T3.1 added tests/e2e/driver-daily-form.spec.ts (9 E2E spec files now) and partly implements row 3; the amounts, save and offline retry steps stay planned. vehicle-login.spec.ts now expects the 'Günlük kayıt' heading and the 'Kim çalıştı?' picker on /sofor instead of the placeholder text; platform-login.spec.ts checks '<username> · <role label>' inside the page header only._

### Unit coverage

**Repos:** dolmus-takip

- Caddy — config/headers verified in M6 ops drill (no unit target)
- Next.js app / HTTP layer (src/server/http) — error envelope, protected-route wrapper: errors.test.ts, handler.test.ts
- Identity/authorization (src/server/auth) — cookie, session, app-origin, permissions, scope, rate-limit, hash-queue unit tests; vehicle-password.test.ts (Argon2id hash/verify, random salt, owner≠driver rule); session-* / scope-* / protected-route integration tests; login/deactivation race (session-usecases.test.ts, vehicle-login-route.test.ts: target inactive at session insert → 401 INVALID_CREDENTIALS, no session row; login/password-reset race: credential reset right after Argon2 verification → 401 INVALID_CREDENTIALS, no session — reset-vehicle-password-route.test.ts); staff login/deactivation and login/reset race: createPlatformSession throws PlatformSessionTargetInactiveError / PlatformCredentialVersionChangedError and writes no session row, issued_version equals the current version on success (session-usecases.test.ts), login right after a reset or deactivation → 401 INVALID_CREDENTIALS, no session row (admin-users-routes.test.ts)
- Receipts module — replay vs 409 REQUEST_ID_REUSED, scope key: mutation-receipts-scope.test.ts (integration)
- Admin module — business create/update/owner/deactivate: admin-businesses-routes.test.ts, platform-admin-cli.test.ts; vehicle create/list/detail/update/deactivate: admin-vehicles-routes.test.ts (single-transaction write, plate conflict, identical passwords 422, request_id replay incl. real concurrent POSTs and different-password 409, version conflict, no-change 422, deactivation revokes sessions and reactivation does not restore them, 403 for vehicle sessions); vehicle password reset: reset-vehicle-password-route.test.ts (200 updates hash + credential_version and revokes only the target credential's sessions, same request_id + same password replays without a second reset, different password 409 REQUEST_ID_REUSED, other role's password 422, unknown vehicle 404, inactive vehicle 403, vehicle sessions 403, real concurrent owner+driver reset to the same password leaves only one working, mid-transaction failure rolls back hash/version/sessions/audit/receipt); business/vehicle list search and paging: admin-list-search-routes.test.ts (existing keys kept and business/owner/active added, plate found in any spacing/case, Turkish case folding on business and owner names, LIKE wildcards treated as text, active filter and nextCursor paging without repeats incl. filtered results, newest business first, invalid q/active/cursor/limit 422, vehicle sessions 403); audit read: admin-audit-route.test.ts (401 without session, 403 for owner and driver sessions, 200 for support and admin, GET-only route, real actor and before = null on create rows written through the real routes, no password/hash/token/cookie/csrf key, session id or raw password in the response, request_id replay adds no second row, actor username resolved after all sessions are deleted, unknown business or other business's vehicle 404, invalid uuid/limit/cursor 422, businessId/vehicleId narrowing with business-less rows only unfiltered, cursor paging returns every row exactly once incl. equal occurred_at and no repeats when rows arrive between pages) and sanitize.test.ts (unit: case-insensitive nested secret-key stripping, harmless keys kept, malformed or non-object JSON → {}); team accounts: admin-users-routes.test.ts (support, owner and driver sessions 403 on every endpoint with nothing changed; list incl. inactive without secret fields, unknown id 404; create with a canonical lower-case username, audit + receipt, no secret leak, the new account can log in; duplicate username in any case incl. a mixed-case CLI row 422 with nothing written; invalid role, username and full name 422; same request_id + same password replays without a second account, different password 409 REQUEST_ID_REUSED; active:false revokes the account's sessions in the same transaction and reactivation restores none, version and conflict rules; name and role changes write audit without bumping credential_version or revoking sessions; a demoted admin's next request 403 with the session kept; role TOCTOU between guard and write 403 with rollback; the last active admin cannot deactivate or demote itself or be deactivated 422; mid-transaction failure changes neither platform_users, sessions, admin_audit nor mutation_receipts; reset changes the hash, revokes sessions, keeps version, returns id + username only and audit carries no secret; reset replay makes no second reset, different target 409 REQUEST_ID_REUSED, unknown account 404; a self-reset revokes the admin's own session and still responds; audit rows carry targetUser even after the account is deactivated, null on other rows)
- Drivers module (src/server/usecases/drivers) — drivers-routes.test.ts (integration): GET gives driver sessions only active person + active assignment with personId/fullName, query params cannot widen it, owner rows and globally inactive people excluded, owner/staff get the management view with candidates (owners and other businesses excluded), staff without target header → 422; driver sessions 403 on POST/PATCH/PUT with no row changed; POST writes one person + one assignment + 2 audit rows + receipt with normalized name and the real actor (vehicle_credential, or platform_user on behalf of the vehicle owner), replay vs 409 REQUEST_ID_REUSED, invalid bodies 422 with nothing written; PUT re-opens and closes the same row without duplicates and without revoking driver sessions, stale/missing version 409, same value 422, parallel links → one 201 one 409, no-row active:false 422 / version 409, other-business/unknown person and other vehicle in URL 404, owner person 422, globally inactive person 422 (closing allowed); PATCH rename keeps the id, bumps version and audits before/after, owner sending active → 403, stale 409, same name 422, owner persons and unlinked people 404, staff active:false changes only people.active and returns affected vehicles; drivers-affected-vehicles.test.ts: batch lookup equals per-person lookup, empty input runs no query, no cross-business leak
- Work/delivery module (planned M3–M4) — share rounding floor((gross×bps+5000)/10000), 0.03 TL → 0.01 share, BigInt/overflow, K3 duration rules, K5 negative remainder, status transitions, version conflicts, atomic correct-and-confirm
- Report module (planned M5) — period boundaries Monday/[start,next), distinct work days, current-version confirmation only, cursor pagination
- Data access (src/server/data) — db.test.ts pragmas (WAL, foreign_keys, synchronous FULL, busy_timeout), schema.test.ts, db-connection, app-db-access, sqlite_version ≥ 3.51.3
- systemd jobs / release scripts — release-shared.test.ts, release-build.test.ts, ci-workflows.test.ts; backup/restore scripts planned M6
- Page: Araç/ekip girişi — LoginForm states, messages.ts mapping, plate.ts normalization/format
- Page: Şoför günlük kayıt — work-time.test.ts (implemented T3.1: Istanbul 'today' independent of the device time zone around the 21:00Z day boundary; calendar day shift across month and year ends; 08:00–17:30 = 570 min with UTC instants at +03; a 00:30 start keeps workDate on the start day; explicit next-day 22:00–06:00 = 8 h; equal same-day times refused, not counted as 24 h; a same-day end before start refused instead of rolling over; next-day equal times = exactly 1440 min, longer refused; 23:59 → next-day 00:00 = 1 min; each missing or invalid field gets only its own error; non-existent dates and malformed values invalid; '14 Eylül 2026' date and '9 saat 30 dakika' duration formatting)
- Page: Şoför günlük kayıt (amounts and save, planned M3) / Sahip çalışma kaydı (planned) — client preview math, draft + request_id persistence (use-stored-draft, client-state)
- Page: Kayıt detayı ve teslim onayı (planned) — received ≥ 0, prefill not treated as confirmation
- Page: Sahip özeti / Raporlar (planned) — no 0 while loading, period labels, amount formatting '6.200,00 TL'
- Page: Şoförlerim (owner and staff) — drivers-ui.test.ts: name trim/whitespace collapse and 1–120 limit, active/inactive split keeping same-named people as separate rows, similar-name hint ignoring Turkish case and matching word prefixes, stale-draft detection per operation (pending never stale), request bodies carry no person/business/vehicle/role ids and escape URL segments, error codes mapped to screen texts (5xx → generic connection text, only 5xx ambiguous), exact F3 warning and rename-note texts, affected-vehicle plate display
- Page: Yönetim / işletme formları — use-stored-draft version freeze on unknown result, 422 text; design tokens contrast (contrast.test.ts)
- Page: Yönetim / araç formları — stale draft detection against the server version, pending result never treated as stale (draft-version.test.ts)
- Page: Yönetim araması — admin-search.test.ts (active filter parsing, business vs vehicle list URL, encoded query and cursor, bare /yonetim link on defaults, 401/403/5xx/network/422 error texts); search-fold.test.ts (Turkish case folding, NFD equals NFC, empty string kept)
- Page: Destek alanı — support-target.test.ts (clears only the target vehicle's three drafts, storage errors never throw, draft names equal the existing form names)
- Page: İşlem geçmişi — audit-ui.test.ts (all 24 written actions have a label different from the raw code, business/vehicle status labels distinct from person labels, unknown code shown raw, creation detection, staff actor with username + role label, vehicle credential shown as access + plate without a person name, before/after rows only for changed fields with ids/version hidden, password reset makes no creation claim, password-like keys never shown even if returned, object values serialized as text, Istanbul time, URL building; team-account actions carry distinct Turkish labels, a created account shows no before value, the role is shown with its Turkish label and a role change lists only the changed field, password/hash-like keys stay hidden)
- Page: Ekip hesapları — team-users-ui.test.ts (username trimmed + lower-cased, 3–32 allowed characters, spaces and Turkish characters refused; full-name whitespace collapse and 1–120 limit; passwords never trimmed, whitespace-only accepted, empty and >200 chars refused with their own texts; create body carries canonical values and platformRole but no actor role or id; update diff returns only changed fields and an empty name on a nameless account is no change; the info PATCH body is built from the frozen draft with its requestId and version and is identical after reload; reset body carries only requestId + newPassword; the account id travels only in the URL, escaped; per-account draft names; session-ended URL /yonetim/giris?oturum=bitti; status codes mapped to screen classes, 'Değişiklik yok' vs generic 422 text, the raw server message never shown, only known field errors picked; role labels equal the staff header labels)

_Existing test files enumerated from src and tests/; planned targets from QA-PLAN critical details. T2.2 added src/server/auth/vehicle-password.test.ts, src/lib/draft-version.test.ts, tests/integration/admin-vehicles-routes.test.ts and race cases in session-usecases / vehicle-login-route tests. T2.3 added tests/integration/reset-vehicle-password-route.test.ts. S2.4 added tests/integration/drivers-routes.test.ts, tests/integration/drivers-affected-vehicles.test.ts and src/lib/drivers-ui.test.ts. The admin support/audit change added tests/integration/admin-list-search-routes.test.ts, tests/integration/admin-audit-route.test.ts, src/server/usecases/admin-audit/sanitize.test.ts, src/lib/admin-search.test.ts, src/lib/search-fold.test.ts, src/lib/support-target.test.ts and src/lib/audit-ui.test.ts. S2.6 added tests/integration/admin-users-routes.test.ts and src/lib/team-users-ui.test.ts, and extended tests/integration/session-usecases.test.ts (platform session race cases) and src/lib/audit-ui.test.ts (team-account rows); tests/integration/release-build.test.ts now expects 4 migrations. T3.1 added src/lib/work-time.test.ts for the pure K3 date/time rule in src/lib/work-time.ts (evaluateWorkTime, istanbulToday, addDays, formatWorkDate, formatDuration); the server-side re-validation of the same rule stays in the planned Work/delivery module targets._

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
