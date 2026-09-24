# Ops: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.1  
**Durum:** Koddan önce hazırlanmış işletim planı; sunucu, izleme, alarm veya yedek kurulmadı. Gerçek olay/test kanıtı yoktur. Sunucu tarafı sağlık otomasyonu (T6.3) **hazırlandı, denenmedi**: dosyalar `deploy/health/` ve `deploy/systemd/` altındadır, denemeler [SERVER-SETUP](SERVER-SETUP.md) §5 satır 10–16'dadır.  
**Kaynaklar:** [Architecture](ARCHITECTURE.md) §8–9 · [Tech Stack](TECH-STACK.md) §5–10 · [PRD](PRD.md) §8–9 · [Stories](STORIES.md) S6.2–S6.6 · [Milestones](MILESTONES.md) M6 · [QA planı](QA-PLAN.md) · [Release](RELEASE.md).  
**Şablon:** Project Blueprint / 11-ops; seçilen tek Lightsail, native servisler ve günlük snapshot planına uyarlandı.

## 1. Amaç, sorumluluk ve hizmet sınırı

Bu rehber tek 2 vCPU/2 GB Lightsail üzerinde Caddy, Next.js/Node ve SQLite hizmetini izleme, arızayı ayırma, veriyi koruyarak toparlama ve tekrarı önleme içindir. Geliştirme sırasında gerçek servis adları/komutlar eklenir; denenmemiş örnek komutlar çalıştırılabilir talimat gibi verilmez. Yayın ve migration sırası [RELEASE.md](RELEASE.md) belgesindedir.

| Açık bilgi | İlk pilot öncesinde gereken |
|---|---|
| İşletim sorumlusu ve ulaşılabilir alternatif | Gerçek kişi adları, erişim yetkileri ve ulaşma yolu yazılır; henüz atanmadı |
| Dış kontrol ve ekip uyarı kanalı | Makineden bağımsız kontrolün yeri, gerçek kanal ve deneme bildiriminin ulaştığı kişi kaydedilir. **Yerel sağlık görevi uyarı göndermez**, yalnız journal'a yazar; bu kanal olmadan uyarı kimseye ulaşmaz |
| Tamamen durmuş makine | **Otomatik olarak algılanmaz** (risk yazılıdır): yerel zamanlayıcı da makineyle durur. Yalnız dış erişim kontrolü ve ekip uyarısı yakalar; ikisi kurulmadan bu risk açıktır |
| Ortam kimliği | Alan adı, AWS bölge/instance, servis adları ve yetkili SSH yolu RELEASE ortam tablosunda tamamlanır |
| Kontrol takvimi | Günlük kontrolü kimin yapacağı, snapshot penceresi ve restore deneme takvimi kesinleştirilir |

Müdahale eldeki imkânlarla mümkün olan en kısa sürede yapılır; nöbet hizmeti, kesin yanıt süresi, %99,9 erişilebilirlik veya iki saatte çözüm taahhüdü verilmez. Ek ücretli izleme ürünü seçilmemiştir; müşteri SMS/e-posta özelliği eklenmez. Eksik sorumlu/kanal bilgisiyle pilot işletime hazır sayılmaz.

| Önem | Örnek | İlk davranış |
|---|---|---|
| Kritik | Yanlış mali kayıt, işletmeler arası erişim, makine kaybı, tüm hizmetin durması | Sorumluya ulaş; veri/yetki etkisini sınırla; arıza kaydı aç ve ilgili müdahale yolunu uygula |
| Yüksek | Hazırlık/son snapshot başarısız, bir temel akış kullanılamıyor, kritik disk seviyesi | Sorumlu inceler; son güvenli durumu ve etkiyi belirler; gerektiğinde kritik olarak ele alır |
| Normal | İşlemleri engellemeyen görünüm veya küçük performans sorunu | Etkiyi kaydet; planlı düzeltme ve doğrulama tarihini belirle |

## 2. İzleme ve uyarılar

Lightsail'ın CPU/ağ metrikleri, yerel RAM/disk/servis ölçümleri ve journald kullanılır. RAM/disk ölçümü AWS tarafından kendiliğinden geliyor varsayılmaz. Aşağıdaki başlangıç değerleri Architecture §8.2 ve §9'dan gelir; uygulama/deneme sonunda gerçek ayarlar ve sonuçlar kaydedilir.

| Kontrol | Eşik / yorum | Aksiyon |
|---|---|---|
| Makine dışından HTTPS | Gerçek alan adındaki herkese açık araç giriş sayfasının yanıtı/içeriği; sıklık ve ardışık hata eşiği S6.3'te kesinleşir | Uyar; DNS/TLS/Caddy/makine ayrımını yap. İç health uçlarını dışarı açma; giriş sayfası başarısını DB sağlığı sayma |
| Yerel canlılık | `/api/v1/health/live`; 30 saniyede bir (`dolmus-takip-health.timer`), 3 saniye timeout, 3 ardışık hata; başlangıç toleransı 90 saniye. Journal: `event=probe`, `event=decision` | Bakım/kilit/bütçe uygunsa sınırlı düzeltici restart; donma yolunu uygula |
| Yerel hazırlık | `/api/v1/health/ready`; küçük uygulama tablo okumasıyla DB ve şema; hata bildir | DB/disk yolunu uygula; tek başına bu hata restart döngüsü başlatmaz |
| Süreç çökmesi | Uygulama için `Restart=on-failure`, `RestartSec=10s`; 900 saniyede 3 start sınırı | systemd sınırlı dener; sınırda kalıcı kurtarma kilidi ve ekip müdahalesi. Caddy ayrı servis olarak izlenir |
| Düzeltici restart | 15 dakikada en çok 2; bakımda ve paralel sağlık görevinde yapılmaz | Sınır dolunca kalıcı kilit; otomatik sayaç sıfırlama veya kilit açma yok |
| Disk | Başlangıç önerisi: %80 uyarı, %90 kritik. Sağlık görevi her koşuda `event=metrics disk_used_pct=… disk_level=ok\|warn\|critical` yazar (uyarı `warn`, kritik `err` önceliğiyle) | Büyümeyi ölç; koruma kurallarıyla güvenli temizlik planla. Yazma hatası/tutarlılık riski varsa bakıma al |
| Log hacmi | journald toplam `SystemMaxUse=200M` (`deploy/journald/dolmus-takip.conf`); `journalctl --disk-usage` ile doğrulanır | Sınırlı döndürmeyi doğrula; mali kayıt/revizyonları log temizliğiyle silme |
| RAM, CPU/burst, event-loop | Sağlık görevi `mem_available_pct` yazar, `live_ms`/`ready_ms` gecikmesi event-loop baskısının ilk işaretidir; yük testi tabanı, OOM ve sürekli baskı; sayısal alarm eşikleri ölçümle kesinleşir (henüz eşik yoktur, yalnız ölçüm) | Süreç/sorgu nedenini araştır; kaynak veya DB değişikliğini gerekçesiyle ayrıca değerlendir |
| Çalışma zamanı ölçümü (S6.6) | Uygulama 60 sn'de bir tek satır yazar: `dolmus-runtime event=runtime_metrics ts=<UTC> interval_ms=… el_p50_ms=… el_p99_ms=… el_max_ms=… rss_bytes=… heap_used_bytes=… heap_total_bytes=… cpu_user_ms=… cpu_system_ms=… tx_count=… tx_p99_ms=… tx_max_ms=… tx_lock_failures=… hash_verifications=… hash_max_pending=… hash_longest_wait_ms=…`. Değerler o aralığa aittir ve her satırda sıfırlanır; `tx_*` yazma işleminin `BEGIN IMMEDIATE` beklemesini de içerir. Satır yalnız sayı taşır (plaka, kullanıcı adı, parola, token, çerez, IP, istek gövdesi yok). Okuma: `sudo journalctl -u dolmus-takip.service --since "-1h" -o cat --no-pager \| grep 'event=runtime_metrics'`; ölçüm alınamazsa `event=runtime_metrics_failed`. Sayısal alarm eşiği yoktur; yük testi tabanıyla karşılaştırılır | `el_p99_ms`/`el_max_ms` sürekli yüksekse donma yoluna (§5-B), `tx_lock_failures` artıyorsa §5-C'ye, `hash_max_pending` 100'e yakınsa giriş yüküne bak; sayıyı yük raporundaki tabanla karşılaştır |
| SQLite bekleme ve WAL | Başlangıç `busy_timeout=2000ms`; `event=metrics wal_bytes=…` (WAL boyutu; sayısal eşik ölçümle kesinleşir); tekrarlayan kilit hatası veya sürekli WAL büyümesi | Uzun transaction/okumayı araştır; sınırsız tekrar veya WAL silme uygulama |
| Giriş sayacı (F13) | Uygulama logunda `RATE_LIMITED` ve `HASH_QUEUE_FULL` (429) satırları: `[<uç>] <KOD> (request_id=…)`. Plaka, IP, kullanıcı adı ve parola satıra yazılmaz. `journalctl -u dolmus-takip \| grep -c RATE_LIMITED` ile sayılır; sayısal alarm eşiği pilot ölçümüyle belirlenir | Yeni bir yoğunlaşma (ör. dakikada tekrarlayan satırlar) brute-force veya tek kaynak taşması olabilir; 429'u meşru engellenme diye gizleme, kaynağı `request_id` ile araştır |
| Argon2 hash kuyruğu (F13) | Yalnız `HASH_QUEUE_FULL` satırında `hash_active=<n> hash_pending=<n> hash_longest_wait_ms=<ms>`; sınırlar 4 eşzamanlı / 100 bekleyen / 10 sn ([DECISIONS](DECISIONS.md)) | Kuyruk dolması login yavaşlığı ve CPU baskısıdır; `hash_pending` sürekli sınıra yakınsa saldırı mı gerçek yük mü ayır, sınırı gerekçesiz yükseltme |
| Yanıt/hata | Normal karışık yük başlangıç hedefi: kayıt p95 ≤2 sn, rapor p95 ≤3 sn, beklenmeyen hata <%1 | Canlı alarm penceresini pilot ölçümüyle belirle; 409/429/yetki reddini ayır, meşru engellenmeyi gizleme |
| Günlük yedek | `dolmus-takip-backup.service` (02:30 Europe/Istanbul) `dolmus-backup event=…` satırlarını journal'a yazar; başarısız koşu `event=backup_failed reason=… message=…` (`err` önceliği) yazar ve **birim başarısız** görünür (`systemctl --failed`); kilit 600 sn içinde alınamazsa `flock` 75 ile çıkar. Uyarı **yalnız journal'dadır** (§1: ekip kanalı kurulana dek kimseye ulaşmaz). `journalctl -u dolmus-takip-backup.service -p err --since "-26h" --no-pager` günlük kontrole girer; tamamlanmayan snapshot veya belirsiz kopya ilişkisi de aynı kontrolde aranır | Son doğrulanmış kurtarma noktasını göster; yedek arızasını uyar; §4'teki üç durumu ayrı izle |

Dış kontrol yalnız herkese açık giriş sayfasına erişir; şifreyle otomatik müşteri işlemi yapmaz. İç canlılık/hazırlık localhost'ta kalır. Dış kontrol hizmetin erişilebilirliğini, yerel hazırlık DB'yi ölçer; ikisi birlikte denenir. Planlı bakımın uyarı davranışı belirlenir, bakım kaydı kaybolmaz.

Her gün sorumlu; dış erişimi, yerel servis/hazırlık durumunu, restart/kilit olaylarını, disk/WAL/log büyümesini ve son yedek durumunu kontrol eder. Bildirim arızası da işletim arızasıdır; sadece alarm üretildiği değil sorumluya ulaştığı sınanır.

Loglar zaman, request_id, sürüm, işlem türü ve gerekli hata kodunu taşır; şifre/token/oturum değeri veya gereksiz kişisel mali veri içermez. Sağlık görevi satırları `dolmus-health event=<ad> ts=<UTC> anahtar=değer …` biçimindedir ve yalnız durum/sayı taşır. Caddy erişim ve hata satırları (JSON, journald) **istek ve yanıt başlıklarını hiç içermez** (Cookie, Authorization, Set-Cookie, X-Csrf-Token yok); `q` ve `cursor` sorgu değerleri silinir (personel araması ve plaka türevi imleç), diğer sorgu parametreleri (kimlik/sabit değer) kalır. Satır şunları taşır: zaman, **maskelenmiş istemci IP'si (IPv4 /16, IPv6 /32)**, yöntem, host, yol ve kalan sorgu, HTTP durumu, yanıt boyutu, süre; kaynak port yoktur. Süzgeç hem site erişim logunda hem işleyici hatalarının gittiği `http.log.error` için genel adlandırılmış logda aynıdır. Maskelenmiş IP yine de kişisel veriye yakındır: yalnız işletim incelemesi için kullanılır ve journald sınırıyla (~200 MB) döner. İşlem geçmişi DB'de korunur ve teknik loglardan ayrıdır. Olay kanıtında UTC; kullanıcıyla paylaşımda açıkça Europe/Istanbul kullanılır.

## 3. Ortak müdahale kuralları

1. Olayın başlangıcını, görünen etkisini, çalışan sürümü ve son başarılı işlemi kaydet; ilk teşhisi salt okunur kontrollerle yap.
2. Veri bütünlüğü riskinde yeni yazmaları bakım moduyla durdur; devam eden kısa işlemleri kontrollü bitir. Yetkisiz okuma/sızıntı şüphesinde etkilenen özel okuma ve yazma yollarını/oturumlarını da geçici kapat; kapsam belirsizse müşteri verisine erişimi durdur. Yalnız yazmaları durdurmak okuma sızıntısını çözmez. Arızalı veriyi doğruymuş gibi gösteren yeni bir salt okunur ürün modu ekleme.
3. Yayın, migration, yedek hazırlığı ve restore **aynı işletim kilidini** kullanır. Kilidin sahibini doğrulamadan silme; ikinci işlem başlatma. Bakımda sağlık otomasyonu restart yapmaz.
4. **Kalıcı kurtarma kilidi** ayrı bir korumadır: restart sınırından sonra otomasyonu ve uygulama açılışını durdurur. Süre geçmesi/reboot kilidi kaldırmaz; neden incelenmeden sayaç sıfırlanmaz.
5. Mevcut DB, WAL, ilgili sürüm/manifest ve olay loglarını koru; dosya silerek kilit açmaya çalışma. Çalışan SQLite'ın yalnız ana dosyasını kopyalamak tutarlı yedek değildir.
6. Otomatik eski DB restore'u ve otomatik kopya birleştirme yapılmaz. DB bulunamıyorsa boş DB oluşturarak hizmeti açma; kurtarma kararını yetkili sorumlu verir.

## 4. Günlük yedek ve geri yükleme

### Günlük hazırlık ve kontrol

Seçim günde bir Lightsail otomatik snapshot ve son **7** otomatik snapshot'tır. Yerelde en yeni **2** doğrulanmış SQLite kopyası (ve bağlı release'leri) tutulur; yeni kopya yayımlandıktan **sonra** eskisi temizlenir, kopya başarısızsa hiçbir kopya silinmez. Bunlar ayrı bir uzak yedek değildir ve yerel kopya tek başına makine kaybına karşı yedek sayılmaz. S3/saatlik yedek planı yoktur. Yedi snapshot sınırı uygulamadaki en az beş yıllık kayıt/revizyon saklama süresini kısaltmaz.

1. Takvim: Europe/Istanbul 02:30 hazırlık (`dolmus-takip-backup.timer`, telafi koşusu yok), 02:55 hazır kopya son saati, Lightsail otomatik snapshot **00:00 UTC = 03:00 Europe/Istanbul** (Türkiye sabit UTC+3; kurulum [SERVER-SETUP](SERVER-SETUP.md) §3.5). Gerçek snapshot başlangıcını kurulumda doğrula; tam dakikada başlama varsayma.
2. Ortak işletim kilidiyle (`/var/lib/dolmus-takip/ops.lock`; yayın/migration de aynı dosyayı tutar) SQLite Backup API kullanarak tarihli geçici kopya al (`dolmus-takip` olarak `scripts/db-backup.ts run`). Hazırlıkla eşzamanlı yayın/migration/restore çalıştırma; normal kısa kullanıcı işlemleri Backup API'nin tutarlı görüntüsüyle yürüyebilir.
3. Kopyanın kendi bağlantısında `integrity_check`, `foreign_key_check`, son kayıt/revizyon, güncel onay ve mali toplamları doğrula. Hazırlık sürerken değişen canlı toplamlarla yanlış eşitlik arama.
4. Manifestte kopya hash'i, şema/uygulama sürümü, kopyadaki son commit edilmiş işlem ve doğrulama zamanını tut. Kopya/manifesti diske senkronla; hazır adına atomik taşı ve dizini senkronla.
5. Hazır kopyayı snapshot penceresinde değiştirme. Son saate yetişmediyse bugünkü snapshot'a girmiş sayma; önceki sağlamı koru ve gecikmeyi uyar.
6. Her kopyanın uyumlu release çıktısı ve sürüm manifestini kopya tutulduğu sürece koru; snapshot bu kodu da kapsasın. Yeni kopya başarısızsa eski sağlam kopyayı temizleme.
7. AWS snapshot kimliği/durumu/zamanını, önceden hazır olan değişmez kopya ve uyumlu release ile ilişkilendir. Son yedi snapshot ve yerelde son iki sağlam kopya saklamasını günlük denetle.

Üç durum **üç ayrı günlük kayıt** olarak tutulur; birinin kaydı diğerinin yerine yazılmaz: (1) **'DB kopyası hazır'** — her gün kopya birimi çıkışı ve `backup_copy`/`backup_status` satırları; (2) **'AWS snapshot başarılı'** — her gün `get-auto-snapshots` durumu ve zamanı; (3) **'restore sınandı'** — yalnız ayrı makinede yapılan restore denemesinde, snapshot kimliğiyle.

| Ayrı durum | Gerekli kanıt | Kanıtlamadığı şey |
|---|---|---|
| DB kopyası hazır | Başarılı kopya kontrolleri, hash/manifest, hazır zamanı ve uyumlu release | Makine dışı snapshot'ın tamamlanması |
| AWS snapshot başarılı | AWS tamamlanma durumu/kimliği/zamanı; hazır kopyayla doğrulanmış ilişki | Bu snapshot'tan uygulamanın gerçekten geri açıldığı |
| Restore sınandı | Belirli snapshot'tan ayrı makinede giriş/veri/rapor kontrolleri ve süre kaydı | Daha sonraki bütün snapshot'ların sınandığı |

Snapshot ile hazır kopya arasındaki bağ kurulamıyorsa (kopya snapshot başlangıcından önce yayımlanmamış, manifest yok veya hash uyuşmuyor) o snapshot **iyi yedek ilan edilmez**; yalnız 'AWS snapshot başarılı' kaydı düşülür, 'DB kopyası hazır' kaydı ayrıca değerlendirilir. Kopya/snapshot bağı belirsizse yeni başarılı DB yedeği ilan edilmez. Son geçerli nokta ve başarısız günler görünür tutulur. Günlük kontrol kaydı; kopya/hash/son işlem, release, snapshot kimliği/durumu, ilişki sonucu, son restore ve kontrol eden kişiyi içerir.

### Kontrollü restore

Restore iki durumda yapılır: (A) **ayrı makinede restore denemesi** — ilk pilottan önce zorunlu, sonra ayda bir önerilir; 'restore sınandı' kaydı yalnız bununla düşülür; (B) **üretimde restore** — DB kaybı/bozulması gibi bir olayda, yetkili sorumlunun kararıyla. İkisi de aynı aracı (`scripts/db-restore.ts`, arşivin içindedir) aynı sırayla kullanır; üretim verisi üzerine deneme yapılmaz.

**Araç** (`dolmus-takip` kullanıcısıyla, kopyanın uyumlu olduğu release dizininden çalışır; root olarak çalıştırılırsa reddeder):

| Komut | Ne yapar | Reddettiği durumlar (`event=restore_failed reason=…`, çıkış ≠ 0) |
|---|---|---|
| `verify --manifest <backup-ready/app-….manifest.json>` | Salt okunur. Kopyanın hash/boyutu, release'i, bütünlüğü, şeması, pay/kalan hesabı, araç dönem raporu toplamları ve manifestteki son kayıt; giriş kimliklerini (`event=restore_principal`: id, plaka/kullanıcı adı, aktiflik, `credential_version`; parola hash'i asla) listeler; başarıda `event=restore_verified recoverable_point=…` | `copy_hash_mismatch`, `release_mismatch`, `integrity_check_failed`, `foreign_key_check_failed`, `schema_not_current`, `entry_amount_mismatch`, `report_totals_mismatch`, `manifest_record_mismatch`, `manifest_invalid`, `copy_missing` |
| `install --manifest <…>` | Ortak kilidi alır (en çok 900 sn; alınamazsa **75** ile çıkar), `verify`'ın tamamını çalıştırır, kopyayı veri dizinine alıp BÜTÜN oturumları uygulama o DB'yi görmeden iptal eder; mevcut `app.sqlite`/`-wal`/`-shm` **silinmez**, `/var/lib/dolmus-takip/preserved/<zaman>/` altına taşınır; `event=restore_installed revoked_sessions=… preserved=…` | `maintenance_off` (bakım işareti yok), `service_active` (uygulama servisi `inactive`/`failed` değil), `ops_lock_busy`, `data_dir_owner_mismatch`, `sessions_not_revoked` ve `verify`'ın bütün nedenleri. Boş DB hiçbir yolda oluşturulmaz |
| `report --started-at <ISO> [--incident-at <ISO>]` | Restore kaydı: `event=restore_record recoverable_point=… recovery_duration_s=… loss_window_s=…` (olay zamanı yoksa `unknown`) | `db_missing`, `incident_before_recoverable_point` |

Kurtarılabilir nokta **kopyanın kendi satırlarından** (son revizyon, teslim onayı veya denetim izi; hangisi en yeniyse) okunur; snapshot saati veya dosya zamanı bunu ikame etmez, manifestteki `last_committed_record` yalnız çapraz kontroldür. `verify`, kopyanın manifestindeki `release_id` dizininden çalıştırılır: daha yeni bir release'ten çalıştırmak geçerli bir kopyada `release_mismatch` verir; bu durumda doğru release dizinine geçilir, kopya "bozuk" sayılmaz.

**A. Ayrı makinede restore denemesi.** Çalışma makinesinde, [SERVER-SETUP](SERVER-SETUP.md) "Değişkenler" tanımlıyken:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# 1) başlangıç zamanı (UTC) kayda yazılır; toparlanma süresi bundan ölçülür
RESTORE_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$RESTORE_STARTED_AT"
# 2) tamamlanmış otomatik snapshot seçilir (date, status = Success)
aws lightsail get-auto-snapshots --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --resource-name "$DOLMUS_INSTANCE" --query 'autoSnapshots[].[date,status]' --output table
# 3) deneme makinesi o snapshot'tan açılır; statik IP ve DNS bağlanmaz (müşteri erişemez)
aws lightsail create-instances-from-snapshot --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-names "$DOLMUS_INSTANCE-restore-<tarih>" --availability-zone "$DOLMUS_AZ" \
  --bundle-id "$DOLMUS_BUNDLE_ID" --key-pair-name "$DOLMUS_KEY_PAIR" \
  --source-instance-name "$DOLMUS_INSTANCE" --restore-date <YYYY-MM-DD>
aws lightsail get-instance-state --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE-restore-<tarih>"   # running olana dek tekrarlanır
```

Deneme makinesinde (SSH, yeni instance'ın ana makine anahtarı doğrulanarak — [SERVER-SETUP](SERVER-SETUP.md) §1.4):

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# 4) deneme makinesi dışarıya ve zamanlayıcılara kapalı; bakım işareti; uygulama durur
sudo systemctl disable --now caddy.service dolmus-takip-health.timer dolmus-takip-backup.timer
sudo install -m 0644 -o root -g root /dev/null /var/lib/dolmus-takip/maintenance
sudo systemctl stop dolmus-takip.service
# 5) snapshot başlangıcından ÖNCE yayımlanmış en yeni kopya ve onun release'i seçilir
sudo -u dolmus-takip sh -c 'cat /var/lib/dolmus-takip/backup-ready/*.manifest.json' | grep -E '"(stem|published_at|release_id|sha256)"'
MANIFEST=/var/lib/dolmus-takip/backup-ready/<stem>.manifest.json
REL=/opt/dolmus-takip/releases/<release_id>
# 6) doğrula; çıkış 0 ve restore_verified satırı olmadan devam edilmez
cd "$REL" && sudo -u dolmus-takip node scripts/db-restore.ts verify --manifest "$MANIFEST"
# 7) yerleştir (kilit, bakım işareti ve durmuş servis araç tarafından denetlenir)
cd "$REL" && sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env scripts/db-restore.ts install --manifest "$MANIFEST"
# 8) current kopyanın release'ini göstermiyorsa ortak kilit altında atomik değiştirilir
sudo flock -w 900 -E 75 /var/lib/dolmus-takip/ops.lock sh -euc \
  'ln -sfn "$1" /opt/dolmus-takip/current.tmp && mv -T /opt/dolmus-takip/current.tmp /opt/dolmus-takip/current' _ "$REL"
# 9) başlat; yerel hazırlık
sudo systemctl start dolmus-takip.service
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
# 10) kontroller bittikten sonra restore kaydı (olay yoksa --incident-at verilmez: kayıp aralığı unknown)
cd "$REL" && sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env scripts/db-restore.ts report --started-at "<RESTORE_STARTED_AT>"
```

Adım 9 ile 10 arasında elle kontrol edilir ve sonuç kayda yazılır:

1. `restore_principal` satırları güncel işletim bilgisiyle karşılaştırılır: kopyadan sonra parolası sıfırlanan, pasifleştirilen araç/işletme/ekip hesabı varsa o giriş, güncel durumu uygulanana (parola yeniden sıfırlanana, pasiflik yeniden verilene) kadar kapalı tutulur. Eski oturumların hepsi `install` ile iptal edildi; aktör geçmişi (revizyon, onay, denetim izi) silinmez.
2. Giriş, işletme/araç/kişi ilişkileri, son kayıt, revizyon geçmişi ve güncel teslim onayı E4/E5 örnekleriyle denetlenir. Rapor toplamlarının kopyayla eşitliği `verify`'da makineyle kanıtlandı; ekranda beklenen/kalan ile alınan tutarlar karıştırılmadan yeniden bakılır. Makinenin açılması veya DB dosyasının bulunması başarılı restore sayılmaz.
3. Deneme makinesinde giriş denemesinin yolu (SSH tüneli veya geçici alan adı) ilk denemede belirlenir ve buraya yazılır; üretim alan adı deneme makinesine yönlendirilmez.

**B. Üretimde restore.** Yetkili sorumlu karar verir; önce olay başlangıcı, etki ve son kabul edilen müşteri yazmaları kaydedilir. Adım 1 ve 4–10 **aynı makinede** uygulanır, farkları: adım 4'te yalnız bakım işareti konur ve uygulama durdurulur (Caddy ve zamanlayıcılar kapatılmaz; Caddy bakım işaretini görüp dışarıya 503 verir, sağlık görevi restart yapmaz); adım 10'da `--incident-at <olayın UTC zamanı>` verilir. `install`'ın taşıdığı eski DB/WAL `preserved/<zaman>/` altında inceleme için kalır; eski ve yeni DB kayıtları otomatik birleştirilmez. Bakım işareti (`sudo rm /var/lib/dolmus-takip/maintenance`) yalnız kontroller geçip sorumlu kontrollü trafik geçişine karar verince kaldırılır; iki makineye aynı anda müşteri yazması açılmaz.

- **Daha eski kopyaya dönüldüyse sonraki günlük yedek reddedilir:** `backup-ready`'deki daha yeni manifest daha fazla satır taşıdığı için `event=backup_failed reason=row_count_drop` beklenir. Bu bir **işletim kararıdır**: ya yeni kopyalar kanıt olarak yerinde bırakılır ve ret günlük kontrolde kayda geçer, ya sorumlu daha yeni kopya+manifest çiftlerini `preserved/<zaman>/` altına **taşır** (kayda yazarak). Manifest veya kopya bu reddi aşmak için **silinmez**.
- Kilit alınamazsa (`install` 75 ile çıkar) çalışan yedek/yayın bitmeden restore yapılmaz; kilidin sahibi doğrulanmadan kilit dosyası silinmez (§3).

**Restore kaydı** (her deneme ve her üretim restore'u için bir satır):

| Alan | Kaynak |
|---|---|
| Tarih, sorumlu, tür (deneme/üretim) | Elle |
| Snapshot tarihi/kimliği ve durumu | Adım 2 |
| Kopya `stem`, `sha256`, `release_id` | Adım 5–6 (`restore_verified`) |
| Kurtarılabilir nokta ve kaydı | `restore_record recoverable_point`, `recoverable_record` |
| Toparlanma süresi | `restore_record recovery_duration_s` |
| Kayıp aralığı | `restore_record loss_window_s` (olay zamanı yoksa `unknown`) |
| Giriş/ilişki/rapor kontrolleri ve kapalı tutulan girişler | Adım 9–10 arası kontroller |
| Deneme maliyeti | Instance saat sayısı × paket saatlik ücreti (12 USD/ay paket ≈ 0,017 USD/saat) + manuel snapshot depolaması (0,05 USD/GB-ay); gerçek faturadan kontrol edilir |
| Temizlik | Silinen deneme instance'ı adı, silme zamanı ve `get-instance` sonucunun `NotFoundException` olduğu |

Günlük aralık ve hazırlık penceresi kadar yeni kayıt kaybı olabilir; yedek arızaları aralığı uzatır. Sıfır kayıp veya kesin toparlanma süresi sözü verilmez. Kayıp aralığı bilinmiyorsa bilinmiyor yazılır; eski/yeni DB kayıtları otomatik birleştirilmez.

İlk pilot öncesi restore zorunlu doğrulamadır; sonraki aylık tekrar Architecture önerisidir. Deneme makinesinin geçici maliyeti bütçeye ve restore kaydına yazılır; kanıt alındıktan sonra deneme makinesi kontrollü kaldırılır ve kaldırıldığı doğrulanır:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
aws lightsail delete-instance --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE-restore-<tarih>"
aws lightsail get-instance --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE-restore-<tarih>"   # beklenen: NotFoundException
```

**Makineyi silmeden önce (zorunlu adım):** Otomatik snapshot'lar kaynak instance ile birlikte silinebilir. Korunacak nokta önce **manuel snapshot** olarak alınır; tamamlandığı görülmeden ve kopya ilişkisi kaydedilmeden instance silinmez. Bu kural üretim instance'ı ve kanıt olarak saklanacak deneme makinesi için geçerlidir; deneme makinesi kaynak instance'ın otomatik snapshot'larını taşımaz.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
aws lightsail create-instance-snapshot --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE" --instance-snapshot-name "$DOLMUS_INSTANCE-manuel-<tarih>"
aws lightsail get-instance-snapshot --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-snapshot-name "$DOLMUS_INSTANCE-manuel-<tarih>" --query 'instanceSnapshot.[name,state,createdAt]' --output text
# state = available olmadan instance silinmez
```

## 5. Arıza müdahale yolları

### A. Uygulama veya Caddy çöktü

**Tetikleyici:** Servis çıkışı/başlatma hatası veya dış erişim kaybı.  
**Müdahale:** Servis durumu, çıkış nedeni, son yayın ve OOM/logları salt okunur incele. systemd'nin gecikme ve start sınırına uyduğunu kontrol et; el ile tekrar başlatarak bütçeyi dolaşma. Caddy ile Node arızasını ayır.  
**Eskalasyon / dönüş:** Tekrarlıyorsa sorumlu nedeni giderir; kilidi kontrollü kaldırıp başlatır. Yerel live/ready ve dış giriş sayfası doğru olmadan toparlandı denmez; mali etki varsa F yolu uygulanır.

### B. Süreç var ama dondu / kurtarma kilidi oluştu

**Tetikleyici:** Canlılık üç kez başarısız, süreç yanıt vermiyor veya kalıcı kurtarma kilidi var.  
**Müdahale:** Başlangıç toleransı/bakımı kontrol et. Bağımsız görev yalnız uygulama `active` iken, üç ardışık canlılık hatasından sonra, bakım işareti/kilit/paralel koşu yokken ve 15 dakikada iki restart bütçesi içinde restart dener; bütçe dolunca veya dolmus-takip/caddy `start-limit-hit` olunca kilit (`/var/lib/dolmus-takip/health/recovery.lock`) yazar. Kilidin içinde zaman ve neden vardır. Log, event-loop ve kaynak baskısını incele: `sudo journalctl -u dolmus-takip-health.service -u dolmus-takip.service -u caddy.service --since "-1h" --no-pager`. Görev kilidi veya systemd sayacını otomatik sıfırlamaz.  
**Kilit kaldırma yordamı (yalnız ekip, neden giderildikten sonra):** (1) Nedeni kayda yaz ve `cat /var/lib/dolmus-takip/health/recovery.lock` içeriğini sakla; (2) gerekiyorsa `sudo systemctl reset-failed dolmus-takip.service caddy.service` (systemd sayacını yalnız insan sıfırlar); (3) `sudo rm /var/lib/dolmus-takip/health/recovery.lock`; (4) istersen sayaç eski restart zamanlarını taşımasın diye `sudo rm /var/lib/dolmus-takip/health/state.json` (bilinçli karar; silmezsen 15 dk penceresi kendiliğinden geçer); (5) `sudo systemctl start dolmus-takip.service`, sonra canlılık/hazırlık ve `journalctl -u dolmus-takip-health.service` ile `decision` satırlarını doğrula. Elle görev koşusu, paralel koşu engeli için sarmalayıcıyla: `sudo /usr/bin/flock -n /var/lib/dolmus-takip/health/run.lock /usr/bin/node /opt/dolmus-takip/health/health-check.mts`. Durum dosyası bozuksa görev `event=state_unreadable` yazar ve restart yapmaz; dosyayı inceleyip bilinçli kaldır.  
**Eskalasyon / dönüş:** Sorumlu nedeni gidermeden kilit açılmaz; reboot çözüm diye tekrarlanmaz (kilit reboot'ta da kalır, uygulama başlatılmaz). Kontrollü açılış ve canlılık/hazırlık doğrulanır; yeni hata varsa tekrar müdahale kaydı tutulur.

### C. DB hazırlık hatası / disk veya SQLite kilit sorunu

**Tetikleyici:** Live başarılıyken ready başarısız; DB yok/bozuk, şema uyumsuz, disk dolu/salt okunur ya da kilit hataları sürüyor.  
**Müdahale:** Bakım ve salt okunur teşhisle disk/izin/şema/sürüm/uzun transaction ayrımını yap. WAL, DB veya işlem geçmişini silme; eksik DB'yi yeniden oluşturma; her health isteğinde tam tarama veya aralıksız restart yapma.  
**Eskalasyon / dönüş:** Güvenli log/çıktı temizliğinde §6 korumalarına uy; DB bozulmasında §4 restore kararına geç. Hazırlık ve mali tutarlılık doğrulanmadan yazmaları açma.

### D. Makine tamamen erişilemiyor

**Tetikleyici:** Dış giriş kontrolü başarısız; yerel görevlere ulaşılamıyor.  
**Müdahale:** Dış kontrol/DNS/TLS ile AWS makine durumunu ayır; yalnız uygulama restart'ı varsayma. **Bilinen risk:** makine tamamen durmuşsa yerel timer ve sağlık görevi de durur; bu durum otomatik algılanmaz ve düzeltilmez, yalnız dış kontrol ve ekip uyarısı (henüz kurulmadı) yakalar. Son snapshot/manifest ilişkisini kontrol et; sınırsız reboot veya otomatik eski DB restore'u başlatma.  
**Eskalasyon / dönüş:** Sorumlu mevcut makineyi toparlama veya §4 ile ayrı makineye kurtarma yolunu seçer; veri noktası ve süreyi kaydeder. Eski makine dönünce ikinci yazan uygulama olarak açılmaz.

### E. Yedek hazırlığı veya snapshot başarısız

**Tetikleyici:** Son saat kaçtı, doğrulama başarısız, AWS snapshot tamamlanmadı veya kopya ilişkisi belirsiz.  
**Müdahale:** Önceki sağlam kopya/release'i koru; disk, ortak kilit, görev/log ve snapshot durumunu incele: `journalctl -u dolmus-takip-backup.service --since "-26h" --no-pager` (`event=backup_failed reason=…`; `flock` 75 = kilit alınamadı, yayın/migration/restore sürüyor olabilir), `systemctl --failed`. Uyarı yalnız journal'dadır; ekip kanalı kurulana dek günlük kontrolde aranır. Geç tamamlanan kopyayı bugünkü snapshot içinde varmış gibi işaretleme; son güvenli kurtarma noktasını güncelle.  
**Eskalasyon / dönüş:** Sorumlu nedeni düzeltir ve sonraki geçerli hazırlık/snapshot ilişkisini doğrular. Tutarlılık şüphesinde ayrı restore sınanır; yerel kopya başarısı tek başına olayı kapatmaz.

### F. Yanlış mali sonuç veya yetkisiz erişim şüphesi

**Tetikleyici:** Kayıp/çift kayıt, hesap/onay sürümü karışması, başka işletme verisi veya yetkisiz işlem.  
**Müdahale:** Kritik değerlendir; yeni yazmaları bakımla durdur, yetkisiz okuma şüphesinde ilgili özel veri yollarını/oturumlarını da kapat; kapsam belirsizse müşteri veri erişimini durdur. Kanıtı koru. Request_id, işletme/araç, sürüm, güncel onay ve gerçek aktörü salt okunur incele; beklenen ile alınan para ayrımını doğrula. Ele geçirilmiş erişim varsa yetkili oturum iptali/şifre sıfırlama yolunu uygula.  
**Eskalasyon / dönüş:** Sorumlu kapsamı belirler; müşteri düzeltmesi mevcut yetkili ve iz bırakan akıştan yapılır. Ham SQL ile geçmiş silme veya eski DB yükleme yapılmaz. Yazılım hatası RELEASE yoluyla düzeltilip QA/mali-yetki kontrolleri geçince açılır.

### G. Yayın veya migration başarısız

**Tetikleyici:** Çıktı/native uyumluluk, migration, başlatma, readiness veya yayın sonrası smoke hatası.  
**Müdahale:** Ortak kilit ve bakım altında RELEASE §7 kararını uygula; müşteri yazmasına açılma zamanını belirle. Uyumlu eski kod dönüşünü, yeni yazma alınmamışken doğrulanmış eski kod+DB dönüşünden ayır.  
**Eskalasyon / dönüş:** Yeni müşteri yazması alındıysa veya durum belirsizse eski DB'ye otomatik dönme; DB/WAL'ı koruyarak ileri düzeltme/planlı kurtarma yap. Sorumlu readiness, mali kontrol ve smoke sonucunu kaydeder.

## 6. Planlı bakım ve kapasite

- **Günlük:** §2 sağlık ve §4 yedek ilişki kontrolü; açık olaylar ve son doğrulanmış kurtarma noktasının kaydı. Başarısız kontrol sessizce atlanmaz.
- **Güncelleme öncesi:** Ubuntu/Caddy/Node ve uygulama bağımlılıklarını, güvenlik düzeltmelerini ve hedef native better-sqlite3/Argon2 uyumluluğunu değerlendir. Paket sürümleri sabitlenir; üretimde gelişigüzel toplu yükseltme/build yapılmaz.
- **Uygulama/şema değişikliği:** CI çıktısı, gerekli QA, ortak kilit, bakım, doğrulanmış ön kopya ve rollback ile RELEASE izlenir. SQLite WAL, bağlantı başına `foreign_keys=ON` ve `synchronous=FULL` korunur. OS/servis değişiminde gerekli kontrollü reboot ve son sağlık kontrolü ayrıca kaydedilir.
- **Saklama/temizlik:** Son iki hazır DB kopyası ve bağlı release'ler; yayın doğrulanana kadar önceki çalışan kod/ön kopya korunur. Teknik log ve gereksiz CI çıktısı temizliği kalıcı DB/WAL, en az beş yıllık iş kayıtları/revizyonlar veya mali işlem sonuçlarına dokunmaz.
- **Restore tekrarı:** İlk yayın öncesi, sonrasında önerilen aylık denemede ve kurtarma yöntemini etkileyen değişiklikte uyumlu sürümle doğrula; süreyi, son işlemi, mali sonucu ve geçici kaynak maliyetini kaydet.
- **Kapasite:** QA/S6.6'daki beş yıllık veri ve üç ayrı 100 kullanıcı/istek senaryosu esas alınır. RAM baskısı, CPU/burst veya SQLite yazma beklemesi ölçülmeden 4 GB'a/PostgreSQL'e geçilmez; değişiklik gerekçesi ve yeniden doğrulaması planlanır.

## 7. Olay sonrası değerlendirme

Kritik olay sonrasında suçlayıcı olmayan değerlendirme yapılır; diğer olaylarda tekrarlanma/etkiye göre uygulanır. Gerçek olay olduğunda aşağıdaki şablon doldurulur; şu anda boş postmortem dosyaları veya yapılmış olay kaydı üretilmez.

~~~text
Olay / önem / sorumlu / uygulama sürümü:
Başlangıç, fark edilme, bakım, doğrulanmış toparlanma zamanları (UTC):
Etkilenen akışlar, işletme/araç kapsamı ve bilinen/bilinmeyen veri etkisi:
Zaman çizelgesi; alarmın kime ne zaman ulaştığı:
Teknik neden, katkıda bulunan koşullar ve neden önceden yakalanmadığı:
Yapılan müdahale; restart/kilit, release veya restore kararının gerekçesi:
Kurtarma noktası / son commit edilmiş işlem / ölçülen süre / kayıp aralığı:
Doğrulama kanıtı ve müşteriye aktarılan doğrulanmış bilgi:
Tekrarı önleme işi, sorumlusu ve hedef tarihi; QA/rehber değişikliği:
Kapanış kararı, kalan risk ve sonraki kontrol:
~~~

## 8. Pilot öncesi işletim kabulü

Bu bölüm S6.6 AC8'in kayıt yeridir ve [RELEASE](RELEASE.md) §4 kapısının 13. kanıtıdır. Boş alan (`________`) gerçek değerin henüz bilinmediğini gösterir; örnek değerle doldurulmaz. Parola, anahtar veya token buraya yazılmaz; yalnız nerede saklandığı ve kimin erişebildiği yazılır.

### Açık ürün ve işletim kararları

| Karar | Durum | Kaynak | Pilota etkisi |
|---|---|---|---|
| Üretim AWS hesabı ve alan adı | **Açık** — seçilmedi | [tech-stack](tech-stack.md) "Production account and domain"; [DECISIONS](DECISIONS.md) K9 kalan kalemleri | Hedef makine, HTTPS ve `APP_ORIGIN` yok; S6.2–S6.6'nın hedef sunucu kanıtlarının hiçbiri alınamaz |
| Makine dışı sağlık kontrolü ve ekip uyarı kanalı | **Açık** — "şimdilik yok", yalnız yerel 30 sn sağlık görevi | tech-stack "Alert channel and external health check" | S6.3 AC6 geçemez; tamamen duran makine algılanmaz (§1, §5-D) |
| Pilot kapsamı: işletmeler/araçlar ve başlangıç zamanı | **Açık** — belirlenmedi | RELEASE §3 | Kapı açılsa da kontrollü yayın planlanamaz |
| Aydınlatma metnindeki veri sorumlusu alanları | **Açık** — metinde köşeli yer tutucular (`[Veri sorumlusunun unvanı]` vb.) yayından önce doldurulacak | architecture.md "Personal data notice and deletion policy (KVKK)" | Metin doldurulmadan müşteriye açılmaz; hukuki metin bu belgenin işi değildir |
| Ad anonimleştirmesinde eski `admin_audit` satırları | **Karar bekliyor** — eski satırlar önceki adı taşımaya devam ediyor; politika notu mu düzeltilecek, anonimleştirme mi genişletilecek | architecture.md "Personal data notice and deletion policy (KVKK)" | Silme talebi yanıtının kapsamını belirler |
| Müşteriye şifre teslimi (F14) | Karara bağlandı — ekip back office'te belirlediği şifreyi kendisi iletir; yeni servis yok | tech-stack "Password delivery to customers" | Teslimi yapacak ekip üyesi aşağıdaki erişim tablosunda adlanır |
| K1–K8 ürün kararları | Karara bağlandı (2026-09-17) | [DECISIONS](DECISIONS.md) | Pilot akışını engelleyen açık ürün kararı yok |
| Kapasite değişimi (4 GB paket / PostgreSQL) | Karar yok, ölçüm yok | S6.6 AC9; aşağıdaki kapasite kuralı | Ölçüm ve karar olmadan değişmez |

### Erişimler

| Erişim | Ne için | Sahibi | Yedek erişimi olan | Saklandığı yer |
|---|---|---|---|---|
| AWS hesabı (Lightsail yetkili profil, `AWS_PROFILE`) | Instance, statik IP, snapshot, metrik okuma, ayrı makinede restore | `________` | `________` | `________` |
| Alan adı ve DNS paneli (`DOLMUS_DOMAIN`) | A kaydı, sertifika sorunlarında DNS | `________` | `________` | `________` |
| SSH anahtarı (`DOLMUS_SSH_KEY`) ve sunucuda `sudo` | Kurulum, günlük kontrol, restore, yayın | `________` | `________` | `________` |
| GitHub deposu | `release.yml` tetikleme, arşiv/manifest indirme, CI sonuçları | `________` | `________` | `________` |
| Back office yönetici hesabı (kişisel) | Müşteri desteği, şifre sıfırlama ve teslimi | `________` | `________` | `________` |

Bir erişimin tek kişide kalması pilot riskidir: yedek erişim sütunu boşken kapı açılmaz.

### Yardım sorumlusu

| Alan | Değer |
|---|---|
| Yardım ve işletim sorumlusu | `________` |
| Ulaşılabilir alternatif | `________` |
| Müşterinin ulaşma yolu | `________` |
| Ulaşılabilir saatler | `________` (nöbet veya kesin yanıt süresi taahhüdü verilmez, §1) |
| Uyarının ulaştığı kanal | `________` (yukarıdaki açık karar kapanınca) |

### Günlük sağlık ve yedek kontrolü

Her gün sorumlu (yoksa alternatif) aşağıdakileri yapar ve sonucu tarih (UTC) ile kaydeder; başarısız veya atlanmış kontrol sessizce geçilmez. Komutlar **hazırlandı, denenmedi (elle kurulumda denenecek)**.

1. Servisler ve kilit: `systemctl is-active dolmus-takip caddy`; `ls /var/lib/dolmus-takip/health/recovery.lock` (dosya **olmamalı**; varsa §5-B).
2. Sağlık görevi: `sudo journalctl -u dolmus-takip-health.service --since "-24h" -o cat --no-pager | grep -E 'event=(decision|corrective_restart|recovery_lock_written|state_unreadable)' | grep -v 'action=none'` (boş olmalı) ve son `event=metrics` satırında `mem_available_pct`, `disk_used_pct`/`disk_level`, `wal_bytes`, `live_ms`/`ready_ms`.
3. Çalışma zamanı ölçümü: `sudo journalctl -u dolmus-takip.service --since "-24h" -o cat --no-pager | grep 'event=runtime_metrics' | tail -n 5` (her 60 sn'de bir satır olmalı; `runtime_metrics_failed` olmamalı). `el_p99_ms`, `rss_bytes`, `tx_p99_ms`, `tx_lock_failures`, `hash_max_pending` yük testi tabanıyla karşılaştırılır.
4. Giriş sınırları: `sudo journalctl -u dolmus-takip.service --since "-24h" --no-pager | grep -cE 'RATE_LIMITED|HASH_QUEUE_FULL'`; önceki günlere göre artış §2'deki F13 satırlarına göre incelenir.
5. Günlük kopya: `sudo journalctl -u dolmus-takip-backup.service -p err --since "-26h" --no-pager` (boş olmalı); `systemctl --failed`; tutulan kopyalar ve release'leri [SERVER-SETUP](SERVER-SETUP.md) §4'teki `db-backup.ts status` komutuyla.
6. Snapshot ve ilişki: `aws lightsail get-auto-snapshots --profile "$AWS_PROFILE" --region "$AWS_REGION" --resource-name "$DOLMUS_INSTANCE"` (çalışma makinesinde); son snapshot `Success` ve en yeni kopyanın `published_at`'i snapshot başlangıcından önce (§4 üç ayrı günlük kayıt).
7. Dış erişim ve uyarı kanalı: `________` (kanal seçilince yazılır).

### Kurtarma ve yayın adımları

Yeni yordam yazılmaz; bu rehberin ve RELEASE'in mevcut yolları uygulanır:

- **Arıza:** §5 A–G (çökme, donma/kurtarma kilidi, DB hazırlık/disk/kilit, makine erişilemiyor, yedek/snapshot, mali/yetki şüphesi, yayın/migration).
- **Geri yükleme:** §4 "Kontrollü restore" (ayrı makine denemesi ve üretim restore'u); ortak kural §3.
- **Yayın:** RELEASE §5 yayın adımları, §6 yayın sonrası kısa doğrulama, §7 geri dönüş kararı ve "İleri düzeltme (F5)"; sonuç RELEASE §8 kaydına.
- **Yük kabulü sonrası:** yük DB'sinden üretim DB'sine dönüş SERVER-SETUP §5.1 adım 7; pilot trafiğinden önce zorunludur.

### Kapasite kuralı

Başlangıç tek 2 vCPU / 2 GB Lightsail ve SQLite'tır. S6.6 yük raporları dar boğaz gösterirse önce sorgu veya işlem iyileştirmesi değerlendirilir. 4 GB pakete ya da PostgreSQL'e **sessizce geçilmez**: ölçülen dar boğaz (rapor ve `runtime_metrics`/Lightsail değerleri), gerekçe, maliyet, geçiş ve geri dönüş planı ile yeniden doğrulama [DECISIONS](DECISIONS.md)'a yazılır ve ürün sahibi karar verir; değişiklik sonrası ilgili yük senaryosu yeni yayın adayı commit'inde yeniden koşulur.

### Kabul kutuları

- [ ] Sorumlu kişi/alternatif, gerçek kanal, dış giriş URL'si ve denenmiş uyarı yolu kayıtlıdır.
- [ ] Çökme/donma, bakım, restart sınırı ve kalıcı kilit; ayrı DB hazırlık/makine arızası yolları gerçek denemeyle doğrulanmıştır.
- [ ] Günlük kopya/snapshot/restore durumları ayrıdır; son iki kopya, uyumlu kod ve son yedi snapshot ilişkisi kanıtlıdır.
- [ ] Ayrı restore, ölçülen kurtarma noktası/süre ve veri/yayın geri dönüş sınırları anlaşılır biçimde kayıtlıdır.
- [ ] Günlük kontrol, bakım ve olay rehberi gerçek ortam bilgileriyle tamamlanmıştır; QA/RELEASE kabulüyle kontrollü pilot açılışı ve yayın sonrası smoke planlanmıştır.

Kutular plan gereksinimidir; henüz hiçbir kontrolün geçtiği, hizmetin yayında olduğu veya M6'nın tamamlandığı anlamına gelmez.
