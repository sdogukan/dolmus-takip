# Dolmuş Takip — Mimari Plan

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.6  
**Durum:** İncelemeye hazır mimari taslak; §10’daki ürün önerileri henüz kesinleşmedi.  
**Girdiler:** [PRD](PRD.md) · [Tech Stack](TECH-STACK.md)  
**Ekran tasarımı:** [Design](DESIGN.md)  
**Şablon:** Project Blueprint / 03-architecture. SQL tabloları, anahtarlar ve indeksler kullanılır; DynamoDB PK/SK/GSI ve Lambda başlıkları bu sisteme uyarlanmıştır.

## Kısa anlatım

Telefondan açılan üç alan aynı uygulamada çalışır: şoför, mal sahibi ve ekibimizin yönetim ekranı. Caddy bağlantıyı karşılar; Next.js yetkiyi ve hesabı kontrol eder; Drizzle aracılığıyla SQLite’a yazar. Başarılı kayıt, veritabanına tamamen yazıldıktan sonra gösterilir.

Tek Lightsail makinesi vardır. systemd uygulama çökerse yeniden başlatmayı dener; ayrı kontrol görevi donmayı takip eder. Günlük Lightsail yedeği, geri yükleme için hazırlanmış tutarlı bir veritabanı kopyasını da içerir. Bu belge yapılacak sistemi tarif eder; kod, kurulum veya performans testi yapılmış değildir.

## 1. Sistem akışı

~~~mermaid
flowchart TD
    A["Telefon tarayıcısı"] --> B["Caddy: HTTPS"]
    subgraph L["Tek Lightsail makinesi"]
        B --> C["Next.js: şoför, sahip ve ekip ekranları"]
        C --> D["Oturum ve yetki kontrolü"]
        D --> E["İş kuralları ve hesaplama"]
        E --> F["Drizzle: veri erişimi"]
        F --> G[("SQLite: kayıtlar ve geçmiş")]
        H["systemd ve sağlık kontrolü"] -. "çalışmayı izler" .-> C
        G -. "günlük tutarlı kopya" .-> I["Doğrulanmış kurtarma kopyası"]
    end
    L -. "günde bir" .-> J["Lightsail snapshot: son 7 yedek"]
~~~

Ekran, sunucu modülleri ve ORM ayrı sunucular değildir. Bütün müşteri işlemleri aynı yetki ve hesaplama kurallarından geçer; ekibin destek ekranı bunları atlamaz.

### 1.1 İlk araç kaydı ve giriş

1. Ekibin kişisel platform hesabı ile işletme, sahibin kişi kaydı ve araç oluşturulur.
2. Plaka boşluklardan arındırılıp büyük harfe çevrilerek benzersiz tutulur. İki farklı parola, sahip ve ortak şoför rolleri için ayrı hash olarak saklanır.
3. Mal sahibi araçta çalışabilecek şoförleri ekler. Ekip de aynı işlemi destek amacıyla yapabilir.
4. Plaka ve parola doğrulanınca araç/rol oturumu açılır. Ekrandaki rol seçimi veya kişi ID’si yetki oluşturmaz.
5. Şoför, o aracın aktif listesinden adını seçer. Bu, işi kimin yaptığının beyanıdır; bireysel kimlik doğrulaması değildir.

Ekibin ilk yönetici hesabı kurulumda, sunucunun yerel yönetim komutuyla oluşturulur; herkese açık yönetici kayıt endpoint’i bulunmaz. Sonraki ekip hesapları yalnız yetkili platform yöneticisi tarafından açılır.

### 1.2 Günlük kaydetme

1. Tarih ve araç hazır gelir; kişi, başlangıç/bitiş, hasılat, mazot ve isteğe bağlı diğer masraf girilir.
2. Tarayıcı yalnız ön izleme hesaplar. Sunucu gerçek yetkiyi, kişi–araç ilişkisini, tarihleri ve tutarları tekrar doğrular.
3. Sunucu payı ve kalanı hesaplar. Kısa bir veritabanı işlemi içinde kayıt, ilk sürüm geçmişi ve tekrar gönderim sonucu birlikte yazılır.
4. İşlem tamamlanınca Kaydedildi gösterilir. Şoförden ikinci bir teslim düğmesine basması istenmez.
5. Şoför kaydı teslim doğrulaması bekler. Sahibin kendi sürüşü onay gerektirmez; payı sıfırdır.

### 1.3 Para teslimi ve onaylı kaydın düzeltilmesi

Sahip, beklenen tutarı ve gerçek aldığı tutarı aynı ekranda görür. Fark varsa yalnız alınan tutarı değiştirip “Parayı aldım, tutar doğru” der. Bu fark hasılat veya giderleri değiştirmez.

**Kullanıcının 15 Eylül kararı:** Onaylı kayıt düzenlenirken “Düzelt ve onayla” tek işlemdir. Sunucu yeni değerleri, yeni kayıt sürümünü ve bu sürüme ait yeni para onayını aynı transaction’da yazar. Eski sürüm ve eski onay değişmeden kalır. Rapor, işlem tamamlandıktan sonra yeni onaylı değerleri kullanır; arada yeni hesap/eski para onayı karışımı görünmez. Destek ekibi de aynı yolu, gerçek ekip kimliğiyle kullanır.

~~~mermaid
sequenceDiagram
    participant K as Sahip veya yetkili ekip
    participant U as Uygulama
    participant V as SQLite
    K->>U: Düzelt ve onayla: değerler, sürüm, işlem anahtarı
    U->>U: Yetkiyi doğrula ve hesabı yeniden yap
    U->>V: Tek transaction başlat
    U->>V: Sürümü kontrol et; kayıt, geçmiş ve onayı yaz
    V-->>U: Commit tamam
    U-->>K: Yeni onaylı kayıt
    Note over U,V: Herhangi bir adım hata verirse tüm işlem geri alınır
~~~

İlk oluşturma, sıradan düzeltme ve onay işlevleri ayrı kullanım durumlarıdır. Onaylı kaydı genel düzenleme endpoint’ine göndermek reddedilir; bu kayıt için yalnız birlikte düzeltme/onay işlemi kullanılır. Kişi veya çalışma tarihi değişirse yeni onay yeni sürümün kişi/tarih bilgisine bağlanır; güncel raporlarda eski dönemdeki değer çıkar, yeni döneme girer. Önceki dağılım geçmişten izlenebilir.

**Tür değişikliği için açık uç:** Şoför sürüşünü sahibin kendi sürüşüne veya tersine dönüştürme, eski para onayını etkiler. Varsayılan mimari önerisi bu dönüşümü normal düzeltmeden ayırıp ilk sürümde kapalı tutmaktır; §10’da ürün kararı olarak bekler. Mevcut sürüş türünde tutar, kişi, tarih ve saat düzeltmesi desteklenir.

### 1.4 Rapor

Yetkili işletme/araç ve dönem sunucuda belirlenir. Güncel çalışma kayıtları toplam saat, hasılat, gider, pay ve kalan için kaynak olur. Doğrulanmış teslim, her kaydın yalnız güncel sürümüne ait tek onaydan toplanır. Sahip sürüşü, bekleyen tutar ve eski onaylar teslim toplamına eklenmez.

Günlük detay sayfalıdır; toplamlar yalnız görünen sayfayı değil seçilen dönemin tamamını kapsar. Ekranlar kayıt sonrası yenilenir; ilk sürümde canlı bağlantı veya sürekli arka plan sorgulaması gerekmez.

## 2. Servis topolojisi ve kod sınırları

| Bileşen | Sorumluluk | Erişim |
|---|---|---|
| Caddy | TLS, HTTPS yönlendirmesi, istek boyutu sınırı, bakım yanıtı | Dışarıya 80/443; Next’e localhost |
| Next.js uygulaması | Sayfalar, API, oturum, yetki, hesap ve rapor | Yalnız 127.0.0.1:3000 |
| Kimlik/yetki modülü | Araç veya ekip oturumundan sunucu kapsamı üretme | Kimlik tabloları |
| Çalışma/teslim modülü | Oluşturma, düzenleme, onay, sürüm çakışması | Tek ortak veri erişim modülü |
| Yönetim modülü | İşletme, araç, kişiler, şifre sıfırlama ve destek | Kapsamlı audit zorunlu |
| Rapor modülü | Tarih filtreleri ve SQL toplamları | Yetkili kapsama sınırlı okuma |
| Drizzle/better-sqlite3 | Parametreli sorgu, transaction ve migration | Yerel SQLite dosyası |
| systemd görevleri | Servis yönetimi, sağlık, yedek hazırlama ve temizlik | Sınırlı yerel servis yetkileri |

İlk sürümde tek Node uygulama süreci kullanılacak. Arka ofis ayrı bir uygulama veya kopyalanmış iş kuralları değildir. Next sunucu bileşenleri gerektiğinde kullanım durumunu doğrudan çağırır; kendi HTTP API’sine gereksiz döngü yapmaz. Formlar aynı kullanım durumlarına bağlı Route Handler’ları çağırır. SQLite işlemleri Node çalışma ortamındadır.

Kodda ekranlar, kullanım durumları ve veri erişimi ayrılır. Genel amaçlı çok veritabanlı çatı, mikroservis, Redis ve harici kuyruk kurulmaz. Veritabanı değişirse esas değişiklik alanı veri erişimi/şema/migration olur; veri taşınması ayrıca yapılır.

### Yetki matrisi

| İşlem | Ortak şoför oturumu | Sahip oturumu | Platform ekibi |
|---|---|---|---|
| Şoför listesinden seçip çalışma oluşturma | Giriş yapılan araç | Yetkili araçta şoför adına | Seçili işletme/araç adına |
| Sahibin kendi sürüşünü oluşturma | Hayır | Evet | Sahip adına |
| Kayıt/teslim durumunu görme | §10’daki geçmiş kapsamı | Yetkili araç kapsamı | Destek hedefi kapsamında |
| Onaysız kaydı düzeltme | §10’da açık | Evet | Evet |
| Teslimi onaylama, onaylı kaydı düzeltme | Hayır | Evet | Sahip adına, ekip iziyle |
| Şoför ekleme/düzeltme/pasifleştirme | Hayır | Yetkili araç ataması ve bağlı kişi adı | Evet; global kişi durumu ayrıca yetkili |
| İşletme/araç açma, iki parolayı sıfırlama | Hayır | İlk sürümde ekip yapar | Evet |
| Ekip hesabı/yetkisi yönetme | Hayır | Hayır | Yalnız platform yöneticisi |

Sahip oturumunun varsayılan kapsamı giriş yapılan araçtır; diğer araçlara otomatik erişim açılmaz. Çok araçlı erişim önerisi §10’dadır. Platform desteğinde hedef işletme/araç hem ekranda hem sunucuda doğrulanır. SQLite satır bazlı erişim politikası sağlamaz; uygulama sorgu kapsamı ile veritabanı ilişkisel kısıtları birlikte uygulanır.

Sahibin “Şoförü pasife al” işlemi yalnız yetkili araçtaki vehicle_drivers atamasını kapatır; başka araçtaki atamaları veya people.active alanını kapatmaz. Kişiyi işletme genelinde pasifleştirme yalnız platform ekibinin tüm etkilenen araçları kapsayan işlemidir. İsim düzeltmesi ortak sabit kişi kaydını ve o kişinin geçmişte gösterilen adını günceller; yeni kişi oluşturmaz ve başka araç kayıtlarını okuma yetkisi vermez.

## 3. Veritabanı tasarımı

### 3.1 Ortak kurallar

- Kimlikler uygulamada üretilen UUID’lerdir. Her işletme tablosunda business_id zorunludur.
- Ebeveynlerde UNIQUE(business_id, id); çocuklarda aynı işletmeyi taşıyan birleşik foreign key kullanılır. Örneğin kayıt, hem araç hem kişi için (business_id, ilgili_id) ile bağlanır. Gerekli foreign key alanları NULL olamaz.
- Bunlar yanlış işletmeye ilişki kurulmasını engeller; SELECT yetkisini sağlamaz. Her okuma/yazma, sunucunun ürettiği işletme ve araç kapsamıyla filtrelenir.
- Para tam sayı kuruş, süre tam sayı dakika; kullanıcı çalışma tarihi YYYY-MM-DD olarak saklanır. İşlem zamanları UTC; ekran ve dönem hesabı Europe/Istanbul’dur. Çalışma tarihi ile sunucuya giriş zamanı ayrıdır.
- Kişi/araç pasife alınır; mali kayıtlar, onaylar ve geçmiş fiziksel olarak silinmez. Ad değişimi yeni kişi yaratmaz.
- PRD’deki en az beş yıllık kayıt saklama korunur. Bakım temizliği yalnız geçici oturum/log/kopya verisini hedefler.

[SQLite foreign key kuralları](https://www.sqlite.org/foreignkeys.html). İlişki ve indeksler migration ile oluşturulacak; bu belge çalışan şema değildir.

### 3.2 Tablolar

| Tablo | Anahtarlar ve başlıca alanlar | İşlev / kısıt |
|---|---|---|
| businesses | id, name, active, created_at | İşletme sınırı |
| people | business_id, id, full_name, active, version | Şoför ve sahibin sabit kişi kimliği; giriş hesabı değildir |
| vehicles | business_id, id, plate_normalized, owner_person_id, araç bilgileri, active, version | Plaka platform genelinde UNIQUE; sahip aynı işletmedeki kişidir |
| vehicle_drivers | business_id, vehicle_id, person_id, active, version | Üçlü UNIQUE; geçmiş ilişki silinmez; sahibin kendi sürüşü bu atama değildir |
| vehicle_credentials | business_id, id, vehicle_id, role, password_hash, credential_version | Araç/rol UNIQUE; role owner veya driver |
| platform_users | id, username, password_hash, platform_role, active, credential_version | Kişisel ekip kimliği; müşteri kişi kaydından ayrı |
| sessions | id, token_hash UNIQUE, credential_id veya platform_user_id, issued_version, created_at, last_seen_at, expires_at, revoked_at | İki aktör türünden tam biri; araç oturumunda işletme/araç rolü credential ilişkisinden alınır |
| work_entries | business_id, id, vehicle_id, person_id, work_kind, work_date, starts_at, ends_at, duration_minutes, gross_cents, fuel_cents, other_expense_cents, other_expense_note, share_bps, share_cents, remainder_cents, calculation_version, status, version | Güncel kaynak kayıt; status pending, confirmed veya not_required |
| work_entry_revisions | business_id, entry_id, version, action, snapshot_json, actor bilgileri, created_at | İşletme/kayıt/sürüm UNIQUE; her başarılı değişikliğin tam değer görüntüsü; UPDATE/DELETE yok |
| cash_confirmations | business_id, id, entry_id, entry_version, received_cents, confirmed_at, actor bilgileri | (business_id, entry_id, entry_version) UNIQUE ve ilgili revizyona FK; UPDATE/DELETE yok |
| mutation_receipts | scope_key, request_id, operation, request_hash, entity_id, result_version, response_code, created_at | (scope_key, request_id) UNIQUE; tekrar gönderimde aynı işlem sonucunu bulur |
| admin_audit | id, business_id/vehicle_id gerektiğinde, entity_type/id, action, before_json, after_json, actor bilgileri, occurred_at | Kişi/araç/kimlik ve ekip yönetiminin geçmişi; gizli değerler dışlanır |

Actor alanları: actor_kind, actor_session_id (gizli token olmayan iz kimliği), actor_role, araç credential kimliği veya gerçek platform_user_id, varsa on_behalf_of_kind/person_id. Çalışmayı yapan person_id ayrı alandır. Oturum temizliği geçmişteki aktör izini silmez; audit kaydı kısa ömürlü sessions satırına silinmeye bağlı değildir. Parola, hash, cookie ve oturum tokenı revizyon/audit içine kopyalanmaz.

Mali revizyon JSON’u tarih/saat, kişi, araç, çalışma türü, parasal girdiler ve hesap sonucunu içerir. Önceki sürümle karşılaştırılarak önce/sonra gösterilir; ilk sürüm oluşturmayı temsil eder. Güncel raporlar JSON taramaz. Onay ve geçmiş tablolarında aynı işletme/kayıt/sürüm bağı zorunludur; farklı kayıt sürümüne onay bağlanamaz.

Oturum ve makbuzlar teknik tablolardır: araç aktörünün kapsamı sunucuda çözülür; destek aktörünün işlem kapsamına hedef işletme ve araç da eklenir. Bekleyen yanlış bir request_id başka işletmenin sonucunu döndüremez.

~~~mermaid
erDiagram
    BUSINESSES ||--o{ PEOPLE : "kişiler"
    BUSINESSES ||--o{ VEHICLES : "araçlar"
    PEOPLE ||--o{ VEHICLES : "sahibi"
    VEHICLES ||--o{ VEHICLE_DRIVERS : "atamalar"
    PEOPLE ||--o{ VEHICLE_DRIVERS : "şoför"
    VEHICLES ||--o{ WORK_ENTRIES : "çalışmalar"
    PEOPLE ||--o{ WORK_ENTRIES : "fiilen çalışan"
    WORK_ENTRIES ||--|{ WORK_ENTRY_REVISIONS : "sürümler"
    WORK_ENTRY_REVISIONS ||--o| CASH_CONFIRMATIONS : "o sürümün onayı"
~~~

Diyagram iş verisinin ana ilişkilerini gösterir; kimlik ve audit tablolarının ayrıntıları üstteki tablodadır. Aynı gün aynı kişi/araç için birden fazla çalışma geçerlidir; bu üçlüye benzersizlik kısıtı konmaz.

### 3.3 Hesap ve durum değişiklikleri

Sunucu yalnız doğrulanmış work_kind üzerinden hesaplar. owner kaydında kişi aracın sahibidir ve pay sıfırdır. driver kaydında aktif kişi/araç ataması aranır; sahibin şoför adına kaydetmesi payı sıfırlamaz. Aracın sahibi driver seçeneğinde sunulmaz ve driver türündeki kayda kişi olarak atanamaz; kendi çalışması yetkili owner akışından girilir. Eski pasif kişinin mevcut kaydını düzeltmek mümkündür; yeni çalışma için aktiflik aranır.

Hesap kuralı v1: share_bps = 2000 veya 0. Kuruşa yuvarlama en yakın tam sayı, yarım yukarıdır: pay = floor((hasılat_kuruş × oran + 5000) / 10000). İşlem BigInt/tam sayı hesabıyla yapılır; tutarlar yerelleştirilmiş ondalık metinden kuruşa kayıpsız dönüştürülür. Girdi ve toplamların veri tipi sınırları kontrol edilir; kayan noktalı para çarpımı yapılmaz.

Girdiler negatif olamaz; hesaplanan kalan negatif çıkarsa sıfıra çekilmez. Böyle durumda kullanıcı açıkça uyarılır; alınan para negatif olamaz. Ayrı borç/ödeme motoru eklenmez. Negatif kalan için teslimi nasıl adlandıracağımız §10’da görünür bir ürün önerisidir.

| İşlem | Kaydedilen sonuç |
|---|---|
| Yeni şoför çalışması | pending, version 1; revizyon var, onay yok |
| Yeni sahip çalışması | not_required, version 1; pay 0, onay yok |
| Onaysız kaydı düzenleme | Sürüm artar; pending korunur; kim yetkili §10’a bağlı |
| İlk teslim onayı | Sürüm artar; confirmed revizyon ve o sürüme bağlı alınan tutar birlikte yazılır |
| Onaylı kaydı düzelt ve onayla | Sürüm artar; yeni confirmed revizyon + yeni onay; eski onaylar korunur |
| Sahip çalışmasını düzeltme | Sürüm artar; not_required ve pay 0 korunur |

Onaylı kaydın genel PATCH işlemi, driver üzerinden onay ve sahibi olmayan kişinin owner sürüşü reddedilir. Onayda yalnız alınan tutarı değiştirmek payı veya hasılatı değiştirmez. İlk onay ve düzelt/onay isteğinde received_cents açıkça bulunmalıdır; sunucu eksik değeri kendiliğinden beklenen tutarla onaylamaz.

### 3.4 Transaction, tekrar gönderim ve eşzamanlı düzenleme

1. Oturum, CSRF ve veri biçimi denetlenir; sunucu kapsamı çıkarılır.
2. Her mutasyon istemciden rastgele request_id alır. Aynı form yeniden gönderilirken bu anahtar korunur. Sonucu bilinen bir işlemden sonra içerik değiştirilirse yeni anahtar üretilir. Oluşturmanın sonucu belirsizse gönderilen içerik/anahtar dondurulur; önce aynı istek tekrar gönderilerek sonuç çözümlenir. Başarılıysa bulunan kayıt ID/sürümü üzerinden düzenlemeye geçilir. Bu çözülmeden değiştirilmiş formdan yeni oluşturma gönderilmez.
3. Kısa yazma transaction’ı içinde güncel yetki/aktiflik ve tekrar gönderim kaydı kontrol edilir. Aynı kapsam/anahtar/işlem/içerik eski sonuç kimliğini döndürür; içerik farklıysa 409 verir.
4. Düzenleme, istemcinin gördüğü version ile koşullu UPDATE yapar. Eşleşme yoksa 409: “Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.” Sessiz son yazan kazanır davranışı yoktur.
5. Güncel kayıt, revizyon, gerekiyorsa onay, destek izi ve makbuz birlikte yazılır. Commit sonrası başarı dönülür; commit olmuş ama yanıt kaybolmuşsa aynı anahtar ikinci kayıt oluşturmaz.

Yetki kontrolü idempotency sonucunda da yapılır; oturumu iptal edilmiş kişi eski makbuz üzerinden veri okuyamaz. Scope, oturum tokenına değil kalıcı credential/ekip kimliğine ve işlem hedefi kapsamına bağlanır; tekrar giriş sonrası aynı request_id korunabilir. Mali makbuzların minimum sonucu kayıt saklama süresince korunur; tüm HTTP gövdesi veya gizli veri saklanmaz. İlk sürümde client request_id sessionStorage’da yalnız kayıt taslağı yaşarken tutulabilir; bu çevrimdışı başarılı kayıt anlamına gelmez.

Yazma transaction’ı için BEGIN IMMEDIATE davranışı seçilir; Drizzle/better-sqlite3 API karşılığı kilitlenen sürümde doğrulanır. Transaction içinde ağ, parola hash’i veya uzun rapor yoktur. [SQLite transaction](https://www.sqlite.org/lang_transaction.html), [Drizzle transaction](https://orm.drizzle.team/docs/transactions).

### 3.5 İndeksler ve rapor sorguları

| İndeks / kısıt | Amaç |
|---|---|
| vehicles(plate_normalized) UNIQUE | Plakayla giriş |
| work_entries(business_id, vehicle_id, work_date, id) | Araç dönemi ve sayfalama |
| work_entries(business_id, person_id, work_date, id) | Sabit kişi raporu |
| work_entries(business_id, vehicle_id, status, work_date, id) | Bekleyen teslim listesi |
| revisions(business_id, entry_id, version) UNIQUE | Sürüm bulma ve onayın doğru sürüme bağı |
| confirmations(business_id, entry_id, entry_version) UNIQUE | Güncel onayı tek satırla eşleme |
| vehicle_drivers(business_id, vehicle_id, person_id) UNIQUE | Atama ve seçim |
| sessions(token_hash) UNIQUE; sessions(expires_at) | Oturum doğrulama ve toplu temizlik |
| mutation_receipts(scope_key, request_id) UNIQUE | Çift işlem önleme |
| admin_audit(business_id, occurred_at, id) | Destek işlem geçmişi |

İşletme/araç/tarih koşullu SUM ve GROUP BY sorguları kullanılır. Doğrulanmış teslim için current entry version = confirmation entry_version bağı şarttır; tüm onay geçmişi join edilip toplanmaz. Toplamlar ve liste tek kısa okuma snapshot’ında hazırlanır; iki eşzamanlı düzenleme farklı toplam/detay görünümü üretmez.

Detay sayfası başlangıçta 50, en fazla 100 kayıt; (work_date,id) cursor ile ilerler. İlk sürümde tek rapor isteği en fazla bir takvim yılıdır; eski yıllar ayrı seçilebilir. Bunlar sorgu bütçesi başlangıç değerleridir, ürün geçmişini silmez. Beş yıllık veriyle EXPLAIN QUERY PLAN ve süre ölçülür; gerekli olmayan indeks eklenmez.

Hafta/ay/yıl [başlangıç, sonraki dönemin başlangıcı) sınırlarıyla hesaplanır. Kişinin çalışma günü COUNT(DISTINCT work_date), süre SUM(duration_minutes) olur. Hafta başlangıcı ve gece geçişinin gün dağılımı için §10 önerileri onaylanmadan kesin kabul testi yazılmaz.

### 3.6 SQLite işletim ayarları

Her bağlantıda foreign_keys=ON, synchronous=FULL; dosyada WAL doğrulanır. Başlangıç busy_timeout değeri 2000 ms; kullanıcı isteğinin toplam zaman bütçesine uyar. Kilitte sınırsız döngü yoktur: transaction geri alınır, 503 ve aynı anahtarla tekrar deneme bilgisi döner. Senkron sürücünün beklemesi Node yanıtlarını etkileyebileceğinden yük testine dahildir.

Otomatik checkpoint başlangıçta korunur; WAL büyümesi izlenir. FULL, commit dayanıklılığı için seçildi; donanım/makine kaybı yedeğin yerini tutmaz. Canlı DB’den WAL dosyası koparılmaz veya elle silinmez.

**Sürüm kapısı:** Kullanılan better-sqlite3 içindeki gerçek SQLite sürümü SELECT sqlite_version() ile kayıt altına alınır. Resmî WAL-reset düzeltmesini içeren 3.51.3 veya daha yeni desteklenen sürüm seçilir; bakım aracı da aynı güvenli sürüm ailesini kullanır. Yalnız npm paket sürümüne bakmak yeterli değildir. [SQLite WAL ve düzeltme notu](https://www.sqlite.org/wal.html).

## 4. API endpoint listesi

Tek origin ve /api/v1 yolu kullanılır. Araç rolü scope’u oturumdan çıkarır; URL’deki ID tek başına erişim hakkı vermez. Staff kapsamı sunucunun doğruladığı açık business/vehicle hedefidir. Liste endpoint’leri sayfalıdır; form girdileri sunucuda doğrulanır.

| Method | Path | İşlem | Yetki |
|---|---|---|---|
| POST | /auth/vehicle-login | Plaka + parola oturumu | Giriş hız sınırı |
| POST | /auth/platform-login | Kişisel ekip girişi | Giriş hız sınırı |
| POST | /auth/logout | Mevcut oturumu iptal | Oturum |
| GET | /session | Rol, izinli kapsam ve CSRF bilgisi | Oturum |
| GET | /drivers | Şoförün aktif seçimi veya sahip/ekibin kişi-atama yönetim listesi | Driver/owner/staff; rol ve araç scope’u uygulanır |
| POST / PATCH | /drivers; /drivers/:id | Şoför ekleme/adını düzeltme | Owner veya staff; global aktiflik yalnız staff |
| PUT | /vehicles/:id/drivers/:personId | Atamayı etkin/pasif yapma | Owner veya staff |
| POST | /work-entries | Çalışma oluşturma | Driver/owner/staff; çalışma türü doğrulanır |
| GET | /work-entries; /work-entries/:id | Kayıt ve teslim durumları | Kapsam + §10 driver geçmiş kuralı |
| PATCH | /work-entries/:id | Onaysız veya sahip çalışmasını düzeltme | Owner/staff; driver sınırı §10 |
| POST | /work-entries/:id/confirm | Gerçek alınan tutarı ilk kez onaylama | Owner/staff |
| POST | /work-entries/:id/correct-and-confirm | Onaylı kaydı atomik düzeltme/onay | Owner/staff |
| GET | /work-entries/:id/history | Sürüm ve onay geçmişi | Owner/staff |
| GET | /reports/summary; /reports/people; /reports/vehicles | Dönem toplamları ve kişi/araç kırılımı | Owner/staff |
| GET / POST / PATCH | /admin/businesses; /admin/businesses/:id | İşletme yönetimi | Staff |
| GET / POST / PATCH | /admin/vehicles; /admin/vehicles/:id | Araç açma ve düzenleme/pasifleştirme | Staff |
| POST | /admin/vehicles/:id/reset-password | Belirtilen rolün parolasını sıfırlama | Staff |
| GET / POST / PATCH | /admin/users; /admin/users/:id | Ekip hesabı açma ve erişim yönetimi | Platform admin |
| POST | /admin/users/:id/reset-password | Ekip parolasını sıfırlama, oturum iptali | Platform admin |
| GET | /admin/audit | Yönetim ve destek izi | Staff; sorgu kapsamı/log gizliliği |
| GET | /health/live; /health/ready | İç sağlık kontrolü | Yalnız localhost; Caddy dışarı açmaz |

Yollar /api/v1 öneki altında tanımlanır. Staff çalışma/rapor uçlarında aynı işlevleri kullanır; ayrı, daha gevşek destek API’si yoktur. Onun adına davranışı istemcinin rol taklidiyle değil oturumun ekip kimliği ve doğrulanmış hedefle üretilir.

GET /drivers, driver oturumuna yalnız giriş yapılan araçtaki aktif ve seçilebilir kişileri verir. Owner için yetkili araç atamalarının yönetim listesi, staff için sunucuda doğrulanmış işletme/araç hedefinin yönetim listesi kullanılabilir; bu iki yetki pasif atamaları da isteğe bağlı listeleyebilir. Filtreyi değiştirmek driver oturumuna pasif kişi veya başka araç/işletme erişimi kazandırmaz. Bu ayrım [Stories S2.4](STORIES.md) ile Design’daki Şoförlerim yönetimini karşılar.

Oluşturma 201, güncelleme/onay 200; geçersiz veri 422, giriş yok 401, işlem yetkisi yok 403, erişim kapsamı dışındaki nesne 404, sürüm/anahtar çatışması 409, hız sınırı 429, geçici DB kilidi/hazır olmama 503. Hata yanıtı alan hataları ve request_id içerir; SQL, hash veya yığın izi müşteriye dönmez.

Toplu gösterilen yönetim yollarında POST koleksiyona, PATCH ID’li kayda, GET liste veya tek kayda uygulanır. API’de parasal kuruş değerleri ondalık tam sayı metni olarak taşınır; toplamlar JavaScript Number sınırında sessiz yuvarlanmaz. Tarih/saatler açık ISO alanlarıdır; Türkçe gösterim yalnız ekrandadır.

## 5. Cache stratejisi

Mali kayıtlar, raporlar, kişi listeleri ve yetki verisi için ilk sürümde paylaşılan kalıcı cache yoktur. Yetki her istekte denetlenir; aynı istek içinde tekrar hesaplama azaltılabilir. Müşteriye özel API ve sayfa yanıtları private/no-store olur; Caddy bunları ortak cache’e almaz.

Next’in sürüm hash’li CSS/JS dosyaları uzun süre cache edilebilir; veritabanı rapor sonucu bunlarla aynı politikayı kullanmaz. Mutasyon sonrası ilgili ekran tekrar sorgulanır; eski sürüm veya geri tuşuyla dönen ekran, sunucunun sürüm kontrolünü atlayamaz. Çevrimdışı kayıt senkronizasyonu §10’da açık öneridir.

## 6. Güvenlik ve kimlik uygulaması

Bu tablo yapılacak kontrol listesidir; tamamlanmış güvenlik testi değildir. [Next oturum rehberi](https://nextjs.org/docs/app/guides/authentication).

| Kontrol | Mimari kararı |
|---|---|
| Parola saklama | node-argon2 ile Argon2id; başlangıç 19 MiB, t=2, p=1 ve rastgele salt. Native paket CI hedefiyle uyumlu; yük testinde asgari güvenlik azaltılmadan ayarlanır. |
| Giriş saldırıları | Başarısız denemeler credential/plaka ve IP bazında süreli sayaç; kalıcı hesap kilidi yok. Başlangıç 20 başarısız plaka/15 dk ve 120 başarısız IP/15 dk; 429/geçici bekleme. Başarılı ortak NAT kullanıcılarının testi ayrıca yapılır. |
| Hash yükü | Eşzamanlı hash işine ve bekleyen kuyruğa üst sınır; başlangıç 4 çalışan/100 bekleyen, en fazla 10 saniye. Aşım 429; sınırsız bellek kuyruğu yok. Değerler kapasite testinde doğrulanır. |
| Kullanıcı/plaka tahmini | Bilinmeyen plaka ve yanlış parola aynı genel mesajı verir. İki rol doğrulaması erken rol ifşası yapmaz; bilinmeyen kimlikte kontrollü dummy hash yolu kullanılır. |
| Oturum | Node kriptografik rastgele üretimle 32 bayt token; DB’de SHA-256 özeti, istemcide HttpOnly/Secure/SameSite=Lax, Path=/, Domain’siz cookie. Token URL/localStorage’a yazılmaz. |
| Oturum süresi | Başlangıç araç oturumu en fazla 30 gün, 7 gün hareketsizlik; ekip en fazla 12 saat, 30 dk hareketsizlik. Her istekte bitiş/iptal/sürüm denetlenir. last_seen yazımı aralıklı yapılır; her rapor okuması DB yazmasına dönüşmez. |
| Yenileme ve iptal | Her giriş yeni token üretir. Logout, parola sıfırlama, araç/işletme veya ekip hesabı pasifliği erişimi keser. Credential sürümü iptal edilmiş eski session’ın kullanılmasını engeller. |
| CSRF | Yazma istekleri için aynı origin + oturuma bağlı CSRF token kontrolü; JSON içerik türü, yöntem ve gövde sınırı. SameSite tek başına kontrol değildir. |
| XSS / veri doğrulama | Ad/notlar düz metin; React kaçışı, CSP ve güvenli header’lar. Dinamik HTML basılmaz; sunucu alanları ve tutarları allowlist ile kabul eder. |
| Nesne yetkisi | Her sorguda işletme/araç scope; client rol/person/owner alanları yetki kazandırmaz. Sahip ve driver parolalarının eşit olmasına izin verilmez. |
| Yönetim ve gizli veri | Staff işlemi gerçek kimlikle audit edilir. Parola/token/hash loglanmaz. Secret dosyası web kökü dışında, uygulama kullanıcısına sınırlı izinle tutulur. |
| Ağ ve yayın | Dışarıya HTTPS; Next portu ve DB internete açılmaz. SSH anahtarı, host doğrulama ve dağıtıma sınırlı kullanıcı; GitHub secret’ları istemci bundle’ına girmez. |
| JWT / e-posta tokenları | JWT oturumu ve halka açık e-posta sıfırlama seçilmedi; bu token türleri yoktur. Parola sıfırlama back office üzerinden yapılır. |

SHA-256 yalnız yüksek rastgeleliğe sahip session token özeti içindir; parola için kullanılmaz. [OWASP parola önerileri](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [node-argon2](https://github.com/ranisalt/node-argon2). Oturum tokenı ve cookie ilkeleri için [OWASP oturum rehberi](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## 7. Mimari karar kayıtları

- [ADR-001 — Tek makine ve doğrudan kurulum](architecture-decision-records/001-tek-makine.md)
- [ADR-002 — Güncel kayıt, sürüm ve atomik para onayı](architecture-decision-records/002-kayit-butunlugu.md)
- [ADR-003 — Araç oturumu ve fiilen çalışan ayrımı](architecture-decision-records/003-kimlik-ve-yetki.md)

## 8. Çalıştırma, yedekleme ve yayın

### 8.1 Süreç ve dosyalar

| Konum / servis | Amaç |
|---|---|
| /opt/dolmus-takip/releases/<release-id> | CI’da üretilmiş sürüm çıktısı; root olmayan servis hesabı |
| /opt/dolmus-takip/current | Aktif sürüme işaret; kod geri dönüşü bu bağı değiştirir |
| /var/lib/dolmus-takip/data/app.sqlite | Kalıcı DB; kod yayını veya dizin temizliği silmez |
| /var/lib/dolmus-takip/backup-ready/ | Son iki doğrulanmış tarihli DB kopyası ve manifest |
| /var/lib/dolmus-takip/pre-migration/ | Bir önceki güvenli yayın öncesi DB kopyası; rutin günlük yedek değildir |
| /etc/dolmus-takip/ | Servis ayarları ve erişimi sınırlı secret’lar |
| systemd/journald | Servis ve sınırlı boyutta log; DB audit geçmişinden ayrı |

Bu yollar önerilen kurulum sözleşmesidir; mevcut makinede oluşturulmadı. Uygulama DB dosyası bulunamazsa sessizce boş DB oluşturarak başlamaz. İlk şema kurulumuna yalnız açık migration/kurulum komutu izin verir.

### 8.2 Çökme, donma ve makine arızası

- **Çökme:** Uygulama systemd servisi açılışta etkin, Restart=on-failure, RestartSec=10s. Başlangıçta StartLimitIntervalSec=900, StartLimitBurst=3; sınıra ulaşınca ekip müdahalesi gerekir. Caddy kendi systemd servisiyle yönetilir; çökme yeniden başlatma davranışı aynı sınır yaklaşımıyla açıkça yapılandırılır.
- **Donma:** Ayrı systemd timer her 30 saniyede localhost /api/v1/health/live çağırır; 3 saniye timeout, üç ardışık başarısızlık ve başlangıçta 90 saniye tolerans. Sağlık kontrolü ayrı süreçte olduğu için Node event-loop donmasını gözleyebilir.
- **Sınırlı kurtarma:** Kontrol görevi bakım sırasında yeniden başlatmaz, paralel koşmaz; 15 dakikada en fazla iki düzeltici restart dener. systemd start sınırını otomatik resetlemez. Herhangi bir kurtarma sınırı aşılınca kalıcı yerel kurtarma kilidi yazılır; süre dolması kilidi açmaz. Ekip nedeni inceleyip kilidi kaldırana kadar görev yalnız kontrol/uyarı yapar. Kilit uygulama açılışını da koşullandırır; sistem yeniden başlatılınca otomasyon kendiliğinden devam etmez.
- **DB sorunu:** /api/v1/health/live veritabanına dokunmadan canlılığı; /api/v1/health/ready küçük bir uygulama tablo okumasıyla DB ve şema hazırlığını denetler. Hazırlık hatasında DB bozulması/disk dolması/şema sorunu araştırılır; yalnız bu hatayla tekrar tekrar restart yapılmaz. Tam integrity_check her sağlık çağrısında çalıştırılmaz.
- **Makine sorunu:** Makine tamamen durmuşsa yerel timer da durur. Dış erişim kontrolü ve ekip uyarısı gerekir; otomatik eski yedeğe dönüş veya sınırsız makine reboot’u seçilmedi. Uyarı kanalı ve dış kontrolün nereden çalışacağı canlıya çıkış şartıdır (§11).

systemd WatchdogSec tek başına uygulama yanıtını izlemez; uygulamanın bildirim desteği gerekir. Burada bağımsız timer yaklaşımı seçildi. [systemd servis belgesi](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml).

### 8.3 Günlük yedek ve geri yükleme

Seçilen plan değişmez: günde bir Lightsail otomatik snapshot, son yedi snapshot. S3 veya saatlik kopya servisi yoktur. Canlı makinenin rastgele dosya kopyasını tutarlı DB saymamak için snapshot içine önceden hazırlanmış kurtarma kopyası konur.

1. Önerilen takvim: Europe/Istanbul 02:30’da SQLite Backup API ile tarihli geçici kopya hazırlanır; otomatik snapshot için 03:00 hedeflenir. AWS saat alanının UTC/Türkiye dönüşümü kurulumda doğrulanır; snapshot’ın tam o dakikada başladığı varsayılmaz. Yedek hazırlama, migration, restore ve yayın aynı işletim kilidini paylaşır; hazırlık sürerken kod/şema değiştirilmez.
2. Kopya tamamlanınca kendi bağlantısında integrity_check, foreign_key_check, son kayıt/revizyon ve mali toplam kontrolleri yapılır. Canlı veri bu sırada değişebileceği için toplamlar kopyanın kendi tutarlı görüntüsü üzerinden doğrulanır.
3. Kopya ve manifest diske senkronlanır; atomik olarak hazır adına taşınır, dizin de senkronlanır. Manifest kopya hash’i, şema/uygulama sürümü, kopyadaki son commit/işlem ve doğrulama zamanını içerir. Hazır dosya snapshot penceresi boyunca değiştirilmez. Önerilen yayınlama son saati 02:55’tir; yetişmeyen kopya o günün snapshot’ına dahil varsayılmaz. Geç hazırlık hata olarak işaretlenir, önceki hazır kopya korunur.
4. Yerelde son iki sağlam kopya tutulur; yeni kopya başarısızsa önceki silinmez. Her kopyayla uyumlu release çıktısı ve sürüm manifesti, o kopya diskte tutulduğu sürece korunur; snapshot bu kodu da içerir. Yerel kopya tek başına makine kaybına karşı yedek değildir; dışarıdaki snapshot korur.
5. Snapshot durumu/tarihi her gün kontrol edilir. “DB kopyası hazır”, “AWS snapshot başarılı” ve “bu snapshot’tan restore sınandı” farklı kayıtlardır. Hazırlığın snapshot penceresinden önce tamamlanması, kopyanın korunması ve snapshot zamanları ilişkilendirilir. Bağı doğrulanamayan veya geç hazırlanan kopya yeni başarılı DB yedeği sayılmaz; operasyona uyarı verilir.
6. Kurtarmada snapshot ayrı makineye açılır; içindeki doğrulanmış kopya, uyumlu uygulama/şemayla kullanılır. Giriş, kayıt, revizyon ve toplamlar kontrol edilmeden trafik yönlendirilmez. Eski canlı DB/WAL gerektiğinde inceleme için korunur; otomatik karıştırma yapılmaz. Restore edilen oturumlar trafiğe açılmadan iptal edilir; eski oturumlar yedekten yeniden geçerli hâle gelmez. Kopyadan sonraki parola sıfırlama/pasiflik kararları güncel işletim bilgisiyle kontrol edilir; güncelliği doğrulanamayan giriş ilgili erişim yeniden doğrulanıp gerekirse sıfırlanana kadar kapalı tutulur. Aktör/geçmiş kayıtları silinmez.

Kurtarılabilir son zaman, yalnız snapshot saatinden değil içindeki doğrulanmış DB kopyasından ölçülür. Günlük aralık ve hazırlama penceresi kadar yeni kayıt kaybı olabilir; görev başarısızsa aralık uzar. Sıfır veri kaybı ve belirli kurtarma süresi vaat edilmiyor; restore testinde süre ölçülecek.

İlk yayından önce ve sonra önerilen aylık denemede geri yükleme yapılır. Deneme makinesinin geçici maliyeti işletim bütçesine dahildir; bu belgede oluşturulmadı. Otomatik snapshot kaynak makineyle birlikte silinebileceğinden, makine silmeden önce korunacak yedek manuel snapshot yapılır.

[SQLite Backup API](https://www.sqlite.org/backup.html), [SQLite bütünlük kontrolleri](https://www.sqlite.org/pragma.html), [Lightsail snapshot açıklamaları](https://aws.amazon.com/lightsail/faq/), [otomatik snapshot durum sorgusu](https://docs.aws.amazon.com/cli/latest/reference/lightsail/get-auto-snapshots.html).

### 8.4 Yayın ve geri dönüş

1. GitHub Actions, hedef Ubuntu/Linux CPU mimarisi ve Node sürümüyle uyumlu üretim çıktısını hazırlar. better-sqlite3 ve Argon2 native modülleri hedefte sınanır; Mac node_modules kopyalanmaz. Tam paket sürümleri lockfile’da sabitlenir.
2. Test geçen çıktı SSH ile yeni release dizinine alınır; kimliği/hash’i doğrulanır. Üretim yayını manuel tetiklenir; yedek/migration/restore ile paylaşılan tek işletim kilidi alınır. Actions kotası ve artifact saklama bütçesi sınırlanır.
3. Bakım açılır; yeni mutasyonlar alınmaz, devam eden kısa işlemler tamamlanır, uygulama durur. Sağlık otomasyonu bakım modunda restart yapmaz.
4. Migration öncesi doğrulanmış kopya alınır; başarısızsa yayın durur. Şema migration’ı bir kez çalıştırılır, current yeni sürüme geçirilir, servis açılır.
5. Readiness ve mali smoke kontrolleri geçerse trafik açılır, bakım kalkar. Yayın başarısızsa trafik açılmadan önce geri dönüş yapılır.
6. Eski kod şemayla uyumluysa kod geri alınabilir. Uyumsuzsa yalnız yeni müşteri yazması alınmamışken eski kod + yayın öncesi DB birlikte geri alınır. Yeni kayıtlar kabul edildikten sonra eski DB’ye otomatik dönüş yapılmaz; veri kaybını önleyen ileri düzeltme/planlı kurtarma gerekir.

Kod çıktıları ile kalıcı DB/yedek dizinleri ayrı temizlenir. Bir önceki çalışan kod ve migration öncesi kopya, yeni yayının doğrulanması tamamlanmadan silinmez. Hazır yedek veya migration öncesi kopyanın referans verdiği release ayrıca korunur; “son iki kod sürümü” temizliği bu bağı koparamaz.

## 9. Kabul ve kapasite doğrulaması

Henüz test çalıştırılmadı. Aşağıdakiler uygulama ve ilk yayın kapılarıdır:

| Senaryo | Beklenen sonuç |
|---|---|
| Başka işletmenin araç/kişi ID’sini gönderme | API reddi; hatalı birleşik FK doğrudan DB testinde de reddedilir |
| Sahip, şoför ve ekip hesabı | Şoför çalışması %20; sahibin çalışması %0; destek gerçek aktörü korunur |
| PRD hesap örnekleri | 14.400 TL hesaplanan kalan ve eksik teslim örneğinde 6.000 TL doğrulanmış tutar ayrı |
| Aynı request_id ile 100 tekrar; commit sonrası yanıt kaybı | Tek mali kayıt ve tek işlem sonucu; içerik değişirse 409 |
| Aynı sürüme iki düzenleme/onay | Biri başarılı, diğeri 409; yarım kayıt ve kayıp güncelleme yok |
| Düzelt ve onayla sırasında hata/çökme | Eski tam sürüm veya yeni tam sürüm; hesap ile onay farklı sürümlerde görünmez |
| Onaylı kaydın kişi/tarihini değiştirme | Tek yeni onay güncel rapora girer; eski dönemden çıkar; geçmiş sürüm korunur |
| Aynı gün iki çalışma; ad değişimi; pasif kişi | Kayıtlar ezilmez, kişi toplamı bölünmez, geçmiş kaybolmaz |
| Crash ve donma | Tanımlı sınırlı restart çalışır; DB/makine arızası sonsuz döngü üretmez |
| Snapshot’tan yeni makineye restore | Kopya hash’i, ilişkiler, son commit, rapor ve giriş doğrulanır |
| Başarısız migration ve geri dönüş | Trafik açılmadan eski güvenli durum; müşteri yazması sonrası eski DB otomatik yüklenmez |
| Logout, parola sıfırlama ve pasifleştirme | Eski oturum/API erişimi kesilir; gizli bilgi loga çıkmaz |

Yük üreticisi Lightsail dışında çalışır. Üretim derlemesi, hedef makine ve beş yıllık temsili geçmiş kullanılır; araç/gün/çalışma sayısı raporda belirtilir. 100 kısa aralıklı giriş, 100 aktif kullanıcının gerçekçi beklemeli karışık akışı ve 100 yazma isteği tepesi ayrı ölçülür. Önerilen süre: 5 dakika ısınma, kademeli yükselme, en az 30 dakika sabit yük; CPU burst ve uzun süreli davranış ayrıca izlenir.

Başlangıç performans hedefleri: normal karışık yükte kayıt p95 ≤2 saniye, rapor p95 ≤3 saniye, beklenmeyen hata oranı <%1. Mali kayıp/çift işlem/tutarsızlık hedefi sıfırdır. Hız sınırı ve 409 gibi beklenen yanıtlar ayrı raporlanır; meşru kullanıcının engellenmesi başarılı kapasite sayılmaz. Tepe giriş/yazma testinin kuyruk ve toparlanma süresi ayrıca raporlanır. Bunlar ölçülmüş sonuç değildir.

RAM, event-loop gecikmesi, SQLite beklemesi, disk/WAL büyümesi ve CPU burst izlenir. Başlangıç disk uyarısı %80, kritik %90; loglara örneğin toplam 200 MB sınır konur. RAM baskısında 4 GB Lightsail; kısa sorgulara rağmen yazma darboğazında PostgreSQL değerlendirilir. CPU sorunu yalnız RAM artışıyla çözülmüş sayılmaz.

## 10. Ürün kararları ve açık varsayımlar

**Karar durumu (2026-09-17):** K1–K8 için buradaki öneriler ürün sahibi tarafından aynen kabul edildi; K9 sürümleri kanıtla sabitlendi. Nihai kararlar ve gerekçeler [DECISIONS.md](DECISIONS.md) dosyasındadır; bu bölümdeki 'açık/onay bekliyor' ifadeleri tarihsel bağlamdır.

“Mimari taslak” bu satırları kullanıcı onayı olmadan ürün gereksinimine dönüştürmez. Güvenlikte varsayılan izin verilmemesidir; açık kapsam için geniş erişim uygulanmaz.

| Konu | Önerilen başlangıç | Durum / etkisi |
|---|---|---|
| Onaylı kaydı düzeltme | Aynı ekranda Düzelt ve onayla; yeni değerler tek işlemle rapora | **Kullanıcı onayladı, PRD’ye işlendi** |
| Ortak şoförün geçmişi ve düzeltmesi | Aynı araçta seçilen kişinin kayıtlarını listeleme; kişi seçiminin kimlik kanıtı olmadığı açık. Onaysız düzeltme yalnız çalışma gününde. | Ürün önerisi; erişim kapsamı ve sonradan başka kişi seçme etkisi netleşmeli |
| Sahibin çok araçlı erişimi | İlk sürüm yalnız giriş yapılan araç; çok araçlı dashboard sonraki karar | Ürün önerisi; işletme kapsamını genişletmez |
| Gece ve dönem | Bitiş günü açık; 0 < süre ≤24 saat; başlangıç gününe bağlama; hafta pazartesi | Ürün önerisi; eşit saatler açık tarih farkıyla yorumlanır |
| Onaylı sürüş türü dönüşümü | Driver↔owner dönüşümünü ilk sürümde normal düzeltmede kapalı tutma | Yeni açık kenar durum; geçmiş teslimin akıbeti netleşmeli |
| Negatif kalan | Olduğu gibi gösterme; alınan tutarı ayrı ve ≥0 doğrulama; borç motoru açmama | Ürün metni/akışı incelenecek |
| Diğer masraf ve bağımsız gider | İlk sürüm tek diğer masraf tutarı/notu; kalem/kategori ve sigorta/vergi için ayrı karar | PRD’deki açık kapsam korunur |
| Çevrimdışı | İlk sürüm sunucu bağlantısıyla kayıt; form kaybolmasın, başarılı sunucu kaydı gibi gösterilmesin | Çevrimdışı senkronizasyon önerisi açık; eklenirse ayrıca tasarlanacak |
| Ortak sahipler ve araç sahipliği değişimi | Araçta tek owner_person_id; geçmiş kayıtların kişisi/türü kendiliğinden değişmez | Ortaklık/devir akışı onaylanmadı |

Bu tercihler [ekran tasarımında](DESIGN.md) öneri olarak gösterilir; ilgili akış uygulanmadan önce karara bağlanacak. Fiyat/abonelik ve diğer gelecek özellikler PRD’deki kapsam sınırlarını korur.

## 11. İnceleme ve onaylar

| Kapsam | Durum |
|---|---|
| Bu mimariyi hazırlama | Doğukan’ın “Tamamdır devam edelim” talebi, 2026-09-15 |
| Onaylı düzeltme ve para onayını birleştirme | Doğukan onayı, 2026-09-15 |
| Teknik mimari | Taslak hazır; uygulama/test sonucu değildir |
| §10’daki diğer ürün önerileri | Onay bekliyor; PRD’de kesin karar gibi işlenmedi |
| Canlıya çıkış ön koşulları | Kesin sürümler, migration/restore ve yük testleri, dış sağlık kontrolü/ekip uyarı kanalı, açık erişim kuralları |

Belge uygulama öncesi referanstır. [Ekran tasarımı](DESIGN.md), [Epics planı](EPICS.md) ve [35 kullanıcı hikâyesi](STORIES.md) hazırlandı; mimari sorumluluklar, kabul kontrolleri ve açık tercihler geliştirme işlerine bağlandı. [Milestones](MILESTONES.md), [Tasks](TASKS.md), [QA planı](QA-PLAN.md), [Release](RELEASE.md) ve [Ops](OPS.md) bu sözleşmeyi geliştirme ve işletim adımlarına bağlar. Planlar koddan önce hazırlanır; test ve kurulum sonuçları uygulama sırasında eklenir. Bu görevde uygulama veya bulut kaynağı oluşturulmadı.
