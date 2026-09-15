# Epics: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.4  
**Durum:** Ana geliştirme işleri hazır; henüz geliştirme veya canlı yayın yapılmadı.  
**Kaynaklar:** [PRD](PRD.md) · [Tech Stack](TECH-STACK.md) · [Architecture](ARCHITECTURE.md) · [Design](DESIGN.md)  
**Şablon:** Project Blueprint / 05-epics.

Bu belge uygulamayı altı anlamlı iş grubuna ayırır. Her grupta kullanıcıya sağlayacağı sonuç, kapsam, bağımlılık, tamamlanma ölçütü ve STORIES.md içinde ayrıntılandırılan kullanıcı hikâyeleri bulunur. Kullanıcının bu aşamaya geçiş talebi esas alınmıştır; önceki belgelerde açık bırakılan tercihler aşağıda ilgili işlere bağlanır ve kendiliğinden kesinleşmez.

## Epic listesi

| ID | Ana iş | Kullanıcının elde edeceği sonuç | Süre tahmini | Bağımlılık |
|---|---|---|---|---|
| E1 | Giriş ve yetkiler | Plaka/şifreyle doğru alana giriş; işletmelerin verilerinin ayrılması | Kapasite netleşince | Yok; uygulama temeli burada başlar |
| E2 | İşletme, araç ve şoför yönetimi | Ekibin araç açması, sahibin veya ekibin şoför tanımlaması | Kapasite netleşince | E1 |
| E3 | Günlük kayıt ve hesap | Çalışmanın tek Kaydet ile doğru ve kalıcı kaydı | Kapasite netleşince | E2; E1’in yetki altyapısı |
| E4 | Para onayı, düzeltme ve geçmiş | Gerçek alınan paranın doğrulanması, izlenebilir düzeltme | Kapasite netleşince | E3 |
| E5 | Özet ve raporlar | Kişi/araç bazında anlaşılır dönem hesabı | Kapasite netleşince | E3 ile başlayabilir; tamamlanması E4’ü de gerektirir |
| E6 | Yayın ve işletim | Uygulamanın çalıştırılması, izlenmesi ve yedekten kurtarılması | Kapasite netleşince | Hazırlığı E1 ile; canlıya hazır sayılması E1–E5 sonrası |

**Toplam süre:** Henüz tahminlenmedi. Stories/Tasks kırılımı hazır; geliştirme kapasitesi ve uygulama ayrıntıları netleşince tahmin eklenecek; bu belge teslim tarihi taahhüt etmez. Bütün epic’ler MVP içindir. Bölümlerdeki tamamlanma listeleri yapılacak doğrulamalardır; yapılmış test sonucu değildir.

### Önerilen geliştirme sırası

1. **E1:** Yerel uygulama, şema/migration temeli, giriş ve yetki kontrolleri. **E6’nın** derleme/test ve dağıtım hazırlıkları bu aşamada başlar.
2. **E2:** Gerçek ekranlardan işletme, araç ve şoför açma. Bundan sonraki işler elle veritabanı düzenlemeye ihtiyaç duymadan denenebilir.
3. **E3:** Günlük çalışma ve para hesabı; daha ilk kayıtta tekrar gönderim koruması ve revizyon vardır.
4. **E4:** Para teslimi, düzenleme ve geçmiş. **E5’in** çalışma raporları E3 sonrası hazırlanabilir; teslim toplamı ve son kabulü E4 ile birleşir.
5. **E5:** Tüm dönem, kişi ve araç hesaplarını doğrulama.
6. **E6:** Bütün akışlarla yük, yeniden başlatma, yedek/geri yükleme ve kontrollü yayın doğrulaması; pilot kullanım için hazır olma.

Bu sıra, her epic için ayrı bulut servisi veya ayrı uygulama oluşturmaz. Aynı Next.js uygulaması ve SQLite kullanılır. İşlevin sahibi kendi kabul kontrollerini geliştirir; E6, diğer epic’lerin hesap ve güvenlik testlerini sonradan yazma aşaması değildir.

## PRD kapsam eşlemesi

PRD’de F-01 gibi özellik kodları yoktur. Şablondaki özellik referansları yerine **PRD bölüm numarası ve §9’daki mevcut kabul senaryosu numaraları** kullanılır. Kaynak numaralar değişirse bu eşleme de güncellenir.

| Ana sorumlu | PRD §9 kabul maddeleri | Diğer epic katkıları |
|---|---|---|
| E1 | 12, 16, 18, 22 | Her veri ekranında kapsam denetimi; E2’de şifre sıfırlama/pasifleştirme |
| E2 | 2, 19, 23, 24, 28 | #2’de E3 günlük form; #19’da E5 geçmiş rapor; #28’de E3/E4/E5 destek işlemleri |
| E3 | 1, 3, 4, 5, 7, 8, 9, 13, 17, 25 | E1 giriş; E4 sahte onay reddi; E5 rapor sonucu |
| E4 | 6, 15, 20, 26, 27 | E1 yetkiler; E3 kayıt/hesap; E5 güncel onayın raporu |
| E5 | 10, 11, 21 | E2 sabit kişi; E3 çalışmalar; E4 güncel teslim onayı |
| E6 | 14 | Tekrarlı gönderim E3/E4’te geliştirilir; E6’da kalıcılık ve restore ile birlikte sınanır |

28 kabul maddesinin her birinin bir ana sorumlusu vardır. Birden fazla epic’e yayılan senaryonun tamamı, katkı veren işler de hazır olduğunda uçtan uca doğrulanır. Örneğin E3’ün kayıt işlemi kendi testleriyle teslim edilebilir; rapor ekranına yansıma E5 ile tamamlanır.

## E1 — Giriş ve yetkiler

### Özet

Mal sahibi ve şoför, aynı plakayla kendilerine verilen farklı şifreleri kullanarak doğru alana girer. Platform ekibi kişisel hesaplarla ayrı yönetim alanına erişir; her işlem yetkili işletme/araçla sınırlıdır.

**Süre tahmini:** Hikâye boyutları STORIES.md içinde; takvim tahmini iş paketleri ve kapasite netleşince.  
**Bağımlılık:** Yok. Test için örnek işletme/araç/kişi verisi kullanılabilir; gerçek müşteri açma ekranı E2’dedir.

### Kapsadığı PRD özellikleri

| Referans | Kapsam |
|---|---|
| PRD §2, §6 | Plaka + iki farklı şifre, ayrı ekip girişi; halka açık kayıt olmaması |
| PRD §8 | Güvenli parola/oturum, sunucu ve veritabanında işletme/araç ayrımı |
| PRD §9: 12, 16, 18, 22 | Yetkisiz veri/alan erişiminin önlenmesi |

### Tamamlanma ölçütleri

- Yerel proje seçilen teknolojiyle çalışır; uyumlu paket sürümleri/lockfile, şema migration altyapısı ve sınanabilir yetki katmanı bulunur. Yeni teknoloji sağlayıcısı seçilmez.
- Plaka ve sahip şifresi sahip alanını, ortak şoför şifresi şoför alanını açar. Kullanıcıya rol seçtirilmez; istemci rol değiştirse bile sunucu yetki vermez. Aynı araç için iki şifre birbirinden farklıdır.
- Ekip girişi kişisel ekip hesabıyla çalışır; araç şifreleri yönetim alanını açamaz. İlk yönetici kontrollü kurulumla oluşturulur, sonraki ekip hesabı yönetimi E2’dedir.
- Parola hash’leri ve iptal edilebilir sunucu oturumları mimariye uygundur; şifre/token loglarda veya yönetim ekranında açığa çıkmaz. Giriş hız sınırı ve istek kaynağı/CSRF kontrolleri sınanır.
- Çıkış, şifre sıfırlama ve araç/işletme/ekip pasifliği ilgili oturum erişimini keser. Sıfırlama/pasifleştirme ekranları E2’de bu kurala bağlanır.
- Başka işletmeye ait araç/kişi/kayıt ID’si doğrudan gönderildiğinde ekran ve API veri açmaz; ilişki kısıtları DB seviyesinde de sınanır. Her yeni endpoint aynı denetimi kullanır.
- Ortak şoförün ad seçimi bireysel kimlik doğrulaması veya sahip yetkisi sayılmaz. Açık geçmiş/çok araç erişimi, kararı gelmeden geniş yetki olarak uygulanmaz.
- Telefon girişinde okunaklı etiketler, büyük alanlar, bekleme ve anlaşılır hata durumu vardır; form yanlış şifrede sessizce sıfırlanmaz.

### Yüksek seviye story’ler

| ID | Başlık |
|---|---|
| S1.1 | Uygulama, migration ve otomatik kontrol temelini hazırlama |
| S1.2 | Plaka ve şifreyle araç girişini tamamlama |
| S1.3 | Kişisel ekip girişi ve ilk yönetici kurulumu |
| S1.4 | Sunucu oturumu, çıkış ve erişim iptali |
| S1.5 | İşletme/araç kapsamı ve işlem yetkilerini uygulama |
| S1.6 | Telefon girişindeki hata, bekleme ve erişilebilirlik durumları |

### İlgili belgeler ve notlar

[Architecture](ARCHITECTURE.md) §1.1, §2, §3.1–3.2, §6; [Design](DESIGN.md) §1, §2.1, §2.10; [Tech Stack](TECH-STACK.md) §1–4. Şoför geçmişi ve sahibin çok araç kapsamı K1/K2 kararlarına bağlıdır. Giriş hesabı yönetimi ile günlük kayıtta çalışanın kim olduğu ayrı kavramlardır.

## E2 — İşletme, araç ve şoför yönetimi

### Özet

Ekibimiz back office’ten müşterinin işletmesini ve aracını açar, iki şifreyi yönetir. Mal sahibi veya yetkili ekip şoför listesini düzenler; kayıtların doğru araç ve kişiyle ilişkilendirilmesi sağlanır.

**Süre tahmini:** Hikâye boyutları STORIES.md içinde; takvim tahmini iş paketleri ve kapasite netleşince.  
**Bağımlılık:** E1. Bu epic’te destek hedefini seçme ve tanımlama işlemleri tamamlanır; günlük destek E3, para işlemleri E4, raporlar E5 ile eklenir.

### Kapsadığı PRD özellikleri

| Referans | Kapsam |
|---|---|
| PRD §2, §6 | Back office, işletme/sahip/araç oluşturma, Şoförlerim, ekip desteği |
| PRD §7–8 | Gerçek ekip işlem izi, yetkili ilişkiler ve geçmişin korunması |
| PRD §9: 2, 19, 23, 24, 28 | Araç açma, kişi yönetimi, şifre/aktiflik ve hedef işletme ayrımı |

### Tamamlanma ölçütleri

- Ekip ekranından işletme ve mal sahibi tanımlanır; araç doğru işletme/sahibe bağlanır. Plaka, marka/model, yıl, hat/durak, not ve aktiflik yönetilebilir; gerçek kullanımda DB’ye elle yazmak gerekmez.
- Araç için iki şifre belirlenebilir ve ayrı ayrı sıfırlanabilir. Mevcut şifre gösterilmez; hangi araç/erişimin değiştiği açıktır. Değişiklik ilgili eski oturumları geçersiz kılar.
- Sahip Şoförlerim ekranından kişi ekler/adını düzeltir ve kendi yetkili aracındaki atamayı yönetir. Ekip aynı işi doğru müşteri bağlamında yapabilir.
- Kişi sabit ID ile tutulur; ad değişince geçmiş bölünmez, aynı adlı farklı kişiler birleşmez. Bir kişi için tekrar araç ataması yeni kişi kaydı oluşturmaz.
- Araç atamasının pasifleştirilmesi başka araçları etkilemez; yeni çalışma seçiminden çıkarır ve geçmişi korur. Genel kişi aktifliği ayrı ekip yetkisidir. Eski pasif kişi kaydını düzeltme ihtiyacı korunur.
- Yönetim ekranında hedef işletme, plaka, sahip ve işlemi yapan ekip kullanıcısı görünür. Yanlış hedefe ait ilişki sunucuda reddedilir; dolu form hedef değiştirirken sessizce başka müşteriye taşınmaz.
- İşletme/araç/kişi/şifre yönetimi işlemleri gerçek ekip kimliği, hedef, zaman ve güvenli önce/sonra bilgisiyle iz bırakır; gizli değerler geçmişe yazılmaz.
- Ekip hesaplarını yalnız platform yöneticisi oluşturur, yetkilendirir, pasife alır veya şifresini sıfırlar. Yeni halka açık kayıt/OTP akışı yoktur.

### Yüksek seviye story’ler

| ID | Başlık |
|---|---|
| S2.1 | İşletme ve mal sahibi tanımlama |
| S2.2 | Araç oluşturma, bilgi düzenleme ve aktiflik |
| S2.3 | Araç şifrelerini belirleme ve sıfırlama |
| S2.4 | Şoförlerim, sabit kişi ve araç atamaları |
| S2.5 | Yönetimde müşteri hedefi ve tanımlama işlem geçmişi |
| S2.6 | Kişisel ekip hesabı ve yetki yönetimi |

### İlgili belgeler ve notlar

[Architecture](ARCHITECTURE.md) §2, §3.1–3.2, §4, §6; [Design](DESIGN.md) §2.8–2.10. Platform desteği kullanıcı işlemlerini müşterinin şifresiyle taklit etmez. Ortak sahip/devir ve sahibin araç bilgisi düzenleme sınırları K2/K8’de kalır. İşletme pasifliğinin araç erişimine etkisi açık gösterilir.

## E3 — Günlük kayıt ve hesap

### Özet

Şoför çalışma saatlerini ve para bilgilerini tek formda kaydeder. Mal sahibi kendi çalışmasını veya şoförün çalışmasını, ekip de müşteri adına aynı iş kurallarıyla girebilir.

**Süre tahmini:** Hikâye boyutları STORIES.md içinde; takvim tahmini iş paketleri ve kapasite netleşince.  
**Bağımlılık:** E2 ve onun kullandığı E1 yetkileri. İlk kayıtla birlikte revizyon, tekrar gönderim sonucu ve destek işlem izi üretilir; bu altyapı E4’e ertelenmez.

### Kapsadığı PRD özellikleri

| Referans | Kapsam |
|---|---|
| PRD §3–4 | Tek Kaydet, %20 / %0 pay, otomatik süre ve para hesabı |
| PRD §5–8 | Birden fazla çalışma, mobil form, kalıcılık, müşteri adına kayıt |
| PRD §9: 1, 3, 4, 5, 7, 8, 9, 13, 17, 25 | Günlük kayıt ve hesap senaryoları; rapor sonuçları E5 ile tamamlanır |

### Tamamlanma ölçütleri

- Bugün önseçili tarih değiştirilebilir, plaka hazırdır, aktif şoför listeden seçilir. Başlangıç/bitiş seçilince 08:00–17:30 için 9 saat 30 dakika görünür. Geçersiz tarih/saat kabul edilmez; açık gece/dönem kuralları K3’e bağlıdır.
- Hasılat ve mazot zorunlu, diğer masraf isteğe bağlıdır. Açıkça girilen 0 geçerlidir; boş zorunlu alan sıfır sayılmaz. Mavi-beyaz tek sütun form, Türkçe metin, büyük yazı/alan ve görünür hata durumları uygulanır.
- 10.000 TL hasılat, 1.500 TL mazot, 300 TL diğer masrafta şoför payı 2.000 TL, kalan 6.200 TL’dir. Sahip kendi çalıştıysa pay 0 ve kalan 8.200 TL olur. Özet Kaydet’ten önce görünür.
- Sahip veya ekip şoför adına girince pay %20 kalır. Şoför oturumu sahibin kendi sürüşünü oluşturamaz. Sahibin kendi sürüşü “onay gerekmiyor” olur ve teslim bekleyen listesine girmez.
- Sunucu süre/pay/kalanı yeniden hesaplar; para kuruş tam sayısıyla ve mimarideki yuvarlama kuralıyla işlenir. İstemcinin değiştirdiği hesaplanmış değerler esas alınmaz. Kural sürümü/oranı kayıtta korunur.
- Tek Kaydet yeterlidir. Başarı yalnız tam kayıt/revizyon/tekrar gönderim sonucu yazıldıktan sonra gösterilir; sahip kayıt listesinde ve raporlama veri kaynağında yeni çalışma okunabilir. Rapor ekranının tamamlanması E5’tedir.
- Aynı gönderimin tekrarları ve commit sonrası yanıt kaybı tek kayıt üretir. Sonuç bilinmiyorsa kullanıcıya belirsizlik gösterilir; aynı işlem çözülmeden değiştirilmiş içerikle yeni kayıt oluşturulmaz. Bilinen hata/bağlantı kaybında girilen alanlar korunur.
- Aynı gün aynı kişi/araç için iki gerçek çalışma iki ayrı kayıt olarak kalır. Sahibin ve ekibin onaysız kayıt veya sahibin kendi çalışmasını düzenlemesi sürüm/geçmiş üretir; eşzamanlı düzeltme sessizce diğerini ezmez. Şoförün onaysız düzenleme kapsamı K1’e bağlıdır.
- Telefon tarayıcısında okuma, saat/para klavyesi ve form tamamlama denenir. PRD’deki yaklaşık 30–60 saniyelik giriş hedefi temsili kullanıcıyla ölçülür; yalnız geliştiricinin hızlı girişi yeterli kanıt değildir.

### Yüksek seviye story’ler

| ID | Başlık |
|---|---|
| S3.1 | Aktif kişi, tarih ve saatlerle günlük form |
| S3.2 | Para girdileri, otomatik pay/kalan ve sunucu hesapları |
| S3.3 | Sahip çalışması ve müşteri adına kayıt |
| S3.4 | Kalıcı kayıt, ilk revizyon ve tekrar gönderim koruması |
| S3.5 | Onaysız/sahip çalışmasını düzeltme ve sürüm çakışması |
| S3.6 | Kayıt sonucu, bağlantı hataları ve telefon kullanım doğrulaması |

### İlgili belgeler ve notlar

[Architecture](ARCHITECTURE.md) §1.2, §3.3–3.6, §4; [Design](DESIGN.md) §2.2–2.4, §2.10, §3–4. K1/K3/K5/K6/K7 ilgili story sınırlarını etkiler. Şoförden ikinci “Teslim ettim / Onaya gönder” işlemi istenmez. Yeni başarılı kayıt için çevrimdışı senkronizasyon varsayılmaz; tekrarlı istek güvenilirliği bu açık özellikten bağımsızdır.

## E4 — Para onayı, düzeltme ve geçmiş

### Özet

Mal sahibi hesaplanan teslimi ve gerçekten aldığı parayı birlikte görüp doğrular. Onaylı kayıt gerektiğinde “Düzelt ve onayla” ile tek işlemde değiştirilir; önceki değerler izlenebilir kalır.

**Süre tahmini:** Hikâye boyutları STORIES.md içinde; takvim tahmini iş paketleri ve kapasite netleşince.  
**Bağımlılık:** E3’ün kayıt, revizyon, hesap ve tekrar gönderim altyapısı; E1/E2 yetkileri ve destek hedefi.

### Kapsadığı PRD özellikleri

| Referans | Kapsam |
|---|---|
| PRD §3–4, §7 | Beklenen/alınan ayrımı, ilk onay, tek işlemde onaylı düzeltme |
| PRD §6–8 | Yetkili ekip desteği, gerçek aktör, eski kayıt ve onayların korunması |
| PRD §9: 6, 15, 20, 26, 27 | Para teslimi ve düzeltme kabul senaryoları |

### Tamamlanma ölçütleri

- Detayda kişi, araç, çalışma tarihi, beklenen teslim ve alınan tutar birlikte görünür. Beklenenle önceden dolan alan kullanıcı basmadan para onayı sayılmaz.
- “Parayı aldım, tutar doğru” bir onay oluşturur. Beklenen 6.200 TL iken 6.000 TL onaylanabilir; hasılat 10.000 TL, pay 2.000 TL ve beklenen 6.200 TL kalır. Ayrı borç/uyuşmazlık/tahsilat akışı açılmaz.
- Şoför oturumu onay veremez veya onaylı kaydı düzenleyemez. Sahip/ekip onaylı kaydın günlük alanlarını ve alınan tutarı aynı ekranda görüp **Düzelt ve onayla** der; ikinci onay adımı çıkmaz.
- Yeni kayıt sürümü, yeni para onayı, geçmiş ve işlem sonucu birlikte yazılır. İşlem ortasında hata halinde eski tam durum kalır. Aynı işlem tekrarlandığında ikinci para onayı/tutar toplamı oluşmaz; sürüm çakışması açıklanır.
- Hasılat veya gideri düzeltmek alınan tutarı kendiliğinden yeni beklenene eşitlemez. Kişi/tarih düzeltmesi yeni sürüme bağlanır; eski sürüm ve eski onay korunur. Güncel rapora yalnız yeni sürümün onayı E5 ile yansır.
- Sahip veya ekip, eski/yeni değerleri ve zamanı okuyabilir. Ekip işlemi gerçek kullanıcı ve “Sahip adına platform desteği” bilgisiyle görünür; ekibin parayı fiziksel aldığı iddia edilmez.
- Şoför için onay durumu üretilir ve K1’de belirlenen erişim kapsamından görülebilir. “Henüz doğrulanmadı” borç veya kesin teslim edilmemiş para olarak sunulmaz; sahibin kendi çalışmasına teslim onayı açılmaz.

### Yüksek seviye story’ler

| ID | Başlık |
|---|---|
| S4.1 | Kayıt detayı ve ilk alınan para onayı |
| S4.2 | Beklenenden farklı alınan tutarı doğrulama |
| S4.3 | Onaylı kaydı tek işlemde düzeltme ve onaylama |
| S4.4 | Sürüm, önce/sonra değerler ve onay geçmişini gösterme |
| S4.5 | Platform desteği adına teslim ve düzeltme |
| S4.6 | Şoföre teslim durumunu gösterme ve yetkisiz değişikliği önleme |

### İlgili belgeler ve notlar

[Architecture](ARCHITECTURE.md) §1.3, §3.3–3.4, §4 ve [kayıt bütünlüğü kararı](architecture-decision-records/002-kayit-butunlugu.md); [Design](DESIGN.md) §2.3, §2.6, §2.9–2.10. Onaylı şoför sürüşünü sahip sürüşüne dönüştürme K4’tedir. Eski onayı yeni toplamın yanında yeniden toplamak veya onaylı kaydı genel düzenleme yolundan değiştirmek kabul edilmez.

## E5 — Özet ve raporlar

### Özet

Mal sahibi günlük kayıtlardan haftalık, aylık ve yıllık hesabını görür. Kim kaç gün/saat çalışmış, araç ne toplamış ve gerçekten ne kadar para doğrulanmış soruları ayrı, anlaşılır alanlarla cevaplanır.

**Süre tahmini:** Hikâye boyutları STORIES.md içinde; takvim tahmini iş paketleri ve kapasite netleşince.  
**Bağımlılık:** E3 verisiyle geliştirme başlayabilir; güncel teslim ve düzeltme sonuçlarının kabulü E4 tamamlanınca yapılır.

### Kapsadığı PRD özellikleri

| Referans | Kapsam |
|---|---|
| PRD §4–6 | Kişi, araç, dönem, gün gün döküm ve sahip özeti |
| PRD §7–8 | Güncel sürümün hesabı, veri ayrımı, geçmiş kişi kayıtları |
| PRD §9: 10, 11, 21 | Doğru toplamlar, dönem raporları, yalnız ekranda görüntüleme |

### Tamamlanma ölçütleri

- Hafta/ay/yıl ve gün gün döküm ekranda seçilebilir; dönem başlangıç/bitişi görünür. Dönem değişirken eski veriler yeni dönemin tutarı gibi sunulmaz.
- Kişi raporunda çalışma günleri, süre, çalışma sayısı, hasılat ve pay; kişi detayında mazot, diğer masraf ve kalan vardır. Aynı gün iki çalışma iki gün sayılmaz; gece/dönem dağılımı K3’teki karara bağlanır.
- Sahip kendi adı, saati, hasılatı ve sıfır payıyla görünür. Ad değişmiş veya kişi pasifleşmiş olsa da geçmiş sabit kişi üzerinden korunur; aynı adlı farklı kişiler birleşmez.
- Araç raporu gelir/mazot/diğer masraf/pay/kalanı verir. **Hesaplanan kalan** ve **teslim alınan (onaylı)** ayrı gösterilir; onaysız çalışma hesap toplamlarına girer, onaysız para teslim toplamına girmez.
- PRD’nin iki çalışma örneği 14.400 TL kalan üretir. Ahmet için 6.200 TL eksiksiz onayda teslim toplamı 6.200 TL; bunun yerine 6.000 TL onaylandığında toplam 6.000 TL’dir. Sahibin 8.200 TL kalanı teslim toplamına eklenmez. Hiç onay yokken teslim toplamı 0 TL olur.
- Onaylı kayıt düzeltildiğinde yalnız güncel sürüm/onay hesaba katılır. Kişi veya tarih değiştirilince eski kişi/dönemden çıkar, yenisine girer; revizyonlar ayrıca toplanmaz. Hesap ve detay tutarlı bir veri görüntüsünden hazırlanır.
- Liste sayfalansa da toplamlar dönemin tamamıdır. Yetkili kapsam, tarih, kişi ve teslim durumu filtrelenebilir; plaka/araç geçişi K2, masraf türü filtresi K6 kararına bağlı ayrıntıdır. Liste filtresi ile tüm araç toplamının kapsamı açıkça etiketlenir.
- SQL toplama, dönem sınırı, sayfalama ve gerekli indeksler kullanılır; her istekte bütün geçmiş uygulamaya yüklenmez. Yeni kayıt/onay/düzeltme ilgili ekranı yeniler; sürekli sorgu döngüsü gerekmez.
- Mobilde okunur kartlar, boş/yükleniyor/hata durumları ve seçili hedef vardır. Hata/gecikme sahte 0 toplam üretmez. Ekip aynı raporu doğru müşteri bağlamında görebilir. PDF/Excel/indirme eklenmez.

### Yüksek seviye story’ler

| ID | Başlık |
|---|---|
| S5.1 | Sahip özeti ve doğrulanmamış kayıt listesi |
| S5.2 | Araç dönem hesabı ve güncel teslim toplamı |
| S5.3 | Kişi çalışma günleri, saatler ve para dökümü |
| S5.4 | Gün gün kayıtlar, filtreler ve sayfalama |
| S5.5 | Rapor tutarlılığı, sorgu planı ve destek görünümü |

### İlgili belgeler ve notlar

[Architecture](ARCHITECTURE.md) §1.4, §3.5, §5, §9; [Design](DESIGN.md) §2.5, §2.7, §2.9–2.10. En az beş yıllık kayıt saklama ve eski yılları ayrı seçme korunur; tek raporun sorgu sınırı kayıtları silme gerekçesi değildir. Bağımsız giderler onaylanmadan sonuç “kesin net kâr/banka bakiyesi” diye adlandırılmaz.

## E6 — Yayın ve işletim

### Özet

Seçilen tek Lightsail makinesinde uygulama kontrollü çalıştırılır; çökme, donma, disk/yedek sorunları fark edilir. Geri yükleme ve veri bütünlüğü denenmeden hizmet hazır sayılmaz.

**Süre tahmini:** Hikâye boyutları STORIES.md içinde; takvim tahmini iş paketleri ve kapasite netleşince.  
**Bağımlılık:** Derleme/test/kurulum hazırlığı E1 ile başlar. Yayın kabulü, E1–E5’in bütünleşik akışlarına ve K9’daki işletim ayrıntılarına bağlıdır.

### Kapsadığı PRD özellikleri

| Referans | Kapsam |
|---|---|
| PRD §1, §8 | Telefon web erişimi, 500 toplam kullanıcı hedefi, kalıcı veri ve en az beş yıllık saklama |
| PRD §9: 14 | Kapanma/telefon değişimi/tekrar gönderim ve yedekten geri yükleme |
| Tech Stack §5–9; Architecture §8–9 | Kontrollü yayın, süreç yönetimi, günlük yedek, restore ve yük doğrulaması |

### Tamamlanma ölçütleri

- Hedef Ubuntu/CPU/Node ile uyumlu sürümler sabitlenir; CI üretim çıktısı ve native modüller hedefte çalışır. Testleri geçen sürüm SSH ile sürümlü dizine kontrollü, manuel tetiklenen yayınla alınır. Üretim makinesinde derleme varsayılmaz.
- Caddy/HTTPS, uygulama servisi, erişim sınırları ve kalıcı DB dizini doğrulanır. Kod sürümü/temizliği DB’yi veya yedeği silmez; eksik DB ile sessizce boş hesap sistemi açılmaz.
- Çökmede systemd yeniden başlatması, donmada ayrı sağlık görevi ve bakım sırasında davranış denenir. Mimari restart sınırları/kurtarma kilidi çalışır; DB bozulması veya disk dolması sonsuz restart üretmez. Makine tamamen erişilemezken dış kontrol ve ekibe uyarı çalışır.
- Günlük **son yedi Lightsail otomatik snapshot** planı kurulur. Öncesinde hazırlanmış, bütünlüğü doğrulanmış SQLite kopyası ve uyumlu sürüm bilgisi snapshot’ta korunur. Hazırlanan kopya, tamamlanan snapshot ve sınanmış restore ayrı durumlar olarak izlenir.
- Yedek hazırlığı/snapshot gecikir veya başarısız olursa önceki sağlam kopya korunur, ekip uyarılır. Yerel kopyalar, loglar ve CI çıktıları tanımlı saklama sınırlarında temizlenir; en az beş yıllık iş kayıtları ve revizyonlar silinmez. Snapshot kaynak makine silinmeden korunacaksa manuel snapshot’a çevrilmesi işletim adımında yer alır.
- Snapshot ayrı makineye geri yüklenir; kopya bütünlüğü, uyumlu uygulama/şema, girişler, son başarılı kayıt, kişi/araç ilişkileri, revizyonlar ve rapor toplamları doğrulanır. Kurtarılabilir son kayıt zamanı ve gerçek toparlanma süresi kaydedilir; günlük yedek sıfır veri kaybı diye sunulmaz.
- Yayın/migration öncesi doğrulanmış kopya ve ortak işletim kilidi kullanılır; başarısız migration/derleme sonrası güvenli dönüş denenir. Yeni müşteri kayıtları kabul edildikten sonra eski DB’ye otomatik geri dönüş yapılmaz.
- Üretim derlemesiyle, beş yıllık temsili veri ve makine dışındaki yük üreticisiyle üç senaryo ayrı ölçülür: 100 kısa aralıklı giriş, 100 aktif kullanıcının gerçekçi beklemeli işlemleri, 100 yazma isteği tepesi. Sürdürülen yük, CPU burst, RAM, disk/WAL ve SQLite beklemeleri gözlenir. 500 toplam kullanıcı bu ölçümlerin yerine geçmez.
- Architecture §9’daki başlangıç hedefleri normal karışık yükte kayıt p95 ≤2 saniye, rapor p95 ≤3 saniye, beklenmeyen hata <%1’dir. Başarılı mali işlem kaybı/çoğalması/tutarsızlığı hedefi sıfırdır. Beklenen yetki/çakışma/hız sınırı yanıtları ayrı sayılır; meşru kullanıcının engellenmesi başarılı kapasite kabul edilmez.
- İlk pilot öncesinde PRD’nin 28 kabul senaryosu ve epic’ler arası bağlantılar doğrulanır. Test/restore sonuçları, günlük sağlık-yedek kontrolü, uyarıyı takip edecek kişi ve kurtarma/yayın adımları yazılır. Gerekirse kapasite değişikliği ölçümle değerlendirilir; sessiz paket/veritabanı değişimi yapılmaz.

### Yüksek seviye story’ler

| ID | Başlık |
|---|---|
| S6.1 | Hedefle uyumlu derleme, kontroller ve yayın çıktısı |
| S6.2 | Lightsail, HTTPS, kalıcı dizinler ve sürümlü kurulum |
| S6.3 | Çökme/donma denetimi, dış sağlık kontrolü ve ekip uyarısı |
| S6.4 | Tutarlı günlük DB kopyası, son yedi snapshot ve saklama kontrolleri |
| S6.5 | Restore, migration ve güvenli yayın geri dönüşü |
| S6.6 | Yük/veri bütünlüğü kabulü ve pilot işletim rehberi |

### İlgili belgeler ve notlar

[Architecture](ARCHITECTURE.md) §3.6, §8–9, §11; [Tech Stack](TECH-STACK.md) §5–10. Seçilen paket ve fiyat ayrıntılarının kaynağı teknoloji belgesidir; gerçek kaynak oluşturma öncesinde bütçe doğrulanır. Docker, S3, saatlik yedek, yeni ücretli gözlem servisi veya PostgreSQL geçişi bu epic’le eklenmez. Bu görev yalnız belge hazırlamadır; bulut kaynağı oluşturulmadı.

## Açık kararların etkileyeceği işler

K kodları yalnız bu belgedeki takip referanslarıdır; yeni ürün gereksinimi değildir. Mevcut öneriler [PRD](PRD.md) §10, [Architecture](ARCHITECTURE.md) §10 ve [Design](DESIGN.md) §2.11’dedir. Etkilenmeyen işlerin planı hazırlanabilir; ilgili akışın son kabulü kararına göre yazılır.

| Kod | Karar konusu | Etkilenen iş | Karara bağlanacağı nokta |
|---|---|---|---|
| K1 | Ortak şoförün hangi kayıt/teslim durumunu göreceği ve onaysız düzeltme sınırı | E1, S3.5, S4.6 | Geçmiş/yeniden açma/düzeltme story kabulü öncesi; ad seçimi bireysel kimlik doğrulaması yapılmaz |
| K2 | Sahibin aynı girişle diğer araçlarına erişimi ve araç bilgisi düzenleme sınırı | E1, E2, E5 | İlgili erişim story’si öncesi; mevcut tek plaka taslağı kapsamı kendiliğinden genişletmez |
| K3 | Gece geçişi, süre sınırı, hafta başlangıcı, gün ve dönem dağılımı | S3.1, S5.2–S5.4 | Zaman/rapor sınırlarının kabulü öncesi; 24 saat veya pazartesi başlangıcı sessiz varsayılmaz |
| K4 | Onaylı şoför sürüşü ↔ sahibin kendi sürüşü dönüşümü | S4.3, S5.2 | Tür dönüşümünün eski para onayına etkisi netleşmeden dönüşüm açılmaz; aynı türde düzeltme kesin kapsamdır |
| K5 | Hesaplanan kalan negatifken kayıt/teslim ekranının davranışı | E3, E4, E5 | Para alanlarının kenar durum kabulü öncesi; negatif sonuç sıfıra çevrilmez, borç motoru eklenmez |
| K6 | Diğer masrafın kalem/kategori düzeyi, tür filtresi ve bağımsız sahip giderleri | S3.2, S5.2–S5.4 | Gider story’leri öncesi; isteğe bağlı günlük gider kesindir, diğer ayrıntılar açık |
| K7 | Çevrimdışı kayıt kuyruğu ve senkronizasyon kapsamı | S3.4, S3.6, E6 | Ağ/tekrar gönderim story’lerinde; sunucuda kaydedilmemiş işlem başarı sayılmaz |
| K8 | Ortak sahiplik ve araç sahipliği devri | S2.1–S2.2, E4 | Sahip ilişkisi/devir akışı öncesi; geçmiş kayıtlar kendiliğinden yeni kişi/türe dönüşmez |
| K9 | Kesin yazılım sürümleri, şifre teslim yöntemi, alan adı/hesap erişimi, dış sağlık kontrolü ve uyarı kanalı | E1, E2, E6 | İlgili kurulum/erişim story’si ve canlı yayın öncesi; yeni müşteri SMS/e-posta özelliği eklenmez |

## Ortak tamamlanma kuralı

Her epic kendi kapsamındaki ekran, sunucu kuralı, veri saklama/ilişki kontrolü ve anlamlı testleri birlikte teslim eder. Yalnız ekranın görünmesi veya düğmenin çalışması yeterli değildir. Para hesapları, tekrar gönderim ve yetkisiz erişim otomatik sınanır; telefon okunabilirliği ve kullanıcı akışı gerçek tarayıcıda kontrol edilir. Açık bir karar nedeniyle uygulanmamış story, tamamlandı işaretlenmez.

Bu belgede 35 yüksek seviye story başlığı vardır. [STORIES.md](STORIES.md) içinde altı epic’in 35 hikâyesi kullanıcı amacı, fayda, akış, kabul kriterleri, göreli boyut ve bağımlılıklarla ayrıntılandırıldı. Bu metinler uygulama veya test sonucu değildir. [TASKS.md](TASKS.md) içinde her hikâyenin teknik iş paketi, [MILESTONES.md](MILESTONES.md) içinde geliştirme aşamaları hazırlandı; henüz sprint takvimi, GitHub Issue veya teslim tarihi oluşturulmadı.

## Onaylar ve sonraki adım

| Kişi / kapsam | Durum | Tarih |
|---|---|---|
| Doğukan — Epics hazırlama | “Ok devam edelim” talebiyle başlandı | 2026-09-15 |
| Codex — kapsam ve bağımlılık planı | Altı epic ve PRD kabul eşlemesi hazır | 2026-09-15 |
| Kesin PRD kararları | Korundu; tekrar onay gerektiren öneriye dönüştürülmedi | 2026-09-15 |
| Açık ürün tercihleri | K1–K8’de ilgili işlere bağlandı; otomatik onaylanmadı | — |
| Aşama ve yayın/işletim planı | Milestones, Tasks, QA, Release ve Ops belgeleri; uygulama/yayın kanıtı değil | 2026-09-15 |
| Süre / sprint takvimi / canlı yayın | Henüz verilmedi veya yapılmadı | — |

[Stories — kullanıcı hikâyeleri](STORIES.md) metni 35 hikâyeyle tamamlandı; açık ürün tercihleri ilgili işlerde görünür tutuldu. [Milestones](MILESTONES.md), [Tasks](TASKS.md), [QA planı](QA-PLAN.md), [Release](RELEASE.md) ve [Ops](OPS.md) geliştirme öncesi planlama belgeleridir. Sıradaki uygulama işi M1'dir; kod veya canlı yayın henüz yoktur.
