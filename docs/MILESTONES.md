# Milestones: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.1  
**Durum:** Geliştirme aşamalarının planı hazır; hiçbir aşama uygulanmış veya tamamlanmış sayılmaz.  
**Kaynaklar:** [Stories](STORIES.md) · [Epics](EPICS.md) · [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) · [Tech Stack](TECH-STACK.md) · [Design](DESIGN.md)  
**Şablon:** Project Blueprint / 08-sprints. Küçük ekip için özellik tamamlanmasına dayalı milestone yaklaşımı.

## Yaklaşım ve sıralama

Milestone, **birlikte bitirilecek iş grubu** demektir. Sabit iki haftalık sprint takvimi yerine, her aşamada gösterilebilir bir sonuç ve doğrulanabilir çıkış ölçütü kullanılır. Altı aşama, mevcut 35 hikâyeyi birer kez sahiplenir; yeni ürün kapsamı oluşturmaz.

Kullanıcının son talebiyle planlama sırası **Stories → Milestones → Tasks → QA planı → Release → Ops → geliştirme**dir. Bütün plan belgeleri koddan önce hazırlanır; testler özelliklerle birlikte yazılır ve çalıştırılır. Release/yayın ve Ops/işletim rehberlerindeki gerçek ortam/komut/sonuç bilgileri geliştirme sırasında doldurulur; ilk kullanıcıya açılmadan önce doğrulanır. Test veya yedekleme düşüncesi son aşamaya bırakılmaz.

| Aşama | Kullanıcının elde edeceği sonuç | Hikâye | Göreli büyüklük | Önce gereken | Çıkış özeti |
|---|---|---:|---|---|---|
| M1 — Güvenli giriş ve geliştirme temeli | Plaka/şifreyle doğru alana giriş | 7 | 2 S + 5 M | QA planı ve ilk teknik ayrıntılar | Yetki/oturum ve hedefe uygun derleme doğrulanır |
| M2 — Araç ve şoför yönetimi | Ekibin araç açması, sahibin şoförlerini tanımlaması | 6 | 2 S + 4 M | M1 | Gerçek ekranlardan örnek müşteri ve araç hazırlanır |
| M3 — Günlük çalışma ve para hesabı | Tek Kaydet ile güvenilir günlük kayıt | 6 | 6 M | M2 | Para hesabı, kalıcılık ve tekrar gönderim doğrulanır |
| M4 — Teslim doğrulaması ve düzeltme | Sahibin aldığı parayı onaylaması, geçmişi koruyarak düzeltmesi | 6 | 2 S + 4 M | M3 | Tek işlemde onay/düzeltme ve şoför geri bildirimi doğrulanır |
| M5 — Özet ve dönem raporları | Kişi/araç hesabını ekranda görme | 5 | 1 S + 4 M | Hesap hazırlığı M3; son kabul M4 sonrası | Güncel kayıt ve onayların toplamları doğru görünür |
| M6 — İşletim doğrulaması ve kontrollü pilot | Çalışan, izlenen ve yedekten kurtarılabilen hizmet | 5 | 5 M | Hazırlığı M1; son kabul M1–M5 sonrası | Yük, arıza, restore ve pilot yayın kontrolleri geçer |
| **Toplam** | | **35** | **7 S + 28 M** | | |

**Takvim:** Henüz gün/hafta veya teslim tarihi verilmedi. S/M değerleri Stories'deki göreli boyutlardır; toplanıp otomatik güne çevrilmez. Teknik iş paketleri, açık kararlar ve geliştirme kapasitesi netleşince tahmin yapılır. Uzayan bir aşama, iş kapsamı ve kabul bağlantıları korunarak yeniden gruplanabilir.

## Ortak tamamlanma ölçütü

- [ ] Aşamanın sahip olduğu hikâyelerin kesin kabul kriterleri uygulanmış ve uygun kontrollerle doğrulanmıştır; ilgili açık kararlar çözülmüş veya kapsam dışında bırakılmaları açıkça kararlaştırılmıştır.
- [ ] Ekran, sunucu kuralı ve veri işlemi birlikte çalışır; yalnız arayüz taslağı veya mock veri aşamayı bitirmez. M1'in E2 öncesi örnek test verisi kullanması kendi sınırında açıkça belirtilir.
- [ ] Para, yetki ve veri bütünlüğü otomatik kontrolleri ile ilgili telefon akışının elle denemesi yapılmıştır. Kontrol sonucu, kullanılan kaynak sürüm ve çözülmemiş hata kaydedilmiştir.
- [ ] Başarı denilen mali işlem kaybolmaz/çoğalmaz; kapsam dışı erişim, yarım onay veya sessiz veri kaybı bulgusu açıkken aşama tamamlandı sayılmaz.
- [ ] Sonraki aşamayı etkileyecek belge ve kararlar güncellenir. Önceki işin testleri yeni değişiklikle bozulmuşsa ilerleme başarı diye raporlanmaz.

Bu dosyadaki bütün kutular henüz açıktır. Bir aşama bitince örnek veriyle gösterim yapılır; her aşamayı gerçek müşterilere yayınlama zorunluluğu yoktur. Aynı tek uygulama ve SQLite planı korunur.

## M1 — Güvenli giriş ve geliştirme temeli

**Kapsam (7):** S1.1, S1.2, S1.3, S1.4, S1.5, S1.6, S6.1.  
**Çalışma sırası:** S1.1 → S1.4 → S1.5 → S1.2/S1.3 → S1.6. S6.1, S1.1 sonrası paralel hazırlanabilir.  
**Bağımlılık:** Önceki milestone yok; koddan önce QA planı ve K9'un paket/ilk erişim ayrıntıları gerekir.  
**Tahmin:** 2 S + 5 M; takvim tahmini yok.

### Tamamlanma ve gösterim

- [ ] Yerel uygulama, açık şema kurulumu ve migration temeli çalışır; DB kaybolması sessizce boş hesap sistemi oluşturmaz.
- [ ] Örnek veride aynı plakanın iki farklı şifresi doğru alanı açar; ayrı kişisel ekip girişi çalışır. Halka açık kayıt veya rol seçimi yoktur.
- [ ] Oturum iptali, süre sonu ve işletme/araç kapsamı sunucuda doğrulanır; kapsam dışı ID denemesi veri açmaz. Gerçek yönetim ekranları M2'de aynı kontrollerle birleştirilir.
- [ ] Telefon girişinin okunurluğu ve hata durumları kontrol edilir; uyumlu hedef üretim çıktısı ve otomatik kontroller hazırlanır.

**Çıkış:** Örnek sahip/şoför/ekip girişi ve yetkisiz erişimin reddi gösterilebilir. Çalışan rapor/günlük kayıt varmış gibi boş yer tutucu ekran sunulmaz. İlk Lightsail makinesini satın almak bu aşamayı planlamanın sonucu değildir.

## M2 — Araç ve şoför yönetimi

**Kapsam (6):** S2.1, S2.2, S2.3, S2.4, S2.5, S2.6.  
**Çalışma sırası:** S2.1 → S2.2 → S2.3/S2.4 → S2.5 → S2.6.  
**Bağımlılık:** M1.  
**Tahmin:** 2 S + 4 M; takvim tahmini yok.

### Tamamlanma ve gösterim

- [ ] Ekip işletme/sahip/araç açar; ilk iki farklı araç şifresi güvenle oluşturulur. Araç, şoför ve sonraki ekip hesapları gerçek ekranlardan yönetilir.
- [ ] Şoför adının düzeltilmesi sabit kişi kimliğini değiştirmez; pasifleştirme geçmişi silmez. Sahip kendi aracının atamasını, ekip kendi yetkili hedefini yönetir.
- [ ] Gerçek şifre sıfırlama, hesap/araç pasifleştirme ve ekip yetkisi değişimi eski erişime M1 kurallarını uygular.
- [ ] Destek hedefi görünür; tanımlama değişiklikleri gerçek ekip aktörüyle izlenir. Tekrar gönderim veya eşzamanlı düzenleme tanımları çoğaltmaz/ezmez.

**Çıkış:** Elle DB düzenlemeden örnek müşteri ve aracı açılıp sürücüsü tanımlanabilir; plaka girişleriyle denenebilir. K2 çok araç erişimi, K8 ortaklık/devir ve K9 şifre teslimi ilgili sınırlarında ele alınır; sessizce yeni yetki eklenmez.

## M3 — Günlük çalışma ve para hesabı

**Kapsam (6):** S3.1, S3.2, S3.3, S3.4, S3.5, S3.6.  
**Çalışma sırası:** S3.1 → S3.2 → S3.3 → S3.4 → S3.5 → S3.6.  
**Bağımlılık:** M2.  
**Tahmin:** 6 M; takvim tahmini yok.

### Tamamlanma ve gösterim

- [ ] Tarih/kişi, başlangıç/bitiş, hasılat/mazot ve isteğe bağlı masraf tek formda çalışır. Şoför bir kez Kaydet der; ayrı teslim/onaya gönder adımı çıkmaz.
- [ ] PRD girdileriyle şoför payı 2.000 TL ve beklenen 6.200 TL; sahibin kendi çalışmasında pay 0 ve kalan 8.200 TL olur. Sahip/ekip şoför adına girince %20 korunur.
- [ ] İlk kayıt/revizyon ve tekrar gönderim sonucu birlikte saklanır. Aynı isteğin tekrarında tek kayıt; aynı gün iki gerçek çalışmada iki kayıt vardır. Süreç yeniden başlatmasında başarılı kayıt korunur.
- [ ] Onaysız/sahip çalışması düzeltmesinde sürüm ve geçmiş korunur; eşzamanlı işlem diğerini sessizce ezmez. Bilinmeyen gönderim sonucu çözülmeden yeni kayıt açılmaz.
- [ ] Telefon akışı temsili kullanıcıyla denenir; S3.6 kolaylık hedefi ve hata durumları değerlendirilir.

**Çıkış:** Şoför, sahip ve ekip aynı kurallarla kalıcı çalışma kaydedebilir. K1 onaysız düzenleme, K3 zaman, K5 negatif kalan, K6 gider ayrıntısı ve K7 çevrimdışı kapsam ilgili kabul öncesinde karara bağlanır; çözülmemiş parça tamamlandı işaretlenmez. Tam rapor ve teslim onayı sonraki aşamalardadır.

## M4 — Teslim doğrulaması ve düzeltme

**Kapsam (6):** S4.1, S4.2, S4.3, S4.4, S4.5, S4.6.  
**Çalışma sırası:** S4.1 → S4.2 → S4.3 → S4.4 → S4.5; S4.6 kendi Stories bağımlılıkları sağlandığında.  
**Bağımlılık:** M3.  
**Tahmin:** 2 S + 4 M; takvim tahmini yok.

### Tamamlanma ve gösterim

- [ ] Sahip ad/tarih/beklenen/alınan tutarı birlikte görüp tek işlemde onaylar. 6.200 TL beklenen için 6.000 TL alınan onaylanabilir; hasılat/pay/beklenen değişmez.
- [ ] Onaylı düzeltme “Düzelt ve onayla” ile yeni kayıt/onay/geçmişi atomik yazar. İşlem ortasında hata eski tam hâli korur; tekrar gönderim ikinci onay üretmez.
- [ ] Eski değerler ve onaylar geçmişte görünür. Platform işlemi gerçek ekip üyesi ve “Sahip adına platform desteği” bilgisiyle ayrılır.
- [ ] Şoför onaylı kaydı değiştiremez/onaylayamaz; izinli görünümde teslim sonucunu okuyabilir. Sahibin kendi çalışmasına teslim onayı eklenmez.

**Çıkış:** İlk onay, farklı alınan tutar, onaylı düzeltme ve şoför geri bildirimi aynı örnek kayıt üzerinde gösterilebilir. K1 geçmiş erişimi, K4 tür dönüşümü ve K5 negatif kalan sınırları korunur. Raporun yalnız güncel sürümü toplaması M5 ile birlikte kabul edilir.

## M5 — Özet ve dönem raporları

**Kapsam (5):** S5.1, S5.2, S5.3, S5.4, S5.5.  
**Çalışma sırası:** S5.2/S5.3 → S5.4 → S5.1 → S5.5; ayrıntılı bağımlılıklar Stories'dedir.  
**Bağımlılık:** Çalışma hesabı M3 verisiyle hazırlanabilir; son kabul M4'ün güncel onay/düzeltmesini gerektirir.  
**Tahmin:** 1 S + 4 M; takvim tahmini yok.

### Tamamlanma ve gösterim

- [ ] Hafta/ay/yıl ve gün gün döküm yalnız ekranda, yetkili araç kapsamında çalışır. Kişi gün/saat/hasılat/pay ve ayrıntı kırılımları sahibin kendi çalışmasını da içerir.
- [ ] İki örnek çalışmada hesaplanan kalan 14.400 TL'dir; alternatif onaylara göre alınan 0, 6.200 veya 6.000 TL ayrı gösterilir. Sahibin 8.200 TL kalanı teslim toplamına eklenmez.
- [ ] Kişi/tarih/tutar düzeltmesi yalnız güncel sürümden toplanır; eski onay ikinci kez eklenmez. Aynı gün iki çalışma iki gün sayılmaz; pasif veya adı düzeltilmiş kişinin geçmişi korunur.
- [ ] Liste sayfalansa da toplamlar dönemin tamamıdır. SQL sorgu/indeks kontrolleri beş yıllık temsili veride yapılır; tüm geçmiş her istekte uygulama belleğine yüklenmez.
- [ ] Sahip ve ekip aynı yetkili raporda aynı toplamı görür. Hata sahte sıfır üretmez; telefonda okunurluk korunur.

**Çıkış:** Kayıt → para onayı → düzeltme → kişi/araç raporu zinciri uçtan uca gösterilebilir. K2 araç kapsamı, K3 dönem/gece ve K6 gider ayrıntısı ilgili kabulde netleşir; indirme/grafik eklenmez. Hedef makinedeki yük kabulü M6'dadır.

## M6 — İşletim doğrulaması ve kontrollü pilot

**Kapsam (5):** S6.2, S6.3, S6.4, S6.5, S6.6. S6.1 M1'e aittir ve burada yeniden sayılmaz.  
**Çalışma sırası:** S6.2 → S6.3 → S6.4 → S6.5 → S6.6.  
**Bağımlılık:** Kurulum/sağlık hazırlığı M1 sonrası ilgili erişimler hazırken başlayabilir. S6.4'ün mali yedek kabulü M4, S6.5 rapor/restore kabulü M5, son pilot kabulü M1–M5'i gerektirir.  
**Tahmin:** 5 M; takvim tahmini yok.

### Tamamlanma ve gösterim

- [ ] Seçilen tek Lightsail'da Caddy/HTTPS, kalıcı DB dizini ve kontrollü sürümlü kurulum çalışır. Kod yayını DB/yedeği silmez; çökme/donma denemesinde sınırlı kurtarma ve kalıcı kilit uygulanır.
- [ ] Makine dışı sağlık kontrolü ve seçilmiş ekip uyarısı denenmiştir. Uyarıyı takip eden kişi, erişim ve müdahale adımları bellidir.
- [ ] Tutarlı DB kopyası, manifest ve uyumlu sürüm son yedi günlük snapshot planında korunur. Son iki sağlam yerel kopya/sürüm ilişkisi, gecikme/başarısızlık uyarıları ve saklama sınırları doğrulanır.
- [ ] Snapshot ayrı makinede geri yüklenir; hash, şema, giriş, kayıt/revizyon/onay ve raporlar kontrol edilir. Kurtarılabilir son zaman ve gerçek toparlanma süresi kaydedilir.
- [ ] Migration/yayın geri dönüşü bakım ve ortak kilitle denenir; yeni kullanıcı yazması alındıktan sonra eski DB'ye otomatik dönüş yapılmaz.
- [ ] Üç ayrı 100 kullanıcı/istek senaryosu, beş yıllık veri ve sürdürülen yük ile ölçülür. Performans hedefleri, engellenen meşru istekler ve veri bütünlüğü ayrı raporlanır; mali kayıp/çoğalma/tutarsızlık yoktur.
- [ ] QA planındaki ilk yayın kontrolleri geçer; yayın ve işletim rehberleri hazırdır. Kontrollü pilot yayını sonrası HTTPS, giriş, bir çalışma/onay/rapor ve ekip erişimi için kısa doğrulama yapılır; sonucu yayın sürümüyle kaydedilir.

**Çıkış:** Uygulama kontrollü pilot kullanımına açılmış, yayın sonrası temel akışlar kontrol edilmiş ve yedek/arıza sorumluluğu belirlenmiştir. Bu gelecekte uygulanacak çıkış ölçütüdür; burada kaynak satın alınmadı veya yayın yapılmadı. Pilot kapsamı/başlangıcı ayrıca belirlenir; otomatik genel satış veya abonelik açılmaz.

## Açık kararların zamanı

K1–K9'un tanımları [Stories](STORIES.md) ve [Epics](EPICS.md) içindedir. Hepsini baştan tekrar sormak gerekmez; etkilenen iş başlamadan çözülür. M1/M2 için giriş/erişim ve tanımlama sınırları, M3 için zaman/para/düzenleme, M4/M5 için teslim/geçmiş/rapor, M6 için dış kontrol/uyarı/erişim ve pilot ayrıntıları ele alınır. Önceden onaylanan %20/%0, tek Kaydet ve tek işlemde Düzelt ve onayla korunur.

## Sonraki belgeler

1. **[TASKS.md](TASKS.md):** Her hikâye için teknik bağlam, yapılacak adımlar, doğrulama ve bağımlılık içeren bir iş paketi. Bir hikâye birçok ayrı görev dosyasına bölünmez.
2. **[QA-PLAN.md](QA-PLAN.md):** Kod yazılmadan önce test stratejisi, kritik senaryolar, test verisi ve başarı ölçütleri. Testlerin uygulaması ilgili iş paketleriyle birlikte yürür.
3. **[RELEASE.md](RELEASE.md):** Koddan önce yayın, migration, kısa yayın kontrolü ve güvenli geri dönüş planı; gerçek adımlar ilk kullanıcıya açılmadan önce sınanır.
4. **[OPS.md](OPS.md):** Koddan önce günlük izleme, yedek kontrolü, arıza müdahalesi ve sorumluluk planı; gerçek kanallar/sorumlular ilk yayın öncesinde doğrulanır, olaylardan sonra güncellenir.

Bu dosya planlama belgesidir; GitHub milestone/issue, sprint takvimi, kaynak kurulumu veya canlı yayın oluşturmaz.
