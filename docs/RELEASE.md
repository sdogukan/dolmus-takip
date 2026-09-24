# Release: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.1  
**Durum:** Geliştirme öncesi yayın planı; repo/CI/sunucu kurulmadı ve yayın yapılmadı.  
**Kaynaklar:** [QA planı](QA-PLAN.md) · [Milestones](MILESTONES.md) · [Tasks](TASKS.md) · [Architecture](ARCHITECTURE.md) §8–9 · [Tech Stack](TECH-STACK.md) · [Ops](OPS.md).  
**Şablon:** Project Blueprint / 10-release; tek makine, manuel tetiklenen kontrollü yayın ve SQLite'a uyarlandı.

## 1. Amaç ve yayın durumları

Release, test edilmiş belirli bir uygulama sürümünü kullanıcıya açma işidir. Bu belgeyi koddan önce hazırlıyoruz; gerçek sürüm, komut, ortam ve test sonuçları geliştirme sırasında eklenir. Boş ortam bilgisi örnek değerle doldurulup çalıştırılmaz.

| Durum | Ne anlama gelir? |
|---|---|
| Plan hazır | Bu rehber yazıldı; çalışan uygulama iddiası yok |
| Yayın adayı | Belirli kaynak sürümü, test sonucu ve üretim çıktısı hazır |
| Pilot için hazır | §4 "Pilot için hazır kapısı"nın her kanıtı **aynı yayın adayı commit'inde** alınmış ve geçmiş; pilot kapsamı belirlenmiş. Kullanıcı trafiği açılmamıştır |
| Yayınlandı | Seçilmiş çıktı canlı adrese alındı ve kullanıcı trafiği açıldı |
| Yayın doğrulandı | Yayın sonrası temel akışlar ve izleme kontrol edildi |

Üç durum birbirinin yerine geçmez: kapının geçmesi yayın yapıldığı, yayının yapılması doğrulandığı anlamına gelmez. S6.6 görevi (T6.6) **kapıda biter**; kontrollü pilot yayını (§5) ve yayın sonrası kısa doğrulama (§6) sonraki görevin işidir (kullanıcı kararı, 2026-09-24). Kapının kanıtları henüz alınmadı; sistem “Pilot için hazır”, “Yayınlandı” veya “Yayın doğrulandı” durumlarının hiçbirinde **değildir**.

M6'nın çıkışı kontrollü pilot yayını ve yayın sonrası doğrulamadır. M1–M5 sonunda gösterim yapılması müşteriye yayın yapılmış olduğu anlamına gelmez. Genel satış/abonelik açılışı bu MVP yayın planında yoktur.

## 2. Kaynak, sürüm ve dağıtım yaklaşımı

- Repo kurulurken sade GitHub Flow uygulanması planlanır: yayınlanabilir ana dal, kısa geliştirme/düzeltme dalları ve incelenen değişiklikler. Gerçek repo/ana dal adı kurulumda kaydedilir; bu belge dal oluşturmaz.
- Uygulama sürümleri MAJOR.MINOR.PATCH biçiminde tutulur. İlk pilot için v0.1.0 başlangıç önerisidir; henüz tag veya uygulama sürümü yoktur. Belge sürümleri uygulama sürümü değildir.
- Her yayın seçili commit, çıktı hash'i, bağımlılık lockfile'ı, Node/CPU/Ubuntu/SQLite sürümleri ve şema uyumluluğuyla tanınır. Hareketli bir dalın son hâli kontrolsüz indirilmez.
- GitHub Actions hedefle uyumlu üretim çıktısını hazırlar; SSH üzerinden sürümlü kurulum adımı **manuel tetiklenir**. Her push/tag üretime otomatik yayın yapmaz; üretim makinesinde build yapılacağı varsayılmaz.
- Uyumlu better-sqlite3/Argon2 native çıktıları hedef ortamda denenir. Next.js sunucusu tek Node sürecidir; Docker veya ikinci canlı uygulama örneği eklenmez.
- Şema değişikliği kod geri dönüşünden ayrı değerlendirilir. Mümkünse eski/yeni sürümle uyumlu küçük migration kullanılır; uyumsuz migration için birlikte veri/kod dönüş koşulu açıkça yazılır.

## 3. Gerçek ortamda doldurulacak bilgiler

| Bilgi | Nerede / ne zaman kesinleşir? |
|---|---|
| GitHub repo, ana dal ve yayın adayı commit | T1.1/T6.1; kaynak deposu oluşturulduğunda |
| Kilitlenmiş paketler, Ubuntu/CPU/Node/SQLite sürümleri | T1.1/T6.1; uyumluluk denemesiyle |
| AWS hesap/bölge/instance ve paket bütçesi | T6.2; mevcut Frankfurt başlangıç seçimi doğrulanarak; doğrulama durağı [SERVER-SETUP](SERVER-SETUP.md) §1 |
| Alan adı, DNS, IP ve SSH yetkili erişim yolu | T6.2; gerçek kaynaklar sağlanınca |
| Servis kullanıcıları, servis/görev adları ve çalıştırılabilir komutlar | T6.2–T6.5; uygulanıp denenen kurulumla; hazırlanan komutlar [SERVER-SETUP](SERVER-SETUP.md) (denenmedi; manuel kurulumda denenecek) |
| Dış erişim kontrolü, uyarı kanalı ve sorumlu | T6.3 ve OPS.md; uyarı gerçekten ulaştırılarak |
| Snapshot penceresi, hazırlık son saati ve son doğrulanmış kopya | T6.4–T6.5; Türkiye/UTC dönüşümü ve restore ile |
| Pilot araçları, başlangıç zamanı ve desteğe ulaşma yolu | T6.6; pilot kullanıma geçerken |

Gizli şifre/anahtar bu tabloya veya Git'e yazılmaz. Güvenli saklandığı yer ve kimin erişebildiği belirtilir. Eksik gerçek ortam bilgisi plan belgesini yazmayı engellemez; ilgili kurulum/yayın adımı tamamlanmış sayılamaz.

## 4. İlk pilot öncesi kontrol

### Pilot için hazır kapısı

Kapı, aşağıdaki kanıtların **tamamı** aynı yayın adayı commit'inde alınıp geçtiğinde açılır (S6.6 AC7). Başka bir commit'te, başka bir arşivde veya önceki bir denemede alınmış kanıt bu aday için geçersizdir; aday değişirse ilgili kanıt yeniden alınır. Bir satır boşsa veya `açık` ise kapı kapalıdır.

**Yayın adayı commit:** `________________________________________` · **Arşiv `artifact_sha256`:** `________` · **Kapı kararı (tarih UTC / karar veren):** `________`

| # | Kanıt | Nerede / nasıl | Kanıtın commit'i | Sonuç |
|---|---|---|---|---|
| 1 | Kabul izlenebilirlik tablosu: 35 hikâye ve PRD §9'un 28 maddesi | [QA-PLAN](QA-PLAN.md) §2 "Kabul izlenebilirlik tablosu"; her satır bu commit'te `geçti`, hiçbir satır `açık` değil | `________` | `________` |
| 2 | Otomatik kontroller ve yayın çıktısı (S6.1) | Aday commit'te CI (`ci.yml`) yeşil; `release.yml` arşivi ve manifesti (`source_commit` = aday); hedef Linux'ta `release:verify` | `________` | `________` |
| 3 | Kurulum, HTTPS, kalıcı veri (S6.2) | [SERVER-SETUP](SERVER-SETUP.md) §5 satır 1–9 | `________` | `________` |
| 4 | Çökme, donma, kurtarma kilidi, dış kontrol ve ekip uyarısı (S6.3) | SERVER-SETUP §5 satır 10–16; makine dışı kontrolün uyarısının sorumluya ulaştığı kayıt ([OPS](OPS.md) §8) | `________` | `________` |
| 5 | Günlük kopya, snapshot ve saklama (S6.4) | SERVER-SETUP §5 satır 17–21; OPS §4 üç ayrı günlük kayıt | `________` | `________` |
| 6 | Restore ve güvenli yayın geri dönüşü (S6.5) | OPS §4 "Kontrollü restore" ayrı makine denemesi (`restore_record`); SERVER-SETUP §5 satır 22–27 | `________` | `________` |
| 7 | Yük raporu: `login-burst` | QA-PLAN §3; `load:run` raporu `acceptance_eligible=true`, `release.sourceCommit` = aday | `________` | `________` |
| 8 | Yük raporu: `active-mix` (kayıt p95 ≤ 2 sn, rapor p95 ≤ 3 sn, beklenmeyen < %1) | QA-PLAN §3; aynı rapor koşulları | `________` | `________` |
| 9 | Yük raporu: `write-peak` ve süreç öldürme denemesi | QA-PLAN §3; SERVER-SETUP §5 satır 31 | `________` | `________` |
| 10 | Veri bütünlüğü: her yük koşusundan sonra `integrity:check` ve defterde kayıp/çift/tutarsız 0 | QA-PLAN §3; SERVER-SETUP §5 satır 32 | `________` | `________` |
| 11 | Üretim DB'sine dönüş, yük verisi kaldırıldı | SERVER-SETUP §5 satır 33 | `________` | `________` |
| 12 | Gerçek telefon kontrolleri ve temsili kullanım (S1.6, S3.6) | `tests/e2e/MANUAL-CHECKS.md` iki listesi | `________` | `________` |
| 13 | Pilot işletim kaydı: açık kararlar, erişimler, yardım sorumlusu, günlük kontrol, kurtarma/yayın adımları | [OPS](OPS.md) §8 | — | `________` |

Kapı yayın değildir: açıldıktan sonra da §5 kontrollü yayın ve §6 doğrulama ayrı yapılır ve §8 kaydına ayrı yazılır.

### Kontrol listesi

- [ ] QA planının ilgili birim, gerçek SQLite, API ve tarayıcı kontrolleri seçilen sürümde geçmiştir; kritik mali/yetki hatası veya açıklanmamış kararsız test yoktur.
- [ ] PRD'nin 28 maddesi, E1–E5 ve E6'nın yayın öncesi kabul kriterleri karşılanmıştır; pilotu etkileyen açık ürün kararı/sınırı belirlenmiştir. S6.6'nın gerçek yayın ve yayın sonrası kontrolü bu aşamada açık kalır, §5–6 uygulanınca kapanır.
- [ ] Üretim derlemesi ve native modüller hedefte çalışır; sırlar istemci/çıktı/loglara girmez. Test müşterileri gerçek müşteri hesaplarına karışmaz.
- [ ] HTTPS, dar ağ izinleri, kişisel ekip erişimi, parola saklama/sıfırlama ve kalıcı DB dizini doğrulanmıştır.
- [ ] Günlük yedek hazırlığı ve tamamlanmış snapshot ilişkisi doğrulanmıştır; ayrı restore denemesinde son kayıt ve mali toplamlar kontrol edilmiştir.
- [ ] Çökme, donma, kurtarma sınırları/kilidi, dış makine kontrolü ve ekip bildirimi denenmiştir; sorumlusu bellidir.
- [ ] Beş yıllık veri ve üç yük senaryosu hedef makinede raporlanmıştır; meşru engellenen istekler gizlenmemiş, başarılı mali işlem kaybı/çoğalması görülmemiştir.
- [ ] Yayın öncesi kopya ve geri dönüş yolu doğrulanmıştır. İlk kurulumda olmayan eski sürüm/yedek varmış gibi geri dönüş sözü verilmez.
- [ ] Pilot kapsamı, kullanıcıya erişim/şifre teslimi ve destek yolu hazırdır. PRD'de korunan aydınlatma/satış öncesi hazırlık ihtiyaçları ilgili sorumlu tarafından ele alınmıştır; bu belge hukuki metin üretmez.
- [ ] Paket, snapshot, geçici restore/yük ortamı ve CI/artifact giderleri güncel bütçede görülür; kod temizliği yedek için gereken sürümü silmez.

## 5. Yayın adımları

Yayın `scripts/release-apply.ts` ile yapılır (T6.5; arşivin içindedir, root olarak yeni release dizininden çalışır). Komutlar **hazırlandı, gerçek sunucuda denenmedi**; denemeler [SERVER-SETUP](SERVER-SETUP.md) §5 satır 25–27'dedir ve sonuç kayda geçene dek denenmiş gibi sunulmaz. Kurulum komutlarının tamamı [SERVER-SETUP](SERVER-SETUP.md) §4'tedir.

1. **Adayı sabitle:** Commit, çıktı hash'i (`artifact_sha256`), şema ve QA sonucunu seç; arşivi yeni `releases/<id>` dizinine aç, sürüm manifestini `releases/<id>.manifest.json` olarak yanına koy. Mevcut `current` dizininin üzerine açılmaz. `deploy` release dizinindeki migration dosyalarını bu manifestteki hash'lerle denetler; uyuşmazsa hiçbir şeye dokunmadan reddeder.
2. **Yayını başlat:** `cd /opt/dolmus-takip/releases/<id> && sudo node scripts/release-apply.ts deploy`. Aşağıdaki 3–8 bu tek komutun sırasıdır; her faz `/var/lib/dolmus-takip/release-state/state.json`'a yazılır.
3. **Ortak kilit:** Yayın, günlük yedek ve restore aynı `/var/lib/dolmus-takip/ops.lock` kilidini kullanır; 900 sn içinde alınamazsa araç 75 ile çıkar ve hiçbir adım çalışmaz. Kilidin sahibi doğrulanmadan kilit dosyası silinmez. Önceki yayın çözülmemişse (bakımda kaldıysa) veya bakım işareti zaten varsa yeni yayın başlamaz; tek istisna §7 "İleri düzeltme (F5)" 4. adımıdır.
4. **Bakım:** Bakım işareti konur (Caddy dış istekleri `503` ile keser, sağlık görevi restart yapmaz), sonra uygulama durdurulur; süren istekler `SIGTERM` ile tamamlanır ([SERVER-SETUP](SERVER-SETUP.md) §4).
5. **Geri dönüş tabanı:** Çalışan **eski** release'in `db-backup.ts pre-migration`'ı doğrulanmış yayın öncesi kopyayı (`/var/lib/dolmus-takip/pre-migration/`, günlük kopyayla aynı manifest biçimi, `release_id` = eski release) üretir; aynı anda DB parmak izi kaydedilir. Kopya başarısızsa migration çalışmaz, eski release `current`'ta kalır ve bakım altında yeniden başlar (§7).
6. **Migration:** Yeni release'in `db-init.ts --existing`'i servis kullanıcısıyla bir kez çalışır; uygulanan migration sayısı DB'den ölçülüp kaydedilir. Ardından toplamlar, korunan tabloların satır sayısı ve son kayıt kopyanın manifestiyle aynı olmalıdır; değilse `current` değişmeden durulur.
7. **Sürüm değişimi ve iç kontrol:** `current` atomik değişir, servis başlar; localhost `live` ve `ready` `200` olmalı, ardından salt okunur mali kontrol (integrity, foreign key, şema bu release'inki, pay/kalan yeniden hesabı, toplamlar/son kayıt kopyayla aynı, DB içeriği migration sonrasıyla aynı) geçmelidir. Giriş veya yazma isteği yapılmaz.
8. **Trafiği aç:** Kontroller geçtiyse önce `traffic_opened_at` yazılır, sonra bakım işareti kalkar. Bu andan sonra müşteri yazması kabul edilmiş sayılır ve eski DB'ye dönüş kapanır (§7).
9. **Yayın sonrası doğrula:** §6 listesini uygula. Hata varsa §7'ye göre karar ver. Doğrulama bitince `cd /opt/dolmus-takip/current && sudo node scripts/release-apply.ts mark-verified`.
10. **Sonucu kaydet ve temizle:** §8 kaydına `state.json` alanlarını (sürüm, önceki sürüm, `pre_migration`, `migrations_applied`, `traffic_opened_at`, `verified_at`) yaz. `cd /opt/dolmus-takip/current && sudo node scripts/release-apply.ts cleanup` `mark-verified`'dan önce önceki release'i ve yayın öncesi kopyayı, her zaman da tutulan bir kopyanın bağlı olduğu release'i silmez.

**Süre:** Ölçülmedi; kesin kesinti veya toparlanma süresi vaat edilmez. İlk kurulum ve yeni sürüm geçişi T6.5 denemesinde ayrı ölçülür.

## 6. Yayın sonrası kısa doğrulama

- [ ] Doğru HTTPS adresi açılır; sahip, şoför ve ekip girişi doğru kapsamı gösterir. İç health veya DB dosyası dışarı açılmaz.
- [ ] Ayrı test işletmesi/araçlarıyla günlük kayıt → sahip onayı → dönem raporu akışı çalışır; gerçek müşteri defterine deneme parası yazılmaz. Müşteri kaydı silerek deneme temizliği yapılmaz.
- [ ] %20/%0 hesap ve alınan/kalan ayrımı doğru; tekrar dokunma ikinci mali kayıt oluşturmaz. Ayrıntılı hata/çökme/yük testleri canlı müşterilerin üstünde tekrar edilmez.
- [ ] Sunucu logları, hazır olma durumu, hata oranı ve kaynaklar olağandır; dış kontrol ve ekip uyarı yolu aktiftir.
- [ ] Yayın öncesi ve hazır yedeklere referans veren kod korunur. Son günlük snapshot'ın yaşı izlenir; sadece deploy sırasında alınan yerel kopya makine dışı günlük yedek diye gösterilmez.

## 7. Geri dönüş kararı

Geri dönüş komutları geri alınan (yeni) release'in dizininden, root olarak çalışır: `cd /opt/dolmus-takip/releases/<id> && sudo node scripts/release-apply.ts rollback --code` veya `... rollback --code-and-db`. Araç koşulları kendi kanıtıyla denetler; koşul tutmazsa hiçbir şeyi değiştirmeden reddeder.

| Durum | Yapılacak işlem | Sınır |
|---|---|---|
| Çıktı/hash/QA sorunu, mevcut uygulama henüz değişmedi | Yeni sürümü yayınlama; mevcut sürümü koru (`deploy` manifest/migration hash uyuşmazlığında ön kontrolde reddeder) | Bozuk çıktı çalıştırılmaz |
| Bakım/migration öncesi kopya başarısız | `deploy` durur: `db-init` çalışmadı, eski release `current`'ta, bakım işareti yerinde, eski servis bakım altında yeniden başladı. Nedeni giderip `rollback --code` ile eski release'i doğrula ve trafiği aç (uygulanan migration 0) | Sağlam geri dönüş tabanı olmadan devam edilmez |
| Yeni kod bozuk, mevcut şema eski kodla uyumlu | `rollback --code`: yalnız bu yayının uyguladığı migration sayısı DB'den ölçülmüş ve 0 ise; eski kod açılır, readiness ve mali kontrol sonrası trafik verilir. Trafik açıldıktan sonra da kullanılabilir | Kod dönüşü DB dönüşü değildir; şema uyumu bir bayrağa değil ölçülen migration sayısına dayanır |
| Şema uyumsuz; yeni sürüm henüz müşteri yazması almadı | `rollback --code-and-db`: yalnız `traffic_opened_at` yoksa ve kilit altında, işaret varken, servis durmuşken okunan DB parmak izi kayıtlı olanla aynıysa. Eski release'in `db-restore.ts install`'ı yayın öncesi kopyayı yerleştirir; yeni DB/WAL `preserved/<zaman>/` altına taşınır, bütün oturumlar uygulama başlamadan iptal edilir; yerleşen DB'nin parmak izi servis başlamadan `rollback.restored_fingerprint`'e yazılır. Kopya yerleştikten sonra bir adım (başlatma, hazırlık, mali kontrol) başarısız olursa nedeni giderip aynı komut yeniden çalıştırılır: canlı parmak izi yerleşen kopyanınkiyle aynıysa `install` tekrarlanmadan `current` değişiminden devam edilir | Trafik açılmadan önceki kopya ve yazma durumu kanıtlanmalı; durum dosyası okunamıyorsa (`reason=state_unreadable`) veya canlı parmak izi ne kayıtlı olanla ne yerleşen kopyanınkiyle aynıysa (`reason=fingerprint_mismatch`) araç reddeder |
| Yeni müşteri yazmaları kabul edildi (`traffic_opened_at` var, parmak izi farklı veya yayın durumu belirsiz) | Eski DB'ye otomatik dönme; aşağıdaki **İleri düzeltme (F5)** yolunu uygula | Yeni hesapları/kayıtları eski kopyayla silme |
| Makine kaybı veya DB bozulması | OPS.md'deki ayrı makine restore yolunu uygula | RPO son doğrulanmış kopyadan; sıfır kayıp garantisi yok |

DB kopyasına dönüldüğünde kopyadaki oturumlar iptal edilir; parola/pasiflik ve erişim durumunun güncelliği kontrol edilir. Doğrulanamayan girişler yeniden doğrulanıp gerekirse sıfırlanana kadar kapalı kalır; aktör geçmişi silinmez. Hangi kayıtların kabul edildiği belirsizse “hiç yazma olmadı” varsayılmaz. Önce mevcut DB/WAL ve işlem izi korunur, durum incelenir. Kopyalardan kayıtlar otomatik birleştirilmez.

### İleri düzeltme (F5)

Şema uyumsuz bir migration uygulanmış ve trafik açıldıktan sonra sorun görülmüşse eski DB'ye dönülmez: o kopyaya dönmek, trafik açıldıktan sonra kabul edilen kayıtları, onayları ve hesap değişikliklerini siler. Yayın aracı bu durumda `rollback --code-and-db`'yi reddeder (`reason=traffic_opened`, `fingerprint_mismatch` veya `state_unreadable`). Yol:

1. **Bakımı aç:** `sudo install -m 0644 -o root -g root /dev/null /var/lib/dolmus-takip/maintenance`. Caddy yeni dış istekleri keser; sağlık görevi restart yapmaz.
2. **Canlı DB/WAL'ı koru:** servis durdurulur ve dosyalar silinmeden, üzerine yazılmadan `preserved/<zaman>-f5/` altına **kopyalanır** (canlı dosyalar yerinde kalır, ileri düzeltme onların üzerinde yapılır). Hash'ler kayda yazılır.
3. **İncele ve kaydet:** `release-state/state.json` (`traffic_opened_at`), `journalctl`, `traffic_opened_at` sonrası kayıt/revizyon/onay ve denetim izi. Kabul edilen müşteri yazmaları listelenir; hangi yazmanın kabul edildiği belirsizse “yazma olmadı” varsayılmaz.
4. **İleri düzelt:** Şema/kod düzeltmesi yeni bir release'te, var olan kayıtları silmeyen migration ile yapılır ve bakım işareti yerindeyken `cd /opt/dolmus-takip/releases/<düzeltme-id> && sudo node scripts/release-apply.ts deploy --under-maintenance` ile yayımlanır (yeni yayın öncesi kopya, mali kontrol; işaret yalnız kontroller geçince kalkar). `fingerprint_mismatch` veya başka bir hatayla bakımda kalan yayında düz `deploy` `reason=previous_release_unresolved`, okunamayan durum dosyasında `reason=state_unreadable` ile reddeder; `deploy --under-maintenance` bu durumu yalnız bakım işareti varken ve kurtarma kilidi yokken devralır. Eski `state.json` silinmez: baytları `release-state/taken-over-<zaman>.json` olarak saklanır, sha256'sı ve özeti (release, faz, hata, `pre_migration`, `traffic_opened_at`) yeni durumun `inherited` listesine ve journal'a (`event=release_state_taken_over`) yazılır. Düzeltme `mark-verified` ile doğrulanana dek `cleanup` devralınan durumun yayın öncesi kopyasını ve release'lerini, devralınan durum okunamadıysa hiçbir yayın öncesi kopyayı ve release'i silmez (5. adımın dönebileceği kopya korunur). Mali toplamları değiştiren bir migration'ı araç trafiği açmadan reddeder: tutar/onay düzeltmesi migration'la değil, trafik açıldıktan sonra uygulamanın denetim izli düzeltme yolu (düzelt-ve-onayla, revizyon, `admin_audit`) ile yapılır.
5. **Planlı kurtarma yalnız insan kararıyla:** eski bir kopyaya dönmek gerekiyorsa sorumlu karar verir, kayıp aralığı kayda geçer ve [OPS](OPS.md) §4-B üretim restore yolu uygulanır; yayın aracı bunu kendiliğinden yapmaz.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek) — adım 1–2
sudo install -m 0644 -o root -g root /dev/null /var/lib/dolmus-takip/maintenance
sudo systemctl stop dolmus-takip.service
sudo flock -w 900 -E 75 /var/lib/dolmus-takip/ops.lock sudo -u dolmus-takip sh -euc '
  d=/var/lib/dolmus-takip/preserved/$(date -u +%Y%m%dT%H%M%SZ)-f5
  mkdir -m 0750 "$d"
  for f in /var/lib/dolmus-takip/data/app.sqlite /var/lib/dolmus-takip/data/app.sqlite-wal /var/lib/dolmus-takip/data/app.sqlite-shm; do
    if [ -e "$f" ]; then cp -p "$f" "$d/"; fi
  done
  sha256sum "$d"/*
'
```

## 8. Yayın notu ve kanıt kaydı

Her gerçek yayında şu kısa kayıt tutulur; bu şablon henüz gerçek bir yayın kaydı değildir:

~~~text
Uygulama sürümü / kaynak commit / çıktı hash'i:
Şema, Ubuntu/CPU/Node/SQLite sürümleri:
Değişen hikâyeler ve kullanıcıya etkisi:
QA sonucu ve kabul edilen sınırlamalar:
Pilot için hazır kapısı (§4): aday commit, kapı kararı tarihi, 13 kanıtın yeri:
Yayın öncesi kopya / son snapshot / restore kanıtı:
Bakım başlangıcı / müşteri yazmasına açılma / doğrulama zamanı:
Yayını yürüten / işletim sorumlusu:
Geri dönüş yolu ve sonucu:
Yayın sonrası smoke / kalan işler:
~~~

Saatler kanıtta UTC, kullanıcıya gösterimde Europe/Istanbul olarak açık etiketlenir. Şifre/token veya gerçek kişilerin gereksiz mali ayrıntıları yayın notuna konmaz. Değişen bir yayın adımı, ilgili Tasks/Architecture/Ops bilgisiyle birlikte güncellenir.
