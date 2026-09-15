# Tasks: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.1  
**Durum:** 35 hikâye için teknik iş paketleri; kod geliştirilmedi ve paketler tamamlanmış değildir.  
**Kaynaklar:** [Milestones](MILESTONES.md) · [Stories](STORIES.md) · [Architecture](ARCHITECTURE.md) · [Tech Stack](TECH-STACK.md) · [Design](DESIGN.md) · [PRD](PRD.md).  
**Şablon:** Project Blueprint / 07-tasks, yerel geliştirme için uyarlandı. Her hikâye bir iş paketidir; GitHub Issue veya Dijji görevi oluşturulmadı.

## Nasıl kullanılacak?

Milestone, birlikte bitecek iş grubudur; **task paketi**, bir hikâyeyi geliştirecek kişinin yapacağı somut iştir. T3.1, S3.1'in teknik paketidir. Numaralar kalıcıdır; çalışma sırası [Milestones](MILESTONES.md) ve bağımlılıklardan gelir. Örneğin T6.1 ilk aşamadadır.

| Aşama | İş paketleri | Sayı |
|---|---|---:|
| M1 | T1.1–T1.6, T6.1 | 7 |
| M2 | T2.1–T2.6 | 6 |
| M3 | T3.1–T3.6 | 6 |
| M4 | T4.1–T4.6 | 6 |
| M5 | T5.1–T5.5 | 5 |
| M6 | T6.2–T6.6 | 5 |
| **Toplam** | **Bir hikâye = bir paket** | **35** |

Bir paketi uygulamaya alırken bu dosyadaki bölüm, aynı numaralı Stories bölümü ve referans mimari/tasarım birlikte okunur. **Stories'deki bütün kabul kriterleri bağlayıcıdır; aşağıdaki kısa Doğrulama satırı onların yerine geçmez.** Bağımlılık satırlarında S kimlikleri kullanılır; aynı kimlikli T paketi kastedilir. Son kabul bağımlılıklarının kesin kaynağı Stories'deki satırdır; sonraki işle bağlantıyı anlatan notlar yeni ön koşul oluşturmaz. Genel kurallar bütün paketlere uygulanır.

Buradaki modüller ve endpoint'ler mevcut mimari sözleşmesidir; uygulama dosyaları henüz yoktur. İş adımları çalıştırılmış komut veya tamamlanmış geliştirme değildir. Bir paket başka araçta tek başına kullanılacaksa hikâye/kabul kriterleri ve ilgili mimari bağlam da pakete eklenir; yalnız okunamayan yerel bağlantı gönderilmez. Blueprint'in Dijji'ye özel pipeline/CLAUDE/örnek AWS servisleri bu projeye taşınmaz.

## Her pakette korunan teknik kurallar

- Tek Node/Next.js uygulaması, Caddy ve yerel SQLite; Drizzle/better-sqlite3 veri katmanı. Docker, Redis, S3, harici kuyruk veya yeni DB servisi eklenmez.
- Yetki istemciden gelen role dayanmaz. Araç oturumu plaka/role, ekip işlemi gerçek kişisel ekip hesabına ve doğrulanmış hedefe bağlanır. Backend kapsam kontrolü ile DB ilişki kısıtları birlikte uygulanır.
- Yazma kısa transaction içinde kayıt/revizyon/onay gerekiyorsa destek izi ve işlem sonucuyla tamamlanır. Aynı işlem kimliği çoğaltmaz, eski sürüm sessizce ezilmez, başarı commit sonrasıdır.
- Para tam sayı kuruş, API'de tam sayı metnidir. Şoför brüt %20, sahip kendi çalışması %0; gerçek çalışan ile kaydı giren ayrı tutulur. Beklenen kalan ile gerçek alınan para birbirine çevrilmez.
- Görünüm Design'ın mavi-beyaz, tek sütun, büyük alan, Türkçe metin ve hata/bekleme kurallarına uyar. Ortak şoför ad seçimi bireysel kimlik doğrulaması değildir.
- Koddan önce [QA planı](QA-PLAN.md) okunur; anlamlı iş kuralı/veri/yetki testleri ilgili paketle geliştirilir. DB transaction/ilişki/çakışma kontrolleri yalnız mock testle geçilmiş sayılmaz.
- K1–K9 karar kayıtları etkilediği pakette uygulanır; henüz gerçek erişim/sürüm bilgisi olmayan yerde uydurma değerle canlı işlem yapılmaz. [Yayın](RELEASE.md) ve [işletim](OPS.md) rehberleri E6 paketlerinin yürütme kaynağıdır.

## Başlama ve bitirme

Önce bağımlılıklar ve ilgili kararlar kontrol edilir; etkilenen ekran/veri akışı uygulanır; testler çalıştırılır; sonuç kullanılan sürümle kaydedilir. Sadece üç iş adımına tik atılması paketi tamamlamaz. İlgili hikâyenin tüm kabulü, inceleme ve gereken kullanım denemesi geçince bitti sayılır.

Kaynak deposu/branch/CI ve yayın bilgileri uygulama aşamasında gerçek ortamda belirlenir. Bu belge, GitHub'da gönderim veya ücretli kaynak oluşturma işlemi yapmaz. Aşağıdaki paketlerin tamamı **planlandı, başlanmadı** durumundadır.

## T1.1 — Uygulama, migration ve otomatik kontrol temelini hazırlama

**Story / aşama:** S1.1 · M1
**Sonuç:** Seçilen teknolojiyle tekrarlanabilir yerel geliştirme ve veri doğrulama temeli hazırlanır.
**Teknik bağlam:** Architecture §2–3'te tanımlanan uygulama, kimlik ve veri erişim modülleri Next.js/TypeScript, Node.js 24 LTS, Drizzle ve better-sqlite3 üzerinde oluşturulacaktır. İşletme/kişi/araç/atama, giriş, oturum ve yönetim izi tabloları migration ile kurulacak; mevcut kod veya kurulmuş şema varsayılmayacaktır.

**İş adımları:**

1. Tech Stack'e göre uyumlu paket sürümlerini ve lockfile'ı belirle; yerel çalıştırma, derleme, tip kontrolü ve özellik testlerinin giriş komutlarını hazırla.
2. Temel tabloları, birleşik işletme ilişkilerini ve veri erişim sınırını tanımla; açık ilk kurulum ile mevcut DB'yi açma yollarını ayır, eksik DB'de sessiz oluşturmayı engelle.
3. Ayrı test verisinde farklı işletmelerin araç/rol/ekip örneklerini hazırla; migration ve yeniden başlatmada veri koruma kontrollerini otomatik çalıştırmaya bağla.

**Doğrulama:** Migration tekrarı tanımları çoğaltmaz; eksik mevcut DB boş müşteri sistemi açmaz; yeniden başlatma test kaydını korur. [STORIES.md](STORIES.md) S1.1'in bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** Önceki story yok; M1'in kod öncesi planlama koşulları ve K9 paket uyumluluğu gerekir. Hedef üretim çıktısı S6.1, gerçek Lightsail kurulumu S6.2 kapsamındadır.

## T1.2 — Plaka ve şifreyle araç girişini tamamlama

**Story / aşama:** S1.2 · M1
**Sonuç:** Kullanıcı aynı plakanın kendisine verilen şifresiyle doğru araç/rol alanına girer.
**Teknik bağlam:** Kimlik modülünde POST /api/v1/auth/vehicle-login, vehicles ve vehicle_credentials üzerinden doğrulama yapıp sessions altyapısını kullanacaktır. Architecture §6'daki Argon2id, geçici giriş hız sınırı ve bilgi sızdırmayan hata sözleşmesi uygulanacak; rol istemciden alınmayacaktır.

**İş adımları:**

1. Plaka normalizasyonu ve alan doğrulamasını, aktif işletme/araç kontrolünü ve iki rolün parola doğrulamasını kimlik kullanım durumunda uygula.
2. Başarıyı S1.4 oturumuna bağla; bilinmeyen plaka/yanlış parola için ortak yanıt, sınırlı hash yükü ve geçici deneme sınırlarını ekle.
3. Design §2.1'deki plaka/şifre formunu, Göster/Gizle, parola yöneticisi/yapıştırma desteği ve doğrulanmış role yönlendirmeyle bağla.

**Doğrulama:** Normalizasyon farkları aynı aracı bulur; iki parola farklı yetki açar ve tarayıcıdan rol değiştirmek yetki kazandırmaz; bilinmeyen plaka/yanlış parola aynı genel hatayı verir. [STORIES.md](STORIES.md) S1.2'nin bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S1.4, S1.5; K1 şoför geçmişi ve K2 diğer araç erişimi genişletilmez. E2 öncesi test verisiyle doğrulanabilir; halka açık kayıt/OTP eklenmez.

## T1.3 — Kişisel ekip girişi ve ilk yönetici kurulumu

**Story / aşama:** S1.3 · M1
**Sonuç:** Yetkili ekip üyesi müşterinin şifresini kullanmadan kişisel hesabıyla yönetim alanına girer.
**Teknik bağlam:** Kimlik modülündeki POST /api/v1/auth/platform-login, platform_users üzerinden kişisel ekip oturumu oluşturacaktır. İlk yönetici Architecture §1.1 uyarınca açık yerel kurulum komutuyla hazırlanacak; müşteri people kaydı veya araç credential'ı ekip hesabı yerine kullanılmayacaktır.

**İş adımları:**

1. İlk yönetici oluşturma komutunu açık kurulum erişimine bağla; tekrar çalıştırmada mevcut hesabı çoğaltmayı veya şifresini/yetkisini sessiz değiştirmeyi engelle.
2. Aktif ekip hesabı, parola, hız sınırı ve doğrulanmış yönetici/destek yetkisini S1.4/S1.5 ile birleştir; araç girişini ekip girişinden ayır.
3. Ayrı ekip giriş formunu ve başarılı oturumun kişisel kimlik başlığını oluştur; bekleme/hata durumlarında gizli bilgi göstermeden sonucu bildir.

**Doğrulama:** İlk kurulum tekrarı mevcut hesabı değiştirmez; araç şifreleri ekip alanını açmaz; kişisel ekip kimliği görünürken parola/token yanıt ve loglarda bulunmaz. [STORIES.md](STORIES.md) S1.3'ün bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S1.4, S1.5; K9 ilk şifrenin teslim yöntemi açıktır. Sonraki ekip hesapları S2.6'da yönetilir; otomatik davet/SMS/e-posta eklenmez.

## T1.4 — Sunucu oturumu, çıkış ve erişim iptali

**Story / aşama:** S1.4 · M1
**Sonuç:** Geçerli oturum sürer, çıkış veya erişim iptali sonrasında eski oturum yeniden kullanılamaz.
**Teknik bağlam:** sessions, vehicle_credentials ve platform_users ilişkileri GET /api/v1/session ile POST /api/v1/auth/logout işlemlerinin temelidir. Architecture §6'ya göre rastgele token güvenli cookie'de, özeti DB'de tutulacak; süre, hareketsizlik, credential sürümü ve aktiflik her istekte denetlenecektir.

**İş adımları:**

1. Oturum üretme/okuma/iptal kullanım durumlarını, cookie özelliklerini ve araç/ekip için farklı süre sınırlarını uygula; last_seen yazmasını aralıklı tut.
2. Çıkış, rol parolası sıfırlama, işletme/araç/ekip pasifliği ve ekip yetki değişikliğinin eski erişime etkisini ortak denetim katmanına bağla.
3. Yazma isteklerine origin/CSRF ve gövde kontrollerini ekle; oturum bitişi veya kullanıcı değişiminde müşteri geçici verisini temizleyen ekran davranışını bağla.

**Doğrulama:** Çıkış/iptal edilen token API'yi açmaz; yeniden aktifleşme eski oturumu diriltmez; bir araç rolünün parola değişimi diğer rolü gereksiz yere kapatmaz. [STORIES.md](STORIES.md) S1.4'ün bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S1.1; yönetim ekranları beklenmeden test düzenekleriyle başlanır, S2.2/S2.3/S2.6 ile gerçek akışa bağlanır. K9'un bu işi etkileyen teknik parametreleri mimari sınırında doğrulanır.

## T1.5 — İşletme/araç kapsamı ve işlem yetkilerini uygulama

**Story / aşama:** S1.5 · M1
**Sonuç:** Her veri isteği sunucuda izinli işletme, araç ve işlemle sınırlandırılır.
**Teknik bağlam:** Architecture §2'deki yetki matrisi kimlik ve veri erişim modüllerinde ortak kapsam denetimi olarak uygulanacaktır. İşletme tablolarındaki birleşik foreign key'ler ilişkiyi, kapsamlı sorgular okumayı/yazmayı koruyacak; ID veya kişi seçimi erişim yetkisi sayılmayacaktır.

**İş adımları:**

1. Araç/rol ve kişisel ekip oturumundan kapsam üret; sahip, ortak şoför, destek ve platform yöneticisinin izinli işlemlerini merkezi denetimlere bağla.
2. Okuma/yazma sorguları ile tekrar gönderim sonucunu kapsama bağla; yazma transaction'ında güncel aktiflik/yetkiyi yeniden denetleyip ilişkisel DB kısıtlarını uygula.
3. Aynı işletmede farklı araçlar ve farklı işletmeler içeren doğrudan endpoint testlerini oluştur; 401/403/404 ayrımını ve bilgi sızdırmayan hata yanıtını doğrula.

**Doğrulama:** Yetkisiz nesne ID'si veri açmaz; yanlış işletme ilişkisi DB'de de reddedilir; arada iptal edilen erişim eski işlem sonucuyla yetki kazanamaz. [STORIES.md](STORIES.md) S1.5'in bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S1.4; K1 ortak şoför geçmişi ve K2 sahibin diğer araçları açıktır. Yeni E2–E5 endpoint'leri aynı denetimi ve kapsam testlerini kullanır; henüz varmış gibi sunulmaz.

## T1.6 — Telefon girişindeki hata, bekleme ve erişilebilirlik durumları

**Story / aşama:** S1.6 · M1
**Sonuç:** Araç ve ekip girişleri küçük telefon ekranında okunur, anlaşılır ve erişilebilir çalışır.
**Teknik bağlam:** Design §2.1, §2.10 ve §3'teki giriş bileşenleri mevcut planın araç/ekip login endpoint'lerine bağlanacaktır. Bu paket yeni tablo veya kimlik yöntemi eklemeyecek; giriş durumunu S1.2/S1.3 yanıtlarından üretecektir.

**İş adımları:**

1. Türkçe etiketler, sistem fontu, mavi-beyaz kontrast ve tasarımın alan/düğme ölçülerini mobil giriş bileşenlerine uygula.
2. Klavye odağı, alanla ilişkili hata, ekran okuyucu durum bildirimi ve paralel gönderimi engelleyen bekleme davranışını ekle.
3. 320 px görünüm, %200 yakınlaştırma ve telefon ekran klavyesiyle giriş denemelerini yap; yanlış şifre/bağlantı/sunucu hatasında anlaşılır tekrar denemeyi bağla.

**Doğrulama:** Form yatay kaydırma gerektirmeden kullanılabilir; hata plaka/rol varlığını açıklamaz ve plaka alanı korunur; beklemede tekrar dokunma paralel giriş üretmez. [STORIES.md](STORIES.md) S1.6'nın bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S1.2, S1.3; yeni açık ürün kararı eklenmez. Günlük formun temsili kullanıcı denemesi S3.6'da, yönetim formlarının kabulü ilgili E2 paketlerindedir.

## T2.1 — İşletme ve mal sahibi tanımlama

**Story / aşama:** S2.1 · M2
**Sonuç:** Yetkili ekip, doğru işletmeye bağlı sabit sahip kaydını gerçek ekran üzerinden oluşturur.
**Teknik bağlam:** Yönetim modülündeki GET/POST /api/v1/admin/businesses ve GET/PATCH /api/v1/admin/businesses/:id, businesses ve people ilişkisini işleyecektir. Oluşturma/düzeltme, güvenli admin_audit ve tekrar gönderim sonucu birlikte tamamlanacak; sahip kişi kaydı bireysel giriş hesabı olmayacaktır.

**İş adımları:**

1. İşletme adı, yeni sahip ad-soyadı veya yetkili mevcut kişi seçimini Design §2.9 formunda sun; isim eşitliğinden otomatik kişi birleştirme yapma.
2. İşletme/kişi ilişkisi, tekrarlı gönderim ve eşzamanlı düzenleme kontrollerini kısa atomik yönetim işlemine bağla; güvenli aktör/önce-sonra izini ilk işlemden üret.
3. İşletme aktiflik ekranını etkilenen araç erişimleriyle birlikte göster; pasiflik ve yeniden aktiflik durumlarını S1.4 oturum denetimiyle birleştir.

**Doğrulama:** Hata yarım işletme/sahip bırakmaz ve tekrar gönderim çoğaltmaz; başka işletmenin kişisi bağlanamaz; yeniden aktifleştirme iptal edilmiş oturumu geri açmaz. [STORIES.md](STORIES.md) S2.1'in bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S1.3, S1.5; K8 ortak sahiplik/devir açıktır. İşletmeleri/kişileri birleştirme veya yeni giriş üyeliği akışı eklenmez.

## T2.2 — Araç oluşturma, bilgi düzenleme ve aktiflik

**Story / aşama:** S2.2 · M2
**Sonuç:** Ekip aracı doğru işletme/sahibe bağlar, iki ayrı rol şifresiyle açar ve bilgilerini yönetir.
**Teknik bağlam:** GET/POST /api/v1/admin/vehicles ve GET/PATCH /api/v1/admin/vehicles/:id, vehicles ile vehicle_credentials kayıtlarını yönetim modülünde işleyecektir. İşletme/sahip ilişkisi, benzersiz normalize plaka, işlem izi ve oturum iptali kuralları birlikte uygulanacaktır.

**İş adımları:**

1. Design §2.9'a göre işletme/sahip, plaka, marka/model, yıl, hat/durak, not, aktiflik ve ilk iki farklı şifre alanını oluştur; sunucuda alan/ilişki doğrulamasını uygula.
2. Parola hash'lerini kısa DB yazma işlemi dışında hazırla; araç, iki rol credential'ı, audit ve tekrar gönderim sonucunu atomik yaz, düzenlemeyi sürüm çakışmasıyla koru.
3. Aktif/pasif araç yönetimini mevcut oturum iptaliyle bağla; pasif aracı ekip listesinde tut, işletme/sahip değişimini sıradan bilgi düzeltmesiyle sessiz devre dönüştürme.

**Doğrulama:** Plaka yazım farkı ikinci araç yaratmaz; kayıt hatası eksik credential'lı kullanılabilir araç bırakmaz; pasiflik eski erişimi keserken geçmişi korur. [STORIES.md](STORIES.md) S2.2'nin bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S2.1, S1.2, S1.4; K2 sahibin araç bilgisi yetkisi ve K8 devir açıktır. İlk şifre burada, sonraki sıfırlama S2.3'tedir; ortak doğrulama iki paketi döngüsel bağımlı yapmaz.

## T2.3 — Araç şifrelerini belirleme ve sıfırlama

**Story / aşama:** S2.3 · M2
**Sonuç:** Ekip seçili araç rolünün şifresini güvenle değiştirir ve o rolün eski erişimini kapatır.
**Teknik bağlam:** POST /api/v1/admin/vehicles/:id/reset-password, vehicle_credentials sürümünü ve sessions erişimini yönetim/kimlik modülleri üzerinden değiştirecektir. İşlem admin_audit ve tekrar gönderim sonucuyla atomik tamamlanacak; diğer rolün parolası değişmeyecektir.

**İş adımları:**

1. İşletme/plaka ve sahip-şoför rol ayrımını gösteren sıfırlama formunu oluştur; mevcut şifreyi görüntüleme yolunu açmadan yeni şifreyi al.
2. Yeni parolanın diğer rolün mevcut parolasıyla aynı olmadığını güvenli doğrulamayla denetle; hash'i kısa yazma işlemi dışında üret ve yazmada doğrulanan credential sürümlerinin değişmediğini kontrol et.
3. İlgili hash/sürüm, oturum iptali, gizli veri içermeyen audit ve işlem sonucunu birlikte kaydet; belirsiz yanıtta aynı işlem sonucunu çöz ve değişen rolü açıkça bildir.

**Doğrulama:** Farklı salt ile aynı parola kabul edilmez; hedef rolün eski şifresi/oturumu çalışmazken diğer rol korunur; hata kısmi sıfırlama veya gizli veri sızıntısı yaratmaz. [STORIES.md](STORIES.md) S2.3'ün bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S2.2, S1.4; K9 müşteriye şifre teslim yöntemi açıktır. SMS/e-posta gönderme ve mevcut şifre gösterme eklenmez.

## T2.4 — Şoförlerim, sabit kişi ve araç atamaları

**Story / aşama:** S2.4 · M2
**Sonuç:** Sahip veya ekip, kişinin geçmişini bölmeden şoför listesini ve araç atamalarını yönetir.
**Teknik bağlam:** GET/POST /api/v1/drivers, PATCH /api/v1/drivers/:id ve PUT /api/v1/vehicles/:id/drivers/:personId, people ile vehicle_drivers kayıtlarını işleyecektir. Driver yalnız aktif seçilebilir listeyi okuyacak; owner araç atamasını, staff ayrıca yetkili genel kişi aktifliğini yönetebilecektir.

**İş adımları:**

1. Rol/kapsama göre aktif seçim ve yönetim listesini ayır; yeni kişi, mevcut kişiyi araca bağlama ve ad düzeltme ekranlarını sabit kişi kimliğiyle oluştur.
2. Araç atamasını kapatma/açma ile genel kişi pasifliğini ayrı işlemler olarak uygula; sahibin genel pasiflik yapmasını ve aracın sahibinin şoför listesine atanmasını engelle.
3. Değişiklikleri sürüm, tekrar gönderim ve atomik audit ile koru; adın geçmişe etkisini, boş listeyi ve genel pasiflikte etkilenen araçları ekranda açıkla.

**Doğrulama:** Aynı adlı kişiler birleşmez ve ad düzeltmesi sabit kimliği korur; araç atamasını kapatma başka atamaları kapatmaz; şoför filtre değiştirerek yönetim/pasif kişi yetkisi alamaz. [STORIES.md](STORIES.md) S2.4'ün bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S2.2, S1.5; K2 diğer araç kapsamı genişletilmez. Günlük kişi seçimi E3, geçmişin tam kişi raporu E5 ile birleşir; bireysel şoför hesabı/kimlik bilgisi eklenmez.

## T2.5 — Yönetimde müşteri hedefi ve tanımlama işlem geçmişi

**Story / aşama:** S2.5 · M2
**Sonuç:** Ekip hangi müşteride işlem yaptığını ve tanımlama değişikliklerinin kimden geldiğini açıkça görür.
**Teknik bağlam:** Yönetim modülü işletme/araç liste endpoint'leri ile GET /api/v1/admin/audit üzerinden hedef seçimi ve geçmiş okumasını sunacaktır. businesses, vehicles, people ve admin_audit kapsamlı okunacak; audit yazımı bu paketi beklemeyip ilgili yönetim mutasyonunda üretilecektir.

**İş adımları:**

1. Plaka/işletme aramasını sayfalı sonuçlara bağla; işletme, plaka, sahip ve aktifliği birlikte göster, yükleme/boş/hata durumlarını ayır.
2. Destek başlığını gerçek ekip kimliği ve doğrulanmış müşteri hedefiyle kur; dolu formdan hedef değiştirmede vazgeçme/ayrılma davranışını uygula, eski formu yeni müşteriye taşıma.
3. Tanımlama geçmişini aktör, hedef, zaman, işlem ve güvenli önce/sonra değerleriyle salt okunur göster; oturum temizliği sonrasında aktör izinin çözülebilmesini koru.

**Doğrulama:** Yanlış işletmenin kayıt/kişi kimliği reddedilir; hedef değiştirmeyi iptal etmek formu korur; audit gizli değer içermez ve müşteri oturumuna açılmaz. [STORIES.md](STORIES.md) S2.5'in bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S2.1, S2.2, S2.3, S2.4; K2/K8 yeni erişim/devir eklenmez. Çalışma, teslim ve rapor desteği E3/E4/E5 ile bağlanır; mevcutmuş gibi gösterilmez.

## T2.6 — Kişisel ekip hesabı ve yetki yönetimi

**Story / aşama:** S2.6 · M2
**Sonuç:** Platform yöneticisi kişisel ekip hesaplarını açar, yetkilerini değiştirir ve erişimlerini kapatabilir.
**Teknik bağlam:** GET/POST /api/v1/admin/users, GET/PATCH /api/v1/admin/users/:id ve POST /api/v1/admin/users/:id/reset-password, platform_users tablosunu yönetecektir. Yöneticiye özel kullanım durumları sessions iptali/güncel yetki denetimi ve admin_audit ile birleşecek; müşteri people kaydıyla aynı hesap modeli kullanılmayacaktır.

**İş adımları:**

1. Yalnız platform yöneticisine açık liste/form ve endpoint yetkisini uygula; benzersiz kişisel kullanıcı adı, mevcut yönetici/destek yetkisi ve aktiflik alanlarını bağla.
2. Hesap/parola/yetki değişimini güvenli hash, oturum iptali veya güncel yetki denetimi, tekrar gönderim koruması ve atomik audit ile tamamla.
3. Yönetici işlemini S2.5 geçmişinde güvenli önce/sonra olarak göster; pasif hesapların geçmişini koru ve ilk yönetici kurulumunu S1.3 yolunda bırak.

**Doğrulama:** Destek/sahip/şoför doğrudan API ile ekip hesabı yönetemez; yetki azaltma sonraki istekte uygulanır ve eski oturum hakkı sürdüremez; başarısız değişiklik kısmi hesap/yetki bırakmaz. [STORIES.md](STORIES.md) S2.6'nın bütün kabul kriterleri bağlayıcıdır.
**Bağımlılık / açık karar:** S1.3, S1.4, S1.5, S2.5; K9 ekip şifresinin teslimi açıktır. Yeni rol hiyerarşisi, halka açık kayıt veya otomatik davet eklenmez.

## T3.1 — Aktif kişi, tarih ve saatlerle günlük form

**Story / aşama:** S3.1 · M3  
**Sonuç:** Şoför tarihini ve çalışma saatlerini doğru araç ve sabit kişi kaydıyla doldurabilir.  
**Teknik bağlam:** Günlük form, `/api/v1/drivers` üzerinden oturumun aracına ait aktif `people`/`vehicle_drivers` seçeneklerini okur. Tarih ve saat doğrulaması çalışma/teslim modülünde hazırlanır; kayıt kalıcılığı T3.4’te bağlanır.

**İş adımları:**

1. Design §2.2’ye göre sabit plaka, bugün önseçili tarih, boş kişi seçimi ve etiketli başlangıç/bitiş alanlarını oluştur.
2. Aktif seçenek sorgusunu sunucu kapsamıyla sınırla; boş liste, sorgu hatası ve form açıkken değişen aktiflik durumunu ayır.
3. Aynı günün açık saat örneği için dakika hesabını ve alan hatalarını bağla; gece/eşit saat kararını K3 çözülmeden varsayma.

**Doğrulama:** 08:00–17:30 dokuz saat otuz dakika verir; pasif veya başka araçtaki kişi sunucu kontrolünü geçmez; aynı gün ikinci gerçek çalışma yeni form olarak açılabilir. STORIES.md S3.1’in tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S1.2, S1.5, S2.2, S2.4; K3. Bu paket tek başına başarılı kayıt iddiası üretmez.

## T3.2 — Para girdileri, otomatik pay/kalan ve sunucu hesapları

**Story / aşama:** S3.2 · M3  
**Sonuç:** Kullanıcı hasılat ve giderlerden hesaplanan payı ve kalanı kaydetmeden önce görür.  
**Teknik bağlam:** Çalışma/teslim modülü `work_entries` için kuruş tam sayısı, `share_bps` ve `calculation_version` üretir. API para sözleşmesi ondalık tam sayı metnidir; sunucu hesapları tarayıcı ön izlemesinden bağımsız doğrular.

**İş adımları:**

1. Hasılat/mazot zorunluluğunu, isteğe bağlı diğer masrafı ve Türkçe para girişinin kayıpsız kuruş dönüşümünü uygula.
2. Brüt %20 ve sahip sürüşünde %0 hesabını, BigInt/tam sayı ve yarım yukarı kuruş yuvarlamasıyla ortak hesap işlevine yerleştir.
3. Form özetini geçerli girdilere bağla; eksik girdide “—”, negatif kalanda gerçek sonucu göster ve sunucu girdi doğrulamasını hazırla.

**Doğrulama:** 10.000/1.500/300 TL örneği şoförde 2.000 TL pay ve 6.200 TL kalan, sahipte 0/8.200 TL üretir; 0,03 TL brüt için pay 0,01 TL’dir; değiştirilmiş istemci toplamı esas alınmaz. STORIES.md S3.2’nin tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.1; K5 negatif kalan akışı, K6 masraf yapısı. Bağımsız gider veya borç motoru eklenmez.

## T3.3 — Sahip çalışması ve müşteri adına kayıt

**Story / aşama:** S3.3 · M3  
**Sonuç:** Sahip ve ekip, hesabı fiilen çalışan kişiye bağlı tutarak günlük formu kullanabilir.  
**Teknik bağlam:** Sahip ve destek ekranları aynı çalışma kullanım durumunu ve `/api/v1/work-entries` POST sözleşmesini kullanır. `vehicles.owner_person_id`, kişi/araç ataması ve sunucu oturumu birlikte doğrulanır; `person_id` ile gerçek işlem aktörü ayrı tutulur.

**İş adımları:**

1. Sahip formuna “Kendim çalıştım / Şoför adına” seçeneklerini ve uygun kişi gösterimini bağla.
2. Ortak şoförden sahip türü/kişi ID’siyle gelen sıfır pay denemesini reddet; sahip veya ekip şoför adına girdiğinde %20 hesabını koru.
3. Ekipte doğrulanmış hedef işletme/araç ve kim adına işlem yapıldığını görünür kıl; T3.4’e gerçek ekip aktörüyle ortak kayıt girdisi aktar.

**Doğrulama:** Üç aktörle aynı şoför çalışması aynı hesabı üretir; sahip sürüşü onay gerektirmez; yanlış işletmeye ait kişi/araç ilişkisi reddedilir. STORIES.md S3.3’ün tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.2, S2.5; K2/K8. Yeni araç erişimi/devir yoktur; ekip para onayı S4.5’tedir.

## T3.4 — Kalıcı kayıt, ilk revizyon ve tekrar gönderim koruması

**Story / aşama:** S3.4 · M3  
**Sonuç:** Tek Kaydet, tamamı saklanmış ve tekrar denemede çoğalmayan çalışma oluşturur.  
**Teknik bağlam:** `/api/v1/work-entries` POST, `work_entries`, `work_entry_revisions` ve `mutation_receipts` yazımını Drizzle/better-sqlite3 üzerinden tek kısa transaction’da yapar. Destek aktörü ve gerekli admin_audit yazımı aynı işlemde korunur; birleşik işletme ilişkileri ve güncel yetki kontrol edilir.

**İş adımları:**

1. Çalışma/revizyon/makbuz şemasını migration ile tamamla; sunucuda kapsam, aktiflik, tarih ve hesap kontrollerini POST kullanım durumuna bağla.
2. BEGIN IMMEDIATE davranışıyla kayıt, ilk revizyon ve sonucu birlikte yaz; şoförde pending, sahipte not_required üret ve onay oluşturma.
3. Kalıcı aktör/hedef kapsamlı işlem anahtarı ve içerik denetimini uygula; sınırlı kilit hatası ve belirsiz yanıtın aynı işlemle çözümlenmesini bağla.

**Doğrulama:** Aynı isteğin 100 tekrarı ve commit sonrası yanıt kaybı tek kayıt üretir; araya hata eklemek yarım kayıt bırakmaz; farklı anahtarlı iki gerçek çalışma aynı gün birlikte kalır. STORIES.md S3.4’ün tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.3; K7. Çevrimdışı kuyruk eklenmez; makine kaybından restore E6’dadır.

## T3.5 — Onaysız/sahip çalışmasını düzeltme ve sürüm çakışması

**Story / aşama:** S3.5 · M3  
**Sonuç:** Yetkili kullanıcı onaysız veya sahibin kendi çalışmasını geçmişi koruyarak düzeltebilir.  
**Teknik bağlam:** `/api/v1/work-entries/:id` PATCH, `work_entries.version` koşullu güncellemesi ile yeni revizyon/makbuzu aynı transaction’a bağlar. Onaylı kayıt bu uçta reddedilir; onaysız şoför ve sahip çalışması mevcut durumunu korur.

**İş adımları:**

1. Kapsamlı kayıt okuması ve düzenleme formunu ekle; eski pasif kişiyi koruma ile farklı kişiyi seçme kontrollerini ayır.
2. Sunucuda süre/para hesabını yeniden yap; beklenen sürümle koşullu güncelleme, yeni revizyon ve tekrar gönderim sonucunu birlikte yaz.
3. 409 durumunda güncel kaydı ve karşılaştırılabilir taslağı göster; onaylı kaydı bu uçtan değiştirme ve şoför iznini K1 kararı olmadan genişletme.

**Doğrulama:** Aynı sürüme iki farklı düzenlemeden yalnız biri uygulanır; tekrar deneme yeni sürüm çoğaltmaz; onaylı kayda PATCH reddedilir ve kendi sürüşü düzeltmesi para onayı yaratmaz. STORIES.md S3.5’in tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.4; K1, K3, K5/K6. Kesin kapsam aynı sürüş türünde düzeltmedir; onaylı yol S4.3 ile birleşir.

## T3.6 — Kayıt sonucu, bağlantı hataları ve telefon kullanım doğrulaması

**Story / aşama:** S3.6 · M3  
**Sonuç:** Kullanıcı telefonda kaydın durumunu anlayıp aynı hesabı ikinci kez oluşturmadan ilerler.  
**Teknik bağlam:** Günlük form, POST/PATCH sonuçlarını ve `/api/v1/work-entries/:id` kapsamlı okumasını kayıt kullanım durumundan alır. Tarayıcıdaki işlem anahtarı/taslak, `mutation_receipts` ile sonuç çözümlemesini destekler; başarılı sunucu kaydı yerine geçmez.

**İş adımları:**

1. Design §2.2–2.4/2.10’a uygun 320 px form, klavye/odak ve Kaydediliyor/Kaydedildi/hata durumlarını tamamla.
2. Belirsiz sonuçta gönderilmiş içeriği/anahtarı koruyup aynı işlemi çöz; oturum yenilenince yalnız aynı yetkili bağlamda devam ettir.
3. Yeni gerçek çalışma bağlantısını önceki sonuç çözüldükten sonra aç; şoförü yeni formda otomatik seçme ve temsili telefon kullanımını ölç.

**Doğrulama:** Bağlantı kaybı ikinci kayıt üretmez; başka araçla giriş önceki taslağı açmaz; %200 yakınlaştırma ve temsili kullanıcıyla 30–60 saniye hedefi değerlendirilir. STORIES.md S3.6’nın tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.4, S3.5; K1/K7. İkinci teslim düğmesi veya çevrimdışı başarı güvencesi yoktur; teslim yenilemesi S4.6’dadır.

## T4.1 — Kayıt detayı ve ilk alınan para onayı

**Story / aşama:** S4.1 · M4  
**Sonuç:** Sahip günlük hesabı inceleyip gerçek aldığı parayı tek işlemle doğrular.  
**Teknik bağlam:** `/api/v1/work-entries/:id` GET detayı, `/api/v1/work-entries/:id/confirm` POST ise ilk onayı sağlar. Çalışma/teslim modülü yeni `work_entries` sürümü, revizyon, `cash_confirmations` ve makbuzu birlikte yazar.

**İş adımları:**

1. Kişi/plaka/tarih, hesap dökümü, beklenen teslim ve düzenlenebilir “Aldığım tutar” alanını aynı detay ekranında göster.
2. Sahibin/ekibin yetkisini ve pending durumunu doğrula; açık alınan tutar ve beklenen sürümle tek transaction’da ilk onayı yaz.
3. Tek onay düğmesini, tekrar gönderim sonucunu, çakışma/başarısızlık durumlarını ve başarı sonrası güncel detay okumasını bağla.

**Doğrulama:** Hazır 6.200 TL alanı düğmeye basılmadan onay sayılmaz; tekrarlı/eşzamanlı onay çoğalmaz; şoförün onayı ve sahip sürüşüne para onayı reddedilir. STORIES.md S4.1’in tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.4, S1.5; K5. Ekip görünümü S4.5, şoför sonucu S4.6, rapor birleşimi E5’tedir.

## T4.2 — Beklenenden farklı alınan tutarı doğrulama

**Story / aşama:** S4.2 · M4  
**Sonuç:** Beklenen teslimden farklı gerçek alınan tutar, günlük hesabı değiştirmeden onaylanır.  
**Teknik bağlam:** Aynı `/api/v1/work-entries/:id/confirm` sözleşmesindeki `received_cents`, `cash_confirmations` verisidir. `work_entries` hasılat/pay/gider/beklenen alanları alınan para değişikliğinden yeniden türetilmez.

**İş adımları:**

1. Alınan tutarı ayrı doğrula; boş/geçersiz/negatif girdiyi reddet ve kuruş hassasiyetini koru.
2. Beklenenle farkı formda açık Türkçe göster; eşitlik şartı veya ayrı borç/uyuşmazlık/tahsilat adımı ekleme.
3. Değiştirilen alınan tutarı mevcut ilk onay kullanım durumundan geçir; detay yeniden açıldığında gerçek onaylı değeri göster.

**Doğrulama:** 6.200 TL beklenene 6.000 TL onayı hasılatı 10.000 TL ve payı 2.000 TL bırakır; tekrar gönderim ikinci teslim yaratmaz; E5 birleşiminde kalan 14.400 TL, onaylı alınan 6.000 TL’dir. STORIES.md S4.2’nin tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S4.1; K5. Sonradan onaylı tutarı değiştirmek S4.3’tür; negatif kalan akışı burada kararlaştırılmaz.

## T4.3 — Onaylı kaydı tek işlemde düzeltme ve onaylama

**Story / aşama:** S4.3 · M4  
**Sonuç:** “Düzelt ve onayla” yeni hesap ve alınan tutarı tek tam sürüm olarak saklar.  
**Teknik bağlam:** `/api/v1/work-entries/:id/correct-and-confirm` POST, koşullu sürüm güncellemesini yeni revizyon/onay/makbuzla atomik yazar. `cash_confirmations.entry_version` yeni sürüme bağlıdır; eski kayıt görüntüleri ve onaylar değiştirilmez.

**İş adımları:**

1. Onaylı detayda günlük alanları ve mevcut alınan tutarı aynı formda aç; yeni beklenen hesabı alınan tutara otomatik kopyalama.
2. Yetki, aynı sürüş türü ve kişi/araç ilişkisini doğrula; yeni hesap, revizyon ve açık alınan tutarı tek transaction’da sürüm kontrolüyle yaz.
3. Genel PATCH yolunu onaylı kayda kapalı tut; 409, rollback ve belirsiz sonuç davranışını bağlayıp başarıda yeni tam detayı yenile.

**Doğrulama:** İşlem ortasında hata eski tam durumu korur; 6.000→6.100 TL düzeltmesi güncel onayı 12.100 TL yapmaz; kişi/tarih değişimi yalnız yeni sürümün rapor dağılımına yansır. STORIES.md S4.3’ün tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S4.1, S4.2, S3.5; K4/K5. Tür dönüşümü kararsızken açılmaz; kendi sürüşünün onaysız düzeltmesi S3.5’te kalır.

## T4.4 — Sürüm, önce/sonra değerler ve onay geçmişini gösterme

**Story / aşama:** S4.4 · M4  
**Sonuç:** Sahip ve ekip, hesabın önceki sürümlerini ve hangi tutarın ne zaman onaylandığını okuyabilir.  
**Teknik bağlam:** `/api/v1/work-entries/:id/history` GET, kapsamlı `work_entry_revisions` ile sürüme bağlı `cash_confirmations` kayıtlarını okur. Veri erişimi güncel özeti geçmişten ayırır; mali raporlar geçmiş JSON satırlarını toplamaz.

**İş adımları:**

1. İşletme/kayıt/sürüm bağını koruyan geçmiş sorgusunu ve sahip/ekip okuma yetkisini uygula.
2. Oluşturma, önce/sonra değişiklik ve onay tutarı/zamanını okunur sırada göster; güncel sürümü belirt ve geçmiş düzenleme/silme işlemi açma.
3. Araç/rol aktörü ile gerçek ekip/onun adına işlem bilgisini ayır; gizli değerleri dışlayıp oturum temizliği ve pasiflik sonrası geçmişi koru.

**Doğrulama:** 6.000 ve 6.100 TL iki geçmiş onayıdır, tek güncel toplam değildir; başka kayıt/işletme veya şoför oturumu tarihçeyi açamaz; kişi pasifleştirme revizyonu silmez. STORIES.md S4.4’ün tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.4, S4.3; K1 şoför geri bildirimi bu tarihçeye izin vermez. Tanımlama audit ekranı S2.5’te kalır.

## T4.5 — Platform desteği adına teslim ve düzeltme

**Story / aşama:** S4.5 · M4  
**Sonuç:** Ekip aynı para kurallarıyla müşteri adına onay/düzeltme yapar ve gerçek aktör görünür kalır.  
**Teknik bağlam:** Destek ekranı mevcut `/confirm` ve `/correct-and-confirm` uçlarını doğrulanmış hedefle kullanır; ayrı destek yazma API’si açılmaz. Revizyon/onay aktör alanları gerçek `platform_user_id`, hedef ve sahip adına işlem bilgisini taşır.

**İş adımları:**

1. T2.5 hedefini ortak detay/form akışına bağla; işletme, plaka, sahip ve ekip kullanıcısını başlıkta göster.
2. İlk onayda “Sahip adına alınan tutar / Sahip adına teslimi onayla”, düzeltmede tek “Düzelt ve onayla” işlemini kullan.
3. Ortak kullanım durumlarında ekip aktörünü sunucudan üret; mali yazma ve izini birlikte tamamlayıp müşteri detayında destek kaynağını göster.

**Doğrulama:** Ekipte 6.000 TL onayı beklenen 6.200 TL ve %20 payı değiştirmez; yanlış müşteri hedefi reddedilir; tekrar/hata testleri müşteri yoluyla aynı bütünlüğü verir. STORIES.md S4.5’in tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S2.5, S4.3, S4.4; K4/K5 ekip için de geçerlidir. Destek kaydı ekibin fiziksel parayı aldığı iddiası değildir; yeni çalışma S3.3’tedir.

## T4.6 — Şoföre teslim durumunu gösterme ve yetkisiz değişikliği önleme

**Story / aşama:** S4.6 · M4  
**Sonuç:** Şoför izinli kayıt görünümünden teslim sonucunu ikinci kayıt/onay oluşturmadan takip eder.  
**Teknik bağlam:** Sonuç görünümü `/api/v1/work-entries/:id` GET ile güncel kayıt ve ona bağlı onayı okur. Yetki modülü araç kapsamını ve K1’de karara bağlanan erişimi uygular; kişi seçimi bireysel hesap yetkisi oluşturmaz.

**İş adımları:**

1. T3.6 sonuç ekranına beklenen/gerçek alınan ayrımı, onay zamanı ve Henüz doğrulanmadı/Teslim doğrulandı metinlerini ekle.
2. Açılış ve “Yenile” okumalarını bağla; hata eski sonucu yanlışlıkla sıfırlamasın, başarılı düzeltmeden sonraki yeni sürüm tutarlı görünsün.
3. Şoförün onay, onaylı düzeltme ve sahip/ekip tarihçe isteklerini sunucuda reddet; K1 sonrası izinli/izinsiz yeniden açma örneklerini tamamla.

**Doğrulama:** 6.200 TL beklenen ve 6.000 TL doğrulanan ayrı görünür; doğrudan şoför onay isteği reddedilir; güncel düzeltme eski alınan tutarla karışmaz. STORIES.md S4.6’nın tüm kabul kriterleri bağlayıcıdır.  
**Bağımlılık / açık karar:** S3.6, S4.1, S4.3, S1.5; K1 çözülmeden geçmiş erişimi genişletilmez veya paket tamamen bitti sayılmaz. Aynı gün düzenleme varsayılmaz; ilgili akış S3.5’tedir.

## T5.1 — Sahip özeti ve doğrulanmamış kayıt listesi

**Story / aşama:** S5.1 · M5.  
**Sonuç:** Sahip dönemin hesabını ve doğrulanmamış kayıtlarını tek ekranda görür.  
**Teknik bağlam:** /api/v1/reports/summary ve kapsamlı work-entries listesi kullanılır. Bekleyen liste şoför/pending kayıtlarını kapsar; toplam hesabı ve liste filtresi ayrıdır.

**İş adımları:**
1. S5.2 toplamlarını ve S5.4 sınırlı listesini sahip özetine bağla; plaka ve dönem sınırını görünür tut.
2. Kayıt detayına geçişi ve başarılı mutasyon sonrası yeniden sorgulamayı bağla; eski istek yanıtının yeni dönemi ezmesini önle.
3. Telefon kartları, boş/hata/yüklenme durumları ve anlaşılır kalan/alınan etiketlerini uygula.

**Doğrulama:** 14.400 TL kalan ile 0/6.000 TL alınan ayrımı; sahip çalışmasının bekleyen listeden dışlanması; yanlış araç/şoför oturumuna özet reddi.  
**Bağımlılık / açık karar:** S5.2, S5.4, S4.1; K2/K3/K5/K6 ilgili sınırları.

## T5.2 — Araç dönem hesabı ve güncel teslim toplamı

**Story / aşama:** S5.2 · M5.  
**Sonuç:** Dönemin çalışma hesabı ve gerçekten doğrulanmış para ayrı, doğru toplanır.  
**Teknik bağlam:** /api/v1/reports/vehicles; work_entries ile yalnız aynı entry_version'a bağlı cash_confirmations okunur. SUM işlemleri kapsam/tarih filtreli SQL'dir; API para değerleri tam sayı kuruş metnidir.

**İş adımları:**
1. Araç/dönem sorgusunu sunucunun yetkili kapsamıyla ve yarı açık dönem sınırlarıyla kur; tarih kararını K3'e bağla.
2. Hasılat/gider/pay/kalan ve güncel onay toplamını ayrı hesapla; sahip çalışmasını teslim toplamından çıkar.
3. Düzeltmede kişi/tarih dağılımını güncel sürümden oku; hesap ve detayın aynı kısa veri görüntüsünü kullanmasını sağla.

**Doğrulama:** 14.400 kalan ve 6.200/6.000/0 alternatif alınan; eski onayların çift sayılmaması; tam sayı hassasiyeti ve sınır tarihleri.  
**Bağımlılık / açık karar:** S1.5, S3.2, S3.4; son onay kabulü S4.1–S4.3. K2–K6 ilgili sınırları; E3 verisiyle erken hazırlanabilir.

## T5.3 — Kişi çalışma günleri, saatler ve para dökümü

**Story / aşama:** S5.3 · M5.  
**Sonuç:** Sahip dahil her kişinin çalışma günleri, saatleri ve tutarları doğru görünür.  
**Teknik bağlam:** /api/v1/reports/people; sabit person_id, COUNT(DISTINCT work_date) ve SUM(duration_minutes) kullanılır. Yeni çalışma seçicisinin aktiflik filtresi geçmiş rapora taşınmaz.

**İş adımları:**
1. Kişi özet/ayrıntısını yetkili araç ve dönemle sınırla; dakika ve para toplamlarını SQL'de hesapla.
2. Kişi adı değişimi/pasifliği ve aynı adlı farklı kişiler için sabit kimlik bağını koru; sahibin %0 çalışmasını dahil et.
3. Kişi kartını, ayrıntıyı ve kayıt detayına geçişi kur; geç gelen yanıt ve boş/hata durumlarını ayır.

**Doğrulama:** Aynı gün iki çalışma bir gün/saat toplamı; ad değişiminin geçmişi bölmemesi; kişi/tarih düzeltmesinde yeni dağılım.  
**Bağımlılık / açık karar:** S1.5, S2.4, S3.4, S3.5; onaylı düzeltme kabulü S4.3. K2/K3/K5/K6.

## T5.4 — Gün gün kayıtlar, filtreler ve sayfalama

**Story / aşama:** S5.4 · M5.  
**Sonuç:** Kullanıcı uzun geçmişte ilgili kayda toplamları bozmadan ulaşır.  
**Teknik bağlam:** GET /api/v1/work-entries; kapsam/tarih/kişi/durum filtreleri ve (work_date,id) cursor kullanılır. Başlangıç 50, en fazla 100 kayıt; tek rapor aralığı en fazla bir takvim yılıdır.

**İş adımları:**
1. Sunucu filtre doğrulaması ve kararlı cursor sorgusunu uygula; kapsam değişiminde sayfalama konumunu sıfırla.
2. Günlük kartlar ve Daha fazla göster davranışını kur; yükleme hatasında mevcut aynı kapsam listesini koru.
3. Liste filtrelerini tüm dönem özetinden etiketle ayır; eski yılları seçerek erişimi koru.

**Doğrulama:** Sabit veride sayfalar arası kayıp/tekrar olmaması; sayfa büyüklüğünün toplamı değiştirmemesi; yanlış hedef ve aşırı aralık reddi.  
**Bağımlılık / açık karar:** S1.5, S2.4, S3.4, S5.2, S4.1; K1/K2/K3/K5/K6, yeni kategori veya araç erişimi eklenmez.

## T5.5 — Rapor tutarlılığı, sorgu planı ve destek görünümü

**Story / aşama:** S5.5 · M5.  
**Sonuç:** Sahip ve ekip aynı yetkili veriden tutarlı rapor alır.  
**Teknik bağlam:** Rapor modülü aynı kullanım durumlarıyla owner/staff'a hizmet verir; private/no-store ve sunucu kapsamı korunur. Kısa okuma transaction'ı toplam/detayı tutarlı tutar.

**İş adımları:**
1. Raporları gerçek ekip hedefiyle bağla; başka müşteri verisinin önbellek/formdan taşınmasını önle.
2. Beş yıllık tanımlı fixture üzerinde sorgu planı/süre ölç; uygun bileşik indeksleri doğrula, gereksiz tam veri yüklemesini kaldır.
3. Kayıt/onay/düzeltme sonrası yenilemeyi ve kapsam/tutar eşitliğini bütünleşik testlerle bağla.

**Doğrulama:** Sahip/ekip toplam eşitliği; eşzamanlı düzeltmede eski veya yeni tam görüntü; 14.400 ile onay alternatifleri ve beş yıllık rapor planı.  
**Bağımlılık / açık karar:** S5.1–S5.4, S2.5, S4.5; K1–K6. S6.6 yük testi bu paketin ön koşulu değildir.

## T6.1 — Hedefle uyumlu derleme, kontroller ve yayın çıktısı

**Story / aşama:** S6.1 · M1.  
**Sonuç:** Test edilen üretim çıktısı hedef Linux ortamında çalıştırılabilir.  
**Teknik bağlam:** GitHub Actions hedef CPU/Ubuntu/Node ile uyumlu Next.js çıktısı hazırlar; SQLite/Argon2 native modülleri doğrulanır. Çıktı DB ve sırları içermez.

**İş adımları:**
1. Lockfile, hedef sürümler, tip/test/derleme kontrolleri ve native modül denemesiyle CI akışını hazırla.
2. Kaynak kimliği, hash ve şema uyumluluğu manifestini çıktıyla sakla; temiz hedef ortamda açmayı doğrula.
3. Artifact saklama ve dakika bütçesini sınırla; yayın işini ayrı manuel tetiklenen adım olarak tanımla.

**Doğrulama:** Başarısız testin çıktı/yayını engellemesi; uyumlu native modül; secret içermeyen tekrar tanımlanabilir sürüm.  
**Bağımlılık / açık karar:** S1.1; K9 sürüm/hesap ayrıntıları. Testler sonraki paketlerle genişletilir, her push üretime yayınlanmaz.

## T6.2 — Lightsail, HTTPS, kalıcı dizinler ve sürümlü kurulum

**Story / aşama:** S6.2 · M6; M1 sonrası hazırlık yapılabilir.  
**Sonuç:** Uygulama seçilen tek makinede güvenli adres ve kalıcı veriyle çalışır.  
**Teknik bağlam:** Caddy 80/443'ten 127.0.0.1:3000 Next.js'e yönlendirir. Architecture §8.1'deki releases/current, data, backup-ready ve servis ayar dizinleri ayrıdır.

**İş adımları:**
1. Bölge/paket/bütçe, alan adı ve yetkili erişimleri doğrula; root olmayan servis kullanıcısı ve dar ağ/dosya izinlerini kur.
2. Uyumluluğu doğrulanmış çıktıyı yerleştir; açık ilk migration, SQLite ayarları ve systemd/Caddy yapılandırmasını hazırla.
3. HTTPS, başlangıç servisleri, kalıcı veri ve eksik DB davranışını dene; tekrar uygulanabilir kurulum adımlarını kaydet.

**Doğrulama:** Restart sonrası veri; dışarı kapalı DB/sırlar/health; sertifika ve eksik DB'de boş sistem açılmaması.  
**Bağımlılık / açık karar:** S6.1, S1.3; K9. Docker/S3/ikinci uygulama sunucusu eklenmez; bu paket tek başına pilot hazır değildir.

## T6.3 — Çökme/donma denetimi, dış sağlık kontrolü ve ekip uyarısı

**Story / aşama:** S6.3 · M6; kurulum sonrası erken yapılabilir.  
**Sonuç:** Sınırlı otomatik kurtarma ve ekip uyarısı arızanın türüne göre çalışır.  
**Teknik bağlam:** systemd/journald ve bağımsız localhost health timer kullanılır. Live DB'den bağımsız, ready küçük tablo okumasıdır; dış makine kontrolü yerel timer'dan ayrıdır.

**İş adımları:**
1. Architecture §8.2'nin restart, timeout, bakım ve kalıcı kurtarma kilidi kurallarını servis/göreve uygula.
2. Dış erişim kontrolünü seçilmiş ekip kanalına bağla; RAM/disk/WAL/hata ölçümlerini ve log sınırını kur.
3. Çökme, event-loop donması, DB/disk arızası ve makine kesintisini ayrı kontrollü deneylerle kaydet.

**Doğrulama:** Sınırsız restart olmaması; reboot sonrası kilidin sürmesi; makine kapalıyken dış uyarı; bakımda otomasyonun beklemesi.  
**Bağımlılık / açık karar:** S6.2; K9 dış kontrol/kanal/sorumlu. Uyarı ulaşmadan tamamlandı sayılmaz.

## T6.4 — Tutarlı günlük DB kopyası, son yedi snapshot ve saklama kontrolleri

**Story / aşama:** S6.4 · M6.  
**Sonuç:** Günlük kurtarma kopyası doğrulanır ve sınırlı saklama düzeninde izlenir.  
**Teknik bağlam:** SQLite Backup API, integrity/FK/mali kontroller, hash/sürüm/son işlem manifesti ve günlük Lightsail snapshot kullanılır. Hazırlık ortak işletim kilidini alır.

**İş adımları:**
1. Tarihli geçici kopyayı kendi tutarlı görüntüsünde denetleyip atomik hazır konuma yayınla; uyumlu release'i koru.
2. Hazırlık son saati ve snapshot penceresini ilişkilendir; yerelde son iki sağlam kopyayı ve AWS'de son yedi otomatik snapshot'ı izle.
3. Geç/başarısız hazırlık ve snapshot alarmı, güvenli saklama temizliği ve makine silmeden manuel koruma adımlarını uygula.

**Doğrulama:** Başarısız yeninin eski sağlamı sildirmemesi; manifest/snapshot eşlemesi; beş yıllık iş verisi ve referans verilen kodun temizlenmemesi.  
**Bağımlılık / açık karar:** S6.2, S6.3, S4.3; saat dönüşümü/kanal K9. Hazırlık daha erken başlayabilir, mali kabul S4.3 sonrası.

## T6.5 — Restore, migration ve güvenli yayın geri dönüşü

**Story / aşama:** S6.5 · M6.  
**Sonuç:** Doğrulanmış yedekten geri dönüş ve başarısız yayın müdahalesi denenmiştir.  
**Teknik bağlam:** Snapshot ayrı makinede uyumlu release/kopyayla açılır; yayın, migration, restore ve yedek aynı işletim kilidini paylaşır. Müşteri yazmaları bakım süresince durur.

**İş adımları:**
1. Ayrı restore denemesinde hash/şema/son işlem/giriş/raporu kontrol et; eski oturumları iptal edip erişim/parola/pasiflik durumunu güncel bilgiyle doğrula. Kurtarılabilir zamanı ve süreyi kaydet.
2. Migration öncesi sağlam kopya, bakım, sürüm geçişi ve readiness/mali smoke kontrollerini kontrollü yayın akışına bağla.
3. Trafik öncesi uyumlu kod veya kod+DB dönüşünü dene; yeni yazma sonrası eski DB'ye otomatik dönüşü engelle ve ileri düzeltme yolunu belgele.

**Doğrulama:** Restore edilen mali toplamlar; başarısız migration'da eski tam durum; yeni kayıtların eski kopyayla silinmemesi; saklanan kod/kopya bağı.  
**Bağımlılık / açık karar:** S6.4, S5.5; K9 erişimler. Deneme üretim verisinin üstüne yapılmaz; geçici kaynak maliyeti kaydedilir.

## T6.6 — Yük/veri bütünlüğü kabulü ve pilot işletim rehberi

**Story / aşama:** S6.6 · M6.  
**Sonuç:** Doğru çalışan uygulama ölçülen kapasitesi ve işletim kanıtlarıyla kontrollü pilota açılır.  
**Teknik bağlam:** Seçilen makinede üretim derlemesi ve beş yıllık temsili veri; yük üreticisi başka ortam. Üç senaryo giriş, gerçekçi aktif kullanım ve yazma tepesidir.

**İş adımları:**
1. 35 hikâyenin yayın öncesi kabulü ve 28 PRD maddesinin sonuçlarını birleştir; açık kararları ve kritik yayın engellerini kapat. S6.6'nın yayın/sonrası kriterlerini 3. adım tamamlar.
2. 100 giriş, 100 aktif kullanıcı ve 100 yazma tepesini ayrı ölç; sürdürülen yük, p95, RAM/CPU/burst/WAL ve mali bütünlüğü raporla.
3. QA/Release/Ops rehberlerini gerçek sürümle tamamla; pilot kapsamı ve erişimler belirlendiğinde kontrollü yayın ile yayın sonrası smoke yap, hazır/yayınlandı durumlarını ayır.

**Doğrulama:** Normal yükte kayıt p95 ≤2 sn, rapor ≤3 sn, beklenmeyen hata <%1; mali kayıp/çoğalma/tutarsızlık sıfır; restore/uyarı kanıtları ve yayın sonrası temel akışlar.  
**Bağımlılık / açık karar:** S1.6, S2.6, S3.6, S4.4, S4.5, S4.6, S5.5, S6.5; pilotu etkileyen K1–K9. Kapasite değişikliği ölçümden sonra değerlendirilir.
