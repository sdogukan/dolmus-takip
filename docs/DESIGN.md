# Design: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.4  
**Durum:** İncelemeye hazır ekran ve etkileşim taslağı. Çalışan uygulama veya bitmiş görsel tasarım değildir.  
**İlgili belgeler:** [PRD](PRD.md) · [Tech Stack](TECH-STACK.md) · [Architecture](ARCHITECTURE.md)  
**Şablon:** Project Blueprint / 04-design: sayfa listesi, şematik ekranlar ve açıklamaları, tasarım sistemi, CSS değişkenleri ve onaylar.

## Tasarımın amacı

Şoför bilgilerini girip **bir kez Kaydet** der. Mal sahibi hesabı görür, parayı sayar ve aldığı tutarı doğrular. Ekibimiz aynı işlemleri müşteriye yardımcı olmak için kendi yönetim ekranından yapabilir. Telefonda büyük yazılar, mavi-beyaz görünüm, açık Türkçe ve tek sütunlu formlar kullanılır.

Aşağıdaki çizimler yerleşimi ve işlem sırasını anlatır; köşeli parantezler alan veya düğmedir. Ürün kuralları PRD’den gelir. Renk, boşluk, sayfa adresi ve bileşen yerleşimleri bu belgenin tasarım önerileridir. Henüz kesinleşmeyen ürün tercihleri §2.11’de ayrılır; taslak ekran bu tercihlere kendiliğinden onay vermez.

## 1. Sayfa Listesi (Sitemap)

### Giriş gerektirmeyen sayfalar

| Sayfa | Önerilen adres | İçerik |
|---|---|---|
| Araç girişi | /giris | Plaka ve şifre; şifre hangi yetkiyi açıyorsa ilgili ekran |
| Ekip girişi | /yonetim/giris | Kişisel ekip kullanıcı adı ve şifresi |

Ana adres, oturum yoksa araç girişine; geçerli oturum varsa ilgili ana ekrana yönlenir. Kayıt ol, şoför hesabı aç, OTP veya zorunlu indirme ekranı yoktur. Şifreyi unutan müşteriye platform ekibinden yardım alması söylenir; otomatik SMS/e-posta akışı eklenmez.

### Giriş gerektiren sayfalar

| Alan | Sayfa | Önerilen adres | Kapsam |
|---|---|---|---|
| Şoför | Günlük kayıt formu | /sofor | Aracı hazır, çalışacak kişi listeden seçilir |
| Şoför | Kaydetme sonucu / teslim durumu | /sofor/kayitlar/:id | Yeni kaydın sonucu; sonraki erişim kapsamı §2.11’de açık |
| Sahip | Özet | /sahip | Toplamlar ve henüz doğrulanmayan kayıtlar |
| Sahip | Çalışma kaydı | /sahip/kayit/yeni | Kendim çalıştım veya şoför adına kayıt |
| Sahip | Kayıt detayı ve düzeltme | /sahip/kayitlar/:id | Hesap, alınan para, onay ve geçmiş |
| Sahip | Raporlar | /sahip/raporlar | Dönem, kişiler ve gün gün kayıtlar |
| Sahip | Şoförlerim | /sahip/soforler | Ekleme, ad düzeltme, araç atamasını pasifleştirme |
| Ekip | İşletme / araç bulma | /yonetim | Plaka veya işletme adıyla hedef seçme |
| Ekip | İşletme oluşturma / düzenleme | /yonetim/isletmeler/yeni ve /yonetim/isletmeler/:id | İşletme ve mal sahibi bilgisi |
| Ekip | Araç oluşturma / düzenleme | /yonetim/isletmeler/:id/araclar/yeni ve /yonetim/araclar/:id | Araç, bağlı sahip, iki şifre ve aktiflik |
| Ekip | Müşteriye destek alanı | /yonetim/araclar/:id/destek | Şoförler, çalışma girişi, onay/düzeltme ve raporlar |
| Ekip | İşlem geçmişi | /yonetim/islem-gecmisi | Gerçek ekip kullanıcısı ve önce/sonra değerler |
| Yönetici | Ekip hesapları | /yonetim/ekip | Kişisel hesap, yetki, aktiflik ve şifre sıfırlama |

Adresler sayfa önerisidir; API adresleri Architecture §4’tedir. Ekranda düğme gizlemek yetki kontrolünün yerine geçmez. Ortak şoför şifresi sahip veya ekip alanını açmaz. Sahip çizimlerinde giriş yapılan tek araç gösterilir; diğer araçlara geçiş kesinleşmemiştir.

## 2. Wireframe'ler

### 2.1 Araç girişi

~~~text
  Dolmuş Takip
  Günlük hesabını kolayca kaydet

  Plaka
  [ 35 ABC 123                         ]
  Şifre
  [ •••••••••                 Göster  ]

  [             Giriş yap             ]

  Giriş yapamıyorsan hesabını açan
  ekipten yardım al.
~~~

- **Yerleşim:** Telefonda 16 px yan boşluk; geniş ekranda ortalanmış, en fazla 480 px form. Başlık üstte, alanların adı her zaman görünür.
- **Davranış:** “Mal sahibi / şoför” seçtirilmez. Plaka boşluk ve küçük harf farklılıkları anlaşılır biçimde normalize edilir; geçersiz plaka alan altında açıklanır. Şifre yapıştırma ve parola yöneticisi engellenmez. Göster/Gizle yalnız girilen şifreyi etkiler.
- **Sonuç:** Giriş başarılıysa ilgili alan açılır. Hata “Plaka veya şifre yanlış.” olarak gösterilir; form silinmez. Beklerken düğme “Giriş yapılıyor…” olur.
- **Ekip varyantı:** Aynı yerleşimde “Ekip girişi”, “Kullanıcı adı” ve “Şifre” bulunur. Kişisel ekip hesabı kullanılır; araç şifreleri burada geçmez.

### 2.2 Şoförün günlük kaydı

Şoför girişten sonra doğrudan bu forma gelir. Önce boş bir ana sayfa veya ayrı kişi seçme sayfası açılmaz.

~~~text
  35 ABC 123                    Çıkış
  Günlük kayıt

  Adın
  [ Ahmet Yılmaz                    v ]
  Çalışma tarihi
  [ 14 Eylül 2026                    v ]
  Başlangıç               Bitiş
  [ 08:00      ]          [ 17:30     ]
  Çalışma süresi: 9 saat 30 dakika

  Hasılat (TL)
  [ 10.000,00                         ]
  Mazot (TL)
  [ 1.500,00                          ]
  [ + Masraf ekle ]
    Diğer masraf (TL) [ 300,00        ]
    Açıklama          [ Otopark       ]

  Şoför payın (%20)        2.000,00 TL
  Teslim edilecek tutar    6.200,00 TL

  [               Kaydet              ]
~~~

- **Alanlar:** Plaka sabittir; tarih bugün hazır gelir ve değiştirilebilir. Tarihin gün/ay/yılı açıktır. Ad başlangıçta “Adını seç” olur; kullanıcı o araçtaki aktif şoförlerden kendisini seçer. Ortak telefonda önceki şoför kendiliğinden seçilmez. İsim yazma ve kimlik belgesi alanı yoktur.
- **Saat:** Etiketli başlangıç/bitiş saat seçicileri kullanılır, süre otomatik hesaplanır. Dar ekranda alanlar alt alta iner. Örnek, aynı gün içindeki bir çalışmadır; gece geçişi önerisi §2.11’dedir.
- **Para:** Hasılat ve mazot zorunludur; açıkça 0 girilebilir. Boş zorunlu alan sıfır kabul edilmez. Para girişi telefonun ondalık klavyesini açar; tutarlar kuruş hassasiyetinde gösterilir. Eksik/geçersiz girdi varken hesap özeti “—” olur.
- **Masraf:** İlk açılışta yalnız “+ Masraf ekle” vardır. Kullanılmazsa diğer masraf 0’dır. Çizimde bölüm açılmıştır. Tek tutar ve isteğe bağlı açıklama başlangıç önerisidir; kategori/kalem kapsamı kesinleşmemiştir. Dolu bölüm sessizce kapatılıp tutarı kaybedilmez.
- **Hesap özeti:** Alanların hemen arkasında görünür. Hasılatın %20’si paydır; mazot, diğer masraf ve pay çıkarılınca teslim edilecek tutar bulunur. Kullanıcı payı elle yazmaz. Kaydetmeden önce hesap görülebilir; sayfa sonunda tek ana işlem bulunur.
- **Kaydetme:** Alan hatası ilgili yerde gösterilir ve ilk hatalı alana odaklanılır. Geçerli form gönderilirken “Kaydediliyor…” olur; tekrar basmak yeni kayıt oluşturmaz. Sunucu sonucu gelmeden başarı gösterilmez (§2.10).
- **Boş liste:** “Bu araç için şoför eklenmemiş. Mal sahibinden adını eklemesini iste.” Mesajı görünür; elle isim yazarak ilerleme yolu açılmaz. İsimler kesilmeden satır atlar; aynı adlı iki kişi varsa sahip listede ayırt edilebilir ad kullanır.

### 2.3 Kayıt sonucu ve şoföre geri bildirim

~~~text
  Kaydedildi
  Ahmet Yılmaz · 35 ABC 123
  14 Eylül 2026 · 08:00–17:30

  Teslim edilecek tutar    6.200,00 TL
  Henüz doğrulanmadı
  Mal sahibi parayı aldığında
  burada görebileceksin.

  [ Yenile ]
  Başka bir çalışma kaydı gir
~~~

Şoförden “Teslim ettim” veya “Onaya gönder” istenmez. Kayıt, onay beklemeden rapora girer. Mal sahibi onayladığında yetkili sonuç ekranında “Teslim doğrulandı”, gerçekten alınan tutar ve onay zamanı görünür. Örnekte eksik teslim varsa beklenen 6.200 TL ile doğrulanan 6.000 TL birlikte gösterilir.

Durum açılışta ve “Yenile” ile güncellenir; sürekli arka plan sorgusu gerekmez. Bu geri bildirim gereksinimi kesindir; şoförün daha sonra hangi kayıtları yeniden açabileceği §2.11’deki erişim kararıdır. “Kayıtlarım” adıyla bireysel gizlilik güvencesi verilmez. Aynı gün yeni çalışma açılması ayrı kayıt üretir; önceki kayıt ezilmez. Sonucu bilinmeyen gönderim sırasında yeni kayıt bağlantısı açılmaz.

### 2.4 Mal sahibinin çalışma girmesi

~~~text
  35 ABC 123
  Çalışma kaydı

  [ Kendim çalıştım ]  [ Şoför adına ]
  Çalışan: Görkem · Mal sahibi

  Tarih, başlangıç, bitiş, hasılat,
  mazot ve masraf: günlük formla aynı

  Şoför payı                  0,00 TL
  Giderlerden sonra kalan 8.200,00 TL
  Kendi çalışmanda şoför payı ayrılmaz.

  [               Kaydet              ]
~~~

İki seçenek tek formun çalışma türünü belirler. “Kendim çalıştım” sahibin tanımlı kişisini gösterir; sıfır payı kullanıcı hesaplamak zorunda kalmaz. “Şoför adına” seçilince aktif kişi seçici açılır ve %20 uygulanır. Kaydı girenin sahip olması, başkasının sürüşünü sıfır paylı yapmaz.

Kendi çalışmasının kayıt sonucu “Kaydedildi — onay gerekmiyor” olur. Saat ve hasılat sahibin kişi raporuna girer; kendisine “Parayı aldım” düğmesi veya teslim alacağı para alanı çıkmaz. Bu tür kaydı sahip/ekip daha sonra “Değişiklikleri kaydet” ile düzenler; para onayı oluşturulmaz.

### 2.5 Mal sahibi özeti

~~~text
  35 ABC 123 · Görkem
  [ Özet ]  [ Raporlar ]  [ Şoförlerim ]

  [ + Çalışma kaydı gir ]
  Dönem [ Bu ay                     v ]
  1–30 Eylül 2026

  Hasılat                 20.000,00 TL
  Mazot                    3.000,00 TL
  Diğer masraf               600,00 TL
  Şoför payı               2.000,00 TL
  Hesaplanan kalan        14.400,00 TL

  Teslim alınan (onaylı)    6.000,00 TL
  Yalnız doğruladığın şoför teslimleri

  Henüz doğrulanmayan kayıtlar
  Bu dönemde bekleyen kayıt yok.
~~~

- **Yerleşim:** Hesaplanan kalan ile alınan para ayrı, etiketli bloklardadır. Aynı paraymış gibi tek büyük “Kazanç” kartı yapılmaz. Gövde geniş ekranda iki sütuna geçebilir; telefonda tek sütundur.
- **Dönem:** İlk öneri “Bu ay”; “Bu hafta / Bu ay / Bu yıl” ve önceki/sonraki dönem kullanılabilir. Başlangıç-bitiş tarihleri görünür. Bu bölümdeki tüm rakamlar aynı döneme aittir.
- **Bekleyen liste:** Her satırda kişi, çalışma tarihi/saatleri, beklenen teslim ve “Kaydı aç” vardır. Liste seçili döneme aittir ve bu kapsam başlıkta belirtilir. “Henüz doğrulanmadı”, paranın fiziksel olarak verilmediği anlamına gelmez; “Borçlu/Ödenmedi” denmez.
- **Gezinme:** Üç metinli sekme telefon genişliğine sığar; yatay kayan menü veya yalnız simgeler kullanılmaz. Şoför ekranında bu menü bulunmaz. Çıkış, başlıktaki açık etiketli ikincil işlemdir.
- **Rakamlar:** Çizim §2.6’daki 6.000 TL onayından sonraki iki örnek kaydı gösterir. Onay öncesinde “Teslim alınan” 0 TL, bekleyen listesinde Ahmet’in kaydı vardır. Kalan her iki durumda da 14.400 TL’dir.

### 2.6 Para teslimi ve onaylı düzeltme

~~~text
  < Özete dön
  Ahmet Yılmaz · 35 ABC 123
  14 Eylül 2026 · 08:00–17:30
  Henüz doğrulanmadı

  Hasılat                 10.000,00 TL
  Mazot                    1.500,00 TL
  Diğer masraf               300,00 TL
  Şoför payı               2.000,00 TL
  Beklenen teslim          6.200,00 TL

  Aldığım tutar (TL)
  [ 6.000,00                          ]
  Beklenenden 200,00 TL az.

  [ Parayı aldım, tutar doğru          ]
  Kaydı düzenle
~~~

**İlk onay:** “Aldığım tutar” başlangıçta beklenen teslimle doldurulabilir; bu doldurma onay değildir. Sahip parayı sayar, gerekirse alanı değiştirir ve tek düğmeyle doğrular. 6.000 TL alınması hasılatı, payı veya beklenen teslimi değiştirmez. Negatif alınan tutar kabul edilmez. Ayrı uyuşmazlık, borç, ikinci onay veya tahsilat takibi açılmaz.

**Onay sonrası:** Durum “Teslim doğrulandı” olur; alınan tutar, onay zamanı ve işlemi yapan yetki/ekip bilgisi gösterilir. Şoför düzenleyemez. Sahip “Kaydı düzenle” ile günlük formun alanlarını ve mevcut alınan tutarı aynı sayfada görür:

~~~text
  Onaylanmış kaydı düzelt
  Ahmet Yılmaz · 35 ABC 123

  Günlük form alanları: düzenlenebilir
  Yeni beklenen teslim     6.200,00 TL
  Aldığım tutar (TL) [ 6.000,00        ]

  [         Düzelt ve onayla           ]
  Vazgeç                  Geçmişi gör
~~~

“Düzelt ve onayla” **tek işlemdir**; ikinci bir onay ekranı açılmaz. Yeni kayıt değerleri, yeni teslim onayı ve geçmiş birlikte tamamlanır; rapor yeni sürümü kullanır. Hata halinde eski tam kayıt korunur. Hasılat/gider değişince mevcut alınan para kendiliğinden yeni beklenene eşitlenmez; sahip o alanı ayrıca görüp değiştirebilir. Kişi/tarih değişirse rapor yeni kişi/döneme göre güncellenir, eski sürüm geçmişte görünür.

Onaysız günlük hesabı düzeltmek için “Değişiklikleri kaydet” işlemi vardır; bu işlem para alındığını iddia etmez. Sonra gerektiğinde ilk teslim onayı yapılır. Onaylı şoför çalışmasını sahibin kendi çalışmasına dönüştürme önerisi §2.11’de açıktır; normal düzeltmede sessiz tür değişimi yapılmaz.

### 2.7 Raporlar

~~~text
  35 ABC 123 · Raporlar
  [ Bu hafta ] [ Bu ay ] [ Bu yıl ]
  <           Eylül 2026            >
  1–30 Eylül 2026

  Hesaplanan kalan        14.400,00 TL
  Teslim alınan (onaylı)    6.000,00 TL
  Hesap dökümünü gör

  [ Kişiler ] [ Gün gün ]
  Ahmet Yılmaz
  9 saat 30 dakika · 1 gün · 1 çalışma
  Hasılat 10.000 TL · Pay 2.000 TL
  [ Ayrıntıyı gör ]

  Görkem · Mal sahibi
  9 saat 30 dakika · 1 gün · 1 çalışma
  Hasılat 10.000 TL · Pay 0 TL
  [ Ayrıntıyı gör ]
~~~

- **Dönem:** Haftalık/aylık/yıllık gezinme aynı kalıptadır. Seçili dönem metinle belirtilir; tarihler sunucunun kullandığı dönemle aynıdır. Dönem veya kişi değişirken eski toplam yeni başlık altında gösterilmez.
- **Araç hesabı:** “Hesap dökümünü gör”, hasılat/mazot/diğer masraf/pay/kalanı aynı sayfada açar. “Hesaplanan kalan” açıklaması: “Girilen giderler ve şoför payları çıkarıldıktan sonra kalan.” Kesin net kâr, banka bakiyesi veya toplam eldeki nakit diye sunulmaz.
- **Kişiler:** Sahip dahil herkes için süre, çalışılan gün sayısı, çalışma sayısı, hasılat ve pay. Aynı gün iki çalışma iki ayrı kayıttır; gün sayısı kayıt sayısına eşitlenmez. Gece çalışmasının gün/dönem hesabı §2.11’de kesinleşecek kurala bağlanır. Ayrıntıda kişinin giderleri, kalanı ve çalışmaları görünür. İsim değişikliği geçmişi farklı bir kişi gibi bölmez. Pasif kişinin eski çalışmaları listede kalır.
- **Gün gün:** Tarih/kişi/saat/hasılat/beklenen ve alınan tutar/durum, telefon kartlarında gösterilir; karttan kayıt açılır. Kişi ve teslim durumu filtreleri bu listeye uygulanır. Üstteki dönem özeti araç toplamıdır; listeye kişi filtresi uygulandı diye sessizce değişmez. Filtrenin kapsamı “Günlük kayıtları filtrele” başlığıyla açıktır.
- **Sayfalama:** “Daha fazla göster” listeye sonraki sayfayı ekler. Toplamlar dönemin tamamından gelir; yalnız ekrandaki kayıtların toplamı değildir. Masaüstünde aynı bilgiler tablo olabilir; telefonda yatay kaydırma gerektirmez.
- **MVP sınırı:** PDF, Excel, indirme, grafik ve rapor gönderme düğmesi yoktur. Kayıt/düzeltme/onay sonrasında ilgili ekranlar güncellenir; diğer zamanlarda açılış ve “Yenile” yeterlidir.

**Birlikte kontrol edilecek örnek veri:** 14 Eylül’de Ahmet ve 15 Eylül’de Görkem 08:00–17:30 çalışır. Her birinin hasılatı 10.000 TL, mazotu 1.500 TL, diğer masrafı 300 TL’dir. Ahmet’in payı 2.000 TL, kalanı 6.200 TL; Görkem’in payı 0 TL, kalanı 8.200 TL olur. Ahmet için 6.000 TL alındığı doğrulanınca araç toplamı 19 saat, 20.000 TL hasılat, 14.400 TL kalan ve 6.000 TL doğrulanmış teslimdir. Sahibin 8.200 TL’si teslim toplamına eklenmez.

### 2.8 Şoförlerim

~~~text
  35 ABC 123 · Şoförlerim
  [ + Şoför ekle ]

  Ahmet Yılmaz              Aktif
  [ Düzenle ]
  Mehmet Demir              Aktif
  [ Düzenle ]

  [ Pasif şoförleri göster ]
~~~

“Şoför ekle” basit ad-soyad formunu açar. Sistemde zaten tanımlı kişinin ilgili araca eklenmesi gerektiğinde mevcut kişi kullanılır; aynı kişi için gereksiz yeni kayıt üretilmez. Arama yalnız yetkili kapsamı gösterir. Benzer isim uyarısı aynı adlı farklı kişiyi kesinlikle aynı kişi saymaz. Ulusal kimlik numarası ve kişisel giriş hesabı istenmez.

Düzenlemede ad değiştirilebilir; “Bu kişinin eski kayıtları da yeni adıyla görünür.” açıklaması gösterilir. Ayrılan şoför için “Bu araçta pasife al” kullanılır. Geçmiş silinmez, kişi yeni çalışma seçiminden çıkar. Sahip yalnız kendi yetkili araç ilişkisini yönetir; başka araçlardaki atamaları veya genel kişi aktifliğini değiştirmez. Pasif atama aynı kişi kaydıyla yeniden etkinleştirilebilir. Yeni çalışmada pasif kişi seçilemez; eski kayıt detayındaki kişi görünmeye devam eder.

### 2.9 Back office: araç açma ve müşteriye destek

~~~text
  Yönetim · Doğukan                 Çıkış
  [ Plaka veya işletme ara              ]
  [ + İşletme aç ]       [ + Araç ekle ]

  Görkem işletmesi · 35 ABC 123
  Mal sahibi: Görkem · Aktif
  [ Destek ekranını aç ] [ Araç bilgisi ]
~~~

Araç eklerken önce bağlı işletme seçilir veya oluşturulur. Arama sonuçları plaka, işletme ve sahip birlikte gösterir. Tek plaka yanlış işletmeye bağlanamaz; çakışma form üzerinde açıklanır. İşletme/araç listesinde aktiflik filtresi bulunur; geçmiş kaydı olan araç fiziksel olarak silinmez.

~~~text
  Destek: Görkem işletmesi
  Araç: 35 ABC 123 · Sahip: Görkem
  İşlemi yapan: Doğukan (platform ekibi)

  [ Özet ] [ Kayıtlar ] [ Şoförler ]
  [ Raporlar ] [ Araç bilgisi ]
  [ + Çalışma kaydı gir ]

  Sahip adına destek işlemi
  Müşteri ekranlarıyla aynı form ve hesap
~~~

Hedef işletme, araç ve sahip her destek sayfasının başında görünür; form başka müşteriye sessizce taşınmaz. Hedef değiştirmek mevcut işlemden çıkmaktır. Kaydedilmemiş form varsa yalnız ayrılırken “Değişiklikleri bırakıp çık?” sorulur; her kayıt için ek izin/talep akışı eklenmez. Mobil ekip menüsü birkaç metinli satıra sığar, masaüstünde yan menü olabilir.

| Yönetim işi | Ekran alanları ve davranış |
|---|---|
| İşletme / sahip açma | İşletme adı, tanımlı sahip veya yeni sahip ad-soyadı; kaydetmeden önce ilişki görünür. Kişisel araç giriş hesabı oluşturma adımı yoktur. |
| Araç açma / düzenleme | Bağlı işletme/sahip, plaka, marka/model/yıl, hat/durak notu, aktiflik. İlk oluşturma sırasında mal sahibi şifresi ve ortak şoför şifresi ayrı etiketli alanlardır; aynı olamazlar. |
| Araç şifresi sıfırlama | Sahip ve şoför için ayrı işlem. Mevcut şifre gösterilmez; yeni şifre girilir ve hangi araç/erişim için olduğu açıkça yazılır. Etkilenen erişimin eski oturumlarının kapanacağı belirtilir. Otomatik mesaj gönderilmez. |
| Araç / işletme aktifliği | Etkilenen hedef ve erişim sonucu açıkça gösterilir. Pasife alma geçmişi silmez. İşletmeyi pasifleştirmek kapsamındaki araç erişimini de etkiler. |
| Şoför yönetimi | Ekle, adını düzelt, mevcut kişiyi araca bağla, araç atamasını pasife al. Genel kişi pasifliği ayrı yetkili işlemdir; etkilenen araçlar görünür. |
| Çalışma girişi | §2.2/2.4’teki form. Ekip, şoför adına %20 veya sahibin kendi çalışması adına %0 ile kaydeder. |
| Teslim ve düzeltme | §2.6’daki aynı kurallar. Ekipte “Sahip adına alınan tutar” etiketi ve “Sahip adına teslimi onayla” düğmesi kullanılır. Onaylı düzeltmede “Düzelt ve onayla” korunur. |
| Raporlar | Seçilen işletme/araç için §2.7; müşteriden ayrı bir hesap formülü yoktur. |
| Kayıt / işlem geçmişi | Zaman, hedef, işlem, gerçek ekip kullanıcısı, kim adına yapıldığı ve önce/sonra değerler. Şifre ve gizli oturum bilgisi gösterilmez. |
| Ekip hesapları | Yalnız platform yöneticisi; kullanıcı adı, kişi adı, yetki, aktiflik, yeni şifre/sıfırlama. Ortak müşteri şifresi ekip hesabı yerine kullanılmaz. |

Destek işlemi müşterinin kayıt detayında **“Sahip adına platform desteği · Doğukan”** gibi görünür. Bu yazı ekibin parayı fiziksel olarak aldığı anlamına gelmez. Araç/rol oturumuyla yapılan müşteri işlemi de doğrulanmış bireysel ekip kimliği gibi sunulmaz. Geriye dönük her mali düzeltmede eski ve yeni değerler izlenebilir.

### 2.10 Ortak durumlar ve ekran metinleri

| Durum | Kullanıcının göreceği davranış |
|---|---|
| Yükleniyor | “Kayıtlar yükleniyor…” / nötr yer tutucular; gerçek veri gelmeden finansal tutarlar 0 gösterilmez. |
| Gerçekten boş dönem | Başarılı sorgudan sonra “Bu dönemde kayıt yok.”; 0 toplam ancak veri gerçekten boşsa. |
| Eksik/geçersiz alan | Alan altında kısa hata: “Hasılatı gir.”, “Geçerli bir saat seç.” Girilen diğer bilgiler korunur. |
| Kayıt sürüyor | “Kaydediliyor…”; aynı işlem düğmesi geçici kapalı, durum ekran okuyucuya da bildirilir. |
| Sunucu kaydı kesin başarılı | “Kaydedildi.” ve ilgili kayıt; yeni kayıt/rapor açılabilir. |
| Gönderim sonrası bağlantı koptu | “Kaydın sonucu kontrol ediliyor.” Sonuç bilinmeden “Kaydedilemedi” veya “Kaydedildi” denmez. “Tekrar kontrol et” aynı işlemin sonucunu arar; yeni mali kayıt üretmez. Sonuç çözülene kadar aynı form değiştirilerek yeni gönderim yapılmaz. |
| Gönderilmediği bilinen bağlantı hatası | “Bağlantı yok. Henüz kaydedilmedi.” Mevcut sayfadaki form korunur; başarı ve teslim onayı gösterilmez. |
| Kesin reddedilen kayıt | Anlaşılır hata ve düzeltilebilir form; kayıt başarılı gibi rapora eklenmez. |
| İki kişinin aynı kaydı düzenlemesi | “Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.” Eski taslak sessizce üzerine yazılmaz; değişiklikler karşılaştırılıp yeniden kaydedilir. |
| Onaylı düzeltme başarılı | “Kayıt düzeltildi ve onaylandı.” Yeni değerler birlikte görünür. |
| Rapor alınamadı | “Rapor yüklenemedi. Tekrar dene.” Önceki veri gösterilecekse eski olduğu ve ait olduğu dönem açık kalır; 0’a çevrilmez. |
| Oturum bitti | “Oturumun sona erdi. Yeniden giriş yap.” Taslak ancak aynı yetkili araç/ekip hedefi doğrulandıktan sonra geri yüklenir. Başka müşteri/rol ekranına veri taşınmaz. |
| Yetkisiz / pasif erişim | Veri açılmaz; “Bu işlem için erişimin yok.” veya pasif araç açıklaması ve girişe dönüş. |

İşlem sonucu ve tekrar gönderim davranışı Architecture §3’teki kayıt bütünlüğüne bağlıdır; yalnız düğmeyi kapatmak yeterli değildir. Form taslağı kaydedilmiş kayıt sayılmaz. Telefonun kapanması veya tarayıcı verilerinin silinmesine karşı taslak kurtarma garantisi verilmez. Çıkışta müşteriye ait geçici veriler temizlenir; çevrimdışı senkronizasyon bu tasarımda kesinleşmiş değildir.

### 2.11 Kesinleşmemiş tercihler için tasarım önerileri

**Karar durumu (2026-09-17):** K1–K8 için buradaki öneriler ürün sahibi tarafından aynen kabul edildi; K9 sürümleri kanıtla sabitlendi. Nihai kararlar ve gerekçeler [DECISIONS.md](DECISIONS.md) dosyasındadır; bu bölümdeki 'açık/onay bekliyor' ifadeleri tarihsel bağlamdır.

| Açık konu | Önerilen ekran davranışı | Kesinleşmesi gereken |
|---|---|---|
| Ortak şoförün geçmişi / düzeltmesi | Seçtiği kişinin aynı araçtaki kayıtları ve teslim durumu; onaysız kaydı yalnız çalışma gününde düzenleme. | Ortak şifre kullanan kişi başka adı da seçebilir. Gösterilecek kayıtlar ve düzeltme sınırı ürün kararıdır; karar olmadan geniş erişim verilmez. |
| Sahibin diğer araçları | İlk sürümde giriş yapılan plaka; filo seçici eklememe. | Aynı sahip diğer araçlara bu oturumdan ulaşacak mı? |
| Gece çalışması / dönem | Saatlerin altında “Ertesi gün bitti” seçeneği ve açık bitiş tarihi; 0 < süre ≤24 saat, çalışma başlangıç gününe; hafta pazartesi. | Süre sınırı, gece dağıtımı ve hafta kuralı onaylanmalı. Eşit saat otomatik 0 veya 24 sayılmaz. |
| Onaylı sürüş türünü değiştirme | Onaylı kaydın normal düzeltmesinde şoför ↔ sahibin kendi çalışması geçişini kapalı tutma. | Eski teslim onayının nasıl ele alınacağı. Aynı türde kişi/saat/tutar düzeltmesi kesindir. |
| Hesaplanan kalan negatif | Negatif tutarı açık gösterme, ör. 10.000 TL hasılat, 9.000 TL gider ve 2.000 TL pay için “Giderler ve şoför payı, hasılatı 1.000 TL aşıyor.” Alınan tutarı ayrı, en az 0 tutma. | Kaydetme/teslim metni ve kabul davranışı; otomatik borç/tahsilat akışı eklenmez. |
| Masraf yapısı / bağımsız gider | Günlük formda tek diğer masraf ve isteğe bağlı açıklama; bağımsız sigorta/vergi formu eklememe. | Kalem/kategori ve günlük çalışmadan bağımsız giderlerin MVP kapsamı. |
| Çevrimdışı kayıt | Bağlantıyla sunucuya kaydetme; bağlantı kesilince formu koruma ve durumu açıklama. | Cihazda kuyruk ve sonradan senkronizasyon kapsamda mı? |
| Ortak sahip / sahip değişimi | Araçta tek tanımlı sahibi gösterme; eski sürüşlerin kişisini/türünü kendiliğinden değiştirmeme. | Ortaklık ve devir yetkileri/tarihçesi ayrıca tasarlanmalı. |

Bu tablo uygulamaya geçirilirken erişim ve hesap akışını etkileyen ilgili satır karara bağlanır. PRD’de onaylanmış günlük kayıt, otomatik pay, tek şoför kaydı ve tek işlemde onaylı düzeltme yeniden tartışmaya açılmaz.

## 3. Design System

### Renk paleti

| Kullanım | Renk | Not |
|---|---|---|
| Ana işlem | #1D4ED8 | Beyaz yazıyla mavi düğme |
| Sayfa / kart | #F8FAFC / #FFFFFF | Açık zemin; sade beyaz kartlar |
| Ana / ikincil metin | #0F172A / #475569 | Koyu, okunur metin |
| Alan kenarı / ayırıcı | #64748B / #CBD5E1 | Açık ayırıcı rengi form sınırı yerine kullanılmaz |
| Başarılı durum | #166534, zemin #F0FDF4 | “Teslim doğrulandı” yazısı da bulunur |
| Bekleme / dikkat | #92400E, zemin #FFFBEB | “Henüz doğrulanmadı” metni |
| Hata | #B91C1C, zemin #FEF2F2 | Kısa neden ve yapılabilecek işlem |

Normal yazıda en az 4,5:1 kontrast hedeflenir ([WCAG kontrast açıklaması](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)). Seçilen ana düğmenin beyaz yazısı yaklaşık 6,70:1; ana metin/beyaz 17,85:1; durum metni/kendi açık zemini en az 5,91:1’dir. Bunlar renk hesabıdır; çalışan ekran için erişilebilirlik doğrulamasının yerine geçmez. Durumlar yalnız renk veya simgeyle anlatılmaz.

### Yazı tipi ve ölçüler

Sistem yazı tipi kullanılır: system-ui, -apple-system, Segoe UI, sans-serif. Ek font indirmesi gerekmez. Türkçe İ/ı/Ş/ş/Ğ/ğ/Ç/ç/Ö/ö/Ü/ü, uzun adlar ve parasal sayılar gerçek cihazda kontrol edilir.

| Kullanım | Ölçü / ağırlık |
|---|---|
| Yardımcı açıklama | 16 px / 400 |
| Alan etiketi | 18 px / 500 |
| Ana metin / giriş / düğme | 18 px / 400; düğme 600 |
| Bölüm / sayfa başlığı | 24 / 28 px, 600 |
| Önemli tutar | 28–32 px, 600 |

Satır aralığı gövdede 1,5’tir. Çok ince veya bütün sayfayı kalın yapan yazı kullanılmaz. Tutarlar uygun yerde hizalı rakamlarla gösterilir; “6.200,00 TL” biçimi kullanılır. Başlıklar büyük harfle bağırmaz. Küçük ekran için yazı küçültmek yerine yerleşim alt alta geçer.

### Boşluk, köşeler ve bileşenler

- **Ölçek:** 4 px temel; 8/12/16/24/32 px boşluklar. Telefon sayfası 16 px, geniş ekran 24 px yan boşluk. Alan grupları 24 px aralıklı.
- **Boyut:** Form alanları en az 48 px, ana düğme en az 56 px yüksekliğinde. Dokunulan küçük bağlantı/simge alanı da 48 × 48 px hedeflenir. Bu ürün tercihi, WCAG’nin koşullara bağlı 24 px minimumunun üzerindedir ([hedef boyutu](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
- **Köşe:** Alan ve düğmeler 8 px, kartlar 12 px. Ağır gölge/dekorasyon yoktur. Durum etiketi işlem düğmesine benzemez.
- **Düğmeler:** Ana işlem mavi dolgulu; ikincil işlem kenarlı veya metinli. Her formda tek baskın işlem; “Vazgeç” ikincil. Kırmızı yalnız pasife alma gibi sonuçlu işlemlerde; normal borç/bakiye rengi olarak kullanılmaz.
- **Girişler:** Etiket alanın üstündedir; placeholder etiketin yerini almaz. Gereken yerde TL birimi görünür. Klavye açıkken önemli alan veya kaydetme düğmesi sabit alt çubuk altında kalmaz.
- **Kartlar / listeler:** Başlık, tutar ve durum sırası sabittir. Kartın açık “Kaydı aç” işlemi vardır; yalnız küçük ok veya tüm satıra görünmez tıklama alanı konmaz.
- **Pencere:** Kayıt ve para onayı ayrı açılır pencerede tekrarlanmaz. Yalnız kaydedilmemiş değişikliklerle ayrılma gibi kısa kararlar için erişilebilir iletişim penceresi kullanılabilir; odak kapanınca önceki düğmeye döner.
- **Durum ve odak:** Klavye odağı görünür, alan hata metnine bağlıdır; işlem sonuçları ekran okuyucuya bildirilir. Yapışkan başlık/klavye odağı gizlememelidir ([odak görünürlüğü](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)).

### Responsive yerleşim ve hareket

320 px genişlikten itibaren ana müşteri akışları tek sütunda yatay kaydırmadan çalışmalıdır. Form genişliği en fazla 560 px; giriş formu 480 px olur. 640 px’te küçük düzen iyileştirmeleri, 768 px’te özet kartlarında iki sütun, 1024 px’te ekip yan menüsü/tablo kullanılabilir. 1280 px üstünde içerik yaklaşık 1120 px ile sınırlanır; form tüm ekrana yayılmaz. Bu eşikler görsel ihtiyaçtır, farklı cihazlara farklı ürün yetkisi vermez.

İlk sürümde dekoratif animasyon, otomatik kayan içerik ve grafik yoktur. İsteğe bağlı 100–150 ms odak/durum geçişleri hareket azaltma tercihini gözetir. Font büyütme ve %200 yakınlaştırmada ana işlemler erişilebilir kalır.

## 4. Framework Config (CSS variables)

Aşağıdaki parça uygulama aşamasındaki tema için başlangıçtır; henüz projeye çalışan stil dosyası eklenmemiştir. Tailwind sürümü sabitlendiğinde aynı değerler temaya bağlanır.

~~~css
:root {
  --color-primary: #1d4ed8;
  --color-on-primary: #ffffff;
  --color-page: #f8fafc;
  --color-surface: #ffffff;
  --color-text: #0f172a;
  --color-text-secondary: #475569;
  --color-input-border: #64748b;
  --color-divider: #cbd5e1;
  --color-success: #166534;
  --color-success-surface: #f0fdf4;
  --color-warning: #92400e;
  --color-warning-surface: #fffbeb;
  --color-error: #b91c1c;
  --color-error-surface: #fef2f2;
  --font-body: system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-size-body: 1.125rem;
  --line-height-body: 1.5;
  --space-unit: 0.25rem;
  --radius-control: 0.5rem;
  --radius-card: 0.75rem;
  --control-min-height: 3rem;
  --primary-min-height: 3.5rem;
  --form-max-width: 35rem;
}
~~~

## 5. Onaylar ve sonraki adım

| Kişi / kapsam | Durum | Tarih |
|---|---|---|
| Doğukan — tasarım belgesine geçiş | “Tamam geçelim” ile hazırlama yetkisi verildi | 2026-09-15 |
| PRD’de kesinleşmiş ürün kararları | Tasarıma taşındı; kapsam yeniden onay beklemiyor | 2026-09-15 |
| Codex — ekran ve etkileşim taslağı | Hazır; çalışan arayüz üzerinde test edilmedi | 2026-09-15 |
| Doğukan / Görkem — ekran düzeni ve kullanım | İncelenecek; hazırlanmış olması bütün önerilerin onayı değildir | — |
| §2.11 açık ürün tercihleri | İlgili ekran/yetki uygulanmadan önce karara bağlanacak | — |

Ekran incelemesi günlük kayıttan başlayabilir: ad seçimi, başlangıç/bitiş, para alanları, otomatik pay/kalan ve tek Kaydet. Ardından sahipte para onayı ve rapor birlikte kontrol edilir. Kullanıcının devam talebiyle [Epics planı](EPICS.md) hazırlandı; bu ekranlar ana geliştirme işleriyle eşlendi. [Stories](STORIES.md) belgesinde 35 kullanıcı hikâyesi yazıldı; açık ürün tercihleri ilgili işlerde ayrıca görünür tutuldu. [Milestones](MILESTONES.md) ve [Tasks](TASKS.md) uygulama sırasını, [QA planı](QA-PLAN.md) ekran ve kullanıcı akışlarının nasıl doğrulanacağını belirler. Geliştirmeye henüz başlanmadı.

Uygulama sırasında telefon tarayıcısı ve masaüstünde şu senaryolar doğrulanacak: büyük yazıyla 320 px form, klavye/odak, uzun Türkçe adlar, boş/geçersiz veri, yavaş ve kesilen bağlantı, çift tıklama, aynı kayda iki düzenleme, şoför/sahip/ekip yetki ayrımı, %20/%0 pay, eksik teslim ve aynı dönemin kişi/araç toplamları. §2.7’deki örnekler PRD hesaplarıyla karşılaştırılacak. Bunlar bu belgeyle tamamlanmış uygulama testleri değildir.
