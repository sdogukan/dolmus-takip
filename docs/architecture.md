# Architecture

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## TL;DR

### TL;DR

**Repos:** dolmus-takip

1 service: a single Node 24 / Next.js 16 process (pages + /api/v1 + use cases) behind Caddy on one AWS Lightsail VM, managed by systemd.
Database: SQLite (WAL, FULL sync) via Drizzle ORM + better-sqlite3; 13 tables, composite (business_id, id) foreign keys enforce tenant boundaries.
Cache: none shared; tenant responses are private, no-store; only hashed static assets are long-cached.
Auth: in-house revocable DB sessions (SHA-256 token hash, HttpOnly cookie) for vehicle roles (plate + owner/driver password) and personal staff accounts (admin/support); CSRF token + same-origin check on writes.
Integrity: every mutation carries a client request_id (idempotency receipt) and optimistic version; financial changes write entry + immutable revision + confirmation atomically (BEGIN IMMEDIATE).

_Condensed from ARCHITECTURE 'Kısa anlatım', §2, §3 and the implemented schema (13 tables incl. business_owners added in T2.1)._

## System Flow Diagram

### Flow: Vehicle setup and plate login (PRD §2, S1.2, S2.1–S2.3)

**Repos:** dolmus-takip

1. Staff (personal account) creates business + owner person (POST /api/v1/admin/businesses — implemented), then vehicle with plate and two passwords (owner, driver; must differ) — T2.2/T2.3 planned.
2. Plate normalized (spaces removed, upper-cased) and globally unique; each role password stored as a separate Argon2id hash.
3. User posts plate + password to POST /api/v1/auth/vehicle-login; server tries owner then driver hash (≤2 hashes per attempt, dummy hash for unknown plate), rate-limited 20/plate and 120/IP per 15 min.
4. On success a new session is issued (prior session in the same browser revoked); role/vehicle/business are derived from the credential, never from the client.
5. Root page routes: no session → /giris; driver → /sofor; owner → /sahip; unknown plate, inactive vehicle/business and wrong password share one 401 message.

_Login is implemented and E2E-covered (tests/e2e/vehicle-login.spec.ts); vehicle creation/password screens are planned in M2._

### Flow: Staff login and business management (S1.3, S2.1, S2.5–S2.6)

**Repos:** dolmus-takip

1. First admin is created with `npm run platform-admin -- create-first-admin` on the server shell (idempotent); `reset-admin-password` recovers access. No public admin signup endpoint.
2. Staff signs in at /yonetim/giris → POST /api/v1/auth/platform-login (username normalized, dummy hash, 20/username + shared IP bucket per 15 min).
3. /yonetim lists businesses; "İşletme aç" posts name + owner full name (always created with an owner).
4. /yonetim/isletmeler/:id edits name/owner name, assigns an owner only to an owner-less business (no transfer, K8), deactivates/reactivates with confirmation; PATCH is optimistic on businesses.version.
5. Deactivation revokes all sessions under the business in the same transaction; every change writes admin_audit with real staff actor and before/after.
6. Planned: vehicle management, team accounts (/yonetim/ekip, admin only), support target area and audit history (T2.2–T2.6).

_Conflict between the approved flow (value kept unchanged) and the code written for this and earlier tasks. Approved step 3 says /yonetim lists businesses; approved step 6 lists team accounts (/yonetim/ekip, admin only), the support target area and audit history as planned (T2.2–T2.6). The code now implements: /yonetim search (AdminSearch: q matches a plate in any spacing/case, a business name or an owner name with Turkish case folding; 'Durum' filter all/active/inactive; empty query → business list via GET /api/v1/admin/businesses, non-empty → vehicle cards via GET /api/v1/admin/vehicles?q= with 'Destek ekranını aç' and 'Araç bilgisi'; keyset 'Daha fazla göster'), /yonetim/araclar/:id/destek with the pinned SupportTargetHeader and 'Hedefi değiştir' → 'Değişiklikleri bırakıp çık?' confirm when a registered form is dirty, /yonetim/islem-gecmisi backed by GET /api/v1/admin/audit (audit.read: support/admin), and — in this task (S2.6) — team accounts: an 'Ekip hesapları' link on /yonetim shown to admins only; /yonetim/ekip lists all accounts incl. inactive; /yonetim/ekip/yeni creates an account (username trimmed + lower-cased, unique case-insensitively; full name; role admin/support; initial password handed over by staff, the app sends no message); /yonetim/ekip/:id edits full name and role (optimistic on platform_users.version), deactivates behind a confirm dialog (revokes all the account's sessions; reactivation restores none) and resets the password (revokes all the account's sessions). The actor's admin role is re-checked inside every write transaction; the last active admin cannot be deactivated or demoted (422); an admin who deactivates or resets their own account is sent to /yonetim/giris?oturum=bitti. Every change writes admin_audit (platform_user.create / update / role_change / deactivate / reactivate / reset_password) with the real staff actor. Vehicle management in step 6 was already implemented before these tasks. Proposed replacement: 3. /yonetim searches businesses and vehicles (plate, business or owner name, active filter); 6. From a vehicle card staff open the support area with the target pinned; switching target with unsaved input asks for confirmation; staff read the history of all actions or of one vehicle; 7. Admins open, edit, deactivate/reactivate team accounts and reset their passwords under /yonetim/ekip; deactivation and reset end the account's sessions; at least one active admin always remains. Update the flow, or keep it and describe these screens only in design?_

### Flow: Daily work entry (PRD §3–4, S3.1–S3.6)

**Repos:** dolmus-takip

1. Date and vehicle prefilled; user picks an active person from the vehicle's driver list, start/end time, gross, fuel and optional single other expense + note (K6).
2. Browser shows a preview only; server re-validates authority, person–vehicle assignment, dates (0 < duration ≤ 1440 min, work_date = start day, K3) and amounts.
3. Server computes share: driver kind 20% (share_bps 2000), owner kind 0%; share = floor((gross_cents × bps + 5000) / 10000) with integer/BigInt math; negative remainder is shown, not clamped (K5).
4. One BEGIN IMMEDIATE transaction writes work_entries (driver → pending, owner → not_required, version 1), the first revision and the mutation receipt.
5. "Kaydedildi" only after commit; unknown result freezes the form and re-sends the same request_id (draft + request_id kept in localStorage, 24 h TTL, F6). No offline queue (K7).

_Planned for M3 (T3.1–T3.6); the receipt/idempotency layer already exists in src/server/usecases/receipts._

### Flow: Cash confirmation and correct-and-confirm (PRD §7, S4.1–S4.6)

**Repos:** dolmus-takip

1. Owner (or staff on behalf, with real staff identity) opens entry detail: expected hand-over vs received amount (received_cents must be explicit, ≥ 0).
2. POST /work-entries/:id/confirm: version +1, confirmed revision + cash_confirmation bound to that entry_version, in one transaction.
3. Confirmed entries reject generic PATCH; only POST /work-entries/:id/correct-and-confirm writes new values + new revision + new confirmation atomically; old versions/confirmations stay.
4. Driver↔owner kind change on a confirmed entry is closed in v1 (422, K4).
5. Concurrent edits use conditional UPDATE on version → 409 "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et."
6. Driver sees delivery status of entries of the person selected on the same vehicle; may edit unconfirmed entries only on the work day (K1).

_Planned for M4; ADR-002 is the governing decision._

### Flow: Period reports (PRD §5, S5.1–S5.5)

**Repos:** dolmus-takip

1. Server resolves authorized business/vehicle and period [start, next start) in Europe/Istanbul; week starts Monday (K3); max one calendar year per request.
2. SQL SUM/GROUP BY over current work_entries for hours, gross, costs, share, remainder; verified hand-over sums only the confirmation whose entry_version equals the current version.
3. Person view: COUNT(DISTINCT work_date) work days, SUM(duration_minutes); vehicle work day = distinct work_date with ≥1 entry (F17).
4. Day-by-day list paginated 50 (max 100) with (work_date, id) cursor; totals and list read in one snapshot.
5. No export/charts in v1; screens refresh on open and "Yenile".

_Planned for M5 (T5.1–T5.5)._

### Flow: Logout and access revocation (S1.4)

**Repos:** dolmus-takip

1. POST /api/v1/auth/logout requires a valid session + CSRF token; client clears local state regardless.
2. Access-change use cases (bumpCredentialVersion, setVehicleActive, setBusinessActive, setPlatformUserActive/Role, bumpPlatformUserVersion) revoke sessions in the same BEGIN IMMEDIATE transaction.
3. Every request checks expiry, revoked_at, issued_version vs credential_version and active flags → 401 SESSION_EXPIRED / SESSION_REVOKED.
4. Session lifetime: vehicle 30 days absolute / 7 days idle; staff 12 h / 30 min idle.

_Conflict between the approved flow (value kept unchanged) and the code written for this task. Approved step 2 lists setPlatformUserActive/Role among the access-change use cases that revoke sessions in the same BEGIN IMMEDIATE transaction. access/set-platform-user-role.ts documents that a role change needs no revoke and no version bump (resolveSession reads the role fresh on every request), and this task made role changes reachable: PATCH /api/v1/admin/users/:userId (updatePlatformUser) changes platform_role without bumping credential_version and without revoking sessions; a demoted admin's next /admin/users request gets 403, and a write racing the demotion is refused by assertActorIsAdmin inside the transaction (403, rolled back). Deactivation (same PATCH, active:false) and POST /api/v1/admin/users/:userId/reset-password revoke all the account's sessions in the same transaction through revokeSessionsForPlatformUserSync, and staff login now re-checks active and credential_version at session insert (401 INVALID_CREDENTIALS, no session), so those still match the approved steps. Proposed step 2: 'Access-change use cases (bumpCredentialVersion, setVehicleActive, setBusinessActive, setPlatformUserActive, bumpPlatformUserVersion, team-account deactivation and password reset) revoke sessions in the same BEGIN IMMEDIATE transaction; a staff role change revokes nothing and takes effect on the next request.' Correct the flow, or keep it and make role changes revoke sessions?_

### Flow: Daily backup, restore and release (S6.1, S6.4–S6.5)

**Repos:** dolmus-takip

1. 02:30 Europe/Istanbul: SQLite Backup API copy → integrity_check, foreign_key_check, totals → fsync + atomic publish with manifest before 02:55; keep last two good copies.
2. ~03:00 Lightsail automatic snapshot (keep 7); prepared-copy, snapshot-success and restore-tested are tracked as separate facts.
3. Restore on a separate machine: verify copy hash, relations, totals and login; revoke restored sessions before opening traffic.
4. Release: CI builds target-compatible tarball + manifest → SSH to new release dir → shared ops lock → maintenance → pre-migration copy → migrate once → switch current → readiness + financial smoke → open traffic.
5. Rollback: code-only if schema compatible; old code + pre-release DB only while no new customer writes were accepted; otherwise forward fix.

_Release build/verify implemented (T6.1); backup/restore/deploy planned for M6._

## Service Topology

### Services

**Repos:** dolmus-takip

- Caddy — TLS, HTTPS redirect, request size limit, maintenance response; exposes 80/443, proxies to localhost
- Next.js app (single Node 24 process, 127.0.0.1:3000) — pages, /api/v1, sessions, authorization, calculations, reports
- Identity/authorization module (src/server/auth, usecases/auth, usecases/session, usecases/access) — sessions, cookies, CSRF/origin, permissions matrix, scope, rate limit, Argon2 queue; vehicle credential hashing + owner≠driver rule (auth/vehicle-password.ts); conditional per-credential password reset core that revokes only that credential's sessions (access/reset-vehicle-credential.ts); vehicle login re-checks credential_version at session insert (login/reset race); staff login re-checks active and credential_version at session insert (login/deactivation and login/reset race, S2.6)
- Receipts module (src/server/usecases/receipts) — request_id idempotency receipts for every mutation
- Admin module (src/server/usecases/admin-businesses, admin-vehicles, admin-audit, admin-users) — businesses, owners, vehicles (create/edit/deactivate implemented), vehicle password reset per role (implemented T2.3), searchable and keyset-paginated business and vehicle lists (q / active / cursor / limit, implemented), read-only audit history with actors resolved without sessions, the target team account resolved for platform_user rows and secret-like keys stripped on read (implemented), team accounts (implemented S2.6: list, create, edit name/role/active, password reset; admin only, re-checked inside the write transaction; the last active admin cannot be deactivated or demoted); full audit
- Drivers module (src/server/usecases/drivers, implemented S2.4) — selectable-driver list (active assignment + active person, owners excluded) and the same rule for one person (findSelectableDriver, used by work-entry creation and editing) and for the person of a work entry (entryPersonSelectableWhere, used for K1 entry visibility) and management view (all assignments + linkable candidates of the same business); add driver (new person + active assignment on the scoped vehicle); rename a person (identity kept); per-vehicle assignment on/off without duplicate rows; staff-only global person (de)activation with the list of affected vehicles; every write adds admin_audit rows and a receipt in the same transaction
- Work/delivery module (src/server/usecases/work-entries, partly implemented T3.2–T3.5) — request body schema (workEntryInputSchema: date/times plus amounts as decimal-integer cent strings, one optional other expense + note up to 200 chars; client-sent share, remainder, work kind and calculation version stripped) and server-side recomputation of duration, share and remainder (computeWorkEntryFigures); who-worked schema (workEntrySubjectSchema: workType owner|driver + workerPersonId; client-sent personId, businessId, role, workKind and shareBps stripped); create preparation (prepareWorkEntryCreate: permission per work type — work_entry.create_owner / work_entry.create_driver; owner kind always resolves to the scoped vehicle's owner person, driver kind only to a selectable driver, the owner person is never accepted as driver kind; status pending for driver kind, not_required for owner kind; actor block = vehicle credential, or platform user on behalf of the owner; writes nothing itself and runs inside the create write transaction); readVehicleOwnerPerson; creation (createWorkEntry, implemented T3.4, behind POST /api/v1/work-entries: one BEGIN IMMEDIATE transaction resolves the receipt first, then prepares under the same lock and writes work_entries version 1 + work_entry_revisions v1 (action create, full snapshot) + one admin_audit row for staff actors only + the receipt; 201 only after commit); scoped reads (readWorkEntryForScope for one entry, listWorkEntriesForScope for the vehicle's entries: business + vehicle scope; K1 driver visibility = driver kind + person still selectable; newest work_date first with a (work_date, id) keyset cursor; a driver session must name a selectable workerPersonId); editing of unconfirmed entries (updateWorkEntry, implemented T3.5, behind PATCH /api/v1/work-entries/:id: one BEGIN IMMEDIATE transaction resolves the receipt first, then scoped lookup with K1 → 404, confirmed → 409 ENTRY_CONFIRMED, stale version → 409 VERSION_CONFLICT, driver session outside today → 403, field validation → 422, no change → 422; conditional UPDATE on version and status <> confirmed + work_entry_revisions (action update, full snapshot) + one admin_audit row for staff actors only + the receipt; work kind and status never change, share and remainder recomputed for the entry's kind, no cash confirmation written); confirm, correct-and-confirm and history planned (M4)
- Report module (planned, M5) — period filters and SQL aggregates within authorized scope
- Data access (src/server/data: Drizzle + better-sqlite3) — parameterized queries, transactions, migrations, scoped filters
- systemd jobs — app/Caddy services, 30 s health timer, nightly backup preparation, cleanup

_ARCHITECTURE §2 component table mapped onto the actual src/server layout from code; planned modules marked. T2.2 added usecases/admin-vehicles (createVehicle, updateVehicle, listVehicles, getVehicleDetail) and auth/vehicle-password.ts (Argon2id m=19456/t=2/p=1 through the hash queue, always outside the write transaction; passwordsAreDistinct shared with the planned T2.3 reset). T2.3 added usecases/admin-vehicles/reset-vehicle-password.ts (resetVehiclePassword: Argon2 distinctness check against the other role + hashing outside the transaction; one BEGIN IMMEDIATE transaction writes the conditional hash/credential_version update, target-only session revoke, one admin_audit row and the receipt) and usecases/access/reset-vehicle-credential.ts (resetVehicleCredentialSync, WHERE credential_version = expected). createVehicleSession takes an optional expectedCredentialVersion and throws VehicleCredentialVersionChangedError, which vehicleLogin maps to the generic 401 INVALID_CREDENTIALS. S2.4 added usecases/drivers: queries.ts (listSelectableDrivers is the single home of the 'selectable driver' rule; listVehicleDriversForManagement; getManagedDriver; listAffectedVehicles / listAffectedVehiclesForPeople; NOT_OWNER_PERSON excludes business and vehicle owners), create-driver.ts (createDriver), update-person.ts (updatePerson, GlobalActiveForbiddenError), set-vehicle-driver.ts (setVehicleDriver), audit.ts (writeDriverAudit: owner actor = vehicle_credential; staff actor = platform_user with on_behalf_of = the target vehicle's owner for vehicle-scoped actions) and person-name.ts (normalizeFullName, 1–120 chars). Each write is one BEGIN IMMEDIATE transaction with receipt; no write in this module revokes sessions (shared driver password, F3). The admin support/audit change added usecases/admin-audit (queries.ts listAdminAudit: LEFT JOINs to businesses, vehicles, platform_users, vehicle_credentials → vehicles and people; sessions are never joined and actor_session_id is not returned, so session cleanup does not erase the actor; ordered occurred_at DESC, id DESC with a two-part keyset cursor; onBehalfOf only for staff actors; sanitize.ts sanitizeAuditPayload removes password/hash/token/cookie/secret/csrf keys case-insensitively and nested, and returns {} for malformed or non-object JSON), usecases/list-cursor.ts (opaque base64url JSON keyset cursor, InvalidCursorError, ListPageOptions / ListPage) and listBusinessesPage (created_at DESC, id ASC) / listVehiclesPage (plate_normalized ASC). q matching runs in the application layer through lib/search-fold.ts foldForSearch (I/İ/ı → i, NFC) because SQLite LIKE folds ASCII only; active and cursor conditions run in SQL; no index or migration was added. listBusinesses / listVehicles remain as unpaged wrappers. S2.6 added usecases/admin-users: queries.ts (listPlatformUsers ordered by lower(username), getPlatformUserDetail; the view never carries password_hash or credential_version), create-platform-user.ts (createPlatformUser: username trimmed + lower-cased and matched against /^[a-z0-9._-]{3,32}$/, uniqueness checked with lower(username) so mixed-case CLI rows collide; full name 1–120 chars via drivers/person-name; Argon2 hashing outside the transaction; one BEGIN IMMEDIATE transaction writes the account, one admin_audit row and the receipt; a replay re-verifies the password against the stored hash), update-platform-user.ts (updatePlatformUser: conditional UPDATE on platform_users.version; deactivation revokes all the account's sessions in the same transaction and reactivation restores none; name and role changes neither bump credential_version nor revoke sessions; the zero-admin lock counts other active admins in the same transaction), reset-platform-user-password.ts (resetPlatformUserPassword: conditional hash + credential_version bump against the version read before Argon2, revokes all the account's sessions incl. the acting admin's own; platform_users.version unchanged) and shared.ts (assertActorIsAdmin re-reads the actor's platform_role inside the transaction because recheckScopeInTransaction does not check the role; audit snapshots carry username, fullName, platformRole and active only). createPlatformSession now re-reads active and, when given, credential_version in the same BEGIN IMMEDIATE transaction as the session insert; platformLogin maps PlatformSessionTargetInactiveError / PlatformCredentialVersionChangedError to the generic 401 INVALID_CREDENTIALS without counting a rate-limit failure. listAdminAudit LEFT JOINs a platform_users alias on entity_type = 'platform_user' to return targetUser. T3.2 added usecases/work-entries: input.ts (workEntryInputSchema built on scopeSafeObject, so personId is forbidden; grossCents and fuelCents required as ^(0|[1-9][0-9]*)$ strings converted with BigInt and capped at Number.MAX_SAFE_INTEGER; otherExpenseCents optional — empty amount + empty note = 0, a note with an empty amount is refused; otherExpenseNote trimmed and at most 200 chars; workKind, shareBps, shareCents, remainderCents and calculationVersion are not in the schema and are stripped), figures.ts (computeWorkEntryFigures(workKind, body): workKind comes from the caller, never from the session role or the body; runs evaluateWorkTime and calculateWorkEntryAmounts; AmountOutOfRangeError becomes a field error) and index.ts. The pure rules live in src/lib and are shared with the page: work-calculation.ts (calculateWorkEntryAmounts, SHARE_BPS_BY_WORK_KIND driver 2000 / owner 0, CALCULATION_VERSION 1, share = floor((gross × bps + 5000) / 10000) in BigInt on gross before expenses, remainder = gross − fuel − other − share and kept when negative) and money.ts (parseTlAmount / formatTlAmount for Turkish '1.250,50' input and '6.200,00 TL' display, parseApiCents / centsToApiString for the API cent string; no floating point). T3.3 added usecases/work-entries/subject.ts (workEntrySubjectSchema on scopeSafeObject, so the person field is named workerPersonId, max 64 chars; workType required, invalid → 'Kayıt türünü seç.'), queries.ts (readVehicleOwnerPerson: the scoped vehicle's owner person via scopedVehiclesFilter) and prepare-create.ts (prepareWorkEntryCreate(db, context, scope, body) → ok + WorkEntryCreateInput {businessId, vehicleId, personId, workKind, status, figures, actor} | 403 FORBIDDEN | 422 VALIDATION_ERROR with field errors; the kind is decided by workType + the session's permission + person resolution, never by the body; an unknown, other-business, inactive, unassigned or owner person gets the same 'personUnavailable' text so nothing leaks; figure errors are returned together with the person error; the actor block mirrors the work_entry_revisions actor columns). drivers/queries.ts now keeps the selectable-driver condition in selectableDriverWhere, shared by listSelectableDrivers and the new findSelectableDriver. T3.4 added usecases/work-entries/create.ts (createWorkEntry(db, context, scope, { requestId, body })): the request hash is computed outside the lock from the normalized subject + input (cents as decimal strings, workerPersonId only for driver kind, fixed key order); a body that does not parse goes straight to prepareWorkEntryCreate for its 403/422 and writes nothing. Inside one BEGIN IMMEDIATE transaction resolveReceipt runs before preparation, so a replay returns the committed entry and status even after the person or assignment was deactivated; otherwise prepareWorkEntryCreate re-checks person and assignment under the same lock, work_entries (version 1) and work_entry_revisions v1 (actor columns from the prepared actor block) are inserted, one admin_audit row work_entry.create (after = workKind, personId, workDate, status, version; no before) is written only when the actor is a platform user, the receipt is recorded (operation work_entry.create, response 201) and the entry is read back through a business + vehicle scoped join with the person's name. No cash_confirmations row is written at creation. T3.5 moved WorkEntryView and readWorkEntryView from create.ts into usecases/work-entries/queries.ts and added findWorkEntryRowForScope (scope filter + optional K1), readWorkEntryForScope (GET detail, K1 applied), readWorkEntryView (create/update result and replay, K1 not applied because the receipt proves this actor wrote the entry) and listWorkEntriesForScope (driver session: missing workerPersonId → personRequired, not selectable → personUnavailable, the same text for every cause; owner/staff: optional workerPersonId filter; ORDER BY work_date DESC, id DESC with limit + 1 for nextCursor). errors.ts adds WorkEntryNotFoundError (404 WORK_ENTRY_NOT_FOUND, identical for an unknown id, another vehicle or business and a K1-invisible entry), WorkEntryVersionConflictError (409 VERSION_CONFLICT with the canonical conflict text) and WorkEntryConfirmedError (409 ENTRY_CONFIRMED). update.ts (updateWorkEntry, operation work_entry.update): the request hash covers entryId, version and the normalized fields, so the same requestId on another entry or version → 409 REQUEST_ID_REUSED; a replay returns the committed result even after the person was deactivated or the entry was confirmed; a workType different from the entry's kind → 422 workTypeMismatch; a driver-kind entry may switch to another selectable driver, an owner-kind entry keeps its person (never re-derived from the vehicle's current owner); a driver session gets 403 for an entry of another day (Istanbul, injectable clock) and 422 fields.date when moving the date off today; the revision actor comes from buildActor (now exported from prepare-create.ts); admin_audit work_entry.update carries before/after of the daily fields, personId, status and version only. drivers/queries.ts adds entryPersonSelectableWhere, the selectable-driver rule expressed over a work entry's business, vehicle and person columns._

### Database tables

**Repos:** dolmus-takip

- businesses — tenant boundary (name, active, version)
- business_owners — at most one owner person per business (T2.1)
- people — stable identity of drivers and owners; not a login account
- vehicles — globally unique normalized plate, owner person, vehicle info, active, version
- vehicle_drivers — vehicle ↔ person assignment, active flag; history never deleted
- vehicle_credentials — one owner and one driver password hash per vehicle, credential_version
- platform_users — personal staff accounts (admin/support) with an optional full name and an edit version
- sessions — hashed session tokens for exactly one actor kind
- work_entries — current version of each work record with calculated amounts and status
- work_entry_revisions — immutable full snapshot per version
- cash_confirmations — immutable received amount bound to one entry version
- mutation_receipts — idempotency results keyed by scope + request_id
- admin_audit — before/after history of admin and support actions (no secrets)

_13 tables in schema.ts and migrations 0000–0003; 0003 adds platform_users.full_name and platform_users.version._

### Connection diagram

**Repos:** dolmus-takip

```
[Phone browser]
      | HTTPS 443
      v
+------------------- AWS Lightsail VM (Ubuntu LTS) -------------------+
|  [Caddy] --http--> [Next.js app 127.0.0.1:3000]                      |
|                       | pages / API / use cases                      |
|                       v                                              |
|                 [Drizzle + better-sqlite3]                           |
|                       v                                              |
|      [SQLite /var/lib/dolmus-takip/data/app.sqlite (WAL)]            |
|                       |  02:30 Backup API                            |
|                       v                                              |
|      [backup-ready/ verified copy + manifest]                        |
|  [systemd timer] --GET /api/v1/health/live every 30 s--> [Next.js]   |
+----------------------------------------------------------------------+
      | daily ~03:00
      v
[Lightsail automatic snapshot, keep 7]

[GitHub Actions] --tarball+manifest--(manual SSH)--> /opt/dolmus-takip/releases/<id>
```

_Merges ARCHITECTURE §1 and §8 diagrams; Next listens on localhost only._

## Database Design

### businesses table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id (app UUID) | — | SQLite table | name, active (bool, default true), created_at (ISO UTC), version (int, default 1) |

_PK/SK columns adapted to SQL: PK = primary key, SK = additional unique/composite keys. version added by ALTER in migration 0002 without CHECK (table rebuild would break FKs)._

### business_owners table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| business_id | FK (business_id, person_id) → people(business_id, id) | SQLite table | person_id; row absent = owner-less business |

_T2.1 decision; owner assigned once, no transfer (K8)._

### people table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | UNIQUE (business_id, id) | SQLite table | business_id, full_name, active, version (CHECK ≥ 1) |

_Composite unique is the target of child composite FKs._

### vehicles table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | UNIQUE plate_normalized; UNIQUE (business_id, id); FK (business_id, owner_person_id) → people | SQLite table | brand_model, year, route_stop, note, active, version |

_Plate reallocation out of MVP scope (F20); plate stays unconditionally unique._

### vehicle_drivers table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| (business_id, vehicle_id, person_id) | FK → vehicles(business_id, id); FK → people(business_id, id) | SQLite table | active, version |

_Owner's own driving is not an assignment row._

### vehicle_credentials table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | UNIQUE (vehicle_id, role); FK (business_id, vehicle_id) → vehicles | SQLite table | role (owner\|driver), password_hash (Argon2id), credential_version |

_Owner and driver passwords must differ (checked at create/reset)._

### platform_users table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | UNIQUE username | SQLite table | password_hash, full_name (nullable), platform_role (admin\|support), active, credential_version, version (int, default 1) |

_Not tied to a business; support target validated per request. Migration 0003 (S2.6) added full_name (nullable: accounts created with the CLI have none) and version, the optimistic lock for team-account edits, kept separate from credential_version so name/role/active edits do not revoke sessions by themselves (deactivation revokes explicitly). No CHECK added: it would rebuild an FK-referenced table (same reason as businesses.version in 0002). The unique index is on the stored username; the create use case additionally rejects a case-insensitive duplicate._

### sessions table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | UNIQUE token_hash; CHECK exactly one of credential_id / platform_user_id | SQLite table | issued_version, created_at, last_seen_at, expires_at, revoked_at |

_Technical table without business_id; scope resolved through the credential._

### work_entries table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | UNIQUE (business_id, id); FK → vehicles, people (composite) | SQLite table | work_kind (owner\|driver), work_date, starts_at, ends_at, duration_minutes, gross_cents, fuel_cents, other_expense_cents, other_expense_note, share_bps, share_cents, remainder_cents, calculation_version, status (pending\|confirmed\|not_required), version |

_No uniqueness on (person, vehicle, date): multiple real entries per day are valid. Table exists since migration 0000; use cases arrive in M3._

### work_entry_revisions table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| (business_id, entry_id, version) | FK → work_entries(business_id, id) | SQLite table (append-only) | action, snapshot_json, actor fields (actor_kind, actor_session_id, actor_role, credential/platform_user id, on_behalf_of), created_at |

_No UPDATE/DELETE; reports never scan JSON._

### cash_confirmations table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | UNIQUE (business_id, entry_id, entry_version); FK → revision | SQLite table (append-only) | received_cents, confirmed_at, actor fields |

_Reports count only the confirmation whose entry_version = current version._

### mutation_receipts table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| (scope_key, request_id) | — | SQLite table | operation, request_hash, entity_id, result_version, response_code, created_at |

_scope_key = actor id + businessId + vehicleId; same key + same hash → replay, different hash → 409 REQUEST_ID_REUSED._

### admin_audit table

**Repos:** dolmus-takip

| PK | SK | Type | Attributes |
| --- | --- | --- | --- |
| id | CHECK: business_id NULL ⇒ vehicle_id and on_behalf_of_person_id NULL | SQLite table (append-only) | business_id?, vehicle_id?, entity_type, entity_id, action, before_json, after_json, actor fields, occurred_at |

_CHECK added in migration 0001 (table rebuild)._

### GSIs

**Repos:** dolmus-takip

| GSI name | PK | SK | Purpose |
| --- | --- | --- | --- |
| vehicles_plate_normalized_unique | plate_normalized | — | Plate login lookup |
| idx_work_entries_vehicle_period | business_id, vehicle_id | work_date, id | Vehicle period report + cursor pagination |
| idx_work_entries_person_period | business_id, person_id | work_date, id | Person report |
| idx_work_entries_vehicle_status_period | business_id, vehicle_id, status | work_date, id | Owner's pending (unconfirmed) list |
| cash_confirmations_business_entry_version_uk | business_id, entry_id | entry_version | Bind confirmation to exactly one version |
| vehicle_credentials_vehicle_role_uk | vehicle_id | role | One credential per role per vehicle |
| platform_users_username_unique | username | — | Staff login lookup |
| sessions_token_hash_unique | token_hash | — | Session validation |
| idx_sessions_expires_at | expires_at | — | Bulk cleanup of expired sessions |
| mutation_receipts PK | scope_key | request_id | Duplicate-submit detection |
| idx_admin_audit_business_period | business_id | occurred_at, id | Support/audit history per business |

_SQLite secondary/unique indexes stand in for GSIs (template column names kept). All exist in migrations; no index is added without EXPLAIN QUERY PLAN evidence on 5-year data._

### TTL

**Repos:** dolmus-takip

| Type | Duration | Field |
| --- | --- | --- |
| Vehicle session | 30 days absolute / 7 days idle | sessions.expires_at, last_seen_at |
| Staff session | 12 hours absolute / 30 min idle | sessions.expires_at, last_seen_at |
| last_seen write throttle | ≥ 5 min between writes | sessions.last_seen_at |
| Client draft + request_id | 24 hours (cleared on logout/session change) | browser localStorage (F6) |
| Login rate-limit window | 15 min sliding (in memory) | plate / username / IP counters |
| Local backup copies | last 2 verified copies | /var/lib/dolmus-takip/backup-ready/ |
| Lightsail snapshots | last 7 daily | AWS automatic snapshots |
| Financial records, revisions, confirmations, receipts | ≥ 5 years (no TTL) | work_entries / revisions / cash_confirmations / mutation_receipts |

_SQLite has no native TTL; expiry is enforced by checks at request time and cleanup jobs._

## API Endpoint List

### API Endpoint List

**Repos:** dolmus-takip

| Method | Path | Description | Auth required |
| --- | --- | --- | --- |
| POST | /api/v1/auth/vehicle-login | Plate + password session (implemented) | No; rate-limited, same-origin |
| POST | /api/v1/auth/platform-login | Personal staff login (implemented) | No; rate-limited, same-origin |
| POST | /api/v1/auth/logout | Revoke current session (implemented) | Session + CSRF |
| GET | /api/v1/session | Role, permissions, opaque scopeKey, CSRF token, plate/username (implemented) | Session |
| GET | /api/v1/health/live | Liveness without DB access (implemented) | Localhost only via Caddy |
| GET | /api/v1/health/ready | DB + schema readiness (planned) | Localhost only |
| GET / POST | /api/v1/admin/businesses | List / create business with owner (implemented). GET takes optional q (business or owner name, Turkish case folding, ≤ 100 chars), active = all\|active\|inactive, cursor and limit (1–100, default 50); newest business first; response { businesses, nextCursor } | Staff (business.manage) |
| GET / PATCH | /api/v1/admin/businesses/:businessId | Read / edit name, owner, active (implemented) | Staff (business.manage) |
| GET / POST | /api/v1/admin/vehicles | List all vehicles incl. inactive / create vehicle with plate, optional info and owner + driver passwords (implemented T2.2). GET takes optional q (plate in any spacing/case, business name or owner name), active, cursor and limit (1–100, default 50); ordered by plate; items add business { id, name, active }; response { vehicles, nextCursor } | Staff (vehicle.manage) |
| GET / PATCH | /api/v1/admin/vehicles/:vehicleId | Read / edit brand-model, year, route stop, note, active (implemented T2.2); plate, business and owner not editable | Staff (vehicle.manage) |
| POST | /api/v1/admin/vehicles/:vehicleId/reset-password | Reset owner or driver password with body { requestId, access: owner\|driver, newPassword }; revokes only that access's sessions (implemented T2.3) | Staff (vehicle.reset_password: admin/support) |
| GET / POST | /api/v1/admin/users | List all team accounts incl. inactive, ordered by username case-insensitively (id, username, fullName, platformRole, active, version; never a hash or credential_version) / create an account with body { requestId, username, fullName, platformRole: admin\|support, password }; username trimmed and lower-cased, 3–32 of a–z 0–9 . _ -, unique case-insensitively; 201 (implemented S2.6) | Platform admin only (platform_user.manage); support and vehicle sessions 403 |
| GET / PATCH | /api/v1/admin/users/:userId | Read / edit with body { requestId, version, fullName?, platformRole?, active? }; username not editable; active:false revokes all the account's sessions, reactivation restores none; the last active admin cannot be deactivated or demoted (422) (implemented S2.6) | Platform admin only (platform_user.manage); support and vehicle sessions 403 |
| POST | /api/v1/admin/users/:userId/reset-password | Body { requestId, newPassword }; revokes all the account's sessions (the acting admin's own too on a self-reset); response { user { id, username } } (implemented S2.6) | Platform admin only (platform_user.manage); support and vehicle sessions 403 |
| GET | /api/v1/admin/audit | Read-only admin/support history (implemented): optional businessId or vehicleId filter (vehicleId wins), cursor, limit (1–100, default 50); newest first; entries { id, occurredAt, action, entityType, entityId, business, vehicle, actor, targetUser, onBehalfOf, before, after }; targetUser { id, username } only on team-account rows, kept after the account is deactivated + nextCursor; secret-like keys stripped; GET only | Staff (audit.read: support/admin); vehicle sessions 403 |
| GET | /api/v1/drivers | Driver session: selectable drivers only (active assignment + active person, owners excluded; fields personId, fullName). Owner/staff: management view with inactive assignments and linkable candidates of the same business. Shape decided by permission; query parameters ignored (implemented S2.4) | Vehicle session for its own vehicle; staff with X-Target-Vehicle (driver.read_active) |
| POST | /api/v1/drivers | Add driver: body { requestId, fullName } creates one person + an active assignment on the scoped vehicle; 201 (implemented S2.4) | Owner or staff (driver.manage) |
| PATCH | /api/v1/drivers/:personId | Body { requestId, version, fullName?, active? }: rename keeps the person id and bumps version; active = global person (de)activation, staff only, response adds affectedVehicles (implemented S2.4) | Owner for people linked to its vehicle (rename only; active → 403) or staff (driver.manage; active needs person.set_global_active) |
| PUT | /api/v1/vehicles/:vehicleId/drivers/:personId | Body { requestId, active, version? }: links a person of the same business to the vehicle (201) or turns the same assignment row on/off (200); never creates a duplicate row (implemented S2.4) | Owner or staff (driver.manage); URL vehicleId must equal the session/target vehicle |
| POST | /api/v1/work-entries | Create work entry (implemented T3.4): body { requestId, workType: owner\|driver, workerPersonId (driver kind only), date, startTime, endTime, endsNextDay, grossCents, fuelCents, otherExpenseCents?, otherExpenseNote? }; person, kind, share and status are decided by the server; 201 { workEntry { id, version, status, workKind, workDate, startsAt, endsAt, durationMinutes, grossCents, fuelCents, otherExpenseCents, shareCents, remainderCents, otherExpenseNote, shareBps, calculationVersion, person { id, fullName } } } | Driver or owner session for its own vehicle; staff with X-Target-Vehicle; route permission work_entry.create_driver, kind permission work_entry.create_owner / work_entry.create_driver checked in the use case |
| GET | /api/v1/work-entries | List entries of the scoped vehicle (implemented T3.5): query workerPersonId (required for driver sessions and must be a selectable driver; optional filter for owner/staff), cursor, limit (1–100, default 50); newest work day first, keyset cursor over (work_date, id); driver sessions see only driver-kind entries whose person is still selectable (K1), owner/staff see every entry of the vehicle; response { workEntries, nextCursor } with the same entry shape as POST | Driver, owner or staff with X-Target-Vehicle (work_entry.read) |
| GET | /api/v1/work-entries/:id | Read one entry (implemented T3.5): same shape as the POST 201 workEntry; an unknown id, another vehicle's or business's entry and, for drivers, an owner-kind entry or one whose person is no longer selectable all get the same 404 WORK_ENTRY_NOT_FOUND | Driver (K1), owner or staff with X-Target-Vehicle (work_entry.read) |
| PATCH | /api/v1/work-entries/:id | Edit an unconfirmed entry (implemented T3.5): body { requestId, version, workType?, workerPersonId? (driver kind only), date, startTime, endTime, endsNextDay, grossCents, fuelCents, otherExpenseCents?, otherExpenseNote? }; the entry id travels only in the URL; 200 { workEntry } with version + 1; kind and status never change, share and remainder are recomputed by the server; a confirmed entry → 409 ENTRY_CONFIRMED | Owner or staff with X-Target-Vehicle (work_entry.edit_unconfirmed); driver only for a pending entry of today (K1) |
| POST | /api/v1/work-entries/:id/confirm | First received-amount confirmation (planned M4) | Owner/staff |
| POST | /api/v1/work-entries/:id/correct-and-confirm | Atomic correct + confirm (planned M4) | Owner/staff |
| GET | /api/v1/work-entries/:id/history | Versions and confirmations (planned) | Owner/staff |
| GET | /api/v1/reports/summary; /reports/people; /reports/vehicles | Period totals and breakdowns (planned M5) | Owner/staff |

_Status codes: 201 create, 200 update, 401/403/404/409/413/415/422/429/503; envelope { error: { code, message, fields? }, request_id }. Staff target on customer endpoints via X-Target-Vehicle header (403 for vehicle sessions). Cents travel as decimal integer strings. Vehicle endpoints (T2.2): POST writes vehicle + both vehicle_credentials + admin_audit + receipt in one BEGIN IMMEDIATE transaction; Argon2 hashing runs before it (429 HASH_QUEUE_FULL possible); the request hash excludes passwords, so a replay with the same request_id re-verifies both passwords against the stored hashes and returns 409 REQUEST_ID_REUSED on mismatch; duplicate plate (normalized) or identical owner/driver passwords → 422 fields; PATCH is optimistic on vehicles.version (409 VERSION_CONFLICT), same-value PATCH → 422, active:false revokes the vehicle's sessions in the same transaction and reactivation does not restore them; unknown vehicle → 404 TARGET_VEHICLE_NOT_FOUND; vehicle sessions get 403. Vehicle password reset (T2.3): newPassword is not trimmed and is excluded from the request hash; a replay with the same request_id re-verifies it against the stored post-reset hash (mismatch → 409 REQUEST_ID_REUSED) and returns 409 VERSION_CONFLICT when a later reset has superseded the receipt; newPassword equal to the other role's current password → 422 fields.newPassword; a concurrent change of either credential_version → 409 VERSION_CONFLICT; inactive vehicle → 403 TARGET_INACTIVE_FOR_WRITE; unknown vehicle → 404; vehicle sessions get 403; vehicles.version is not changed. Response { access, vehicle { id, plateNormalized }, business { id, name } }. A vehicle login whose password matched just before a reset is refused with the generic 401 INVALID_CREDENTIALS and opens no session. Driver endpoints (S2.4): every write is one BEGIN IMMEDIATE transaction with admin_audit rows and a receipt; same request_id + same body replays without a second write, a different body → 409 REQUEST_ID_REUSED. Bodies are scopeSafeObject: personId travels only in the URL. fullName is trimmed with inner whitespace collapsed and must be 1–120 chars (422 fields.fullName). Stale or missing version → 409 VERSION_CONFLICT; same-value PATCH/PUT → 422 fields.change; PUT with no existing row and active:false → 422, with a version → 409; two parallel links of the same person → one 201, one 409. A business or vehicle owner person cannot be a driver (PUT → 422 fields.personId, PATCH → 404); a globally inactive person cannot be linked or re-activated on a vehicle (422), closing stays allowed. Other-business or unknown person → 404 PERSON_NOT_FOUND; URL vehicleId different from the scoped vehicle → 404 TARGET_VEHICLE_NOT_FOUND. Driver sessions get 403 on POST/PATCH/PUT. Global person deactivation changes only people.active (assignment rows untouched). No driver write revokes sessions (shared driver password, F3). Audit actor: owner → vehicle_credential; staff → platform_user with on_behalf_of = the vehicle owner, except global person (de)activation which carries no vehicle and no on_behalf_of. Admin list and audit query parameters (admin support/audit change): parameters are read from the URL only; q longer than 100 chars, an unknown active value, a cursor with the wrong number of parts or undecodable, or a limit that is not a plain integer string in 1–100 → 422 VALIDATION_ERROR with fields; LIKE wildcards in q are plain text; paging is keyset (no offset), so rows are neither repeated nor skipped when new rows arrive between pages. Audit filter to an unknown business, an unknown vehicle or a vehicle of another business → 404; invalid uuid → 422; rows written without a business (CLI) appear only in the unfiltered list; the actor username is resolved even after all sessions are deleted; the response never carries passwords, hashes, tokens, cookies, CSRF values or session ids. Vehicle sessions get 403 on all three list endpoints. Team accounts (S2.6): the body field is platformRole because role is a forbidden client scope field; the actor's admin role is re-read inside the write transaction (demoted between guard and write → 403 FORBIDDEN, rolled back); a missing or stale version → 409 VERSION_CONFLICT, checked before the no-change 422 fields.change; password and newPassword are never trimmed and are excluded from the request hash, so a replay re-verifies them against the stored hash (mismatch → 409 REQUEST_ID_REUSED; superseded by a later reset → 409 VERSION_CONFLICT); a reset replay for a different target → 409 REQUEST_ID_REUSED; unknown user id → 404 NOT_FOUND; invalid username, full name or role → 422 fields. Name and role changes do not revoke sessions: a demoted admin's next /admin/users request gets 403 because the role is read fresh per request. reset-password does not change platform_users.version. Audit actions platform_user.create / update / role_change / deactivate / reactivate / reset_password carry username, fullName, platformRole and active only, with business_id and vehicle_id NULL, so they appear only in the unfiltered history. A staff login whose password matched just before a deactivation or reset is refused with the generic 401 INVALID_CREDENTIALS and opens no session. Work entry creation (T3.4): 201 is returned only after commit; the same requestId with the same normalized content (extra fields, whitespace and a workerPersonId on owner kind do not count) replays the same entry and status with no second row, also after the driver was deactivated, while a new requestId then gets 422; a different body → 409 REQUEST_ID_REUSED with no data change; 100 concurrent identical requests → one entry, all 201 with the same id; an identical body under a different requestId creates a second entry. Client-sent share, businessId and status are dropped. Invalid fields or requestId → 422 VALIDATION_ERROR with field keys and no receipt; missing or other-vehicle person → 422 fields.workerPersonId; driver session with owner kind → 403 FORBIDDEN; vehicle session sending X-Target-Vehicle → 403 TARGET_HEADER_NOT_ALLOWED; staff with an unknown target → 404 TARGET_VEHICLE_NOT_FOUND; no session → 401. Inactive vehicle or business: vehicle sessions get 401 for both a new entry and a replay, staff get 403 TARGET_INACTIVE_FOR_WRITE; a revoked session cannot read an old result (401); the same requestId under another actor or vehicle is a new scope and never returns the old result. A write lock held beyond busy_timeout → 503 SERVICE_UNAVAILABLE and the same requestId later yields exactly one entry; a failing INSERT into work_entries, work_entry_revisions, admin_audit or mutation_receipts leaves no row in any of them. Staff creation writes one admin_audit row work_entry.create (platform_user actor on behalf of the owner); owner and driver creation write none. Work entry read and edit (T3.5): GET query parameters are read from the URL only; an invalid limit, cursor or workerPersonId → 422 VALIDATION_ERROR with field keys; an empty list → 200 with nextCursor null. PATCH order inside one BEGIN IMMEDIATE transaction: receipt replay first (returns the committed result even after the person was deactivated or the entry confirmed), then the scoped lookup (404 WORK_ENTRY_NOT_FOUND, so an invalid body on an unknown entry gets 404, not 422), confirmed → 409 ENTRY_CONFIRMED even with the right version, stale version → 409 VERSION_CONFLICT before the no-change check, driver session on an entry of another day → 403 FORBIDDEN (Istanbul midnight boundary), then field errors 422 (workType different from the entry's kind → fields.workType, unselectable person → fields.workerPersonId, driver moving the date off today → fields.date) and identical values → 422 fields.change. Client-sent share, status, kind and business fields are dropped. Same requestId + same body replays with no second revision; a different body, another version, another entry or a create receipt under the same requestId → 409 REQUEST_ID_REUSED; two concurrent edits of the same version → one 200, one 409 and a single revision. A failing UPDATE, revision, audit or receipt write leaves the old entry intact and the same requestId later succeeds once. Owner and driver edits write no admin_audit; a staff edit writes one work_entry.update row with before/after daily fields and version and no secrets. No edit writes cash_confirmations. Vehicle sessions sending X-Target-Vehicle → 403, no session → 401._

## Cache Strategy

### Cache layers

**Repos:** dolmus-takip

- No shared persistent cache for financial records, reports, person lists or authorization data in v1.
- Session-specific API/page responses: Cache-Control: private, no-store; Caddy never caches them.
- Next.js content-hashed CSS/JS: long-lived immutable caching.
- Per-request memoization only (avoid recomputing scope within one request).

_ARCHITECTURE §5; private,no-store implemented in T1.4._

### Invalidation

**Repos:** dolmus-takip

After a mutation the affected screen re-queries the server. Stale screens (back button, old tab) cannot bypass optimistic version checks (409 on mismatch). No live connection or background polling in v1; screens refresh on open and via "Yenile". Offline sync is out of scope (K7).

_ARCHITECTURE §1.4, §5; DECISIONS K7._

## Security Checklist

### Security Checklist

**Repos:** dolmus-takip

| Control | Implementation |
| --- | --- |
| Password hashing | node-argon2 Argon2id m=19456 KiB, t=2, p=1, random salt; bounded hash queue 4 concurrent / 100 waiting / 10 s → 429 HASH_QUEUE_FULL |
| Brute force | Sliding 15 min counters: 20 failures per plate or username, 120 per IP (shared vehicle+staff bucket); 429 + Retry-After; no permanent lockout; IP from X-Forwarded-For only if TRUSTED_PROXY set |
| Enumeration | Unknown plate/user, inactive vehicle/business and wrong password → same 401 INVALID_CREDENTIALS; dummy Argon2 hash path; no role disclosure |
| Session token | 32 random bytes (base64url), SHA-256 stored; cookie dolmus_session HttpOnly, SameSite=Lax, Path=/, no Domain, Secure when APP_ORIGIN is https; never in URL/localStorage |
| Token rotation / revocation | New token per login; logout, password reset, credential_version bump and vehicle/business/staff deactivation revoke sessions in the same transaction |
| JWT secret | Not applicable — no JWT |
| Reset / verify token | Not applicable — no email tokens; password reset only via back office or server CLI (reset-admin-password) |
| Credential handover | New owner/driver passwords are sent to the customer manually by staff over WhatsApp, outside the app; the app never displays existing passwords and sends no message |
| CSRF | Same-origin check (Sec-Fetch-Site or Origin == APP_ORIGIN) + session-bound CSRF token (SHA-256(token + ':csrf:v1')) in X-CSRF-Token, constant-time compare; JSON content type (415), body ≤ 64 KB (413) |
| XSS / headers | Plain-text names/notes via React escaping; nonce-based CSP set in src/proxy.ts; no dynamic HTML; zod allowlist validation |
| Object authorization | Server-derived scope on every query; permission matrix (16 permissions × 4 actors); role/personId/businessId/ownerId forbidden in request bodies (scopeSafeObject); out-of-scope → 404, inactive target write → 403 TARGET_INACTIVE_FOR_WRITE |
| Tenant integrity | Composite (business_id, id) foreign keys reject cross-business links at DB level |
| Rate limiting | Login endpoints as above; Caddy request size limit |
| Secrets and logs | Passwords, hashes, tokens and cookies never logged or copied into audit/revisions; secrets in /etc/dolmus-takip with restricted permissions |
| Network | Only 80/443 public; Next and DB not internet-facing; SSH key auth with host verification; no GitHub secrets in client bundle |

_Custom auth ⇒ detailed checklist. Rows reflect ARCHITECTURE §6 plus implemented values from DECISIONS T1.2–T1.5; the credential handover row is the product owner's answer to F14._

### Personal data notice and deletion policy (KVKK)

**Repos:** dolmus-takip

Personal data in scope: full names of owners, co-drivers and people (people.full_name), staff usernames and names, vehicle plates, and the work/cash records linked to them.
Notice: a KVKK information notice tells customers which data is kept, why (daily income, expense, driver share and cash handover tracking), and that records are kept for at least five years.
Deletion request: the person's name is anonymised in place (people.full_name replaced); the person row, work entries, revisions, cash confirmations, receipts and audit history are not deleted, so reports and totals stay intact.
Retention: the ≥5-year record retention rule is unchanged; backup/snapshot rotation does not shorten it.

_Product owner accepted the proposed technical path as-is (closes DECISIONS.md F8 + F16: people.full_name anonymisation, financial records are never deleted). The legal wording of the notice text is outside the scope of this document (PRD §10). No anonymisation operation or notice page exists in the code yet._

## ADRs

### ADRs

**Repos:** dolmus-takip

- ADR-001: Single machine, single app, native install — one Lightsail VM with Caddy + one Node/Next process + local SQLite, systemd, no Docker
- ADR-002: Current record, immutable revisions and atomic cash confirmation — entry + revision + confirmation + receipt in one transaction; confirmations bound to entry_version
- ADR-003: Vehicle/role session separate from the person who actually worked — plate + two passwords, driver picked from list is not an identity proof; personal staff accounts with real actor audit

_Product decisions K1–K8 and version pins K9 are recorded in docs/DECISIONS.md and complement these ADRs._
