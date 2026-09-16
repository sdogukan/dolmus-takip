# Dolmuş Gelir-Gider ve Çalışma Takibi — PRD

**Durum:** v0.14 — Geliştirme öncesi ürün, teknoloji, mimari, tasarım ve iş planları hazır; uygulama geliştirilmedi. Açık ürün konuları §10'da.
**Güncelleme:** 2026-09-15
**Geliştirici:** Doğukan · **Müşteri / ürün sahibi:** Görkem

Bu dosya projenin tek ana ürün gereksinimleri belgesidir. Önceki istek metni ve sohbet karalamasındaki gerekli gereksinimler burada birleştirildi. Son görüşmedeki kararlar eski taslaklara üstündür. Kesin ürün kararları ile eski taslaktan korunan öneriler aşağıda ayrılmıştır. Teknik seçimlerin durumu [Teknoloji planı](TECH-STACK.md), uygulanacak düzen [Mimari plan](ARCHITECTURE.md) belgesindedir. MVP başlangıç teknoloji seçimleri netleşti; uygulama, kesin sürüm ve kapasite doğrulaması bekliyor. Kod uygulaması yapılmadı.

## 1. Amaç ve ölçek

Kâğıtta tutulan günlük hasılat, mazot, gider ve şoför hesabını telefondan kolayca kaydetmek; mal sahibinin hangi aracı kimin ne kadar süre kullandığını, ne topladığını ve kendisine ne kaldığını görmesini sağlamak. Haftalık, aylık ve yıllık kişi ve araç raporları üretmek.

Uygulama indirme veya kurulum gerektirmeyen, iPhone ve Android tarayıcılarında çalışan telefon uyumlu **web uygulaması + backend** olacak. Veriler sunucuda kalıcı tutulacak. Başlangıç planı tek AWS Lightsail makinesinde Ubuntu LTS, Caddy, Node.js 24 LTS üzerinde Next.js/React/TypeScript ve SQLite/Drizzle olarak seçildi. Kesin sürümler ve kapasite uygulama öncesinde doğrulanacak; ayrıntılar teknoloji planındadır.

Güncel hedef en fazla **500 toplam kullanıcıdır**; önceki 200 kullanıcı tahmininin yerini alır. Bu sayı eşzamanlı kullanıcı sayısı değildir. Önceki **200 araç** hedefi farklı bir ölçüdür; kullanıcı sayısı ile eşitlenmez ve eşzamanlı kullanıcı sayısı sayılmaz. Ürün farklı mal sahiplerine satılabilir olmalı; her işletmenin verileri birbirinden ayrılmalıdır.

Başarı hedefi: telefon kullanımında zorlanan bir kullanıcı günlük kaydı yaklaşık 30–60 saniyede tamamlayabilsin. Öncelik doğru hesap, kalıcı kayıt ve sade kullanımdır.

## 2. Giriş modeli ve yetkiler

Araç kayıtlarını platformu yöneten biz, **MVP’de zorunlu olan ekibe özel back office/yönetim ekranlarından** oluşturacağız. Bu iş doğrudan veritabanına elle giriş olarak bırakılmayacak veya sonraki sürüme ertelenmeyecek. Kullanıcı kendi kayıt olmayacak. Her aracın kullanıcı adı **plakasıdır**; araç için **iki ayrı şifre** bulunur: mal sahibi şifresi ve ortak şoför şifresi.

- **Mal sahibi girişi:** Plaka ve mal sahibi şifresi tüm dashboard/yönetim ekranını açar. Bu, platformdaki diğer sahiplerin verilerine erişim sağlamaz. Aynı sahibin diğer araçlarını bu girişten görüp göremeyeceği henüz açık karardır.
- **Ortak şoför girişi:** O araçta çalışan her şoför aynı şoför şifresiyle girer. Mal sahibi **Şoförlerim** listesini oluşturur ve o araçta çalışabilecek şoförleri belirler. Şoför girişten sonra bu listeden kendisini seçer; günlük ad soyad yazmaz. Ayrı bireysel giriş hesabı, telefon OTP veya TC kimlik bilgisi yoktur.
- **Mal sahibinin kendi sürüşü:** Aynı sahip oturumundan çalışma kaydı girer; ayrı şoför hesabı gerekmez. Kendi sürüşüne şoför payı ayrılmaz; saat ve hasılat kişi raporuna yansır.

Her şoförün sabit bir kaydı vardır; kişi raporu seçilen kayda bağlanır. Mal sahibi isim düzeltince geçmiş bölünmez. Ayrılan şoför pasife alınır, yeni çalışma seçiminde sunulmaz ve geçmişi korunur. Bu kayıt giriş hesabı değildir. Listeden seçim kimlik kanıtı sayılmaz; ortak şifreyi hangi gerçek kişinin kullandığı kesin bilinemez. İşlemi yapan araç/rol oturumu ile çalışmayı yapan olarak seçilen kişi ayrı tutulur.

**Rol erişimi, fiilen kullananın niteliği payı belirler:** Sahip kendi sürüşünü girerse pay sıfır; şoför adına girerse %20'dir. İsim veya kişi seçimi oturuma sahip yetkisi vermez. Şoför oturumu sahibin kendi sürüşü akışını kullanamaz. Platform ekibi destek kaydı girdiğinde de hesap çalışmayı yapan kişiye göre yapılır: sahibin sürüşü sıfır, şoförün sürüşü %20 paydır; ekip girişi kendiliğinden sıfır pay doğurmaz.

Bir araçta farklı şoförlerin çalışmaları ayrı kaydedilir. Ortak şoför oturumunun geçmiş kayıtlara erişimi ve onay öncesi düzeltme sınırları §10'da açıktır; onaylanmış kaydı mal sahibi veya onun adına yetkili platform destek ekibi düzeltebilir; “yalnızca kendi kayıtlarına erişir” şeklinde bireysel hesap güvencesi verilmez. Platformun araç açacağı back office MVP gereksinimidir. Bu giriş araçların mal sahibi girişinden ayrıdır, yalnız yetkili platform ekibine açıktır. Yetkili platform ekibi destek amacıyla hedef işletme/araç bağlamında sahip ve şoförün yapabildiği tüm mevcut işlemleri yapabilir; kayıt ve raporları görebilir. Şifre dağıtımının teknik ayrıntıları planlanacaktır. Araç pasife alınırsa eski kayıtlar korunur.

## 3. Kesin günlük kayıt akışı

1. Kullanıcı günlük kayıt formunu açar. Tarih bugün olarak hazır gelir ve değiştirilebilir. Gün, ay ve yıl okunaklı gösterilir; seçilen tarih geçerli bir takvim tarihi olmalıdır. Kaydetmeden önce çalışma tarihi açıkça görünür; kayıt tarihi ile çalışma tarihi karıştırılmaz. Araç, giriş yapılan plakadan hazır gelir; şoföre araç seçimi yaptırılmaz. Sahibin başka kendi aracına geçişi §10 kapsamında açıktır.
2. Her çalışma için başlangıç ve bitiş saatini seçer. Toplam süre otomatik hesaplanır; elle toplam saat girilmez. Şoför, o araçta çalışabilecek aktif şoförler arasından kendisini seçer; çalışma sabit şoför kaydına bağlanır.
3. Günlük brüt hasılatı ve mazot tutarını girer. Diğer masraf isteğe bağlıdır; boş bırakılması sıfır masraf anlamına gelir.
4. Şoför payı ve hesaplanan teslim tutarı **kaydetmeden önce formda otomatik görünür**. Pay elle girilmez.
5. Şoför yalnızca **Kaydet** düğmesine basar. Ayrıca “teslim ettim” veya “onaya gönder” adımı yoktur.
6. Sunucu kaydı başarıyla saklayınca kayıt mal sahibinin ekranına ve raporlara hemen girer. Kaydetmek fiziksel para teslimini kanıtlamaz.
7. Mal sahibi parayı alıp saydıktan sonra kayıtta görünen ad soyad, çalışma tarihi (gün/ay/yıl), beklenen teslim ve gerçek alınan tutarı kontrol eder. Alınan tutar beklenenden farklıysa taraflar bunu kendi aralarında konuşur; sahip alınan tutarı düzeltip **“Parayı aldım, tutar doğru”** düğmesine bir kez basar. Şoför de paranın teslim alındığının doğrulandığını görür.

Mal sahibinin kendi sürüşü sahip oturumundaki kendi çalışmasını kaydetme akışından girilir; aynı çalışma bilgileri kaydedilir; kendisine para teslim onayı gerekmez. Bu kayıtlar “onay gerekmiyor” olarak ayrılır, bekleyen teslim listesine girmez.

“Henüz doğrulanmadı” ifadesi paranın verilmediği anlamına gelmez. Ekranlar bunu borç veya kesin teslim edilmemiş para diye sunmamalıdır. Başarısız kayıt başarılıymış gibi gösterilmez; kullanıcıya anlaşılır hata ve yeniden deneme imkânı sunulur.

## 4. Hesap kuralları

### 4.1 Şoförün çalışması

- Şoför payı = brüt hasılat × %20.
- Mal sahibine hesaplanan kalan / şoförden beklenen teslim = hasılat − şoför payı − mazot − diğer masraf.
- Mazot ve giderler pay hesaplandıktan sonra kalan kısımdan düşer. Önceki görüşmeye göre şoför mazotu kasadan öder, fişi araçta bırakır.

### 4.2 Mal sahibinin kendi çalışması

- Ayrılan şoför payı = 0.
- Mal sahibine hesaplanan kalan = hasılat − mazot − diğer masraf.
- Giderlerden kalanın tümü mal sahibinindir. Süre ve hasılat kendi kişi raporuna yazılır.
- İlk sürümde “kendime pay ayır” gibi ayrıca bir ayar bulunmaz.

| Aynı günlük girdiler | Şoför çalışırsa | Mal sahibi çalışırsa |
|---|---:|---:|
| Hasılat | 10.000 TL | 10.000 TL |
| Mazot | 1.500 TL | 1.500 TL |
| Diğer masraf | 300 TL | 300 TL |
| Ayrılan şoför payı | 2.000 TL | 0 TL |
| Mal sahibine hesaplanan kalan | 6.200 TL | 8.200 TL |
| Teslim doğrulaması | Sahip parayı sayınca | Gerekmez |

Bu iki çalışma aynı rapor dönemindeyse toplam hasılat 20.000 TL, mazot 3.000 TL, diğer masraf 600 TL, ayrılan pay 2.000 TL ve hesaplanan kalan **14.400 TL** olur. Şoförden beklenen 6.200 TL eksiksiz alınmış ve onaylanmışsa doğrulanmış teslim **6.200 TL** olur; sahibin kendi çalışmasındaki 8.200 TL bu toplama eklenmez. Doğrulama yoksa doğrulanmış teslim toplamı 0 TL'dir; bu, paranın fiziksel olarak verilmediğini kanıtlamaz.

Eksik teslim örneği: Şoför kaydında beklenen 6.200 TL iken sahip 6.000 TL aldıysa **alınan tutarı 6.000 TL yapıp onaylar**. Hasılat 10.000 TL, pay 2.000 TL ve hesaplanan kalan 6.200 TL olarak kalır. Yukarıdaki iki kayıt için toplam hesaplanan kalan yine 14.400 TL, doğrulanmış alınan toplamı 6.000 TL olur. Aradaki 200 TL ayrı borç/tahsilat veya kısmi ödeme akışı başlatmaz.

### 4.3 Hesap güvenilirliği

- Tutarlar kuruş hassasiyetinde tam sayı olarak saklanır; kayan noktalı para hesabı kullanılmaz. Yuvarlama kuralı teknik planda açıkça tanımlanır.
- Sunucu süreyi, payı ve kalanı tekrar hesaplar; istemcinin gönderdiği hesaplanmış tutarlara güvenmez.
- Kaydın hesaplama kuralı ve kullanılan oranı saklanır. Gelecekte kural değişikliği olursa geçmiş kayıtlar kendiliğinden değişmez.
- Eski yüzde/sabit tutar/gider sonrası yüzde/kira yöntemi motoru ve araç/şoför bazlı oran ayarları **MVP zorunluluğu değildir**. İlk sürüm kuralı şoför için brüt %20, mal sahibinin kendi sürüşü için sıfır paydır.
- Hesaplanan kalan, yalnızca kayda giren giderleri kapsar; tüm işletme giderleri veya banka bakiyesi olarak sunulmaz.

## 5. Çalışma zamanı ve raporlar

Her çalışmada tarih, araç, seçilen sabit kişi kaydı, çalışma türü (şoför/sahibin kendi sürüşü), başlangıç, bitiş ve hesaplanan süre bulunur. Örneğin 08:00–17:30 arası **9 saat 30 dakika**dır. Mal sahibinin süreleri de diğer kişilerle aynı şekilde kişi raporuna eklenir.

Aynı gün aynı araçta birden fazla çalışma ayrı kaydedilebilir. Eski “tam gün/gündüz/gece” vardiya etiketleri gerçek başlangıç ve bitiş saatlerinin yerini tutmaz. Aynı gün bir kişinin birden fazla çalışmasının kimliklendirilmesi teknik planda çözülmelidir; kayıtlar yanlışlıkla birbirini ezmemelidir.

**Gece geçişi önerisi, kesin karar değil:** Bitiş ertesi gündeyse bitiş günü açıkça belirtilsin; 22:00–ertesi gün 02:00 dört saat hesaplansın. Kayıt başlangıç gününe bağlanabilir. Gece yarısını geçen çalışmanın hangi rapor gününe yazılacağı, eşit başlangıç/bitiş saatinin anlamı ve süre kontrolleri §10'da açıktır. Salt saat karşılaştırmasıyla belirsiz kayıt sessizce 24 saat sayılmamalıdır.

Raporlar **yalnız ekranda**, **hafta, ay, yıl toplamları ve gün gün döküm** olarak sunulur. MVP’de PDF, rapor indirme veya dışa aktarma yoktur; tarih aralığı filtresi kullanılabilir.

- **Kişi raporu:** Çalışılan günler, toplam süre, toplam hasılat, ayrılan şoför payı ve günlük detaylar. Mal sahibi sürmüşse aynı listede saat/hasılatıyla görünür, payı sıfırdır. Önceki gereksinimdeki mazot, diğer masraf ve kalan kırılımları kişi detayında korunur.
- **Araç raporu:** Gelir, mazot, diğer gider, şoför payı ve hesaplanan kalan; gün gün seçilen sürücüler. Bir giriş altında birden fazla araç karşılaştırmasının erişim kapsamı §10 kararı sonrasında belirlenecektir.
- **İşletme özeti:** Yetkili olunan araç kapsamının toplamları (ilk sürümde sahip yalnız giriş yapılan aracı görür; çok araçlı özet K2 kararıyla ertelendi); hesaplanan kalan ile **teslim alındığı doğrulanan tutar** ayrı alanlardır. Henüz doğrulanmamış şoför kayıtları ve onay gerekmeyen sahip sürüşleri ayırt edilir.
- Tarih, plaka/araç, kişi, doğrulama durumu ve masraf türüyle ilgili kayıtlara ulaşılabilir.

Kişi raporları isim metnine göre değil sabit kişi kaydına göre toplanır. İsim düzeltmesi aynı kişinin geçmişini bölmez; aynı isimli farklı şoför kayıtları birbirine karıştırılmaz. Pasif şoförlerin geçmiş kayıtları ve raporları korunur. Seçim, bireysel kimlik doğrulaması anlamına gelmez.

Önerilen toplama kuralı: süreler dakika olarak toplanıp saat/dakika gösterilir; kişi çalışma günü, o kişinin farklı çalışma tarihlerinin sayısıdır. Aynı gün iki kayıt iki gün sayılmaz. İşletme genelinde çalışma günü ile kişi-gün toplamı aynı metrik değildir; teknik planda adlandırılır. Haftanın başlangıcı ve dönem sınırları da netleştirilir.

## 6. Ekranlar ve kolay kullanım

Öncelik, telefon kullanımında zorlanan dolmuş kullanıcıları için mümkün olan en kolay kullanımdır. Görsel kararlar günlük kaydı okumayı ve tamamlamayı kolaylaştırmalıdır.

- **Renkler:** Genel uygulama mavi ve beyaz tonlarında olacak. Açık zemin üzerinde yeterli kontrast sağlayan koyu metin kullanılacak; mavi düğmelerin üzerindeki yazı da rahat okunacak.
- **Yazı tipi:** Sade, kolay okunan ve Türkçe karakterleri destekleyen bir font kullanılacak. Yerleşik sistem fontu kullanımı teknoloji planında seçilmiştir; ayrıntılar [TECH-STACK.md](TECH-STACK.md) belgesindedir. İnce ağırlıklardan kaçınılacak; önemli tutar ve düğmelerde orta veya yarı kalın ağırlık kullanılacak.
- **Boyut ve dokunma:** Yazılar, rakamlar, düğmeler ve diğer dokunma alanları büyük ve rahat seçilebilir olacak. Yanlış dokunmayı azaltacak boşluklar bırakılacak.
- **Mobil düzen:** Günlük form tek sütun ve sade olacak; gerektiğinde kaydırılabilecek. Uzun menüler ve gereksiz alanlar günlük işi zorlaştırmayacak. Etiketler açık Türkçe olacak.
- **Durum bilgisi:** Hata, başarı ve teslim doğrulaması yalnız renkle anlatılmayacak; anlaşılır metinle, gerektiğinde destekleyici simgeyle gösterilecek.

**Giriş:** Plaka + şifre. Doğrulanan şifreye göre sahip veya ortak şoför yetkisi sunucuda belirlenir; kullanıcı kayıt ekranı yoktur.

**Platform back office — MVP’de zorunlu:** Araç sahibi panelinden ayrı, yalnız ekibimizin yetkili girişle kullanacağı yönetim alanı. Kesin MVP işlem kapsamı (ekranların düzeni teknik planda belirlenir):

- Yetkili platform ekibi girişi.
- Mal sahibi/işletme kaydı oluşturma ve araç kaydını doğru işletmeye/plakaya bağlama.
- Araç için sahip ve ortak şoför şifrelerini belirleme veya sıfırlama. Mevcut şifre düz metin gösterilmez.
- Araç kaydını aktif/pasif yapma; pasife alma geçmişi silmez.
- Müşteri adına şoför ekleme, isim düzeltme, araçla ilişkilendirme ve pasife alma.
- Sahip veya şoför adına çalışma kaydı oluşturma ve düzeltme; onaylanmış kayıtları da destek amacıyla düzenleme.
- Hedef işletme/araç kayıtlarını, değişiklik geçmişini ve mevcut kullanıcı raporlarını görme.
- Gerçek alınan tutarı düzeltme ve sahip adına teslim doğrulama dahil sahip/şoförün yapabildiği tüm mevcut kullanıcı işlemlerini yürütme.

Amaç telefon veya uygulama kullanımında zorlanan müşteriye doğrudan ekip desteğidir. Her işlem için ek onay, destek talebi veya karmaşık süreç zorunluluğu eklenmez. Farklı sahiplerin araçları karıştırılmamalı; liste ve kayıt işlemlerinde işletme/araç bağı görünür ve sunucuda denetlenen olmalıdır. Abonelik, ödeme ve gelişmiş platform raporları bu ihtiyacın otomatik parçası değildir. Mal sahibi Şoförlerim listesini kendi panelinde yönetmeye devam eder; ekip gerektiğinde back office üzerinden destek olur.

**Şoför:** Büyük “Bugünkü kaydı gir” düğmesi; giriş yapılan araç, aktif şoför listesinden kişi seçimi, saatler ve §3'teki para alanları. Hesap özeti formda görünür, son işlem Kaydet'tir. Teslim doğrulamasını görme ihtiyacı korunur; bunun hangi kayıtlar üzerinden gösterileceği geçmiş erişimi kararıyla birlikte tanımlanacaktır. Geçmiş okuma ve onay öncesi düzeltme erişimi kesinleşmemiştir; onaylı kaydı şoför değiştiremez.

**Mal sahibi:** Tüm dashboard/yönetim ekranları; yetkili araç kapsamındaki gelir/gider/kalan, seçilen sürücüler, doğrulanmamış kayıtlar, değişiklik geçmişi, gerçek alınan tutarı düzenleme ve tek para doğrulama düğmesi, kendi sürüşünü kaydetme ve dönem raporları. Araç oluşturmayı platform yapar; sahip Şoförlerim listesinden şoför ekler, adını düzeltir, araçta çalışabilecekleri belirler ve ayrılanları pasife alır. Araç bilgilerini düzenleme yetkilerinin ayrıntısı ve aynı sahibin diğer araçlarına geçiş açık konudur.

Araç bilgilerinde plaka, marka/model, yıl, hat/durak, not ve aktif/pasif durumu korunur; şoförlerin sabit kayıtlarında ad soyad, aktif/pasif durumu ve çalışabilecekleri araç ilişkisi bulunur. Bunlar bireysel giriş hesapları değildir. Günlük diğer masraf isteğe bağlıdır. Kalemli gider ve kategori önerileri: tamir, yağ, lastik, yıkama, otopark, ceza, diğer; tutar ve açıklama. Kategorilerin kesin listesi ve ayrıntı düzeyi açık konudur.

## 7. Kayıt, doğrulama ve değişiklik geçmişi

Kesin ayrım: **kaydedilmiş ve henüz doğrulanmamış**, **para teslimi doğrulanmış**, **sahibin kendi sürüşü nedeniyle onay gerekmeyen** kayıtlar. Bu adlar ürün anlamını belirtir; teknik durum adları seçilmedi.

Mal sahibi para alındığında gerçek **alınan tutarı** kontrol eder; bu alan başlangıçta beklenen tutarla hazır gelebilir. Fark varsa alınan tutarı düzeltir ve **“Parayı aldım, tutar doğru”** düğmesiyle onaylar. Düğmedeki “doğru”, ekrandaki gerçek alınan tutarın doğru olduğunu belirtir; beklenen ile alınanın eşit olması şart değildir. Henüz onaylanmamış hazır tutar, alınmış para sayılmaz.

Doğrulama ekranında seçilen kişinin adı, çalışma tarihi, hesaplanan beklenen teslim ve gerçek alınan tutar açık görünür. Onayın araç/sahip rolündeki oturumu, zamanı, kayıt sürümü ve onaylanan alınan tutarı saklanır. Tekrar tıklama toplamı artırmaz. Onay kimlik kanıtı değildir.

Eksik teslimi taraflar kendi aralarında konuşur. Uygulamada ayrı uyuşmazlık, red, borç tahsilatı veya kısmi ödeme iş akışı yoktur. Alınan tutarı değiştirmek hasılatı, giderleri, şoför payını veya beklenen teslimi otomatik değiştirmez.

**Onaylanmış kaydı mal sahibi düzeltebilir; açık istisna olarak yetkili platform ekibi de müşteri adına destek amacıyla düzeltebilir. Normal şoför oturumu değiştiremez.** Her değişiklikte araç/rol oturumu, seçilen kişi kaydı, zaman ve önceki/yeni değerler korunur; geçmiş fiziksel olarak silinmez. Ortak şifrenin kullanımı nedeniyle işlem geçmişi gerçek kişinin kesin kimliğini kanıtlamaz. Onay öncesi şoför düzeltme ve geçmiş erişim sınırları açıktır; kişi seçimi tek başına bireysel erişim güvencesi değildir.

**Platform destek işlem izi:** Gerçek ekip kullanıcısı, hedef işletme/araç, kim adına işlem yapıldığı, işlem zamanı ve değişiklik öncesi/sonrası korunur. Oluşturma işleminde önceki değer bulunmadığı da ayırt edilir. Müşteri yapmış gibi gösterilmez. Teslim doğrulamasında “sahip adına platform desteği” ve ekip kullanıcısı açık görünür; bu, ekip üyesinin fiziksel parayı bizzat aldığı iddiası değildir. Hedef işletme/araç işlem ekranında görünür ve sunucuda kayıt ilişkileriyle doğrulanır; yanlış işletmeye yazma veya kayıt karıştırma engellenmelidir.

**Onay sonrası düzeltme — 15 Eylül 2026 tarihinde kullanıcı tarafından onaylanan karar:** Mal sahibi onaylı kaydı düzenlerken gerçek alınan tutarı da aynı ekranda görür ve tek seferde **“Düzelt ve onayla”** der. Yetkili platform desteği de sahip adına aynı işlemi yapabilir. Yeni kayıt değerleri ve yeni para onayı birlikte kaydedilir; eski kayıt/onay değişiklik geçmişinde korunur. Raporlar işlem tamamlandığında yeni onaylı değerleri kullanır. Düzeltmeyi kaydedip para onayını ayrıca bekleten ikinci adım yoktur. İşlemin herhangi bir kısmı başarısızsa eski tam kayıt korunur; yeni hesapla eski onay karışık gösterilmez. Çalışma tarihi veya kişi düzeltmesi yeni sürümün rapor dağılımına yansır; geçmiş dağılım revizyonlarda kalır. Şoför/sahip sürüş türleri arasında dönüşümün eski teslimi nasıl etkileyeceği ayrı açık kenar durumudur; bu karar otomatik borç/tahsilat akışı eklemez.

## 8. Kalıcı veri, güvenlik ve teknik plan girdileri

Önceki uygulamada veri kaybolması yaşandığı için kalıcılık temel gereksinimdir. Tarayıcı veya telefon kapanınca kayıtlar silinmez; başka telefondan yetkili giriş yapıldığında erişim kapsamındaki geçmiş korunur. Ortak şoför girişinin hangi geçmişi görebileceği açık kalır.

- Veriler sunucuda kalıcı veritabanında saklanır. Seçilen yedekleme günde bir Lightsail otomatik makine snapshot’ı ve son yedi otomatik yedeğin tutulmasıdır; S3 veya saatlik yedek kurulmayacak. Son başarılı yedekten sonraki kayıtların kaybolabilmesi kabul edildi. Yedek başarısı kontrol edilecek ve restore testi yapılacak. Yedi yedek sınırı uygulama kayıtlarını silmez; en az beş yıllık saklama gereksinimi korunur. Makine silinmeden önce korunacak otomatik yedek manuel snapshot olarak saklanmalıdır; ayrıntılar teknoloji planındadır.
- Her araç, kişi ilişkisi, çalışma kaydı, gider, teslim doğrulaması ve revizyon ilgili işletmeye bağlıdır. İşletme ayrımı backend ve veritabanı seviyesinde uygulanır; ekranda gizleme yeterli değildir.
- Yetkili araç/işletme kapsamı dışındaki kayıt kimliğini bilen kullanıcı doğrudan API üzerinden de okuyamaz/değiştiremez. Aynı araçtaki ortak şoför şifresi bireysel şoför ayrımı sağlamaz. Raporlar aynı yetki sınırlarına tabidir.
- Her iki şifre düz metin olarak değil güvenli, tuzlanmış parola hashleriyle saklanmalıdır. Back office erişimi ayrı platform ekip yetkisiyle korunmalı; araç sahibi veya ortak şoför şifresi platform girişi açmamalıdır. Mevcut şifreyi görüntüleme yerine sıfırlama uygulanmalıdır. Sunucu her istekte araç ve rol yetkisini doğrulamalıdır; istemcinin gönderdiği rol veya isim yetki vermez. Bunlar uygulanacak gereksinimlerdir, hazır güvenlik özellikleri değildir.
- Şoför hesaplanan alanları, sahibi adına teslim doğrulamasını veya yetki ayarlarını değiştiremez.
- Tekrarlanan gönderimler kayıt çoğaltmamalı; eşzamanlı düzeltmeler sessiz veri kaybına yol açmamalıdır. Bu güvenilirlik gereği çevrimdışı özellikten bağımsızdır.
- Eski taslaktaki KVKK aydınlatma ve satış öncesi hazırlık ihtiyacı korunur; hukuki metin ve uygulama ayrıntıları bu belgenin konusu değildir.

Teknik planda ele alınacak kavramlar: ayrı platform ekip erişimi, gerçek ekip kullanıcı kimliği, kim adına işlem yapıldığı, hedef işletme/araç ve önce/sonra değerlerini içeren yönetim işlem geçmişi, işletme/sahip kapsamı, plaka ile tanımlanan araç, araç başına iki rolün parola hashleri, yetkili oturum, çalışma kaydı, gider kalemleri, teslim doğrulaması ve revizyon. Çalışma kaydı; sabit kişi kaydı, işlemi yapan araç/rol oturumu, çalışma türü, zamanlar/süre, para girdileri/hesapları, hesap kuralı, kayıt sürümü ve doğrulama ilişkisini taşır. Şoför kaydı ad değişiminden bağımsız sabit kimlik taşır; aktif/pasif durumu ve araçta çalışabilme ilişkisi bulunur. Ayrı bireysel giriş üyeliği yoktur. Beklenen teslim, gerçek alınan tutar ve onaylanan tutar/sürüm ayrı izlenir. Bu liste seçilmiş veritabanı şeması değildir.

Tek AWS Lightsail ve günlük otomatik snapshot seçildi. Frankfurt/Linux IPv4 2 vCPU, 2 GB RAM, 60 GB disk, 3 TB transfer paketi seçilen başlangıçtır; ölçülmüş kapasite garantisi değildir. Ubuntu LTS, Caddy, Node.js 24 LTS üzerinde Next.js/React/TypeScript, yerel SQLite, Drizzle ORM/better-sqlite3/Drizzle Kit ve diğer yardımcı araçlar teknoloji planındaki başlangıç seçimleridir. PostgreSQL koşullu geçiş seçeneğidir. Supabase önerisi kullanıcı tarafından reddedildi. Giriş için telefon OTP önerisi yeni plaka/iki şifre kararıyla geçersizdir.

## 9. İlk sürümün kabul senaryoları

1. Telefonda kurulum yapmadan giriş ve günlük kayıt çalışır. §6’daki mavi-beyaz görünüm, açık zeminde kontrastlı koyu metin, Türkçe karakter destekli okunur font, büyük yazı/dokunma alanları ve sade tek sütun form doğrulanır. Önemli tutar ve düğmeler orta/yarı kalın görünür; hata ve teslim durumları renk olmadan da metinden anlaşılır.
2. Platform ekibi ayrı back office üzerinden işletme ve araç kaydını oluşturur, plakayı doğru işletmeye bağlar. Plaka + ortak şoför şifresiyle girince bugün ve giriş yapılan araç hazır gelir; mal sahibinin Şoförlerim listesinde o araç için belirlediği aktif şoför seçilir; serbest isim yazılmaz ve ayrı bireysel giriş gerekmez. Bugün önseçili çalışma tarihi değiştirilebilir; gün/ay/yıl açık görünür, geçersiz takvim tarihi kabul edilmez.
3. Başlangıç/bitiş seçilir, 08:00–17:30 için 9 saat 30 dakika hesaplanır; süre seçilen sabit kişi kaydı için rapora girer.
4. Şoför için 10.000 TL hasılat, 1.500 TL mazot, 300 TL masrafta pay 2.000 TL ve teslim 6.200 TL formda otomatik görünür.
5. Şoför yalnızca Kaydet'e basar; başarılı kayıt sahibin ekranına ve rapora hemen girer. Ayrı teslim ettim/onaya gönder adımı çıkmaz.
6. Sahip seçilen kişinin adını, çalışma tarihini, beklenen ve alınan tutarı açıkça görüp “Parayı aldım, tutar doğru” ile 6.200 TL'yi doğrular; şoför için doğrulama bilgisi üretilir; gösterilecek kayıt kapsamı §10 kararına göre sınanır. Tekrar tıklama çift teslim oluşturmaz.
7. Sahip aynı hesabıyla sürüş kaydeder; aynı para girdilerinde pay 0, kalan 8.200 TL olur. Saat ve hasılat kendi kişi raporunda görünür; kendisine teslim onayı istenmez.
8. Sahip şoför adına kayıt girince hesap ve saatler seçilen şoför kaydına bağlanır, pay %20 olur; sahip rolündeki kayıt oturumu ayrıca görünür. Sahip oturumu tek başına her kaydı sıfır paylı yapmaz.
9. Aynı gün aynı araçta farklı kişilerin çalışmaları ayrı kalır; araç raporu hepsini, kişi raporu sabit kişi kaydı üzerinden toplanır.
10. §4'teki iki kayıt için kalan 14.400 TL ve doğrulanmış şoför teslimi 6.200 TL ayrı görünür; sahibi sürüşü teslim toplamına eklenmez.
11. Haftalık, aylık ve yıllık toplamlar kaynak kayıtlarla tutar; sahip dahil kişi saatleri ve araç gelir/gider kırılımları doğrulanır.
12. İşletmeler birbirlerinin araç/kişi/kayıt/raporlarına ekran veya API üzerinden erişemez; ortak şoför şifresi sahip dashboard/yönetim yetkisini açamaz. Aynı araçtaki şoförler arasında bireysel erişim ayrımı iddia edilmez.
13. İstemciden değiştirilmiş pay, kalan veya onay gönderildiğinde sunucu yetki ve hesap kurallarını uygular.
14. Uygulama kapanıp açılınca ve telefon değişince yetkili kapsamın geçmişi korunur; yedekten geri yükleme doğrulanır. Tekrarlanan kayıt isteği çoğalmaz.
15. Onaylı kaydı ortak şoför oturumu değiştiremez; sahip veya onun adına yetkili platform destek ekibi “Düzelt ve onayla” ile tek işlemde değiştirir. Değişiklik araç/rol oturumu, seçilen kişi, zaman ve önce/sonra geçmişi üretir. Rapor yalnız yeni sürümün onayını kullanır; eski onayları ayrıca toplamaz. İşlem ortasında hata olursa tüm değişiklik geri alınır; eski tam durum korunur.
16. Plaka + sahip şifresi dashboard/yönetim ekranını açar; başka sahiplerin verisini açmaz. Çok araçlı sahibin kapsamı açık karar sonrası sınanır.
17. Kişi seçimi ortak şoför oturumuna sahip yetkisi vermez; sıfır pay sahibin kendi sürüşüne uygulanır; ekip bunu sahip adına kaydedebilir. Ekip şoför adına kaydederse pay %20 kalır.
18. İki rolün şifreleri güvenli hash olarak saklanır; yanlış şifre ve değiştirilmiş araç/rol bilgisiyle yetki kazanılamaz. Kullanıcının kendi kayıt olması ve telefon OTP akışı bulunmaz.
19. Şoför adı düzeltilince geçmiş tek kişi raporunda kalır; şoför pasife alınırsa yeni seçimde sunulmaz, geçmişi korunur.
20. Beklenen teslim 6.200 TL iken sahip alınanı 6.000 TL yapıp onaylayabilir. Pay 2.000 TL, hasılat 10.000 TL ve beklenen 6.200 TL kalır; doğrulanmış alınan 6.000 TL olur. Ayrı uyuşmazlık veya kısmi ödeme adımı açılmaz.
21. Hafta/ay/yıl toplamları ve gün gün döküm ekranda görünür; MVP’de PDF/indirme işlevi bulunmaz.

22. Araç sahibi/şoför şifreleri back office’i açmaz; yalnız yetkili platform ekibi erişebilir. Halka açık kayıt ol ekranı yoktur.
23. Back office üzerinden araç için iki rolün şifreleri belirlenebilir/sıfırlanabilir; mevcut şifreler düz metin gösterilmez. Araç aktif/pasif yapılabilir, geçmiş korunur. Bu işlemler uygulanırken işletme/araç bağı doğrulanır; yanlış işletmeye ait kayda yetkisiz erişim verilmez.

24. Yetkili ekip doğru işletme/araç bağlamında şoför ekler/düzeltir, araçla ilişkilendirir ve pasife alır; müşteri paneli ve geçmiş buna tutarlı yansır.
25. Ekip şoför adına 10.000 TL hasılat, 1.500 TL mazot ve 300 TL giderle kayıt girerse pay 2.000 TL, beklenen 6.200 TL olur; sahibin kendi sürüşü adına girerse pay 0, kalan 8.200 TL olur.
26. Ekip onaylı kaydı destek amacıyla düzenleyebilir; normal şoför düzenleyemez. Gerçek ekip kullanıcısı, hedef işletme/araç, kim adına yapıldığı ve önce/sonra değerler geçmişte görünür; müşteri işlemi olarak gösterilmez.
27. Ekip sahip adına alınan tutarı 6.000 TL yapıp teslimi doğrulayabilir; kayıt “sahip adına platform desteği” olarak görünür. Beklenen teslim ve pay bundan değişmez; ekip parayı bizzat almış gibi gösterilmez.
28. Back office’te seçilen işletme/araç açık görünür; hedefle uyuşmayan kayıt ilişkisi sunucuda reddedilir. Destek için ayrı talep veya her işlemde ek onay akışı zorunlu değildir; mevcut kullanıcı işlemlerinin kendi kontrolleri korunur.

Gece geçişi ve çevrimdışı kullanımın ek testleri ilgili kapsam kararı sonrası yazılacaktır; bunlar burada karara bağlanmış sayılmaz.

## 10. Açık kararlar ve kapsam sınırları

**Karar durumu (2026-09-17):** K1–K8 için buradaki öneriler ürün sahibi tarafından aynen kabul edildi; K9 sürümleri kanıtla sabitlendi. Nihai kararlar ve gerekçeler [DECISIONS.md](DECISIONS.md) dosyasındadır; bu bölümdeki 'açık/onay bekliyor' ifadeleri tarihsel bağlamdır.

Kesinleşmiş temel akış tekrar sorulmayacak. Aşağıdakiler teknik planın ilgili noktasında ele alınacak:

1. **Gece geçişi:** Bitiş günü, çalışma tarihi, dönemlere dağıtım, eşit saatler ve izin verilen süre sınırları. Başlangıç gününe bağlama §5'te öneridir.
2. **Onaylı kaydın sürüş türünü dönüştürme:** Onaylı kaydı düzeltme ve para onayı §7’ye göre tek işlemdir; rapor hemen yeni onaylı değerleri kullanır. Açık kalan kenar durum, şoför sürüşünü sahibin kendi sürüşüne veya tersine dönüştürürken eski para tesliminin nasıl ele alınacağıdır. Ayrı uyuşmazlık/kısmi ödeme akışı kapsam dışıdır.
3. **Onay öncesi düzeltme:** Ortak şoför oturumunun süre/yetki sınırları. Onaylı kayıt için sahip ve müşteri adına yetkili platform destek ekibi yetkilidir; normal şoför değildir.
4. **Sahibin bağımsız giderleri:** Sigorta, vergi, kasko gibi giderler önerildi; ilk sürüm kapsamı onaylanmadı. Günlük çalışma masrafından ayrı ele alınacak.
5. **Çevrimdışı kullanım:** İlk kaynakta gelecek özellik, eski PRD'de v1 olarak yazılmıştı. Yeni web tercihi bunu ne onayladı ne kaldırdı. İlk sürümde olup olmayacağı açık. Seçilirse yerel kuyruk, tekrar gönderim ve çakışma davranışı planlanacak; yerel kayıt sunucuda kaydedilmiş gibi gösterilmeyecek. Kurulum mecburiyeti getirilmeyecek.
6. **Teknik uygulama ayrıntıları:** Başlangıç araçları teknoloji planında seçildi. Kesin sürümler, mimari, şifre dağıtımı, güvenli oturum süreleri/parametreleri ve kapasite doğrulaması tamamlanacak. Kullanıcı tahmininden eşzamanlı yük varsayımı çıkarılmayacak.
7. **Diğer eski açık konular:** Ortak sahipler, gider kategorileri ve rapor dönem sınırları. Çalışma tarihi bugün önseçili ve değiştirilebilirdir; geçmiş tarih seçimi açık soru değildir. Ayrı bireysel giriş hesabı bulunmaz; kişi raporunun sabit şoför kaydına bağlanması kesindir.
8. **Ticarileştirme:** Ürün adı ve fiyat/abonelik sonraki aşamada ele alınacak. MVP araç oluşturma platform ekibinin özel back office ekranlarından yapılır; kendi kendine kayıt kapsamda değildir.
9. **Sahibin çok araçlı erişimi:** Bir plakanın sahip girişi aynı sahibin diğer araçlarını da açacak mı? Kesinleşmedi.
10. **Ortak şoför geçmişi ve düzenleme:** Hangi kayıtlar/teslim doğrulamaları görülebilecek, onay öncesinde hangi kayıt ne zamana kadar değiştirilebilecek? Şoför listeden kendisini seçer; bireysel kimlik doğrulaması eklenmez. Onaylı kaydı mal sahibi veya onun adına yetkili platform destek ekibi değiştirir; geçmiş silinmez.

İlk sürümün çekirdeği günlük çalışma/para kaydı, sahibi ve şoförü kapsayan raporlar, teslim doğrulaması, ekibe özel back office, güvenlik ve kalıcı veridir. Native mağaza uygulaması gerekmez.

Önceki karalamadan korunan sonraki sürüm adayları: farklı pay yöntemleri/taksi yevmiyesi ve kart hasılatı; kilometre/litre/yakıt tüketimi; fiş fotoğrafı; Excel/PDF; grafikler; bildirim/WhatsApp; bakım-lastik geçmişi ve hat/durak yönetimi; sigorta/muayene/vergi hatırlatmaları; performans analizi, gelir tahmini ve otomatik günlük kapanış. Bunlar MVP taahhüdü değildir. Fiş fotoğrafının v1.1 veya v2 sıralaması da kesin değildir.

## 11. Geliştirme öncesi planlar ve sıradaki aşama

Başlangıç teknolojileri, [mimari](ARCHITECTURE.md) ve [ekran tasarımı](DESIGN.md) hazırlandı. [Epics](EPICS.md) altı ana işi ve §9'daki 28 kabul maddesinin sorumluluğunu, [Stories](STORIES.md) 35 hikâyenin kabul kriterlerini tanımlar.

Kullanıcının 15 Eylül 2026 tarihli “geliştirme hariç hepsini hazırla” talebiyle planlama sırası [Milestones](MILESTONES.md) → [Tasks](TASKS.md) → [QA planı](QA-PLAN.md) → [Release](RELEASE.md) → [Ops](OPS.md) şeklindedir. Milestones işleri altı aşamada gruplar, Tasks her hikâyenin teknik adımlarını, QA nasıl doğrulanacağını, Release nasıl yayınlanacağını ve Ops nasıl işletileceğini anlatır. Plan belgeleri koddan önce hazırlanır; testler ilgili özelliklerle birlikte uygulanır, gerçek yayın/işletim kanıtları uygulama ve kurulum sırasında eklenir.

Sıradaki çalışma **M1 geliştirmesidir**. Bu planlama görevi kod, repo/Issue oluşturma, sunucu satın alma/kurma veya yayın yapmaz. Açık ürün tercihleri §10 ve ilgili hikâyelerde korunur; bunlara bağlı geliştirme kabulü karar netleşmeden kapanmaz. Alan adı, ekip uyarı kanalı ve gerçek kurulum bilgileri Release/Ops hazırlık tablolarında izlenir; bilinmeyen değerler uydurulmaz.

Önceki öneri olan Görkem'in filosuyla yaklaşık bir aylık gerçek kullanım pilotu, ardından satış/onboarding/abonelik aşaması planlamada değerlendirilebilir; kesin teslim takvimi değildir.
