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
| Pilot için hazır | Restore/yük/işletim kontrolleri geçti; pilot kapsamı belirlendi |
| Yayınlandı | Seçilmiş çıktı canlı adrese alındı ve kullanıcı trafiği açıldı |
| Yayın doğrulandı | Yayın sonrası temel akışlar ve izleme kontrol edildi |

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
| AWS hesap/bölge/instance ve paket bütçesi | T6.2; mevcut Frankfurt başlangıç seçimi doğrulanarak |
| Alan adı, DNS, IP ve SSH yetkili erişim yolu | T6.2; gerçek kaynaklar sağlanınca |
| Servis kullanıcıları, servis/görev adları ve çalıştırılabilir komutlar | T6.2–T6.5; uygulanıp denenen kurulumla |
| Dış erişim kontrolü, uyarı kanalı ve sorumlu | T6.3 ve OPS.md; uyarı gerçekten ulaştırılarak |
| Snapshot penceresi, hazırlık son saati ve son doğrulanmış kopya | T6.4–T6.5; Türkiye/UTC dönüşümü ve restore ile |
| Pilot araçları, başlangıç zamanı ve desteğe ulaşma yolu | T6.6; pilot kullanıma geçerken |

Gizli şifre/anahtar bu tabloya veya Git'e yazılmaz. Güvenli saklandığı yer ve kimin erişebildiği belirtilir. Eksik gerçek ortam bilgisi plan belgesini yazmayı engellemez; ilgili kurulum/yayın adımı tamamlanmış sayılamaz.

## 4. İlk pilot öncesi kontrol

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

Bu işlem sırası T6.1–T6.5'te uygulanacak otomasyona bağlanacaktır. Henüz var olmayan script adları veya kopyalanıp çalıştırılabilecek hayali komutlar verilmez. Gerçek komutlar denendikten sonra bu rehbere eklenir.

1. **Adayı sabitle:** Commit, çıktı hash'i, şema uyumluluğu ve QA sonucunu seç; çıktı hedef makinedeki yeni release dizinine alınırken bütünlüğünü kontrol et. Mevcut current dizinini doğrudan üzerine yazarak güncelleme.
2. **Ortak kilidi al:** Yayın, yedek hazırlığı, migration ve restore aynı işletim kilidini kullanır. Başka işlem sürüyorsa üstüne ikinci işlem başlatma; kilidin sahibini doğrulamadan silme.
3. **Bakımı başlat:** Yeni yazmaları durdur, devam eden kısa işlemleri bitir. Sağlık otomasyonunun bakım modunda yeniden başlatma yapmadığını doğrula; uygulamayı kontrollü durdur.
4. **Geri dönüş tabanını hazırla:** Mevcut kurulum için migration öncesi tutarlı DB kopyası, hash/şema/son işlem ve mevcut release bilgisi oluştur. Doğrulama başarısızsa yayın ilerlemez. İlk boş kurulum ayrı açık ilk migration yolunu kullanır.
5. **Migration uygula:** Gerekli migration'ı kontrollü bir kez çalıştır; hata/şema sonucunu kaydet. Başarısızlığı gizleyerek uygulamayı açma.
6. **Sürümü değiştir:** current yeni doğrulanmış release'e alınır; servis başlatılır. Kalıcı DB ve yedeklerin konumu değişmez.
7. **İç kontrol yap:** Localhost live/ready, şema ve salt okuma mali tutarlılık kontrollerini uygula. Kayıt/revizyon/güncel onay ilişkisi ve örnek veri toplamı doğru olmadan müşteri yazmasına izin verme.
8. **Trafiği aç:** Kontroller geçtiyse bakımı kaldır; normal servis/sağlık denetiminin aktifliğini doğrula. Müşteri yazmasına açıldığı zamanı özellikle kaydet; geri dönüş seçeneği bu andan sonra değişir.
9. **Yayın sonrası doğrula:** Aşağıdaki smoke listesini uygula, izlemeyi kontrol et. Hata varsa durumun veri/yetki/yayın etkisine göre bakıma dön ve §7 yolunu uygula.
10. **Sonucu kaydet:** Sürüm, test/restore referansı, yayın/trafik zamanları ve sorumlu yazılır. Ortak kilit yalnız işlem sona erip güvenli durum doğrulanınca bırakılır; korunan kopya/release ilişkileri gözetilerek temizlik yapılır.

**Süre:** Ölçülmedi; kesin kesinti veya toparlanma süresi vaat edilmez. İlk kurulum ve yeni sürüm geçişi T6.5 denemesinde ayrı ölçülür.

## 6. Yayın sonrası kısa doğrulama

- [ ] Doğru HTTPS adresi açılır; sahip, şoför ve ekip girişi doğru kapsamı gösterir. İç health veya DB dosyası dışarı açılmaz.
- [ ] Ayrı test işletmesi/araçlarıyla günlük kayıt → sahip onayı → dönem raporu akışı çalışır; gerçek müşteri defterine deneme parası yazılmaz. Müşteri kaydı silerek deneme temizliği yapılmaz.
- [ ] %20/%0 hesap ve alınan/kalan ayrımı doğru; tekrar dokunma ikinci mali kayıt oluşturmaz. Ayrıntılı hata/çökme/yük testleri canlı müşterilerin üstünde tekrar edilmez.
- [ ] Sunucu logları, hazır olma durumu, hata oranı ve kaynaklar olağandır; dış kontrol ve ekip uyarı yolu aktiftir.
- [ ] Yayın öncesi ve hazır yedeklere referans veren kod korunur. Son günlük snapshot'ın yaşı izlenir; sadece deploy sırasında alınan yerel kopya makine dışı günlük yedek diye gösterilmez.

## 7. Geri dönüş kararı

| Durum | Yapılacak işlem | Sınır |
|---|---|---|
| Çıktı/hash/QA sorunu, mevcut uygulama henüz değişmedi | Yeni sürümü yayınlama; mevcut sürümü koru | Bozuk çıktı çalıştırılmaz |
| Bakım/migration öncesi kopya başarısız | Yayını durdur; mevcut güvenli durumu doğrulayıp bakımdan çık veya müdahale et | Sağlam geri dönüş tabanı olmadan devam edilmez |
| Yeni kod bozuk, mevcut şema eski kodla uyumlu | Bakım ve kilitle eski uyumlu kodu aç; readiness/smoke sonrası trafiği ver | Kod dönüşü DB dönüşü değildir |
| Şema uyumsuz; yeni sürüm henüz müşteri yazması almadı | Doğrulanmış yayın öncesi kod+DB'yi birlikte geri al; eski/yeni dosyaları inceleme için koru | Trafik açılmadan önceki kopya ve yazma durumu kanıtlanmalı |
| Yeni müşteri yazmaları kabul edildi | Eski DB'ye otomatik dönme; bakımı aç, yeni kayıtları koruyan ileri düzeltme veya planlı kurtarma yap | Yeni hesapları eski kopyayla silme |
| Makine kaybı veya DB bozulması | OPS.md'deki ayrı makine restore yolunu uygula | RPO son doğrulanmış kopyadan; sıfır kayıp garantisi yok |

DB kopyasına dönüldüğünde kopyadaki oturumlar iptal edilir; parola/pasiflik ve erişim durumunun güncelliği kontrol edilir. Doğrulanamayan girişler yeniden doğrulanıp gerekirse sıfırlanana kadar kapalı kalır; aktör geçmişi silinmez. Hangi kayıtların kabul edildiği belirsizse “hiç yazma olmadı” varsayılmaz. Önce mevcut DB/WAL ve işlem izi korunur, durum incelenir. Kopyalardan kayıtlar otomatik birleştirilmez.

## 8. Yayın notu ve kanıt kaydı

Her gerçek yayında şu kısa kayıt tutulur; bu şablon henüz gerçek bir yayın kaydı değildir:

~~~text
Uygulama sürümü / kaynak commit / çıktı hash'i:
Şema, Ubuntu/CPU/Node/SQLite sürümleri:
Değişen hikâyeler ve kullanıcıya etkisi:
QA sonucu ve kabul edilen sınırlamalar:
Yayın öncesi kopya / son snapshot / restore kanıtı:
Bakım başlangıcı / müşteri yazmasına açılma / doğrulama zamanı:
Yayını yürüten / işletim sorumlusu:
Geri dönüş yolu ve sonucu:
Yayın sonrası smoke / kalan işler:
~~~

Saatler kanıtta UTC, kullanıcıya gösterimde Europe/Istanbul olarak açık etiketlenir. Şifre/token veya gerçek kişilerin gereksiz mali ayrıntıları yayın notuna konmaz. Değişen bir yayın adımı, ilgili Tasks/Architecture/Ops bilgisiyle birlikte güncellenir.
