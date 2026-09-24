# QA / Test Planı: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.1  
**Durum:** Kod öncesi doğrulama planı; test, CI, yük deneyi veya yayın çalıştırılmadı.  
**Kaynaklar:** [PRD](PRD.md) §9, [Stories](STORIES.md), [Tasks](TASKS.md), [Architecture](ARCHITECTURE.md), [Design](DESIGN.md), [Tech Stack](TECH-STACK.md), [Milestones](MILESTONES.md), [Release](RELEASE.md), [Ops](OPS.md).  
**Şablon:** Project Blueprint / 09-qa; gerçek SQLite veri bütünlüğü ve seçilen native işletim yaklaşımına uyarlandı.

## 1. Test stratejisi

Asıl kabul kapsamı STORIES.md içindeki 35 hikâyenin **258 kabul kutusudur**. Aşağıdaki 16 senaryo grubu bunları düzenler; PRD'nin 28 maddesiyle eşleme, hikâyelerdeki ayrıntıların yerine geçmez. Uygulamada her kabul kutusu `Sx.y/ACn → test veya manuel kanıt` olarak izlenir; kaynak revizyonu saklanır. Testler ilgili hikâyeyle yazılır, E6'ya biriktirilmez.

| Seviye | Araç / ortam | Kapsam |
|---|---|---|
| Birim | Vitest; saat gibi dış girdiler kontrollü | Para ayrıştırma/yuvarlama, süre, doğrulama, yetki kararları, görünür hata metinleri. |
| Entegrasyon | Vitest + gerçek better-sqlite3/Drizzle; ayrı geçici dosya ve gerçek migration | Birleşik FK, transaction, revizyon/onay, idempotency, SQL raporları; bağımsız bağlantı ve süreçler. |
| Uçtan uca | Playwright Chromium (WebKit 2026-09-24 kararıyla kaldırıldı, bkz. DECISIONS.md); gerçek Node backend ve üretim derlemesi | Giriş → kayıt → teslim → düzeltme → rapor; gerçek HTTP, cookie, oturum ve test DB'si. |
| İşletim / yük | İzole Linux denemesi; M6'da seçilen hedef makine | Native modüller, systemd, WAL, donma/çökme, yedek/restore, yayın ve kapasite. |
| Manuel | Android Chrome, iPhone Safari ve temsili kullanıcı | Gerçek dokunma/klavye, okunabilirlik, yavaş bağlantı ve anlaşılabilir günlük akış. |

[Vitest rehberi](https://vitest.dev/guide/) ve [Playwright rehberi](https://playwright.dev/docs/intro) başlangıç araçlarıdır; uyumlu kesin sürümler T1.1'de lockfile'a sabitlenir. Tarayıcı taklidi gerçek telefon denemesinin yerine geçmez. Finansal DB testleri yalnız mock veya `:memory:` üzerinde kabul edilmez.

Rastgele bir kod kapsama yüzdesi veya sabit test adedi başarı ölçütü değildir. Kritik hesap/yetki dalları, hata geri alma ve tekrar gönderim davranışları açık örneklerle sınanır. Kod kapsama raporu eksik dalı bulmaya yardım eder; tek başına kabul kanıtı olmaz.

## 2. Test verisi ve senaryolar

### Ortak veri seti

- A ve B adlı iki işletme; A'da iki, B'de bir araç. Her araçta ayrı sahip/ortak şoför credential; kişisel yetkili ekip hesabı ve pasif ekip hesabı bulunur. Personel destek hedefini açıkça seçer.
- Her işletmede sahip kişi ve şoförler; aynı araçta aynı ada sahip iki ayrı kişi ID'si, yeniden adlandırılmış kişi ve pasif şoför bulunur. Pasif araç/işletme oturum iptalinde kullanılır.
- En az iki ay ve iki yıl sınırına dağılan çalışmalar, aynı gün aynı kişi için iki gerçek çalışma, aynı gün farklı şoförler ve boş dönem bulunur. Yük verisi ayrıca beş yıllık geçmişe genişletilir; üretim verisi kullanılmaz.
- Temel kayıt: hasılat 10.000 TL, mazot 1.500 TL, diğer masraf 300 TL. Şoför payı 2.000 TL, beklenen teslim 6.200 TL; aynı girdilerle sahip çalışması pay 0, kalan 8.200 TL.
- Bu iki kaydın hesaplanan kalanı 14.400 TL'dir. Hiç onay yokken doğrulanmış teslim 0; şoför teslimi tam onaylanınca 6.200 TL, alınan 6.000 TL olarak onaylanınca 6.000 TL. Sahip çalışması teslim toplamına eklenmez.
- Her test kendi başlangıç verisini kurar. İstek kimliği, kişi/araç ID'si, kontrollü saat ve rastgele veri tohumu sonuç kaydında saklanır; paralel testler aynı DB dosyasını paylaşmaz. Eşzamanlılık testi özellikle tek dosyaya birden çok bağlantı/süreç açar.

### Senaryo grupları

| ID | Sınanacak davranış ve beklenen sonuç | Hikâye / yöntem |
|---|---|---|
| QA01 | Telefonda kurulum gerekmeyen mavi-beyaz sade akış; okunur Türkçe metin, büyük alanlar, odak/klavye ve renk dışı durum etiketleri. | S1.6, S3.6 · E2E + manuel |
| QA02 | Araç sahip/şoför ve kişisel ekip girişleri ayrıdır; yanlış/eşit rol parolası reddi, hash, süre/iptal, yetki değişimi, CSRF ve giriş sınırları çalışır. | S1.1–S1.4, S2.3, S2.6 · birim + entegrasyon + E2E |
| QA03 | UI/API başka işletme veya izinsiz araç verisini açmaz; ad/rol/ID değiştirmek yetki kazandırmaz; staff hedefi açık, gerçek aktör korunur. | S1.5, S2.5, E3–E5 · entegrasyon + E2E |
| QA04 | Back office işletme/sahip/araç kurar; iki şifreyi yönetir; pasifleştirme geçmişi silmez ve erişimi keser; araç girişinde doğru bağlam hazırdır. | S2.1–S2.3, S3.1 · entegrasyon + E2E |
| QA05 | Şoför ekleme/atama/pasiflik ve aynı adlı kişiler sabit ID ile ayrılır; ad düzeltmesi geçmişi bölmez; seçicide yalnız izinli aktif kişiler görünür. | S2.4–S2.5, S3.1, S5.3 · entegrasyon + E2E |
| QA06 | Geçerli çalışma tarihi ve aynı gün 08:00–17:30 → 570 dakika; ayrı çalışmalar ezilmez. Gece/dönem kenarları K3 kararıyla tamamlanır. | S3.1, S5.2–S5.4 · birim + entegrasyon + E2E |
| QA07 | Kuruş hesabı, %20/%0, sahip/ekip adına sürüş ayrımı ve sunucu doğrulaması kanonik örneklerle tutar; istemci hesap/yetki alanlarını dayatamaz. | S3.2–S3.3 · birim + entegrasyon + E2E |
| QA08 | Tek Kaydet sunucuda kalıcı sonuç verir; sahip/rapor hemen görür. Bağlantı kopması, bilinmeyen sonuç ve oturum yenilenmesi çift kayıt yaratmaz. | S3.4–S3.6 · entegrasyon + E2E |
| QA09 | İsim/tarih/beklenen/alınan açık; ilk onay ve 6.000 TL farklı alınan tutar gelir/pay/bekleneni değiştirmez; staff sahip adına görünür, kendisi almış sayılmaz. | S4.1–S4.2, S4.5–S4.6 · entegrasyon + E2E |
| QA10 | Onaylı kaydı yalnız owner/staff aynı türde atomik Düzelt ve onayla ile değiştirir; eski sürüm/onay/aktör geçmişi korunur; şoför reddedilir. | S4.3–S4.6 · entegrasyon + E2E |
| QA11 | Özet, kişi/araç dönemleri ve gün gün liste yalnız güncel sürümü sayar; kalan/teslim ayrıdır, aynı kişi geçmişi birleşir; rapor ekrandadır. | S5.1–S5.5 · entegrasyon + E2E |
| QA12 | Restart, gerçek dosyanın yeniden açılması, 100 tekrar, sürüm yarışları ve işlem içi çökme sonunda tek eski veya tek yeni tam mali durum bulunur. | S3.4–S3.5, S4.1–S4.3, S6.6 · dosyalı/süreçli entegrasyon |
| QA13 | Çökme/donma sınırlı kurtarma üretir; kalıcı kilit reboot'ta korunur; DB hazırlık hatası restart döngüsü olmaz; makine arızasını dış kontrol bildirir. | S6.2–S6.3 · izole Linux arıza denemesi |
| QA14 | Tutarlı kopya/snapshot/restore ayrı kanıtlanır; son iki yerel kopya/son yedi snapshot ve uyumlu release korunur; restore sonrası mali veri doğrulanır. | S6.4–S6.5 · entegrasyon + M6 işletim |
| QA15 | Hedef uyumlu üretim çıktısı; ortak işletim kilidi/bakım/migration/geri dönüş; yeni müşteri yazması sonrası eski DB otomatik yüklenmez. | S1.1, S6.1–S6.2, S6.5 · CI + Linux yayın denemesi |
| QA16 | Üç ayrı 100 kullanıcı/istek senaryosu, p95 ve bütünlük hedefleri ölçülür; pilot smoke ve yardım/işletim hazırlığı sürümle ilişkilendirilir. | S6.6 · M6 yük + manuel |

### PRD §9 maddelerinin ana eşlemesi

Bir madde tek ana gruba atanır; grup içindeki bağımlı ekran/rapor/işletim kontrolleri birlikte geçmelidir. Özellikle #14 yalnız QA12 ile tamamlanmaz; QA14'ün gerçek restore kanıtı zorunludur.

| PRD maddesi | Ana QA | Birlikte gereken grup / not |
|---|---|---|
| 1 | QA01 | Günlük form QA08 |
| 2 | QA04 | Aktif kişi/tarih QA05–QA06 |
| 3 | QA06 | Kişi raporu QA11 |
| 4 | QA07 | Formda hesap görünümü |
| 5 | QA08 | Sahip/rapor görünümü QA11 |
| 6 | QA09 | Tekrarsızlık QA12; şoför görünürlüğü K1 |
| 7 | QA07 | Kişi raporu ve teslim hariçliği QA11 |
| 8 | QA07 | Oturum/aktör QA03 |
| 9 | QA06 | Araç/kişi toplamı QA11 |
| 10 | QA11 | Kanonik kalan/teslim örneği |
| 11 | QA11 | Dönem sınırları K3 |
| 12 | QA03 | Şoför/owner ayrımı QA02 |
| 13 | QA07 | Onay yetkisi QA03, QA09 |
| 14 | QA12 | Yedek/restore QA14; süreç QA13 |
| 15 | QA10 | İşlem içi hata QA12; güncel rapor QA11 |
| 16 | QA03 | Giriş QA02; çok araç K2 |
| 17 | QA07 | Kişi seçiminin yetki vermemesi QA03 |
| 18 | QA02 | Rol/araç kurcalama QA03 |
| 19 | QA05 | Geçmiş kişi raporu QA11 |
| 20 | QA09 | 6.000 TL güncel teslim QA11 |
| 21 | QA11 | Ekranda dönem ve günlük detay |
| 22 | QA02 | Back office sınırı QA03 |
| 23 | QA04 | Şifre/oturum iptali QA02 |
| 24 | QA05 | Destek hedefi/aktörü QA03 |
| 25 | QA07 | Destek hedefi/aktörü QA03 |
| 26 | QA10 | Gerçek ekip aktörü QA03 |
| 27 | QA09 | Destek açıklaması ve güncel toplam QA11 |
| 28 | QA03 | Yönetim ve müşteri adına işlemler QA04–QA11 |

### Kritik ayrıntılar

- **Para:** TL girişi → tam sayı kuruş → BigInt hesap → ondalık tam sayı metni API dönüşümü sınanır. 0,03 TL'nin %20 payı 0,01 TL olur; kayan nokta, `Number.MAX_SAFE_INTEGER` sınırı, bozuk/negatif girdi ve taşma sınanır. Negatif hesap sonucu sıfıra kırpılmaz; K5 akışı ayrıca karara bağlıdır.
- **Yetki:** Birleşik FK'yi yanlış işletmeli doğrudan SQL yazmasıyla; SELECT/API kapsamını ayrı saldırı örnekleriyle doğrula. Cookie/token gizliliği, çıkış/reset/pasiflik sonrası eski oturum ve aynı isimle başka kişi seçimi yetki testlerinin parçasıdır. Ortak şifre bireysel kimlik kanıtı değildir.
- **Tekrar/sürüm:** Aynı anahtar ve gövdeyle 100 tekrar tek kayıt/sonuç; farklı gövde 409. Commit sonrası yanıt kaybı ve tekrar girişte aynı mantıksal iş sonuçlanır; hedef değişikliği sızıntı yaratmaz. Aynı sürüme iki düzenleme/onaydan biri başarılı, diğeri 409 olur.
- **Atomiklik:** Kayıt/revizyon/receipt ve onay/audit yazıları arasındaki hata noktaları ile commit öncesi/sonrası süreç sonlandırma sınanır. Yeniden açılan dosyada eski tam veya yeni tam sürüm vardır; eski onay yeni sürüme bağlanmaz. Unknown-result formu içerik/anahtarı değiştirmeden sonucu çözer.
- **Rapor:** Onaylı kişi/tarih düzeltmesi yeni kişi/döneme taşınır; eski revizyonlar toplamı şişirmez. Aynı kişinin aynı çalışma tarihindeki iki çalışması bir çalışma günü sayılır. Yeniden adlandırılmış/pasif kişi, boş dönem, yıl sınırı, filtre/cursor ve toplam+liste tutarlı okuma görüntüsüyle sınanır; özel veride ortak cache oluşmaz.
- **Gerçek SQLite:** Her bağlantıda FK/WAL/synchronous/busy timeout ayarları kontrol edilir; `SELECT sqlite_version()` ile seçilen WAL düzeltmesini içeren sürüm doğrulanır. Birden çok süreçten aynı dosyaya yazma, kilit beklemesi, checkpoint, ani sonlandırma ve yeniden açma yer alır; tek bağlantılı bellek testi yeterli olmaz.
- **İşletim:** Node event-loop donması kontrollü oluşturulur ve bağımsız sağlık sürecinden algılanır; restart limitleri, bakım, DB hazırlık hatası ve reboot sonrası kurtarma kilidi sınanır. Backup API kopyası aktif yazmalar altında hazırlanır; doğrulama kopyanın kendi tutarlı görüntüsünde yapılır.
- **Restore/yayın:** Kopya hash/manifest/uyumlu sürüm, integrity/FK, son commit, güncel onay ve 14.400/6.000 toplamları doğrulanır. Restore edilen eski oturumların çalışmadığı ve kopyadan sonraki parola/pasiflik değişikliklerinin kontrolsüz geri açılmadığı sınanır; aktör geçmişi korunur. Geç/bozuk kopya eskisini silmez; snapshot ilişkisi belirsizse başarı denmez. Ortak kilit, migration öncesi kopya başarısızlığı ve yazma açılmadan/açıldıktan sonraki ayrı geri dönüş yolları sınanır.

### Kabul izlenebilirlik tablosu (S6.6)

S6.6 AC1 ve AC7 için tek kayıt yeridir. Bütün satırlar **tek bir yayın adayı commit'inde** üretilmiş kanıtla doldurulur; başka bir commit'te, başka bir arşivde veya yerel çalışma ağacında alınmış sonuç bu aday için geçerli sayılmaz ve o commit'te yeniden koşulur. Aday değişirse sonuç sütunu baştan boşaltılır.

**Yayın adayı commit:** `________________________________________` (henüz seçilmedi) · **Arşiv `artifact_sha256`:** `________` · **Tabloyu dolduran / tarih (UTC):** `________`

- **Durum:** `çalıştırılmadı` = kanıt var ama aday commit'te koşulmadı; `açık` = açık karar, kurulmamış altyapı, hedef sunucu veya gerçek cihaz kanıtı gerektirir. `açık` satır, gerektirdiği şey çözülüp kanıt aday commit'te alınmadan `geçti` yazılamaz. Hiçbir satır şu anda geçmiş değildir.
- **Sonuç (aday commit):** `geçti / başarısız` + kanıtın yeri (CI koşu bağlantısı, rapor dosyası, kayıt tarihi). Boş = alınmadı.
- Otomatik kanıt sütunu, dosyayı ekleyen hikâye commit'inden eşlenmiştir. Bir hikâye satırı, o hikâyenin **bütün** kabul kutuları (§1: toplam 258) aday commit'te kanıtlanınca kapanır; kutu düzeyi eşleşme `Sx.y/ACn → kanıt` olarak §4 kaydında tutulur. Otomatik kanıtlar aday commit'te `npm run test:unit`, `npm run test:integration`, `npm run test:release` ve `npm run test:e2e` (Chromium) ile koşulur.

| Hikâye | Otomatik kanıt | Manuel / hedef sunucu kanıtı | Durum | Sonuç (aday commit) |
|---|---|---|---|---|
| S1.1 | `src/server/data/db.test.ts`; `tests/integration/{schema,db-connection,db-seed-dev}.test.ts`; `tests/unit/ci-workflows.test.ts` | Aday commit'te GitHub Actions `ci.yml` koşusu | çalıştırılmadı | `________` |
| S1.2 | `src/server/auth/{rate-limit,hash-queue}.test.ts`; `tests/integration/{vehicle-login-route,vehicle-login-hash-queue}.test.ts`; `tests/e2e/vehicle-login.spec.ts` | — | çalıştırılmadı | `________` |
| S1.3 | `tests/integration/{platform-login-route,platform-admin-cli}.test.ts`; `tests/e2e/platform-login.spec.ts` | — | çalıştırılmadı | `________` |
| S1.4 | `src/server/auth/{session,cookie,app-origin}.test.ts`; `src/lib/client-state.test.ts`; `tests/integration/{session-routes,session-revocation,session-usecases,app-db-access}.test.ts` | — | çalıştırılmadı | `________` |
| S1.5 | `src/server/auth/{permissions,scope}.test.ts`; `src/server/http/handler.test.ts`; `tests/integration/{scope-authorization,scope-resolution,protected-route,mutation-receipts-scope,session-scope-summary}.test.ts` | — | çalıştırılmadı | `________` |
| S1.6 | `src/lib/contrast.test.ts`; `tests/e2e/login-accessibility.spec.ts` | `tests/e2e/MANUAL-CHECKS.md` "Giriş ekranı" listesi (Android Chrome, iPhone Safari) | çalıştırılmadı | `________` |
| S2.1 | `tests/integration/admin-businesses-routes.test.ts`; `tests/e2e/admin-businesses.spec.ts` | — | çalıştırılmadı | `________` |
| S2.2 | `src/server/auth/vehicle-password.test.ts`; `src/lib/draft-version.test.ts`; `tests/integration/admin-vehicles-routes.test.ts`; `tests/e2e/admin-vehicles.spec.ts` | — | çalıştırılmadı | `________` |
| S2.3 | `tests/integration/{reset-vehicle-password-route,session-revocation}.test.ts` | — | çalıştırılmadı | `________` |
| S2.4 | `src/lib/drivers-ui.test.ts`; `tests/integration/{drivers-routes,drivers-affected-vehicles}.test.ts`; `tests/e2e/drivers.spec.ts` | — | çalıştırılmadı | `________` |
| S2.5 | `src/lib/{admin-search,audit-ui,search-fold,support-target}.test.ts`; `src/server/usecases/admin-audit/sanitize.test.ts`; `tests/integration/{admin-audit-route,admin-list-search-routes}.test.ts`; `tests/e2e/admin-support-audit.spec.ts` | — | çalıştırılmadı | `________` |
| S2.6 | `src/lib/team-users-ui.test.ts`; `tests/integration/admin-users-routes.test.ts`; `tests/e2e/team-accounts.spec.ts` | — | çalıştırılmadı | `________` |
| S3.1 | `src/lib/work-time.test.ts`; `tests/e2e/driver-daily-form.spec.ts` | — | çalıştırılmadı | `________` |
| S3.2 | `src/lib/{money,work-calculation}.test.ts`; `src/server/usecases/work-entries/work-entries.test.ts` | — | çalıştırılmadı | `________` |
| S3.3 | `src/lib/work-entry-ui.test.ts`; `src/server/usecases/work-entries/subject.test.ts`; `tests/integration/work-entry-prepare-create.test.ts`; `tests/e2e/owner-staff-work-entry.spec.ts` | — | çalıştırılmadı | `________` |
| S3.4 | `tests/integration/{work-entries-create-route,work-entry-crash-integrity}.test.ts` | — | çalıştırılmadı | `________` |
| S3.5 | `tests/integration/work-entries-read-update-routes.test.ts`; `tests/e2e/work-entry-edit.spec.ts` | — | çalıştırılmadı | `________` |
| S3.6 | `src/lib/{messages,work-entry-ui}.test.ts`; `tests/e2e/{driver-daily-form,owner-staff-work-entry}.spec.ts` | `tests/e2e/MANUAL-CHECKS.md` "Günlük kayıt ve kayıt sonucu" listesi; temsili kullanıcı süre/yardım sonuçları | çalıştırılmadı | `________` |
| S4.1 | `tests/integration/work-entries-confirm-route.test.ts` | — | çalıştırılmadı | `________` |
| S4.2 | `tests/integration/work-entries-confirm-route.test.ts`; `tests/e2e/work-entry-edit.spec.ts` | — | çalıştırılmadı | `________` |
| S4.3 | `tests/integration/{work-entries-correct-and-confirm-route,work-entry-crash-integrity}.test.ts` | — | çalıştırılmadı | `________` |
| S4.4 | `src/lib/{work-entry-history,work-entry-history-ui}.test.ts`; `tests/integration/work-entries-history-route.test.ts` | — | çalıştırılmadı | `________` |
| S4.5 | `tests/integration/{work-entries-confirm-route,work-entries-correct-and-confirm-route,work-entries-read-update-routes}.test.ts`; `tests/e2e/work-entry-edit.spec.ts` | — | çalıştırılmadı | `________` |
| S4.6 | `tests/integration/work-entries-driver-delivery.test.ts` | — | çalıştırılmadı | `________` |
| S5.1 | `tests/integration/reports-summary-route.test.ts`; `tests/e2e/owner-summary.spec.ts` | — | çalıştırılmadı | `________` |
| S5.2 | `src/lib/{report-period,report-ui}.test.ts`; `tests/integration/reports-vehicles-route.test.ts`; `tests/e2e/owner-reports.spec.ts` | — | çalıştırılmadı | `________` |
| S5.3 | `tests/integration/reports-people-route.test.ts` | — | çalıştırılmadı | `________` |
| S5.4 | `tests/integration/work-entries-list-filters.test.ts` | — | çalıştırılmadı | `________` |
| S5.5 | `tests/integration/{reports-prd-scenario,reports-query-plan,reports-scope-matrix,reports-snapshot}.test.ts`; `tests/e2e/staff-reports.spec.ts` | — | çalıştırılmadı | `________` |
| S6.1 | `tests/unit/{ci-workflows,release-shared}.test.ts`; `tests/release/release-build.test.ts` | Aday commit'ten `release.yml` (workflow_dispatch) arşivi + manifest (`source_commit` = aday); hedef Linux'ta `release:verify` | çalıştırılmadı | `________` |
| S6.2 | `tests/integration/{app-db-startup,db-init-cli}.test.ts`; `tests/unit/deploy-config.test.ts` | SERVER-SETUP §5 satır 1–9 | açık — üretim AWS hesabı ve alan adı seçilmedi | `________` |
| S6.3 | `tests/unit/health-decision.test.ts`; `tests/integration/{health-ready-route,admin-hash-queue-log}.test.ts` | SERVER-SETUP §5 satır 10–16; makine dışı kontrol ve ekip uyarısının ulaştığı kayıt | açık — hedef makine yok; dış kontrol ve uyarı kanalı seçilmedi (AC6) | `________` |
| S6.4 | `tests/unit/backup-schedule.test.ts`; `tests/integration/db-backup.test.ts` | SERVER-SETUP §5 satır 17–21; OPS §4 üç ayrı günlük kayıt | açık — hedef makine yok | `________` |
| S6.5 | `tests/integration/{db-restore,release-apply}.test.ts` | OPS §4 "Kontrollü restore" ayrı makine denemesi; SERVER-SETUP §5 satır 22–27 | açık — hedef makine yok | `________` |
| S6.6 | `tests/integration/{work-entry-crash-integrity,integrity-check,load-seed,instrumentation-runtime-metrics}.test.ts`; `tests/unit/{load-metrics,load-client,load-run-args}.test.ts`; `src/server/observability/runtime-metrics.test.ts` | §3 yük prosedürü: üç senaryo raporu, süreç öldürme denemesi, her koşu sonrası `integrity:check`; SERVER-SETUP §5 satır 28–33; bu tablonun tamamı; OPS §8 | açık — hedef makine yok; `load:run` dış hazırlık engeli (§3) | `________` |

| PRD §9 | Ana QA | Otomatik kanıt | Manuel / hedef sunucu kanıtı | Durum | Sonuç (aday commit) |
|---|---|---|---|---|---|
| 1 | QA01 | `tests/e2e/{vehicle-login,login-accessibility,driver-daily-form}.spec.ts`; `src/lib/contrast.test.ts` | `MANUAL-CHECKS.md` S1.6 ve S3.6 listeleri (gerçek telefon) | çalıştırılmadı | `________` |
| 2 | QA04 | `tests/integration/{admin-businesses-routes,admin-vehicles-routes,work-entry-prepare-create}.test.ts`; `tests/e2e/{admin-businesses,admin-vehicles,driver-daily-form}.spec.ts` | — | çalıştırılmadı | `________` |
| 3 | QA06 | `src/lib/work-time.test.ts`; `tests/integration/reports-people-route.test.ts`; `tests/e2e/driver-daily-form.spec.ts` | — | çalıştırılmadı | `________` |
| 4 | QA07 | `src/lib/{money,work-calculation}.test.ts`; `tests/e2e/driver-daily-form.spec.ts` | — | çalıştırılmadı | `________` |
| 5 | QA08 | `tests/integration/{work-entries-create-route,reports-summary-route}.test.ts`; `tests/e2e/owner-summary.spec.ts` | — | çalıştırılmadı | `________` |
| 6 | QA09 | `tests/integration/{work-entries-confirm-route,work-entries-driver-delivery}.test.ts`; `tests/e2e/work-entry-edit.spec.ts` | — | çalıştırılmadı | `________` |
| 7 | QA07 | `src/lib/work-calculation.test.ts`; `src/server/usecases/work-entries/subject.test.ts`; `tests/integration/reports-people-route.test.ts`; `tests/e2e/owner-staff-work-entry.spec.ts` | — | çalıştırılmadı | `________` |
| 8 | QA07 | `src/server/usecases/work-entries/subject.test.ts`; `tests/integration/work-entry-prepare-create.test.ts`; `tests/e2e/owner-staff-work-entry.spec.ts` | — | çalıştırılmadı | `________` |
| 9 | QA06 | `tests/integration/{reports-prd-scenario,reports-vehicles-route,reports-people-route}.test.ts` | — | çalıştırılmadı | `________` |
| 10 | QA11 | `tests/integration/{reports-prd-scenario,reports-vehicles-route}.test.ts`; `tests/e2e/owner-reports.spec.ts` | — | çalıştırılmadı | `________` |
| 11 | QA11 | `src/lib/report-period.test.ts`; `tests/integration/{reports-vehicles-route,reports-people-route,reports-snapshot}.test.ts` | — | çalıştırılmadı | `________` |
| 12 | QA03 | `src/server/auth/permissions.test.ts`; `tests/integration/{scope-authorization,reports-scope-matrix,protected-route}.test.ts` | — | çalıştırılmadı | `________` |
| 13 | QA07 | `src/server/usecases/work-entries/work-entries.test.ts`; `tests/integration/{work-entries-create-route,work-entries-confirm-route}.test.ts` | — | çalıştırılmadı | `________` |
| 14 | QA12 | `tests/integration/{db-connection,work-entries-create-route,work-entry-crash-integrity,db-backup,db-restore}.test.ts` | Hedefte yük sonrası `integrity:check` (§3); OPS §4 ayrı makinede restore (S6.5) | açık — hedef makine yok | `________` |
| 15 | QA10 | `tests/integration/{work-entries-correct-and-confirm-route,work-entries-history-route,work-entries-driver-delivery,work-entry-crash-integrity,reports-prd-scenario}.test.ts` | — | çalıştırılmadı | `________` |
| 16 | QA03 | `tests/integration/{vehicle-login-route,scope-resolution}.test.ts`; `tests/e2e/vehicle-login.spec.ts` (çok araç K2 kararıyla tek araç) | — | çalıştırılmadı | `________` |
| 17 | QA07 | `src/server/usecases/work-entries/subject.test.ts`; `tests/integration/scope-authorization.test.ts`; `tests/e2e/owner-staff-work-entry.spec.ts` | — | çalıştırılmadı | `________` |
| 18 | QA02 | `src/server/auth/{vehicle-password,rate-limit}.test.ts`; `tests/integration/{vehicle-login-route,session-routes}.test.ts` | — | çalıştırılmadı | `________` |
| 19 | QA05 | `tests/integration/{drivers-routes,reports-people-route}.test.ts`; `tests/e2e/drivers.spec.ts` | — | çalıştırılmadı | `________` |
| 20 | QA09 | `tests/integration/{work-entries-confirm-route,reports-prd-scenario}.test.ts`; `tests/e2e/work-entry-edit.spec.ts` | — | çalıştırılmadı | `________` |
| 21 | QA11 | `tests/integration/work-entries-list-filters.test.ts`; `tests/e2e/{owner-reports,staff-reports}.spec.ts` | — | çalıştırılmadı | `________` |
| 22 | QA02 | `tests/integration/{platform-login-route,protected-route}.test.ts`; `tests/e2e/platform-login.spec.ts` | — | çalıştırılmadı | `________` |
| 23 | QA04 | `tests/integration/{reset-vehicle-password-route,admin-vehicles-routes,session-revocation}.test.ts`; `tests/e2e/admin-vehicles.spec.ts` | — | çalıştırılmadı | `________` |
| 24 | QA05 | `tests/integration/{drivers-routes,admin-audit-route}.test.ts`; `tests/e2e/{drivers,admin-support-audit}.spec.ts` | — | çalıştırılmadı | `________` |
| 25 | QA07 | `tests/integration/work-entry-prepare-create.test.ts`; `tests/e2e/owner-staff-work-entry.spec.ts` | — | çalıştırılmadı | `________` |
| 26 | QA10 | `tests/integration/{work-entries-correct-and-confirm-route,work-entries-history-route}.test.ts`; `tests/e2e/work-entry-edit.spec.ts` | — | çalıştırılmadı | `________` |
| 27 | QA09 | `tests/integration/work-entries-confirm-route.test.ts`; `src/lib/work-entry-history-ui.test.ts` | — | çalıştırılmadı | `________` |
| 28 | QA03 | `src/lib/support-target.test.ts`; `tests/integration/{scope-authorization,mutation-receipts-scope}.test.ts`; `tests/e2e/admin-support-audit.spec.ts` | — | çalıştırılmadı | `________` |

## 3. Çalıştırma ve CI planı

| Zaman | Çalışacak kontroller / sınır |
|---|---|
| Geliştirme / her PR | Typecheck, lint, ilgili birim/gerçek DB entegrasyonu, üretim derlemesi ve hazır kritik E2E akışları; ana kapsama erişen değişiklikte regresyon. |
| M1–M5 çıkışı | O aşama ve bağımlılıklarının tüm AC kanıtları; Chromium regresyonu, seçilen gerçek telefon akışları (iPhone Safari dahil). M1'den itibaren migration/native çıktı denemesi. |
| M6 / manuel yayın adayı | E1–E5 ve E6'nın yayın öncesi kriterleri, 28 PRD maddesi, hedef Linux, restore/yük/telefon kanıtları; çözülmemiş kritik yayın engeli yok. S6.6'nın yayın ve yayın sonrası kabulü bu noktada henüz açık kalır. |
| Kontrollü yayın sonrası | Ayrı test işletmesinde HTTPS → giriş → tek kayıt → alınan tutar onayı → rapor → ekip desteği kısa smoke; gerçek müşteri defterine deneme kaydı yazma, sonucu sürümle ilişkilendir. |

M6'nın son çıkışı, pilot kapsamı ve başlangıcı belirlendikten sonra kontrollü pilot yayınını ve yayın sonrası başarılı smoke kanıtını da içerir. “Yayına hazır”, “yayınlandı” ve “yayın doğrulandı” ayrı durumlardır; bu planın teslimi bunların hiçbiri sayılmaz.

Aşağıdaki komutlar **önerilen package script isimleridir; henüz mevcut veya çalıştırılmış değildir**. T1.1/T6.1 bunları test altyapısıyla oluşturacak; otomatik üretim deploy'u eklenmez.

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

CI izole test DB'si, test parolaları ve boş migration başlangıcı kullanır. E2E üretim derlemesini ayrı Node sürecinde çalıştırır; DB yazma istekleri mock ile karşılanmaz. Native modüller hedef Linux/Node/CPU ile uyumlu ortamda sınanır; Mac bağımlılık çıktısı sunucu kanıtı sayılmaz. CI artifaktları süre/boyutla sınırlanır; gizli veriler temizlenir.

### Kapasite ve geçiş ölçütleri

M6'da hedef Lightsail üzerinde üretim derlemesi ve beş yıllık temsili geçmiş kullanılacak; araç/kişi/çalışma adetleri raporlanacak. Yük üreticisi başka makinededir. Yük kiti (`load:seed`, `load:run`, `integrity:check`, uygulamanın `runtime_metrics` satırı) hazırlandı; hedef makinede **hiçbir senaryo koşulmadı ve hiçbir ölçüm yoktur**. Şimdi ücretli kaynak açılmaz veya yük testi başlatılmaz.

1. 100 kısa aralıklı giriş: Argon2 kuyruğu, ortak NAT, meşru kullanıcı beklemesi/engeli ve toparlanma.
2. 100 aktif kullanıcının gerçekçi beklemeli kayıt/onay/rapor karışımı: önerilen 5 dakika ısınma, kademeli artış ve en az 30 dakika sabit yük.
3. 100 yazma isteği tepesi: transaction/idempotency, kuyruk ve toparlanma; ilk iki senaryonun yerine geçmez.

Normal karışık yük başlangıç hedefi **kayıt p95 ≤2 sn, rapor p95 ≤3 sn, beklenmeyen hata <%1**; başarılı mali işlem kaybı, çift işlem ve hesap/onay tutarsızlığı **0**. 409/429/yetki reddi ayrı sayılır; meşru kullanıcıyı engelleyerek elde edilen hız geçer sayılmaz. RAM, CPU/burst, event-loop, disk/WAL ve SQLite beklemesi kaydedilir. Hedef sağlanmazsa bulgu ve düzeltme sonrası ilgili test tekrarlanır; kapasite artışı kendiliğinden onaylanmaz.

### Yük ve veri bütünlüğü kabul prosedürü (S6.6)

Komutlar **hazırlandı, denenmedi (elle kurulumda denenecek)**. Hedef makinedeki adımlar [SERVER-SETUP](SERVER-SETUP.md) §5.1'dedir; bu bölüm sırayı, eşikleri ve kanıtın nereden okunacağını verir.

**Açık engel (2026-09-24):** `load:run` hazırlıkta ve koşu boyunca hedefin `GET /api/v1/health/ready` ucunu çağırır (`scripts/load-run.ts`); Caddy bu yolu dışarıya 404 ile kapatır (`deploy/caddy/Caddyfile` `@health`, ARCHITECTURE §4 "yalnız localhost"). Bu yüzden hedefin dışından başlatılan her koşu hazırlıkta `Hedef hazır değil` hatasıyla durur. Engel kodda giderilmeden hiçbir senaryo koşulamaz. Sağlık uçlarını dışarı açmak veya üreticiyi hedef makineye taşımak çözüm değildir: ilki mimariyle çelişir, ikincisi AC2'yi bozar ve rapor `acceptance_eligible=false` olur.

**Ön koşullar**

- Hedef makine SERVER-SETUP §1–§4 ile kurulu, `current` yayın adayı commit'inin arşivi (manifest `source_commit` = §2 tablosundaki aday commit). Üretim AWS hesabı ve alan adı seçilmeden bu makine yoktur (OPS §8).
- Yük üreticisi hedeften **ayrı** bir makinedir; aday commit'te temiz bir checkout, `npm ci` ve aynı commit'in `release:build`/`release.yml` manifest dosyası (`dist/…manifest.json`) üreticide bulunur. Geri döngü (`localhost`/`127.x`) hedefli veya 100'den az kullanıcılı koşu rapora `acceptance_eligible=false` yazar.
- Yük DB'si müşteri verisine asla karışmaz: ayrı yolda durur, üretim DB'sine yalnız SERVER-SETUP §5.1'deki doğrulanmış geri dönüşle dönülür. `load:seed` hedef makinede ve `/var/lib/dolmus-takip/data/app.sqlite` üzerinde **çalıştırılmaz** (araç var olan dosyayı ve `NODE_ENV=production`'ı zaten reddeder).

**Sıra**

1. **Veri seti (üreticide):** `npm run load:seed -- --db <üretici>/load.sqlite --credentials <depo-dışı>/load-credentials.json --load-window-month <YYYY-MM>`. Varsayılan 50 araç (araç başına sahip + ortak şoför kimlik bilgisi = 100 kullanıcı) ve 4 ekip hesabı; geçmiş `--load-window-month` ayından önce biten en az beş yıldır. Yan dosya `<db>.counts.json` araç/kişi/gün/kayıt/revizyon/onay sayılarını, `sourceCommit`, `sourceTreeDirty`, migration hash listesini ve DB `sha256`'sını taşır; `sourceCommit` aday commit'le aynı ve `sourceTreeDirty=false` olmalıdır. Kimlik bilgisi dosyası `0600`, depo dışındadır; rapora, loga veya Git'e girmez.
2. **Hedefe kopyala ve servisi yük DB'sine bağla:** SERVER-SETUP §5.1 adım 1–3; bağlantı doğrulanmadan yük başlamaz.
3. **Üç senaryo, ayrı ayrı, sırayla:** `login-burst` → `active-mix` → `write-peak`. Her çağrı tek senaryo koşar; iki koşu aynı anda başlatılmaz (aynı yazma penceresini seçerler). Aşamalar: **ısınma ≥ 5 dk** (`--warmup 300`, varsayılan), **kademeli artış** (`--ramp 300`, varsayılan), **sürdürülen yük ≥ 30 dk** (`--sustain 1800`, varsayılan); kısaltılmış koşu `acceptance_eligible=false` yazar ve kabul kanıtı sayılmaz. Hedeflerle yalnız sürdürülen aşamadaki işlemler karşılaştırılır.

   ```sh
   # hazırlandı, denenmedi (elle kurulumda denenecek) — üreticide, aday commit checkout'unda
   npm run load:run -- --scenario login-burst --target "https://$DOLMUS_DOMAIN" \
     --credentials <depo-dışı>/load-credentials.json --dataset <üretici>/load.sqlite.counts.json \
     --release-manifest <dist/…manifest.json> --out <rapor-dizini>/login-burst
   ```

   `active-mix` ve `write-peak` aynı komutla, yalnız `--scenario` ve `--out` değişerek koşulur. Çıkış kodu: 0 geçti, 2 hedef tutmadı (rapor yazıldı), 1 koşu hatası.
4. **Giriş yoğun koşular arasında ≥ 15 dk:** her senaryo 100 girişle başlar (`login-burst` dalgalarla, diğer ikisi hazırlıkta). Giriş sayaçları 15 dakikalık penceredir (20 başarısız/plaka, 120 başarısız/IP; yalnız başarısız denemeler sayılır, `src/server/auth/rate-limit.ts`), Argon2 kuyruğu 4 eşzamanlı / 100 bekleyen / 10 sn'dir. Bir koşunun bitişi ile sonrakinin başlangıcı arasında en az 15 dk bırakılır; rapordaki `loginWindow.nextLoginHeavyScenarioNotBefore` bir sonraki giriş yoğun koşunun en erken zamanını verir. Sayaçları sıfırlamak için servis yeniden başlatılmaz.
5. **Süreç öldürme denemesi (`write-peak` sürdürülen aşamasında, bir kez):** SERVER-SETUP §5.1 adım 4. systemd uygulamayı 10 sn sonra açar; üretici sonucu bilinmeyen yazmaları aynı `requestId` ve bayt-bayt aynı gövdeyle 1, 2, 4, 8, 16 sn beklemeyle yeniden dener (`--max-retries 5`). Öldürme zamanı (UTC), ilk başarılı yanıta kadar geçen süre ve rapordaki `unresolved` sayısı kayda yazılır; defter mutabakatında kayıp, çift ve tutarsız **0** olmalıdır.
6. **Her koşudan sonra bütünlük:** SERVER-SETUP §5.1 adım 5 ile yük DB'sinin tutarlı kopyası alınır ve üreticide `npm run integrity:check -- <kopya>` çalıştırılır; beklenen tek satır `event=integrity_passed` ve çıkış 0'dır. `integrity:check` yayın arşivinde yoktur ve canlı WAL DB üzerinde uzun okuma checkpoint'i bekletir; bu yüzden kopyada çalışır.
7. **Kaynak ölçümleri:** koşu penceresinin UTC başlangıç/bitişiyle aşağıdaki kaynaklardan toplanır (komutlar SERVER-SETUP §5.1 adım 6).
8. **Üretim DB'sine dönüş:** SERVER-SETUP §5.1 adım 7; pilot trafiğinden önce zorunludur.

| Ölçüm | Kaynak |
|---|---|
| Uç gecikmesi ve sonuçlar | `load:run` raporu (JSON + Markdown): sınıf başına (`login`; `kayit` = bütün yazmalar: kayıt, onay, düzelt ve onayla; `rapor`; `okuma`) p50/p95/p99/max; planlanan/gerçekleşen hız ve gönderim gecikmesi |
| RAM | Süreç: `dolmus-runtime event=runtime_metrics` satırında `rss_bytes`, `heap_used_bytes`, `heap_total_bytes`. Makine: `dolmus-health event=metrics` satırında `mem_available_pct` |
| CPU / burst | Süreç: `runtime_metrics` `cpu_user_ms` + `cpu_system_ms` (aynı satırdaki `interval_ms`'e bölünür). Makine: `aws lightsail get-instance-metric-data` ile `CPUUtilization`, `BurstCapacityPercentage`, `BurstCapacityTime` |
| Event-loop | `runtime_metrics` `el_p50_ms`, `el_p99_ms`, `el_max_ms`; dış gözlem olarak `dolmus-health event=metrics` `live_ms` |
| Disk | `dolmus-health event=metrics` `disk_used_pct`, `disk_level` (veri dosya sistemi; yük DB'si aynı dosya sistemindedir) |
| WAL | Yük DB'sinin `-wal` boyutu SERVER-SETUP §5.1 adım 6'daki örnekleme döngüsüyle. `dolmus-health` `wal_bytes` yalnız üretim DB'sinin (`app.sqlite-wal`) boyutudur, yük DB'sini göstermez |
| SQLite beklemesi | `runtime_metrics` `tx_count`, `tx_p99_ms`, `tx_max_ms` (süreye `BEGIN IMMEDIATE` beklemesi dahil), `tx_lock_failures` (SQLITE_BUSY/LOCKED) |
| Argon2 kuyruğu | `runtime_metrics` `hash_verifications`, `hash_max_pending`, `hash_longest_wait_ms`; uygulama logunda `RATE_LIMITED` / `HASH_QUEUE_FULL` satırları (OPS §2) |
| Mali bütünlük | `load:run` defter mutabakatı (`lost`, `duplicate`, `inconsistent`) ve her koşu sonrası `integrity:check` satırı |

**Karar kuralı**

- `active-mix` (normal karışık yük): **kayıt p95 ≤ 2 sn, rapor p95 ≤ 3 sn, beklenmeyen hata < %1**. `login-burst` ve `write-peak` için bekleme ve toparlanma süreleri ayrıca yazılır; yalnız ortalama süreyle başarı ilan edilmez. Üç senaryonun sonuçları birbirinin yerine kullanılmaz.
- Başarılı mali işlem **kaybı, çift işlem ve hesap/onay tutarsızlığı 0**; her koşu sonrası `integrity:check` geçer.
- Ayrı sayılanlar: beklenen **409** (`VERSION_CONFLICT`, `REQUEST_ID_REUSED`; bilerek üretilen çakışma sondaları), **429** koduyla (`RATE_LIMITED`, `HASH_QUEUE_FULL`), **yetki reddi** (401/403; yük kullanıcıları meşru olduğundan raporda `unexpected` altında koduyla ayrı satırdır ve her biri incelenir), sonucu bilinmeyen yazma ve beklenmeyen. Meşru kullanıcıya dönen tek bir 429 bile geçer sayılmaz; engellenerek elde edilen hız başarılı kapasite değildir.
- Sağlık görevi koşu sırasında durdurulmaz. `live` üç kez kaçıp düzeltici restart veya kurtarma kilidi oluşursa bu bir **bulgudur**: zamanı ve `event=decision` satırı kayda geçer, koşu temiz sayılmaz.
- Dar boğaz görülürse önce sorgu/işlem iyileştirmesi değerlendirilir; 4 GB pakete veya PostgreSQL'e geçiş ancak ölçüm, gerekçe ve ürün sahibi kararıyla olur (OPS §8).

**Sonuç kaydı (her senaryo için ayrı doldurulur; boş alan = ölçülmedi)**

~~~text
Senaryo: login-burst | active-mix | write-peak
Yayın adayı commit / artifact_sha256 (rapordaki release alanı):
Hedef URL / üretici makine / hedef makine paketi:
Veri seti: araç / kişi / gün / kayıt / revizyon / onay sayıları, sourceCommit:
Isınma / kademeli artış / sürdürülen süre (sn); başlangıç–bitiş (UTC):
acceptance_eligible ve nedenleri:
login / kayit / rapor / okuma p50-p95-p99-max (ms):
Başarı / beklenen 409 / 429 (koda göre) / yetki reddi / bilinmeyen / beklenmeyen:
Defter: lost / duplicate / inconsistent; unresolved:
Süreç öldürme (yalnız write-peak): zaman (UTC), toparlanma süresi, yeniden deneme sonucu:
integrity:check satırı ve çıkış kodu:
RAM (rss max, mem_available_pct min) / CPU (süreç %, CPUUtilization max) / BurstCapacityPercentage min:
Event-loop el_p99_ms max / live_ms max:
Disk disk_used_pct max / yük DB -wal max bayt:
SQLite tx_p99_ms max / tx_max_ms max / tx_lock_failures toplam:
Argon2 hash_max_pending max / hash_longest_wait_ms max:
Sağlık görevi kararları (restart / kilit) ve diğer bulgular:
Sonuç: geçti / kaldı; kaydeden:
~~~

## 4. Bulgu ve kanıt takibi

Her koşuda sürüm/commit, QA grubu, Story/AC, fixture tohumu, DB/Node/paket sürümleri, tarayıcı/OS, adımlar, beklenen/gerçek sonuç ve temizlenmiş log/ekran kanıtı bulunur. Durumlar **planlandı / çalıştırılmadı / geçti / başarısız / karar bekliyor** olarak ayrılır; atlanan test geçti sayılmaz. Mevcut bir takip aracı zorunlu değil; bu belge GitHub issue oluşturmaz.

| Önem | Örnek / etkisi |
|---|---|
| Kritik | Mali veri kaybı/çift hesap, işletmeler arası sızıntı, yanlış onay veya geri dönülemeyen veri bozulması; yayını durdurur. |
| Yüksek | Temel kayıt/onay/giriş işinin kullanılamaması, yetki atlama, restore edilemeyen yedek; yayını durdurur. |
| Orta | Temel akışı bozmayan işlev eksikliği; etkisi ve geçici çözümü açık yazılır, ilgili zorunlu AC kapatılmaz. |
| Düşük | Kozmetik/ikincil metin sorunu; okunabilirliği veya hesap anlamını bozuyorsa düşük sınıfta tutulmaz. |

Bulgu kaydı: `QA/Story/AC · önem · alan · adımlar · beklenen · gerçek · ortam/sürüm · kanıt · sorumlu · düzeltme · yeniden test sonucu`. Kapanışta hatayı yeniden üreten test ve uygun regresyon çalışır; yalnız kod değişti diye bulgu kapanmaz.

## 5. Manuel telefon kontrolü

- [ ] Android Chrome ve iPhone Safari'de linkten giriş, kişi seçimi, saat/para girişi ve tek Kaydet gerçek cihazda tamamlanır; temsili kullanıcıların 30–60 saniye hedefi süre/hata/yardım ihtiyacıyla ölçülür, önceden başarı ilan edilmez.
- [ ] 320 px genişlik, %200 yakınlaştırma, uzun/Türkçe adlar, açık zemin ve mavi-beyaz görünüm; tutar ve düğmeler okunur, yatay taşma temel işi engellemez.
- [ ] Dokunma alanı, telefonun sayı/saat klavyesi, görünür odak ve klavye sırası; VoiceOver/TalkBack ile alan etiketi ve hata/durum açıklaması kontrol edilir.
- [ ] Yavaş bağlantı, kayıt sırasında kopma, tekrar deneme ve telefon değişimi yanlış başarı/çift kayıt doğurmaz; bilinmeyen sunucu sonucu anlaşılır görünür.
- [ ] Sahip 6.200 TL bekleneni ve 6.000 TL alınanı ayırır; Düzelt ve onayla sonrası güncel toplamla geçmişi karıştırmaz; ekip işlemi sahip adına görünür.
- [ ] Boş dönem, bekleyen/onaylı kayıt, pasif şoför ve aynı adlı iki kişi anlaşılır; şoför geçmişi/düzeltme adımları K1 kararı tamamlanınca eklenir.

## 6. Açık kararlar ve kabul kapısı

**Karar durumu (2026-09-17):** K1–K8 için buradaki öneriler ürün sahibi tarafından aynen kabul edildi; K9 sürümleri kanıtla sabitlendi. Nihai kararlar ve gerekçeler [DECISIONS.md](DECISIONS.md) dosyasındadır; bu bölümdeki 'açık/onay bekliyor' ifadeleri tarihsel bağlamdır.

| Karar | QA'ya bağlanacağı yer / mevcut sınır |
|---|---|
| K1 | QA03, QA08–QA10: ortak şoförün görebileceği kayıt/teslim ve onaysız düzeltme süresi kararı gelmeden bu testlerin beklenen sonuçları kesinleştirilmez. |
| K2 | QA03–QA05, QA11: tek plaka erişimi kendiliğinden çok araca genişletilmez; sahibin araç bilgisi yetkisi ilgili kararla sınanır. |
| K3 | QA06, QA11: gece/eşit saat/azami süre/hafta başlangıcı ve dönem dağılımı açıklığa kavuşunca sınır örnekleri eklenir; 570 dakikalık aynı gün örneği kesindir. |
| K4 | QA10–QA11: aynı türde atomik düzeltme kesindir; driver↔owner dönüşümü onaylanmış sayılmaz. |
| K5 | QA07, QA09–QA11: negatif matematik sonucu korunur; kayıt/teslim arayüzünün ve kabulünün mali anlamı netleşmeden ilgili akış geçti sayılmaz. |
| K6 | QA07, QA11: günlük isteğe bağlı masraf kesindir; kategori/kalem ve bağımsız sahip giderleri kapsam kararı gerektirir. |
| K7 | QA08, QA12: güvenli tekrar gönderim ve yanlış başarı göstermeme zorunlu; çevrimdışı kuyruk/senkronizasyon kararı ayrı test paketi doğurur. |
| K8 | QA04–QA05, QA10: ortak sahip/devir geçmişi dönüştürmez; henüz onaylanmış yeni iş akışı yoktur. |
| K9 | QA02, QA13–QA16: kesin sürüm, şifre teslimi, hesap/alan adı ve dış sağlık/uyarı kanalı ilgili uygulama/yayın öncesinde belirlenir. |

QA belgesinin hazırlanması bu ürün kararlarının onayı değildir. K1/K3/K5'in mali/erişim akışını etkileyen açık parçaları özellikle kabul engeli olarak görünür tutulur; bağımsız kesin kuralların geliştirme ve testi devam edebilir. Yayın adayı, kendi kapsamındaki yayın öncesi AC ve PRD kontrolleri ile restore/yük/telefon kanıtları tamamlanınca değerlendirilir. S6.6'nın gerçek yayın ve yayın sonrası kontrolleri, yayın sırasında/sonrasında kapanır; M6 ancak bunlar da geçince tamamlanır.

| Kapsam | Durum |
|---|---|
| QA planı | Kod öncesi plan hazırlandı; uygulama ve ölçüm kanıtı henüz yok. |
| Ürün kapsamı | Kesin PRD kararları korundu; açık sınırlar yukarıda bağlı. |
| Teknik/ürün kabulü ve canlı yayın | Test sonuçları, açık kararlar ve sorumlular tamamlandığında ayrıca kaydedilecek; bu belge onay verilmiş yayın değildir. |
