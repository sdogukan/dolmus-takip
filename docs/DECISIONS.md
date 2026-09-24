# Karar Kaydı (geliştirme oturumu)

**Tarih:** 2026-09-17 · **Karar veren:** Doğukan (ürün sahibi/geliştirici) · **Kaydeden:** Claude (orkestratör)

Bu dosya EPICS.md K1–K9 açık kararlarının kapanış kaydıdır. Kaynak öneriler ARCHITECTURE §10, PRD §10, DESIGN §2.11.

## K1–K8 — 2026-09-17 kabul edildi ("Hepsini kabul et")

| Kod | MVP kararı | Etkilediği paketler |
|---|---|---|
| K1 | Ortak şoför, aynı araçta seçtiği kişinin kayıtlarını listeler. Onaysız düzeltmeyi yalnız çalışma günü (work_date = bugün, Europe/Istanbul) yapabilir. Kişi seçimi kimlik kanıtı değildir. | S1.5, S3.5, S4.6, S5.4 |
| K2 | Sahip oturumu yalnız giriş yapılan aracı kapsar. Çok araçlı dashboard ilk sürümde yok. Sahibin araç bilgisi düzenleme yetkisi yok (ekip yapar). | S1.5, S2.2, S5.x |
| K3 | Gece geçişinde bitiş günü açıkça gösterilir. Süre 0 dk'dan büyük ve en fazla 24 saat (1440 dk). Kayıt work_date = başlangıç günü. Hafta pazartesi başlar. Dönem sınırları [başlangıç, sonraki başlangıç). Eşit saatler = bitiş ertesi gün (24 saat) değil; süre 0 reddedilir, gece geçişi için bitiş tarihi açıkça verilir. | S3.1, S5.2–S5.4 |
| K4 | Onaylı kayıtta driver↔owner sürüş türü dönüşümü ilk sürümde kapalı; correct-and-confirm aynı türde kalır, tür değişimi 422. | S4.3, S5.2 |
| K5 | Hesaplanan kalan negatifse olduğu gibi gösterilir, sıfıra çekilmez, kullanıcı açıkça uyarılır. Alınan tutar ayrı alan, ≥ 0. Borç/ödeme motoru yok. | S3.2, S4.1–S4.2, S5.x |
| K6 | Diğer masraf: tek tutar (other_expense_cents) + açıklama (other_expense_note). Kategori/kalem ve sigorta/vergi gibi bağımsız sahip giderleri ilk sürümde yok. | S3.2, S5.2–S5.4 |
| K7 | Çevrimdışı kuyruk yok. Sunucu bağlantısı şart. Form taslağı ve request_id sessionStorage'da korunur; sunucuda kaydedilmemiş işlem başarı gösterilmez. | S3.4, S3.6 |
| K8 | Araçta tek owner_person_id. Ortak sahiplik ve devir akışı ilk sürümde yok; geçmiş kayıtlar kendiliğinden dönüşmez. | S2.1–S2.2 |

## K9 — Kesin sürümler (2026-09-17, kanıtla sabitlendi)

Yerel ortam: macOS arm64, Node v24.18.0, npm 11.16.0. Hedef: Ubuntu LTS x86_64, Node 24 LTS (güncel 24.21.0).

| Paket | Sürüm | Kanıt |
|---|---|---|
| node | 24.x LTS (engines ">=24") | nodejs.org index: 24.21.0 aktif LTS "Krypton" |
| next | 16.3.5 | npm latest; engines node ≥20.9 |
| react / react-dom | 19.3.0 | next 16 peer ^19 |
| typescript | 5.9.3 | typescript-eslint peer "<6.1.0"; TS 7 (tsgo) eslint-config-next zinciriyle uyumsuz |
| drizzle-orm | 0.45.2 | peer better-sqlite3 ≥7 |
| drizzle-kit | 0.31.10 | npm latest |
| better-sqlite3 | 13.0.3 | Gömülü SQLite **3.53.4** ≥ 3.51.3 (ARCHITECTURE §3.6 kapısı) — `SELECT sqlite_version()` ile doğrulandı |
| argon2 | 0.45.1 | Argon2id m=19456,t=2,p=1 yerel derleme doğrulandı |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | npm latest |
| vitest | 5.0.1 | npm latest |
| @playwright/test | 1.63.0 | next 16 peer ^1.51.1 |
| zod | 4.6.5 | npm latest |
| eslint / eslint-config-next | 10.10.0 / 16.3.5 | npm latest |
| Paket yöneticisi | npm (package-lock.json) | QA-PLAN §3 `npm run ...` komutlarını kullanır |

K9'un kalan kalemleri (şifre teslim yöntemi, alan adı, AWS hesap erişimi, dış sağlık kontrolü, uyarı kanalı) M6/deploy aşamasında kullanıcıya sorulacak; uygulama içinde SMS/e-posta yok.

## Oturum kararları
- Commit stratejisi: her task paketi (T1.1, T1.2, ...) sonunda ayrı commit. Push yok; GitHub/deploy aşamasında sorulacak.
- **E2E kapısı, çalışma ortamına göre (2026-09-19, kullanıcı kararı, tüm sonraki paketler için geçerli):** WebKit sistem kütüphaneleri kurulamayan ortamlarda (ör. dijji-ai runtime container'ı: root yok, yalnız Chromium) paket kapısındaki E2E `npx playwright test --project=chromium` ile koşulur ve bu durum PROGRESS notunda belirtilir. WebKit dahil tam E2E (`npm run test:e2e`) GitHub Actions `ci.yml`'de her push/PR'da koşar; **CI yeşil olmadan PR merge edilmez**. `playwright.config.ts` değiştirilmez; bu durum için her pakette kullanıcıya yeniden sorulmaz.
- **E2E yalnız Chromium (2026-09-24, kullanıcı kararı — yukarıdaki 2026-09-19 E2E kapısı kararının yerini alır):** `playwright.config.ts`'ten `webkit` projesi, `ci.yml`/`release.yml`'den WebKit kurulumu kaldırıldı; E2E her yerde (dijji-ai container'ı, yerel, CI) aynı komutla, `npm run test:e2e`, yalnız Chromium'da koşar. Gerekçe: dijji-ai container'ında WebKit kurulamıyor; PR'lar yalnız Chromium ile doğrulanıp merge edildiği için main CI'ı PR #5–#27 boyunca yalnız WebKit testlerinden kırmızı kaldı. Yerel kanıt (macOS, WebKit): 47 testlik başarısız dosyalarda 4 hata, hepsi aynı test yarışı — `page.goto("/giris")` bir önceki `/giris` yönlendirmesi tarafından kesiliyor; `owner-summary`/`owner-reports` yerelde geçti. Uygulama hatası bulunmadı. iPhone Safari otomatik E2E ile değil, `tests/e2e/MANUAL-CHECKS.md` gerçek cihaz kontrolleriyle doğrulanır.
- **CI düzeltmesi (2026-09-19):** `ci.yml`/`release.yml` iş düzeyi `env`'de `${{ runner.temp }}` kullandığı için GitHub iş akışını reddediyordu (tüm koşular 0 sn, "workflow file issue"; actionlint: context "runner" is not allowed here). DB yolu adım düzeyinde `$RUNNER_TEMP` ile `GITHUB_ENV`'e yazılır; tests/unit/ci-workflows.test.ts bunu kilitler. Bu tarihten önce merge edilen PR'lar (#1, #2) CI'dan geçmemiştir.

## Faz 0 inceleme bulgularından çıkan mühendislik kararları (2026-09-17)

Faz 0: 14 doküman, 7 mercek, 38 aday bulgu, 3'lü çürütme; 20 birleşik bulgu. Hiçbiri M1'i engellemiyor. Kararlar:

| # | Bulgu | Karar | Uygulanacağı paket |
|---|---|---|---|
| F1/F2/F19 | DECISIONS.md kararları PRD/ARCH/DESIGN/EPICS/ADR'lere yansımamış; PRD §5'te K2 ile çelişen parantez | Dokümanlara "2026-09-17 karar durumu → DECISIONS.md" notu; PRD §5 parantezi K2 ile uyumlu | Faz 0 doküman senkronu |
| F3 | Şoför araçta pasife alınınca ortak şoför şifresi geçerli kalır (model gereği) | Sahip ekranında uyarı: "Ortak şoför şifresi hâlâ geçerli. Erişimi tamamen kesmek için ekipten şifre sıfırlama isteyin." Ekip ekranında pasife alma yanında şifre sıfırlama bağlantısı | T2.4, T2.3 |
| F4 | Native modül paketleme modu belirsiz | Next.js `output: 'standalone'` + `outputFileTracingIncludes` (better-sqlite3, argon2). CI'da standalone çıktısında `require` + `SELECT sqlite_version()` ≥ 3.51.3 doğrulaması | T1.1, T6.1 |
| F6 | request_id yalnız sessionStorage'da; iOS sekme kapanınca çift kayıt riski | Taslak + request_id **localStorage**'da; anahtar = credential/platform_user kimliği + araç; TTL 24 saat; çıkış/oturum değişiminde temizlenir. ARCH §3.4 "tutulabilir" → bu şekilde tutulur | T3.4, T3.6 |
| F7 | 409 metni ARCH ile DESIGN'da farklı | Kanonik metin DESIGN: "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et." | Doküman senkronu; T3.5, T4.3 |
| F10 | Rol seçimsiz giriş = deneme başına ≤2 Argon2 doğrulaması | Hash kuyruğu kapasitesi hash işlemi başına sayılır; M6 yük testinde hash işlem sayısı ayrı raporlanır | T1.2, T6.6 |
| F11 | İlk yönetici erişimi kaybolursa kurtarma yok | Yerel CLI: `create-first-admin` (idempotent, S1.3) + `reset-admin-password --username` (yalnız sunucu shell, admin_audit'e yazar, public endpoint yok) | T1.3 |
| F15 | Başarısız giriş sayacı plaka bazlı; şoför hataları sahibi de yavaşlatabilir | ARCH §6 değerleri korunur (20 plaka/15 dk, 120 IP/15 dk); bilinçli trade-off; M6'da meşru engellenme raporlanır | T1.2 |
| F17 | "İşletme/araç genelinde çalışma günü" metriği adsız | "Araç çalışma günü" = dönemde en az bir kayıt olan farklı work_date sayısı; kişi çalışma günü kişi bazlı COUNT(DISTINCT work_date) | T5.2, T5.3 |

### M6 / deploy aşamasına ertelenenler
- F5: Şema uyumsuz migration + yeni yazma sonrası "ileri düzeltme" prosedürü → **Çözüldü (T6.5, 2026-09-24):** [RELEASE.md](RELEASE.md) §7 "İleri düzeltme (F5)". `scripts/release-apply.ts` trafik açıldıktan (`traffic_opened_at`), DB parmak izi değiştikten veya yayın durumu okunamadığında eski DB'ye dönüşü reddeder; düzeltme bakım altında `deploy --under-maintenance` ile yeni release olarak yayımlanır, eski kopyaya dönüş yalnız insan kararıyla OPS §4-B yoludur.
- F8 + F16: KVKK aydınlatma metni ve silme/anonimleştirme politikası → deploy öncesi **kullanıcıya sorulacak** (teknik yol: people.full_name anonimleştirme, mali kayıt silinmez).
- F12: Ağır rapor sorgusu + eşzamanlı health-check senaryosu T5.5/T6.3 testine eklenecek; rapor aralığı ≤1 takvim yılı sınırı korunur.
- F13: Giriş sayacı ve Argon2 kuyruk izleme satırları OPS.md'ye T6.3'te eklenecek.
- F14: Şifre teslim yöntemi → deploy öncesi kullanıcıya sorulacak.
- F20: Plaka yeniden tahsisi MVP dışı; backlog notu. plate_normalized UNIQUE koşulsuz kalır.

## T1.1 uygulama kararları (2026-09-17)
- ESLint: eslint 10.10.0 + eslint-config-next 16.3.5 zinciri (eslint-plugin-react 7.37.5, vendored babel parser) ESLint 10 ile çöküyordu (vercel/next.js#89764, jsx-eslint/eslint-plugin-react#4018). Kök neden düzeltmesi eslint.config.mjs'de: settings.react.version = '19.3.0' (detect kapatıldı) ve tüm JS/TS dosyaları typescript-eslint parser'ına bağlandı. Hiçbir kural kapatılmadı, paket sürümü değişmedi.
- vehicles sütunları: brand_model, year, route_stop, note (PRD §6 + TASKS T2.2 + DESIGN §2.9).
- Sabit değerler: platform_role ∈ {admin, support}; actor_kind ∈ {vehicle_credential, platform_user}; actor_role ∈ {owner, driver, admin, support}; work_kind ∈ {driver, owner}; status ∈ {pending, confirmed, not_required}. CHECK kısıtlarında.
- admin_audit: business_id NULL iken vehicle_id/on_behalf_of_person_id NULL olmak zorunda (CHECK); migration 0001.
- Scripts ESM: scripts/ ve src/server/data/ altında {"type":"module"} package.json; tsconfig allowImportingTsExtensions; Node 24 yerleşik TS çalıştırma. Kök package.json "type" alanı yok (Next etkilenmesin).
- Seed üretim koruması NODE_ENV==='production' kontrolüne dayanır → T6.2 systemd env dosyasında NODE_ENV=production ZORUNLU (RELEASE/OPS'a T6.2'de yazılacak).
- CSP: nonce tabanlı, src/proxy.ts (Next 16'da middleware.ts yerine proxy.ts); x-nonce request header'ı yazılır.
- Yeniden adlandırılmış kişi senaryosu seed'de people.version=2 ile temsil; gerçek ad geçmişi admin_audit ile T2.4'te.

## T1.4 uygulama kararları (2026-09-17)
- Oturum tokenı: crypto.randomBytes(32) base64url; DB'de yalnız SHA-256 hex özeti. Çerez `dolmus_session`: HttpOnly, SameSite=Lax, Path=/, Domain yok, Max-Age = kalan mutlak süre. **Secure bayrağı (2026-09-17 güncellendi, T1.2 ek):** APP_ORIGIN şeması `https:` ise Secure, `http:` ise değil; NODE_ENV'e bağlı DEĞİL. Üretimde APP_ORIGIN https olduğundan Secure zorunlu kalır; E2E/dev http'de tarayıcı çerezi kabul eder.
- Süreler ARCH §6 birebir (araç 30 gün / 7 gün hareketsizlik; ekip 12 saat / 30 dk). Sınırlar yarı açık: now >= limit → geçersiz. last_seen_at en az 5 dk aralıkla yazılır.
- CSRF tokenı = SHA-256(hamOturumTokenı + ':csrf:v1'); ayrı sütun yok. GET /api/v1/session ile verilir, yazma isteklerinde X-CSRF-Token header'ında beklenir; karşılaştırma sabit zamanlı.
- Hata kodları: 401 SESSION_MISSING (token yok/eşleşmiyor) | SESSION_EXPIRED (yalnız zaman aşımı) | SESSION_REVOKED (revoked_at, credential_version uyuşmazlığı, işletme/araç/ekip pasifliği). 403 ORIGIN_INVALID | CSRF_TOKEN_INVALID. 415 Content-Type application/json değilse. 413 gövde > 64 KB (akış içinde sayılır, önce belleğe okunmaz). 503 SQLITE_BUSY/LOCKED ve migration bekliyor.
- JSON zarfı (tüm API): hata `{ error: { code, message, fields? }, request_id }`, başarı `{ ...veri, request_id }`. Sunucu her istek için request_id üretir; console log satırları request_id taşır (OPS).
- Oturuma özel yanıtlar `Cache-Control: private, no-store` (ARCH §5).
- Aynı kaynak denetimi: Sec-Fetch-Site same-origin VEYA Origin == APP_ORIGIN (zorunlu env, sessiz varsayılan yok; Next request.url Caddy arkasında 127.0.0.1:3000 döndüğü için isteğin url'inden türetilemez). **T6.2 deploy:** systemd env: `APP_ORIGIN=https://<alan-adı>`, `HOSTNAME=127.0.0.1`, `NODE_ENV=production`, `DOLMUS_DB_PATH=/var/lib/dolmus-takip/data/app.sqlite`.
- POST /auth/logout geçerli oturum + CSRF ister (401/403 aksi halde); idempotent 200 değildir. İstemci çıkışta yerel durumu her hâlükârda temizler.
- GET /session istemciye sessionId/credentialId/platformUserId VERMEZ. client-state (F6) anahtarı için T1.5'te yanıta gizli olmayan opak `scopeKey` (sunucuda türetilen kısa hash) eklenir.
- Erişim kullanım durumları src/server/usecases/access/*: bumpCredentialVersion, setVehicleActive, setBusinessActive, setPlatformUserActive, setPlatformUserRole, bumpPlatformUserVersion — ilgili oturum iptaliyle aynı BEGIN IMMEDIATE transaction'ında (ortak yardımcı). M2 ekranları bunları kullanır.
- Açılış: src/instrumentation.ts register → getAppDb → assertMigrationsApplied (migration bekliyorsa açık hata, otomatik migration yok); next.config outputFileTracingIncludes'a drizzle/** eklendi (standalone).
- Route handler'lar düz Request/Response ile yazılır (next/headers kullanılmaz) → doğrudan test edilebilir.
- src/lib/messages.ts: hata kodu → ekran metni; SESSION_EXPIRED ve SESSION_REVOKED aynı metne ('Oturumun sona erdi. Yeniden giriş yap.') eşlenir; sunucu error.message ekrana basılmaz.

## T1.5 uygulama kararları (2026-09-17)
- Yetki matrisi kod olarak: src/server/auth/permissions.ts, 16 izin × 4 aktör (driver ⊂ owner ⊂ support ⊂ admin); authorize(scope, permission) → 403. Kapsam dışı nesne → 404; oturum yok → 401.
- Staff hedefi: müşteri uçlarında `X-Target-Vehicle` header'ı (sunucu business_id'yi türetir); /admin/* uçlarında path ID. Araç oturumundan gelen X-Target-Vehicle → 403 TARGET_HEADER_NOT_ALLOWED. Global admin işlemleri (/admin/users) Scope kurmadan permissionsForActor ile denetlenir.
- Pasif hedefe yazma → **403 TARGET_INACTIVE_FOR_WRITE** (404 değil: nesne gerçek ve okunabilir, yalnız bu işlem yasak). Okuma için pasif hedef kabul. Yeniden aktifleştirme işlemleri için recheck istisnası tanımlı (staff business/vehicle.manage).
- İstemci gövdesinde role/personId/businessId/ownerId alanları şema düzeyinde yasak (zod scopeSafeObject); fazladan alanlar düşürülür.
- recheckScopeInTransaction: BEGIN IMMEDIATE içinde oturum iptali/süre/credential_version/aktiflik yeniden denetlenir; ihlalde throw → rollback.
- Makbuz kapsamı (ARCH §3.4): scope_key = (credentialId|platformUserId) + ':' + businessId + ':' + vehicleId; aynı request_id + aynı hash → replay; farklı hash/operation → 409 REQUEST_ID_REUSED; makbuz okumada da yetki denetimi.
- GET /session: `permissions` listesi ve opak `scopeKey` (SHA-256(kind:id:vehicleId)[:16]) eklendi; ayrı `actor` alanı yok (role yeterli). Staff oturumunda hedef bilinmediğinden scopeKey hedefsizdir; istemci F6 anahtarını scopeKey + ':' + hedef vehicleId ile kurar. Araç oturumu için T1.2'de `plate` (görüntü biçimi) eklenecek.
- ARCH §4 dışı endpoint açılmaz: GET /vehicles/current denemesi kaldırıldı; plaka /session ile verilir.
- withProtectedRoute({permission, write?, target}) deseni src/server/http/handler.ts; E2–E5 uçları bunu kullanır. target:'business' dalı T2.1'de gerçek uçla yeniden doğrulanacak.
- API'de plaka normalize (boşluksuz) döner; boşluklu gösterim ekranın işidir (formatPlateForDisplay).

## T1.2 uygulama kararları (2026-09-17)
- Araç girişi: rol istemciden alınmaz; owner ve driver hash'leri sırayla doğrulanır; bilinmeyen/pasif plakada sabit dummy Argon2id hash'ine karşı doğrulama (≤2 hash/deneme, F10). Bilinmeyen plaka, pasif araç/işletme ve yanlış parola aynı 401 INVALID_CREDENTIALS ('Plaka veya şifre yanlış.').
- Hız sınırı (ARCH §6 birebir): normalize plaka başına 20 / 15 dk, IP başına 120 / 15 dk, kayan pencere, yalnız gerçek kimlik doğrulama denemeleri sayılır (422 sayılmaz), kalıcı kilit yok, 429 RATE_LIMITED + Retry-After. Sayaç haritaları süresi dolanları budar (bellek sınırı). IP: TRUSTED_PROXY env tanımlıysa X-Forwarded-For'un ilk değeri; **T6.2 deploy:** `TRUSTED_PROXY=127.0.0.1`.
- Argon2 kuyruğu: 4 eşzamanlı / 100 bekleyen / 10 sn; aşım 429 HASH_QUEUE_FULL. Metrik loglama OPS'a T6.3'te (F13).
- POST /api/v1/auth/vehicle-login: 201; oturumsuz yazma için requireAnonymousWrite (origin + JSON + gövde sınırı, CSRF yok); girişte aynı tarayıcıdaki eski oturum iptal edilir (S1.4 AC2).
- GET /session araç oturumu için `plate` (görüntü biçimi) döner.
- Sayfalar: `/` oturum yoksa /giris, varsa role göre /sofor | /sahip; rol uyuşmazsa role uygun sayfaya yönlendirme. /giris geçerli oturumda otomatik yönlendirme yapmaz (DESIGN §1 yalnız kök adres için ister). Platform oturumu için hedef /yonetim T1.3'te; o zamana kadar /giris'e düşer.
- M1'de /sofor ve /sahip sahte form/rapor içermez; dürüst durum metni + plaka + Çıkış.
- E2E: Playwright chromium + webkit; ayrı geçici test DB (global-setup webServer komut zincirinde çalışır, çünkü Playwright webServer'ı globalSetup'tan önce başlatır); **sunucu `node .next/standalone/server.js`** (next start, output:standalone ile desteklenmez); standalone hazırlığı (.next/static + public kopyası) yeniden kullanılabilir script ile (T6.1 de kullanır); APP_ORIGIN=http://127.0.0.1:3100 → çerez Secure değil.

## T1.3 uygulama kararları (2026-09-17)
- İlk yönetici: `npm run platform-admin -- create-first-admin --username <ad> --password-stdin` yalnız sunucu shell'inden; tekrar çalıştırma çoğaltmaz/değiştirmez ('zaten var', exit 0). admin_audit: action platform_user.bootstrap, aktör = yeni yöneticinin kendisi. `reset-admin-password --username` (F11): credential_version +1 → oturumlar iptal, audit platform_user.reset_password.
- Platform login: username normalize; bilinmeyen/pasif kullanıcıda dummy hash; 401 INVALID_CREDENTIALS 'Kullanıcı adı veya şifre yanlış.'; hız sınırı anahtarı `platform:<username>` 20/15 dk. **IP kovası araç ve ekip girişi arasında ortaktır** (120/15 dk): aynı IP'den gelen toplam kötüye kullanım tek sayaçta; ARCH §6 'IP bazında' ifadesinin yorumu, kabul edildi.
- GET /session platform oturumunda `username` döner; /yonetim başlığında username + rol etiketi (Yönetici/Destek).
- Ortak LoginForm bileşeni src/app/_components (araç/ekip varyantı; serileştirilebilir prop'lar, RSC sınırı). Platform oturumu `/`, `/sofor`, `/sahip` → /yonetim.
- scripts/ saf Node ESM: src/server/auth ve src/server/usecases altına {type:module} package.json, göreli import'larda açık .ts uzantısı (T1.1 deseni).

## T1.6 uygulama kararları (2026-09-17)
- Giriş formu erişilebilirlik: alan hatası aria-describedby/aria-invalid + ilk hatalı alana odak; genel hata role=alert; bekleme sr-only aria-live=polite; hata metinlerinde renk dışı ikon; focus-visible halkası; enterkeyhint; odaklanan alan scrollIntoView.
- 5xx ve ağ hatası istemcide tek genel metne eşlenir ('Bağlantı kurulamadı. Tekrar dene.'); sunucunun 5xx mesajı ekrana basılmaz (teknik ayrıntı sızmaz).
- Kontrast kanıtı: src/lib/contrast.ts + birim testleri DESIGN §3 token çiftlerini WCAG AA (≥4.5:1) ile doğrular.
- Yardım metni ('Giriş yapamıyorsan hesabını açan ekipten yardım al.') hem araç hem ekip girişinde görünür (S1.6 AC7).
- Playwright: globalTimeout 15 dk, timeout 30 sn, expect 5 sn, actionTimeout 15 sn, navigationTimeout 30 sn, webServer stdout/stderr pipe. WebKit masaüstü varsayılanı düğmeleri Tab sırasına almaz; Tab sırası Chromium'da, odak görünürlüğü her iki tarayıcıda test edilir.
- QA-PLAN §5 manuel telefon kontrolleri: tests/e2e/MANUAL-CHECKS.md (pilotta gerçek cihazla doldurulacak).

## T6.1 uygulama kararları (2026-09-17)
- `npm run release:build`: kirli çalışma ağacında reddeder (--allow-dirty yok, S6.1 AC4); kendi içinde kalite kapısı (typecheck → lint → test:unit → test:integration [release-build meta-testi hariç]) koşar (S6.1 AC3); temiz next build + prepare-standalone; standalone'un kendi node_modules'undan better-sqlite3/argon2 yükleme ve `SELECT sqlite_version()` ≥ 3.51.3 kapısı; gizli/veri dosyası taraması (dosya ve dizin adları); arşiv `dist/dolmus-takip-<sha>-<platform>-<arch>.tar.gz` + `<aynı ad>.manifest.json` (source_commit, lockfile_sha256, node/next/sqlite sürümü, schema migration hash listesi, artifact_sha256/size, built_at).
- Arşiv standalone + drizzle/** + scripts/db-init + src/server/data/{db,schema}.ts (db-init'in çalışması için) içerir; next.config outputFileTracingIncludes'a node_modules/drizzle-orm/** eklendi (migrator route'lardan import edilmediği için taşınmıyordu).
- `npm run release:verify -- <tar.gz>`: hash/boyut/platform-arch eşleşmesi, gizli dosya yokluğu, arşivin kendi db-init'i ile geçici DB, standalone server.js → /api/v1/health/live 200. Farklı platformda doğrulama reddedilir (Linux x86_64 çıktısı yalnız CI'da).
- GitHub Actions: `.github/workflows/ci.yml` (push + PR, ubuntu-24.04, Node .nvmrc, timeout 30 dk, concurrency, en-az-yetki permissions, secret yok, artifact retention 14 gün, Playwright raporu yalnız hatada 7 gün); `.github/workflows/release.yml` yalnız workflow_dispatch(ref), artifact 30 gün, deploy adımı YOK (SSH yayını T6.2/T6.5 manuel). Adım listesi tek kaynak `scripts/ci-steps.json`; `npm run ci:local` aynı sırayı yerelde koşar; tests/unit/ci-workflows.test.ts metinsel doğrular. Gerçek Actions koşusu push sonrası (deploy aşamasında sorulacak).

## T2.1 uygulama kararları (2026-09-18)
- `business_owners` tablosu: PK tek başına `business_id` (bir işletmenin en fazla bir sahibi olur; satırın YOKLUĞU "sahipsiz" anlamına gelir), birleşik FK `(business_id, person_id) -> people(business_id, id)` — vehicles.owner_person_id ile AYNI desen. Sahip DEĞİŞTİRİLEMEZ, yalnız sahipsizken bir kez atanır (devir/ortaklık K8 kararıyla uyumlu, MVP dışı).
- `businesses.version`: migration YALNIZ `ALTER TABLE ADD COLUMN` (+ `CREATE TABLE business_owners`) üretecek şekilde eklendi; people/vehicles'taki gibi bir `CHECK(version >= 1)` BİLEREK eklenmedi — SQLite bir var olan tabloya CHECK eklemeyi yalnız tam tablo yeniden oluşturarak destekler ve `businesses` insanların/araçların/audit'in ebeveynidir (dolu DB'de DROP TABLE FK ihlaline düşerdi). Bu, entegrasyon testiyle (0000+0001 uygulanmış + veri içeren bir DB'ye 0002'nin hatasız uygulanması) kanıtlandı.
- POST oluşturmada henüz bir hedef işletme YOKTUR: `../auth/scope.ts` `StaffActorScope` (yalnız `platformUserId`, businessId/vehicleId YOK) eklendi; `computeReceiptScopeKey`/`recheckScopeInTransaction`/`findReceipt`/`resolveReceipt` artık `ReceiptScope = Scope | StaffActorScope` kabul eder — `businessId`/`vehicleId` YOKSA o alana bağlı aktiflik denetimi atlanır, aktörün KENDİ oturum/credential geçerliliği HER ZAMAN denetlenir. Var olan hiçbir çağıran (tam `Scope` geçen T1.x kullanım durumları) etkilenmez.
- Reaktivasyon istisnası (`RecheckScopeOptions.skipBusinessActiveCheck`) `findReceipt`/`resolveReceipt`'e de bir parametre olarak taşındı: aksi halde `PATCH .../businesses/:id { active: true }`'ın İLK (replay olmayan) denemesi, henüz hiçbir makbuz aranmadan, idempotency katmanının kendi sıkı denetiminde 403 TARGET_INACTIVE_FOR_WRITE'a düşerdi. Varsayılan `{}` var olan davranışı korur.
- `setBusinessActive`/`runAccessChangeTransaction`'a DOKUNULMADI (üç entegrasyon testinin bağımlı olduğu dış imza/davranış korunur, T2.1 risk notu). Admin PATCH akışı `revokeSessionsForBusinessSync`'i (zaten bağımsız export edilmiş sync çekirdek) KENDİ transaction'ında, sürüm kontrolü ve audit ile birlikte doğrudan çağırır — ayrı bir "iç yardımcıya ayırma" refactörüne gerek kalmadı.
- "Aynı değerle PATCH" (değişiklik yok): `name`/`active` yalnız GERÇEKTEN mevcut değerden farklıysa değişiklik sayılır (businesses.version artar, audit yazılır); hiçbir alan gerçek değişiklik getirmiyorsa (hepsi aynı) 422 VALIDATION_ERROR `{ change: "Değişiklik yok." }` döner, sürüm artmaz, audit yazılmaz. Sahip atama/adı düzeltmesi bu "aynı değer" muafiyetine TABİ DEĞİLDİR (yapısal işlemlerdir, kendi hata sınıflarıyla — "zaten bir sahibi var" / "sahibi yok" — ayrıca korunur).
- Mevcut kişiyi sahip atamak için istemci alanı `existingPersonRef` (yasaklı `personId` adıyla ÇAKIŞMAZ, scopeSafeObject bunu zorunlu kılar); sunucu bu kimliğin path'teki `businessId`'ye ait VE aktif olduğunu doğrular (422 aksi halde) — `business_owners_person_fk` birleşik FK'si İKİNCİ savunma hattıdır.
- Her PATCH `businesses.version`'ı en az bir kez artırır (owner-only değişikliklerde de) — version, tüm PATCH ucunun TEK iyimser eşzamanlılık jetonudur; `people.version` (sahip adı) AYRI ve ek bir jetondur.
- POST her zaman bir sahiple birlikte işletme oluşturur (owner.fullName zorunlu); "sahipsiz işletme" durumu yalnız PATCH'in ownerAssignment akışının hedeflediği bir ARA durumdur (test verisinde bir POST sonrası business_owners satırı elle silinerek simüle edildi).

## T2.2 uygulama kararları (2026-09-23)
- `src/app/api/v1/admin/_http.ts` eklendi: T2.1'in `businesses/_http.ts`'inde yaşayan, ALANA ÖZGÜ OLMAYAN kısımlar (JSON gövde ayrıştırma, oturum/kapsam/makbuz/DB-kilidi hata zarfı + T2.2'nin eklediği `HashQueueFullError` → 429 `HASH_QUEUE_FULL` eşlemesi) bu paylaşılan modüle çıkarıldı; `businesses/_http.ts` ve yeni `vehicles/_http.ts` bunu SARAR, yalnız kendi alana özgü hata sınıflarını/alan mesajlarını taşır. Durum kodu/kod/mesaj davranışı businesses ucunda BİREBİR aynı kaldı (`tests/integration/admin-businesses-routes.test.ts` değişmeden geçer).
- POST /admin/vehicles'ın hedef işletmesi (`businessRef`) gövdeden gelir ve OLUŞTURMA ANINDA zaten VARDIR (T2.1'in "henüz hiçbir hedef yok" durumundan FARKLI) — bu yüzden `StaffActorScope` yerine, `businessRef`in transaction İÇİNDE doğrulanmasından SONRA kurulan tam bir `StaffScope` (vehicleId YOK) kullanılır; makbuz kapsamı böylece T2.1'in businessId'siz makbuzlarından ayrılır.
- Parola alanları `request_hash`'e HİÇ dahil edilmez (ARCH §6 — kısa parolanın SHA-256'sı çevrimdışı kırılabilir); bunun bedeli, aynı requestId+FARKLI parolalarla yapılan bir tekrar gönderimin hash karşılaştırmasıyla YAKALANAMAMASIDIR. Bunu kapatmak için `createVehicle`, bilinen bir makbuzla karşılaşınca (transaction'a girmeden, salt okunur bir ön bakışla) gönderilen iki parolayı da saklanan Argon2 özetlerine karşı (hash kuyruğu üzerinden, `verifyReplayPasswords` paylaşılan yardımcısıyla) DOĞRULAR; eşleşmezse 201 yerine 409 REQUEST_ID_REUSED döner. Ön bakış ile asıl yazma transaction'ı arasındaki (aynı requestId'nin GERÇEKTEN eşzamanlı iki isteğiyle sınırlı) dar yarış penceresinde de doğrulama ATLANMAZ: transaction-içi `resolveReceipt`'in `replay: true` bulduğu dal, Argon2'yi senkron transaction İÇİNDE ÇALIŞTIRAMAYACAĞI için yalnız bir replay İŞARETİ (`entityId` + `responseCode`) döner; `createVehicle` bu işareti transaction COMMIT olduktan SONRA AYNI `verifyReplayPasswords` yardımcısıyla (transaction dışında) doğrular ve eşleşmezse 409 REQUEST_ID_REUSED döner. Böylece hem ön bakış hem transaction-içi replay yolu AYNI garantiyi taşır (C2 düzeltmesi — bkz. `tests/integration/admin-vehicles-routes.test.ts` yarış testi).
- Araç plaka tekilliği: transaction İÇİNDE önce bir SELECT ile denetlenir (BEGIN IMMEDIATE diğer yazarları zaten serileştirdiğinden bu tek başına yeterlidir); AYRICA `vehicles.plate_normalized` UNIQUE ihlali (`SQLITE_CONSTRAINT_UNIQUE`) ayrıca yakalanıp 422 `fields.plate`'e çevrilir — savunma derinliği, hiçbir yol ham `SqliteError`'ı istemciye sızdırmaz.
- PATCH /admin/vehicles/:id işletme aktiflik denetimini HİÇBİR ZAMAN atlamaz (yalnız `active: true` gönderildiğinde ARACIN kendi aktiflik denetimi atlanır) — bu uç işletmeyi aktive ETMEZ, yalnız T2.1'in kendi PATCH'i işletmeyi aktive edebilir.
- Giriş/pasifleştirme yarışı (risk notu): `createVehicleSession` artık `vehicles.active`/`businesses.active`'ı `sessions` INSERT'iyle AYNI BEGIN IMMEDIATE transaction içinde YENİDEN okur (önceden yalnız `vehicle-login.ts`'in Argon2 doğrulamasından ÖNCEKİ tek okumasına güveniyordu). Hedef o anda pasifse yeni `VehicleSessionTargetInactiveError` fırlatılır; `vehicleLogin` bunu YAKALAYIP diğer TÜM başarısız giriş nedenleriyle (bilinmeyen plaka, yanlış parola) AYNI genel 401 `INVALID_CREDENTIALS` yanıtına çevirir (ARCH §6 "hangi durum gerçekleşti asla ayırt edilemez" ilkesi) — hız sınırı sayacı bu durumda ARTIRILMAZ (parola gerçekten eşleşti, bu yanlış deneme değildir). `createVehicleSession`'ın `db` parametresi bu yüzden `BetterSQLite3Database<Schema>`'DAN `AppDatabase`'e genişletildi (`$client` erişimi gerekli); var olan tüm çağıranlar zaten `AppDatabase` geçiyordu, davranış/imza dışarıdan DEĞİŞMEDİ.

## T6.2 elle kurulum kararı (2026-09-24)
- Gerçek makineye ilk kurulum, otomasyonla değil, `docs/SERVER-SETUP.md` adım adım izlenerek **elle** yapılır. Rehber değişkenlerle (`DOLMUS_DOMAIN`, `AWS_PROFILE`, `AWS_REGION`, instance/static IP adları, SSH anahtarı) açılır; komutlarda gerçek alan adı veya hesap numarası bulunmaz, her `aws lightsail` komutu `--profile`/`--region` taşır, bundle/blueprint kimlikleri çıktıdan seçilir.
- Bu depo AWS'ye komut çalıştırmaz ve kaynak oluşturmaz; rehberdeki komutlar hazırlandı ama DENENMEDİ işaretlidir (RELEASE §5). Manuel doğrulama tablosu (SERVER-SETUP §5) elle kurulumda doldurulur; o zamana dek sistem **pilot için hazır değildir**.
- `scripts/platform-admin.ts` (ve import ağacı) yayın arşivine girer ve `release:verify` arşivden `create-first-admin`'i geçici DB'de çalıştırır: eksik bir dosya yalnız sunucuda değil, yayın doğrulamasında patlar. İlk yönetici parolası stdin'den verilir.
- Önceki gerçek makine denemeleri (ISSUE-24/25/26/28) elle kurulum tamamlanana dek ertelendi; ISSUE-29 göndermeleri "manuel kurulumda denenecek" durumuyla değiştirildi.

## Yayın boru hattı testi ayrı komutta (2026-09-24)
- `tests/integration/release-build.test.ts` → `tests/release/release-build.test.ts`, yeni `release` Vitest projesi ve `npm run test:release`. Sebep: ilk iki testi birer tam `release:build` koşar, o da kalite kapısında `test:integration`'ı yeniden çalıştırır; dosya tek başına ~20 dk sürüyor, rutin entegrasyon paketinin %72'sini oluşturuyordu.
- CI (`scripts/ci-steps.json`, `ci.yml`, `release.yml`) `test:release`'i `test:integration`'dan hemen sonra ayrı adım olarak koşar; kapsam değişmedi, hiçbir test atlanmadı.
- `release:build` kalite kapısı artık `npm run test:integration`'ı olduğu gibi çağırır; meta-test ayrı projede olduğu için önceki `--exclude` gereksizleşti (T6.1 kaydındaki "[release-build meta-testi hariç]" notu bununla geçersiz).

## T6.6 yük/veri bütünlüğü kabulü ve pilot rehberi kararları (2026-09-24)
- **Görev kapıda biter (kullanıcı kararı):** T6.6, [RELEASE.md](RELEASE.md) §4 "Pilot için hazır kapısı"nı ve kanıt yollarını yazar; kontrollü pilot yayını ve yayın sonrası kısa doğrulama sonraki görevdir. Hazır / yayınlandı / yayın doğrulandı ayrı durumlardır; bu kayıt hiçbirinin gerçekleştiğini söylemez.
- **Tek aday commit:** kabul izlenebilirlik tablosu ([QA-PLAN.md](QA-PLAN.md) §2; 35 hikâye + 28 PRD maddesi) ve RELEASE §4'teki 13 kanıt aynı yayın adayı commit'ine bağlanır. Başka commit'te alınmış sonuç geçersizdir (S6.6 AC7). Açık karar veya hedef sunucu gerektiren satırlar `açık` yazılır, `geçti` yazılmaz.
- **Yük kiti hedefin dışında çalışır:** `npm run load:seed` (yalnız yeni dosya; var olan yolu ve `NODE_ENV=production`'ı reddeder; gerçek Argon2id kimlik bilgileri `0600` depo dışı dosyada), `npm run load:run` (çağrı başına tek senaryo: `login-burst`, `active-mix`, `write-peak`; ısınma/artış/sürdürülen varsayılan 300/300/1800 sn; kısa veya geri döngü koşu `acceptance_eligible=false`), `npm run integrity:check` (salt okunur). Üçü de `ci-steps.json` ve rutin test komutlarının dışındadır.
- **Kaynak ölçümü:** uygulama 60 sn'de bir `dolmus-runtime event=runtime_metrics` satırı yazar (event-loop, RAM, CPU, yazma işlemi süresi/kilit hatası, Argon2 kuyruğu; yalnız sayı). Makine RAM/disk `dolmus-health event=metrics`'ten, CPU/burst Lightsail `get-instance-metric-data`'dan okunur. `dolmus-health` `wal_bytes` yalnız üretim DB'sinin WAL'ıdır; yük DB'sinin WAL'ı ayrıca örneklenir ([SERVER-SETUP.md](SERVER-SETUP.md) §5.1).
- **Yük DB'si ayrı:** hedefte `/var/lib/dolmus-takip/data/load-test/load.sqlite`; yalnız uygulama servisi bir drop-in ve `/etc/dolmus-takip/load-test.env` ile ona bağlanır, `app.env`, yedek/sağlık/yayın birimleri değişmez. Pilot trafiğinden önce üretim DB'sine dönüş süreç ortamından doğrulanır ve yük dizini silinir (yük oturumları yalnız yük DB'sindedir).
- **Koşu kuralları:** senaryolar sırayla ve ayrı; giriş yoğun koşular arasında ≥ 15 dk; sayaçları sıfırlamak için servis yeniden başlatılmaz; sağlık zamanlayıcısı durdurulmaz, düzeltici restart bulgu sayılır; süreç öldürme `write-peak` sırasında bir kez; `integrity:check` yayın arşivinde olmadığı için her koşudan sonra `db-backup.ts run` ile alınan tutarlı kopyada, üreticide çalışır.
- **Dış erişilebilirlik sondası (2026-09-24):** `load:run` hazırlıkta ve koşu boyunca sağlık uçlarını değil, Caddy üzerinden oturumsuz `GET /giris` çağırır. Hazırlıkta 200 dışı yanıtta yük başlatılmaz; 503 bakım kapısıdır. Sağlık uçları yalnız localhost içinde kalır (Caddy `@health` dışarıya 404; Caddyfile değişmedi); sağlık uçlarını dışarı açmak veya üreticiyi hedefe taşımak reddedildi (ilki mimariyle çelişir, ikincisi raporu `acceptance_eligible=false` yapar). `GET /giris` DB hazırlığını göstermez: koşu sırasında DB hazırlığı hedefte `dolmus-health` `event=probe` `ready` ve `event=metrics` `ready_ms` satırlarından okunur ([QA-PLAN.md](QA-PLAN.md) §3).
- **Durum:** hedef makine yok (üretim AWS hesabı ve alan adı seçilmedi), hiçbir yük ölçümü yapılmadı; sistem pilot için hazır değildir.
