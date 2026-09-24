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
| SQLite bekleme ve WAL | Başlangıç `busy_timeout=2000ms`; `event=metrics wal_bytes=…` (WAL boyutu; sayısal eşik ölçümle kesinleşir); tekrarlayan kilit hatası veya sürekli WAL büyümesi | Uzun transaction/okumayı araştır; sınırsız tekrar veya WAL silme uygulama |
| Giriş sayacı (F13) | Uygulama logunda `RATE_LIMITED` ve `HASH_QUEUE_FULL` (429) satırları: `[<uç>] <KOD> (request_id=…)`. Plaka, IP, kullanıcı adı ve parola satıra yazılmaz. `journalctl -u dolmus-takip \| grep -c RATE_LIMITED` ile sayılır; sayısal alarm eşiği pilot ölçümüyle belirlenir | Yeni bir yoğunlaşma (ör. dakikada tekrarlayan satırlar) brute-force veya tek kaynak taşması olabilir; 429'u meşru engellenme diye gizleme, kaynağı `request_id` ile araştır |
| Argon2 hash kuyruğu (F13) | Yalnız `HASH_QUEUE_FULL` satırında `hash_active=<n> hash_pending=<n> hash_longest_wait_ms=<ms>`; sınırlar 4 eşzamanlı / 100 bekleyen / 10 sn ([DECISIONS](DECISIONS.md)) | Kuyruk dolması login yavaşlığı ve CPU baskısıdır; `hash_pending` sürekli sınıra yakınsa saldırı mı gerçek yük mü ayır, sınırı gerekçesiz yükseltme |
| Yanıt/hata | Normal karışık yük başlangıç hedefi: kayıt p95 ≤2 sn, rapor p95 ≤3 sn, beklenmeyen hata <%1 | Canlı alarm penceresini pilot ölçümüyle belirle; 409/429/yetki reddini ayır, meşru engellenmeyi gizleme |
| Günlük yedek | Hazırlık gecikmesi/başarısızlığı, tamamlanmayan snapshot veya belirsiz kopya ilişkisi | Son doğrulanmış kurtarma noktasını göster; yedek arızasını uyar; §4'teki üç durumu ayrı izle |

Dış kontrol yalnız herkese açık giriş sayfasına erişir; şifreyle otomatik müşteri işlemi yapmaz. İç canlılık/hazırlık localhost'ta kalır. Dış kontrol hizmetin erişilebilirliğini, yerel hazırlık DB'yi ölçer; ikisi birlikte denenir. Planlı bakımın uyarı davranışı belirlenir, bakım kaydı kaybolmaz.

Her gün sorumlu; dış erişimi, yerel servis/hazırlık durumunu, restart/kilit olaylarını, disk/WAL/log büyümesini ve son yedek durumunu kontrol eder. Bildirim arızası da işletim arızasıdır; sadece alarm üretildiği değil sorumluya ulaştığı sınanır.

Loglar zaman, request_id, sürüm, işlem türü ve gerekli hata kodunu taşır; şifre/token/oturum değeri veya gereksiz kişisel mali veri içermez. Sağlık görevi satırları `dolmus-health event=<ad> ts=<UTC> anahtar=değer …` biçimindedir ve yalnız durum/sayı taşır. Caddy erişim satırı (JSON, journald) **istek ve yanıt başlıklarını hiç içermez** (Cookie, Authorization, Set-Cookie yok); şunları taşır: zaman, **istemci IP'si**, yöntem, host, URI (sorgu dizesi dahil), HTTP durumu, yanıt boyutu, süre. İstemci IP'si kişisel veridir: yalnız işletim incelemesi için kullanılır ve journald sınırıyla (~200 MB) döner; uygulama URL'sine gizli değer koymaz (varsayım, kodda ayrıca doğrulanmadı). İşlem geçmişi DB'de korunur ve teknik loglardan ayrıdır. Olay kanıtında UTC; kullanıcıyla paylaşımda açıkça Europe/Istanbul kullanılır.

## 3. Ortak müdahale kuralları

1. Olayın başlangıcını, görünen etkisini, çalışan sürümü ve son başarılı işlemi kaydet; ilk teşhisi salt okunur kontrollerle yap.
2. Veri bütünlüğü riskinde yeni yazmaları bakım moduyla durdur; devam eden kısa işlemleri kontrollü bitir. Yetkisiz okuma/sızıntı şüphesinde etkilenen özel okuma ve yazma yollarını/oturumlarını da geçici kapat; kapsam belirsizse müşteri verisine erişimi durdur. Yalnız yazmaları durdurmak okuma sızıntısını çözmez. Arızalı veriyi doğruymuş gibi gösteren yeni bir salt okunur ürün modu ekleme.
3. Yayın, migration, yedek hazırlığı ve restore **aynı işletim kilidini** kullanır. Kilidin sahibini doğrulamadan silme; ikinci işlem başlatma. Bakımda sağlık otomasyonu restart yapmaz.
4. **Kalıcı kurtarma kilidi** ayrı bir korumadır: restart sınırından sonra otomasyonu ve uygulama açılışını durdurur. Süre geçmesi/reboot kilidi kaldırmaz; neden incelenmeden sayaç sıfırlanmaz.
5. Mevcut DB, WAL, ilgili sürüm/manifest ve olay loglarını koru; dosya silerek kilit açmaya çalışma. Çalışan SQLite'ın yalnız ana dosyasını kopyalamak tutarlı yedek değildir.
6. Otomatik eski DB restore'u ve otomatik kopya birleştirme yapılmaz. DB bulunamıyorsa boş DB oluşturarak hizmeti açma; kurtarma kararını yetkili sorumlu verir.

## 4. Günlük yedek ve geri yükleme

### Günlük hazırlık ve kontrol

Seçim günde bir Lightsail otomatik snapshot ve son **7** otomatik snapshot'tır. Yerelde son **2** doğrulanmış SQLite kopyası tutulur; bunlar ayrı bir uzak yedek değildir. S3/saatlik yedek planı yoktur. Yedi snapshot sınırı uygulamadaki en az beş yıllık kayıt/revizyon saklama süresini kısaltmaz.

1. Architecture başlangıç önerisi: Europe/Istanbul 02:30 hazırlık, 02:55 hazır kopya son saati, 03:00 snapshot hedefi. AWS UTC dönüşümünü ve gerçek snapshot penceresini kurulumda doğrula; tam dakikada başlama varsayma.
2. Ortak işletim kilidiyle SQLite Backup API kullanarak tarihli geçici kopya al. Hazırlıkla eşzamanlı yayın/migration/restore çalıştırma; normal kısa kullanıcı işlemleri Backup API'nin tutarlı görüntüsüyle yürüyebilir.
3. Kopyanın kendi bağlantısında `integrity_check`, `foreign_key_check`, son kayıt/revizyon, güncel onay ve mali toplamları doğrula. Hazırlık sürerken değişen canlı toplamlarla yanlış eşitlik arama.
4. Manifestte kopya hash'i, şema/uygulama sürümü, kopyadaki son commit edilmiş işlem ve doğrulama zamanını tut. Kopya/manifesti diske senkronla; hazır adına atomik taşı ve dizini senkronla.
5. Hazır kopyayı snapshot penceresinde değiştirme. Son saate yetişmediyse bugünkü snapshot'a girmiş sayma; önceki sağlamı koru ve gecikmeyi uyar.
6. Her kopyanın uyumlu release çıktısı ve sürüm manifestini kopya tutulduğu sürece koru; snapshot bu kodu da kapsasın. Yeni kopya başarısızsa eski sağlam kopyayı temizleme.
7. AWS snapshot kimliği/durumu/zamanını, önceden hazır olan değişmez kopya ve uyumlu release ile ilişkilendir. Son yedi snapshot ve yerelde son iki sağlam kopya saklamasını günlük denetle.

| Ayrı durum | Gerekli kanıt | Kanıtlamadığı şey |
|---|---|---|
| DB kopyası hazır | Başarılı kopya kontrolleri, hash/manifest, hazır zamanı ve uyumlu release | Makine dışı snapshot'ın tamamlanması |
| AWS snapshot başarılı | AWS tamamlanma durumu/kimliği/zamanı; hazır kopyayla doğrulanmış ilişki | Bu snapshot'tan uygulamanın gerçekten geri açıldığı |
| Restore sınandı | Belirli snapshot'tan ayrı makinede giriş/veri/rapor kontrolleri ve süre kaydı | Daha sonraki bütün snapshot'ların sınandığı |

Kopya/snapshot bağı belirsizse yeni başarılı DB yedeği ilan edilmez. Son geçerli nokta ve başarısız günler görünür tutulur. Günlük kontrol kaydı; kopya/hash/son işlem, release, snapshot kimliği/durumu, ilişki sonucu, son restore ve kontrol eden kişiyi içerir.

### Kontrollü restore

1. Neden, etki ve son kabul edilen müşteri yazmalarını değerlendir; mevcut DB/WAL'ı koru. Hedef snapshot'ı ve içindeki doğrulanmış kopyayı seç; üretim üzerine deneme yapma.
2. Ortak kilit/bakım koşulunu sağla. Snapshot'ı ayrı makineye aç; hazırlık boyunca genel müşteri erişimini kapalı tut. Makine açılamıyorsa yerel kilide güvenmek yerine ikinci kurtarma işlemi başlatılmadığını sorumlu koordine eder.
3. Manifest/hash, uyumlu kod/şema, dosya izinleri ve servis ayarlarını doğrula. Snapshot'ın rastgele canlı DB görüntüsü yerine hazırlanmış doğrulanmış kopyayı kullan. Kopyadaki eski oturumları iptal et; yedekten sonraki parola sıfırlama/pasiflik kararlarını güncel işletim bilgisiyle kontrol et. Güncelliği doğrulanamayan girişi yeniden doğrulanıp gerekirse sıfırlanana kadar kapalı tut; eski oturum ve yetkileri yedekten kontrolsüz diriltme, aktör geçmişini silme.
4. Yerel canlılık/hazırlık, giriş ve işletme/araç/kişi ilişkilerini; son kayıt, revizyon, güncel onay ve rapor toplamlarını denetle. Beklenen/kalan ile alınan tutarları karıştırma; E4/E5 örnekleriyle kontrol et.
5. Kopyadaki son commit edilmiş işlemin zamanı/kimliğini kurtarma noktası olarak yaz. Snapshot saati bunu ikame etmez. Başlangıçtan doğrulanmış hizmete kadar toparlanma süresini ölç; henüz ölçülmüş süre yoktur.
6. Veri aralığı ve doğrulama sonucu anlaşılınca sorumlu kontrollü trafik geçişi yapar; iki makineye aynı anda müşteri yazması açılmaz. RELEASE smoke ve izleme kontrolüyle sonucu kaydet.

Günlük aralık ve hazırlık penceresi kadar yeni kayıt kaybı olabilir; yedek arızaları aralığı uzatır. Sıfır kayıp veya kesin toparlanma süresi sözü verilmez. Kayıp aralığı bilinmiyorsa bilinmiyor yazılır; eski/yeni DB kayıtları otomatik birleştirilmez.

İlk pilot öncesi restore zorunlu doğrulamadır; sonraki aylık tekrar Architecture önerisidir. Deneme makinesinin geçici maliyeti bütçeye yazılır, kanıt alındıktan sonra gerekli olmayan deneme kaynakları kontrollü kaldırılır. Kaynak makine silinmeden korunacak otomatik snapshot önce manuel snapshot olarak saklanır.

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
**Müdahale:** Önceki sağlam kopya/release'i koru; disk, ortak kilit, görev/log ve snapshot durumunu incele. Geç tamamlanan kopyayı bugünkü snapshot içinde varmış gibi işaretleme; son güvenli kurtarma noktasını güncelle.  
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

- [ ] Sorumlu kişi/alternatif, gerçek kanal, dış giriş URL'si ve denenmiş uyarı yolu kayıtlıdır.
- [ ] Çökme/donma, bakım, restart sınırı ve kalıcı kilit; ayrı DB hazırlık/makine arızası yolları gerçek denemeyle doğrulanmıştır.
- [ ] Günlük kopya/snapshot/restore durumları ayrıdır; son iki kopya, uyumlu kod ve son yedi snapshot ilişkisi kanıtlıdır.
- [ ] Ayrı restore, ölçülen kurtarma noktası/süre ve veri/yayın geri dönüş sınırları anlaşılır biçimde kayıtlıdır.
- [ ] Günlük kontrol, bakım ve olay rehberi gerçek ortam bilgileriyle tamamlanmıştır; QA/RELEASE kabulüyle kontrollü pilot açılışı ve yayın sonrası smoke planlanmıştır.

Kutular plan gereksinimidir; henüz hiçbir kontrolün geçtiği, hizmetin yayında olduğu veya M6'nın tamamlandığı anlamına gelmez.
