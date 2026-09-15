# Stories: Dolmuş Takip

**Tarih:** 2026-09-15 · **Yazan:** Codex · **Versiyon:** v0.3  
**Durum:** Altı epic için 35 hikâye yazıldı; açık kararlar ilgili hikâyelerde işaretli. Henüz uygulama veya test sonucu yoktur.  
**İlgili Epics:** [EPICS.md](EPICS.md)  
**Kaynaklar:** [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) · [Design](DESIGN.md) · [Tech Stack](TECH-STACK.md)  
**Şablon:** Project Blueprint / 06-stories. Kullanıcı amacı, fayda, kabul kriterleri, göreli boyut ve bağımlılıklar.

## Özet ve kapsam

Bu belge altı epic'in **35 hikâyesini** kullanıcı amacı, fayda, akış, kabul kriterleri, göreli boyut ve bağımlılıklarla ayrıntılandırır. Epic belgesindeki numaralar korunmuştur. Açık ürün tercihleri ilgili hikâyenin sınırında görünür; metnin hazır olması o kararın verilmiş veya işin uygulanmış olduğu anlamına gelmez. Ayrıntılı teknik adımlar, geliştirmeye alınacak hikâyenin iş paketinde hazırlanacaktır.

| Epic | Planlanan başlık | Burada ayrıntılandırılan | Göreli ön tahmin |
|---|---:|---:|---|
| E1 — Giriş ve yetkiler | 6 | 6 | 2 S + 4 M |
| E2 — İşletme, araç ve şoför yönetimi | 6 | 6 | 2 S + 4 M |
| E3 — Günlük kayıt ve hesap | 6 | 6 | 6 M |
| E4 — Para onayı, düzeltme ve geçmiş | 6 | 6 | 2 S + 4 M |
| E5 — Özet ve raporlar | 5 | 5 | 1 S + 4 M |
| E6 — Yayın ve işletim | 6 | 6 | 6 M |
| **Toplam** | **35** | **35** | **7 S + 28 M** |

**S** küçük, **M** orta kapsam için ilk göreli değerlendirmedir. Bunlar iş günü veya teslim tarihi taahhüdü değildir; belirsizlikler ve geliştirme kapasitesiyle yeniden değerlendirilir. Toplam gün/hafta tahmini henüz yoktur. S1.1 geliştirme temelini sağlayan bir hazırlık işidir; müşterinin göreceği yeni özellik gibi sunulmaz. S1.5’in güvenlik sonucu bütün kullanıcı akışları için ortak gereksinimdir.

### Ortak kabul kuralları

- Kutular uygulanacak ve doğrulanacak davranışlardır; boş kutu uygulamanın henüz doğrulanmadığını gösterir.
- İzinler ekranda ve sunucuda denetlenir. İsim, rol veya nesne kimliğini tarayıcıdan değiştirmek yetki kazandırmaz. İşletme ilişkileri veritabanı seviyesinde de korunur.
- E2’deki her oluşturma/düzeltme/pasifleştirme, güvenli işlem geçmişiyle birlikte tamamlanır. Aynı gönderim tekrarlanınca çoğalmaz; eski sürüm üzerinden eşzamanlı düzenleme sessizce üzerine yazmaz. Bu davranışlar ilk yönetim işlemiyle başlar; S2.5 yalnız geçmişi görünür kılar.
- Kayıt sonucu bilinmiyorsa başarı veya kesin başarısızlık ilan edilmez. Aynı işlem sonucu kontrol edilir; form başka bir işlem gibi yeniden gönderilmez. Hata halinde girilen bilgiler korunur; gizli şifre/token geçmişe veya loga yazılmaz.
- Ortak şoför seçimi kişisel kimlik kanıtı değildir. Sahip/şoför işlemleri araç ve rol oturumuyla, ekip işlemleri gerçek ekip kullanıcısıyla izlenir. Oturum temizliği eski işlem izini silmez.
- K1–K9 açık karar kodlarının kaynağı [Epics karar tablosudur](EPICS.md). Bu belgede yalnız kesin kapsamın kabulü yazılır; açık uzantıların tamamlandığı iddia edilmez.

## E1 — Giriş ve yetkiler

### S1.1 — Uygulama, migration ve otomatik kontrol temelini hazırlama (M)

**Kullanıcı / ihtiyaç:** Geliştirmeyi yürüten kişi olarak projeyi belgelenmiş adımlarla açıp çalıştırabilmek istiyorum.  
**Fayda:** Sonraki özellikleri aynı teknoloji ve veri kuralları üzerinde geliştirebilirim.  
**Akış:** Temiz geliştirme ortamı hazırlanır → bağımlılıklar kurulur → açık ilk kurulumla şema oluşturulur → uygulama ve kontroller çalıştırılır.

#### Kabul kriterleri

- [ ] Seçilen Next.js/React/TypeScript, Node.js, SQLite ve Drizzle bileşenleri için uyumlu sürümler belirlenmiş, lockfile ve çalıştırma komutları kaydedilmiştir. Seçilmiş teknoloji sağlayıcıları değişmez.
- [ ] Boş geliştirme veritabanında ilk kurulum açık bir komutla yapılır; kurulmuş veritabanının kaybolması uygulamanın sessizce boş müşteri verisiyle açılmasına yol açmaz.
- [ ] İşletme, kişi, araç, araç ataması, araç girişleri, ekip hesapları, oturum ve yönetim işlem izi için temel ilişkiler migration ile kurulabilir. Mevcut veride migration yeniden çalıştırıldığında tanımlar çoğalmaz.
- [ ] E1’i E2 ekranlarını beklemeden denemek için farklı işletmelere ait örnek araçlar, iki rolün girişleri ve ekip hesapları içeren ayrı test verisi vardır. Test verisi gerçek müşteri açma yöntemi veya canlı kurulum adımı değildir.
- [ ] Derleme, tip kontrolü ve temel veri/ilişki kontrolleri belgelenmiş komutlarla çalışır; hatalı kontrol başarı sayılmaz. Asıl özellik testleri ilgili hikâyelerde eklenir.
- [ ] Uygulama yeniden başlatıldığında test kaydı korunur. Kod/derleme çıktısı ile kalıcı verinin yeri ayrıdır; gizli bilgiler istemci çıktısına girmez.

**Bağımlılık:** Yok.  
**Referans:** [Epics](EPICS.md) E1; [PRD](PRD.md) §8; [Architecture](ARCHITECTURE.md) §2–3; [Tech Stack](TECH-STACK.md) §1–4, §9.  
**Sınır:** Hedef Linux üretim çıktısı, Lightsail kurulumu ve restore kanıtı E6’dadır. K9’un bu işi etkileyen kısmı paket uyumluluğudur; bulut veya mesaj hizmeti açılmaz.

### S1.2 — Plaka ve şifreyle araç girişini tamamlama (M)

**Kullanıcı / ihtiyaç:** Mal sahibi veya şoför olarak plakam ve bana verilen şifreyle giriş yapmak istiyorum.  
**Fayda:** Ek hesap veya rol seçimiyle uğraşmadan bana uygun ekranı açabilirim.  
**Akış:** Plaka ve şifre girilir → uygulama doğrular → sahip ya da şoför alanı açılır.

#### Kabul kriterleri

- [ ] Aktif araç ve işletmede, sahip şifresi sahip alanını; ortak şoför şifresi şoför alanını açar. Araç plakası yeni ekranda görünür. Günlük formun kendisi E3, tam rapor ekranı E5 ile tamamlanır.
- [ ] Girişte yalnız plaka ve şifre istenir. Rol seçici, kayıt ol, telefon doğrulaması veya bireysel şoför hesabı adımı bulunmaz.
- [ ] “35 abc 123” ile “35ABC123” aynı tanımlı araca karşılık gelir. Biçimi geçersiz veya eksik plaka için anlaşılır alan hatası gösterilir.
- [ ] Biçimi geçerli ama tanımsız plaka ile yanlış şifre aynı genel “Plaka veya şifre yanlış.” mesajını verir. Yanıtta mevcut rol/şifre bilgisi sızmaz.
- [ ] Ortak şoför oturumunda isim/kişi veya rol bilgisi değiştirilerek sahip yetkisi alınamaz. Pasif araç ya da işletme yeni yetkili giriş oluşturamaz.
- [ ] Tekrarlı hatalı denemeler mimarideki geçici hız sınırına tabidir; kalıcı hesap kilidi uygulanmaz. Bekleme gerektiren durumda anlaşılır mesaj çıkar, teknik hata ayrıntısı gösterilmez.
- [ ] Şifre yapıştırma, parola yöneticisi ve girilen şifre için Göster/Gizle çalışır. Başarı kesinleşmeden ilgili alana girilmiş gibi gösterilmez.

**Bağımlılık:** S1.4, S1.5.  
**Referans:** [PRD](PRD.md) §2, §6, §9: 16, 18, 22; [Architecture](ARCHITECTURE.md) §1.1, §4, §6; [Design](DESIGN.md) §2.1.  
**Açık sınır:** K1 şoförün sonradan göreceği kayıtları, K2 sahibin diğer araç erişimini belirler. Burada tek plakanın girişi tamamlanır; diğer araçlara otomatik izin eklenmez. İlk gerçek araç E2’de açılır; bu hikâye önce test verisiyle doğrulanabilir.

### S1.3 — Kişisel ekip girişi ve ilk yönetici kurulumu (S)

**Kullanıcı / ihtiyaç:** Platform ekibinin bir üyesi olarak kişisel hesabımla yönetim alanına girmek istiyorum.  
**Fayda:** Müşterinin şifresini kullanmadan yardımcı olabilir ve işlemlerimin bana ait olduğu görülebilir.  
**Akış:** İlk yönetici kontrollü kurulumla oluşturulur → ekip giriş ekranına kullanıcı adı/şifre girilir → yetkili yönetim alanı açılır.

#### Kabul kriterleri

- [ ] İlk platform yöneticisi yalnız yetkili kurulum erişimiyle oluşturulabilir; herkese açık yönetici kayıt ekranı veya endpoint’i bulunmaz.
- [ ] İlk yönetici kurulumunun tekrar çalıştırılması hesabı çoğaltmaz veya mevcut şifre/yetkisini sessizce değiştirmez; mevcut durumu bildirir.
- [ ] Aktif ekip hesabının geçerli kullanıcı adı ve şifresi yönetim alanını açar; çalışan ekip kullanıcısının kimliği ekranda görünür.
- [ ] Araç sahibi veya ortak şoför şifresi ekip girişi yerine geçmez. Geçersiz giriş kullanıcı adının varlığını ifşa etmeden genel hata verir ve hız sınırına tabidir.
- [ ] Ekip oturumu müşteri kişi kaydından ayrıdır; yönetici/destek yetkisi doğrulanmış ekip hesabından gelir. Tarayıcının gönderdiği yetki esas alınmaz.
- [ ] Oturum açmanın başarı/başarısızlık durumları açıktır; parola veya oturum sırrı ekranda, adreste ve işlem geçmişinde gösterilmez.

**Bağımlılık:** S1.4, S1.5.  
**Referans:** [PRD](PRD.md) §2, §6, §8, §9: 22; [Architecture](ARCHITECTURE.md) §1.1, §2, §6; [Design](DESIGN.md) §2.1, §2.9.  
**Sınır:** Sonraki ekip hesapları S2.6’da yönetilir. K9’daki ilk şifre teslim yöntemi ayrıca netleşir; otomatik davet/SMS/e-posta eklenmez.

### S1.4 — Sunucu oturumu, çıkış ve erişim iptali (M)

**Kullanıcı / ihtiyaç:** Kullanıcı veya ekip üyesi olarak oturumumu kapatabilmek ve iptal edilmiş erişimin yeniden kullanılmamasını istiyorum.  
**Fayda:** Eski giriş bilgileriyle yetkisiz işlemler yapılamaz.  
**Akış:** Geçerli oturumla işlem yapılır → çıkış, süre sonu veya yetkili erişim değişikliği olur → sonraki istek giriş/yetki kontrolüne takılır.

#### Kabul kriterleri

- [ ] Her başarılı girişte yeni sunucu oturumu oluşturulur. Oturumun süresi ve aktifliği sunucuda denetlenir; sayfayı yenilemek yetkiyi değiştirmez.
- [ ] Çıkış sonrası eski oturumla API isteği yapılamaz. Ortak telefonda başka kullanıcı/araçla giriş yapılınca önceki müşterinin geçici form ve verisi yeni ekrana taşınmaz.
- [ ] Araç/işletme pasifliği, ilgili rolün şifre sıfırlaması veya ekip hesabının pasifleştirilmesi mevcut oturumları etkiler. Yeniden aktifleştirmek önceden iptal edilmiş oturumu diriltmez; yeni giriş gerekir.
- [ ] Araç şifresi sıfırlaması yalnız ilgili rolün girişlerini iptal eder; diğer rolün şifresi değişmez. Yönetim ekranından yapılan gerçek sıfırlamayla birlikte doğrulama S2.3’te tamamlanır.
- [ ] Ekip yetkisi değiştirildiğinde sonraki istekte güncel yetki uygulanır; eski oturum eski yönetici hakkını kullanamaz. Bu değişikliği yapma ekranı S2.6’dadır.
- [ ] Mimari §6’daki araç/ekip oturum süresi ve hareketsizlik sınırları zaman kontrollü testle doğrulanır. Süre bittiğinde “Oturumun sona erdi. Yeniden giriş yap.” gösterilir; kaydedilmemiş form başarı sayılmaz.
- [ ] Cookie/oturum sırrı URL veya uygulamanın localStorage alanında tutulmaz; gizli veriye erişim ve yazma isteği kaynağı kontrolleri uygulanır. Geçersiz kaynak/tokenla yazma isteği veri değiştirmez.

**Bağımlılık:** S1.1.  
**Referans:** [PRD](PRD.md) §8, §9: 12, 18; [Architecture](ARCHITECTURE.md) §3.2, §4–6; [Design](DESIGN.md) §2.10.  
**Sınır:** E1’de iptal davranışı test düzenekleriyle sınanır; yönetim ekranlarının tamamını bekleme bağımlılığı yoktur. S2.2/S2.3/S2.6 aynı davranışı gerçek kullanıcı işlemleriyle birleştirir.

### S1.5 — İşletme/araç kapsamı ve işlem yetkilerini uygulama (M)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak hesabımın başka işletmelerden ayrılmasını; ekip üyesi olarak yalnız yetkim dahilindeki işlemleri yapabilmeyi istiyorum.  
**Fayda:** Başka aracın hesabı görülmez veya yanlışlıkla değiştirilmez.  
**Akış:** Kullanıcı bir kayıt/işlem ister → uygulama oturum ve hedefi doğrular → izinli sonucu verir veya değişiklik yapmadan reddeder.

#### Kabul kriterleri

- [ ] Aynı ve farklı işletmelere ait test araçlarıyla, izin verilmeyen araç/kişi ID’si doğrudan gönderildiğinde okuma/yazma reddedilir. Ekrandaki seçeneği gizlemek tek koruma değildir.
- [ ] İstemciden gelen işletme, rol veya kişi alanı erişim kapsamını genişletmez. Şoförün ad seçimi araç oturumunu sahip hesabına dönüştürmez.
- [ ] Sunucunun işlem yetkisi, Architecture §2’deki matrise uyar: şoför sahip/ekip yönetimi ve para onayı yetkisi alamaz; sıradan ekip kullanıcı yönetimi yetkisi alamaz.
- [ ] Aynı işletmede farklı araçlar bulunması, bir plakanın sahibine diğer araçları kendiliğinden açmaz. K2 kararı gelmeden geniş araç listesi veya erişimi verilmez.
- [ ] Ekip destek işlemi doğrulanmış işletme/araç hedefiyle çalışır. Hedefle çelişen kişi/araç ilişkisi uygulamada reddedilir; başka işletmeye ait ilişkiyi DB’ye yazma denemesi de başarısız olur.
- [ ] Oturum yokluğu, işlem yetkisi yokluğu ve kapsam dışı nesne yanıtları mimarideki hata sözleşmesine uyar; başka müşterinin içeriği veya gizli kimlik verisi hata mesajına girmez.
- [ ] Yetki kontrolü tekrar gönderim sonucu okunurken ve yazmanın tamamlandığı noktada da korunur. Arada erişimi iptal edilen kullanıcı eski başarılı işlem yanıtını kullanarak yeni yetki kazanamaz.

**Bağımlılık:** S1.4.  
**Referans:** [PRD](PRD.md) §2, §8, §9: 12, 16–18, 22, 28; [Architecture](ARCHITECTURE.md) §2, §3.1–3.4, §4, §6.  
**Açık sınır:** K1 ve K2. Ortak şoför için “yalnız kendi kişisel kayıtlarını görür” güvencesi verilmez. E3–E5 endpoint’leri eklendikçe aynı matris ve doğrudan erişim testleri genişletilir; bu hikâye onların uygulanmış olduğunu iddia etmez.

### S1.6 — Telefon girişindeki hata, bekleme ve erişilebilirlik durumları (S)

**Kullanıcı / ihtiyaç:** Telefon kullanırken zorlanan biri olarak giriş formunu rahat okuyup hatamı anlayabilmek istiyorum.  
**Fayda:** Yardım almadan doğru alana girebilirim.  
**Akış:** Form açılır → alanlar doldurulur → bekleme, hata veya başarı açık metinle gösterilir.

#### Kabul kriterleri

- [ ] Araç ve ekip girişleri 320 px genişlikte yatay kaydırmadan kullanılabilir; etiketler alan üzerinde kalır, Türkçe karakterler ve uzun metinler kesilmez.
- [ ] Mavi-beyaz görünüm, okunur sistem fontu ve Design §3’teki kontrast/ölçü hedefleri uygulanır; giriş alanı en az 48 px, ana düğme en az 56 px yüksekliktedir.
- [ ] Klavye ile alanlara/düğmelere ulaşılır; odak görünür ve ekran klavyesi önemli alanı kalıcı olarak kapatmaz. %200 yakınlaştırmada temel işlem kullanılabilir.
- [ ] Boş/geçersiz alan hatası ilgili alana bağlı görünür; ilk hatalı alana ulaşılabilir. Yanlış şifre mesajı rol veya plakanın varlığını açıklamaz; girilen plaka korunur.
- [ ] İstek sürerken “Giriş yapılıyor…” gösterilir ve tekrarlı dokunma paralel girişler başlatmaz. Başarı/hata ekran okuyucuya da bildirilir; yalnız renk kullanılmaz.
- [ ] Bağlantı yokluğu veya sunucu hatası başarılı giriş gibi gösterilmez. Bağlantı yeniden geldiğinde kullanıcı anlaşılır biçimde tekrar deneyebilir; teknik yığın izi gösterilmez.
- [ ] Kayıt ol/uygulama indir zorunluluğu veya yeni kurtarma hizmeti yoktur. “Giriş yapamıyorsan hesabını açan ekipten yardım al.” metni görünür.

**Bağımlılık:** S1.2, S1.3.  
**Referans:** [PRD](PRD.md) §6, §9: 1; [Design](DESIGN.md) §2.1, §2.10, §3.  
**Sınır:** Bu kontroller giriş içindir. Günlük para formunun kullanılabilirliği S3.6’da, yönetim formları ilgili E2 hikâyelerinde doğrulanır.

## E2 — İşletme, araç ve şoför yönetimi

### S2.1 — İşletme ve mal sahibi tanımlama (S)

**Kullanıcı / ihtiyaç:** Yetkili ekip üyesi olarak işletmeyi ve sahibini tanımlamak istiyorum.  
**Fayda:** Açacağımız araç doğru müşteriye bağlı olur.  
**Akış:** İşletme açılır → işletme adı ve sahibin ad-soyadı girilir ya da yetkili kapsamda mevcut kişi seçilir → kaydedilen işletme/sahip ilişkisi gösterilir.

#### Kabul kriterleri

- [ ] İşletme/sahip oluşturma ve yönetimi yalnız yetkili ekibe açıktır; araç sahibi veya şoför oturumu doğrudan istekte bulunsa da işlem yapamaz.
- [ ] İşletme adı ve sahibin ad-soyadı açık etiketlerle alınır. Zorunlu bilgi eksik/geçersizse ilgili alanda neden gösterilir; diğer bilgiler kaybolmaz.
- [ ] Sahip, ayrı bireysel giriş üyeliği yerine sabit kişi kaydıyla tutulur. İşletme ve kişi ilişkisi sunucuda doğrulanır; başka işletmenin kişi ID’si bu ilişkiye atanamaz.
- [ ] Yeni işletme ve yeni sahibi birlikte kaydeden akış ya tamamen başarılıdır ya eski durumu korur; hata kullanılabilir yarım müşteri tanımı bırakmaz. Tekrar gönderim ikinci işletme/kişi üretmez.
- [ ] Aynı adlı kişiler kendiliğinden birleştirilmez. Mevcut kişi seçimi görünür kayda dayanır; ad eşitliği kimlik sayılmaz. İsim düzeltmesi mevcut kişinin kimliğini değiştirmez.
- [ ] İşletme pasife alınırken bağlı araç erişimlerine etkisi açıkça gösterilir ve bu erişimler kesilir. Yeniden aktifleştirme geçmiş mali kayıtları değiştirmez veya iptal edilmiş oturumları yeniden açmaz.
- [ ] Oluşturma/düzeltme/aktiflik değişikliği hedef, gerçek ekip kullanıcısı, zaman ve güvenli önce/sonra bilgisiyle saklanır. Başarılı kaydın adı ve ilişkisi yeniden açıldığında korunur.

**Bağımlılık:** S1.3, S1.5.  
**Referans:** [PRD](PRD.md) §2, §6–8, §9: 2, 28; [Architecture](ARCHITECTURE.md) §3.1–3.2, §4; [Design](DESIGN.md) §2.9.  
**Açık sınır:** K8 ortak sahiplik/devir. Bu hikâye müşterileri veya farklı işletmelerdeki kişileri birleştiren bir işlem eklemez.

### S2.2 — Araç oluşturma, bilgi düzenleme ve aktiflik (M)

**Kullanıcı / ihtiyaç:** Yetkili ekip üyesi olarak aracı doğru işletmeye ve sahibine bağlamak istiyorum.  
**Fayda:** Müşteri kendi plakasıyla doğru araç hesabını kullanabilir.  
**Akış:** İşletme/sahip seçilir → plaka ve araç bilgileriyle iki farklı şifre girilir → araç kaydedilir → gerektiğinde bilgileri veya aktifliği düzenlenir.

#### Kabul kriterleri

- [ ] İşletme, sahip ve plaka formda açıkça görünür. İlişki başka işletmeye aitse işlem reddedilir. Kaydedilen aracın sabit kimliği plaka metninden ayrıdır.
- [ ] Plaka normalize edilerek platform genelinde benzersiz tutulur. Aynı plakanın boşluk/küçük harf farkıyla ikinci araç olarak açılması alan hatasıyla engellenir.
- [ ] Marka/model, yıl, hat/durak, not ve aktiflik alanları görüntülenip düzenlenebilir. Eski sürümle gönderilen eşzamanlı değişiklik yeni değerleri sessizce ezmez.
- [ ] İlk araç açılışında mal sahibi ve ortak şoför şifresi ayrı etiketli alanlarda belirlenir; aynı şifre kabul edilmez. Araç ve iki rolün giriş bilgileri birlikte hazırlanır; hata eksik şifre ilişkisiyle kullanılabilir araç bırakmaz.
- [ ] Oluşturulan aktif araç iki şifreyle S1.2’deki doğru alanları açar. Pasife alma giriş ve müşteri yazma erişimini keser; eski çalışma, onay, kişi ilişkisi ve geçmiş silinmez.
- [ ] Pasif araç ekip tarafından tanımlama/aktiflik amacıyla bulunabilir. Yeniden aktifleşmesi eski mali kayıtları değiştirmez ve iptal edilmiş oturumları canlandırmaz.
- [ ] Araç düzenlemesi gerçek ekip kullanıcısı, hedef ve önce/sonra bilgisiyle izlenir. Mevcut aracın işletme/sahibini değiştirmek sıradan metin düzeltmesi gibi sessiz devir oluşturmaz.

**Bağımlılık:** S2.1, S1.2, S1.4.  
**Referans:** [PRD](PRD.md) §2, §6, §8, §9: 2, 23, 28; [Architecture](ARCHITECTURE.md) §1.1, §3.1–3.2, §4, §6; [Design](DESIGN.md) §2.9.  
**Açık sınır:** K2 sahibin araç bilgisi düzenleme hakkı; K8 devir. İlk şifre atama bu akışta, sonradan sıfırlama S2.3’tedir. İki şifrenin farklılığı için ortak doğrulama kullanılır; S2.2/S2.3 birbirini bekleyen bir geliştirme döngüsü oluşturmaz.

### S2.3 — Araç şifrelerini belirleme ve sıfırlama (S)

**Kullanıcı / ihtiyaç:** Yetkili ekip üyesi olarak sahip ve ortak şoför erişimini ayrı ayrı değiştirebilmek istiyorum.  
**Fayda:** Kullanıcı yeniden giriş yapabilir; eski şifreyle yetkisiz erişim sürmez.  
**Akış:** Araç açılır → değiştirilecek erişim seçilir → yeni şifre girilir → değişiklik ve eski oturumların kapanması bildirilir.

#### Kabul kriterleri

- [ ] İşlem ekranında işletme, plaka ve “Mal sahibi şifresi / Şoför şifresi” ayrımı görünür. Yalnız yetkili ekip değiştirebilir; müşteri oturumları doğrudan API’den değiştiremez.
- [ ] Mevcut şifre görüntülenmez. Yeni şifre, diğer rolün mevcut şifresiyle aynı olamaz; salt nedeniyle iki hash’in farklı çıkması şifrelerin farklı olduğuna kanıt sayılmaz.
- [ ] Şifre güvenli parola yöntemiyle saklanır; eski/yeni parola, hash veya oturum sırrı yanıt, log ve işlem geçmişinde bulunmaz.
- [ ] Sahip şifresi değişince o aracın mevcut sahip oturumları kapanır; şoför şifresi değişince ortak şoför oturumları kapanır. Eski şifre ve iptal edilmiş oturum yeni istekte kullanılamaz; diğer rolün şifresi kendiliğinden değişmez.
- [ ] Şifre güncellemesi, ilgili oturum iptali ve işlem izi birlikte tamamlanır. Kesin başarısızlıkta eski tam durum korunur; belirsiz yanıtta aynı işlem sonucu kontrol edilir, ikinci bir sıfırlama varsayılmaz.
- [ ] Sonuçta hangi araç/erişimin değiştirildiği anlaşılır. Gerçek ekip kullanıcısı ve zaman geçmişe girer; şifrenin kendisi girmez.

**Bağımlılık:** S2.2, S1.4.  
**Referans:** [PRD](PRD.md) §6, §8, §9: 18, 23; [Architecture](ARCHITECTURE.md) §4, §6; [Design](DESIGN.md) §2.9.  
**Açık sınır:** K9 şifrenin müşteriye teslim yöntemi. Bu hikâye SMS/e-posta göndermez. İlk araçtaki iki şifrenin oluşturulması S2.2’nin kabulü içindedir.

### S2.4 — Şoförlerim, sabit kişi ve araç atamaları (M)

**Kullanıcı / ihtiyaç:** Mal sahibi veya yetkili ekip üyesi olarak araçta çalışabilecek kişileri tanımlamak istiyorum.  
**Fayda:** Şoför listeden doğru kişiyi seçer; adı düzelse bile raporları bölünmez.  
**Akış:** Yetkili aracın şoför listesi açılır → yeni kişi eklenir veya mevcut kişi atanır → gerektiğinde adı ya da araçtaki aktifliği değiştirilir.

#### Kabul kriterleri

- [ ] Sahip yalnız yetkili araçtaki listeyi yönetir; ekip açık işletme/araç hedefiyle çalışır. Ortak şoför oturumu seçilebilir listeyi okuyabilir fakat şoför ekleyemez, ad/atama değiştiremez.
- [ ] Yeni kişinin ad-soyadı sabit kimlikle kaydedilir. Mevcut kişi yeni araca atanırken ikinci kişi oluşturulmaz; aynı kişi/araç ilişkisi tekrar kaydetmeyle çoğalmaz.
- [ ] Aynı adlı farklı kişiler ayrı kalır. Arama yalnız yetkili kişi kapsamını gösterir; isim eşleşmesi otomatik birleştirme yapmaz. Ulusal kimlik bilgisi veya bireysel şoför giriş hesabı istenmez.
- [ ] İsim düzeltmesi aynı kişi kimliğini korur. Eski kayıtlarla ilişki kopmaz; “Bu kişinin eski kayıtları da yeni adıyla görünür.” açıklaması vardır. Nihai kişi raporu E5’te de aynı örnekle sınanır.
- [ ] “Bu araçta pasife al” yalnız seçili araç atamasını kapatır. Başka araçtaki atamalar ve işletme genelindeki kişi aktifliği değişmez. Pasif kişi/atama yeni çalışma seçicisinden çıkar; geçmiş silinmez ve aynı atama yeniden etkinleştirilebilir.
- [ ] Kişinin işletme genelindeki aktifliğini yalnız yetkili ekip değiştirebilir; etkilenen araçlar görünür. Sadece sahip oturumuyla bu genel işlem yapılamaz. Pasif kişinin eski kaydı görünmeye devam eder.
- [ ] Araç sahibi şoför seçeneklerine eklenmez; kendi sürüşü ayrı sahip akışındadır. Aktif şoför yoksa “Bu araç için şoför eklenmemiş.” durumu anlaşılır gösterilir; isim yazarak çalışma oluşturma yolu açılmaz.
- [ ] Ad/atama değişikliğinin aktörü, hedefi ve önce/sonra değerleri korunur; eski sürümle gelen ikinci düzenleme ilkini sessizce ezmez. Ekip işlemi müşteri yapmış gibi gösterilmez.

**Bağımlılık:** S2.2, S1.5.  
**Referans:** [PRD](PRD.md) §2, §5–8, §9: 19, 24, 28; [Architecture](ARCHITECTURE.md) §2, §3.1–3.3; [Design](DESIGN.md) §2.2, §2.8–2.9.  
**Açık sınır:** K2. Mevcut kişiyi bulmak başka araçların mali kayıtlarını açma yetkisi vermez. E2’de liste/kimlik/ilişki kontrolleri yapılır; yeni günlük form E3 ve tam rapor görünümü E5 ile birleşir.

### S2.5 — Yönetimde müşteri hedefi ve tanımlama işlem geçmişi (M)

**Kullanıcı / ihtiyaç:** Ekip üyesi olarak hangi müşteriye yardım ettiğimi ve daha önce ne değiştirildiğini görmek istiyorum.  
**Fayda:** Doğru araçta işlem yapar, bir değişikliğin kaynağını anlayabilirim.  
**Akış:** Plaka/işletme aranır → hedef seçilir → müşteri bağlamı görünür → mevcut tanımlama işlemleri ve geçmişi açılır.

#### Kabul kriterleri

- [ ] Plaka veya işletme aramasında işletme, araç, sahip ve aktiflik birlikte görünür; sonuç yokluğu, yükleme ve sorgu hatası ayrı gösterilir. Liste büyüdüğünde sayfalı okunabilir.
- [ ] Destek sayfasında hedef işletme, plaka, sahip ve gerçek ekip kullanıcısı görünür. Başka işletmeye ait kişi/kayıt ID’siyle işlem denendiğinde sunucu reddeder.
- [ ] Dolu form varken hedef değiştirme, kaydedilmemiş değişikliği bırakma tercihini sorar. İptal edilirse eski form/bağlam korunur; devam edilirse form yeni müşteriye taşınmaz. Her normal işlem için ek destek talebi/onay ekranı gerekmez.
- [ ] Tanımlama geçmişinde işlem türü, hedef, zaman, aktör ve önce/sonra değerler bulunur. Oluşturmada önceki değerin olmadığı anlaşılır; geçmişi düzenleme/silme işlemi yoktur.
- [ ] Ekip işlemi gerçek ekip kimliğiyle; araç sahibi işlemi araç/rol oturumuyla gösterilir. Ortak şifre kullanan gerçek kişinin kimliği doğrulanmış gibi sunulmaz.
- [ ] Parola/hash/cookie/token geçmişte görünmez. Oturumlar temizlense bile aktör izi kaybolmaz. Yetkisiz müşteri/şoför oturumu platform geçmişini okuyamaz.
- [ ] S2.1–S2.4’te yapılan örnek tanımlama değişiklikleri geçmişte bulunur; tekrar gönderim tek işlemin geçmişini çoğaltmaz. Günlük kayıt, para onayı ve raporlar E3/E4/E5 tamamlanmadan çalışıyormuş gibi gösterilmez.

**Bağımlılık:** S2.1, S2.2, S2.3, S2.4.  
**Referans:** [PRD](PRD.md) §6–8, §9: 24, 28; [Architecture](ARCHITECTURE.md) §2, §3.2, §4, §6; [Design](DESIGN.md) §2.9–2.10.  
**Sınır:** Audit yazımı bu hikâyeyi beklemez; ilgili tanımlama işlemiyle birlikte geliştirilir. Ekip hesabı geçmişi S2.6’nın ek kabulünde bu görünümle doğrulanır. K2/K8 kapsamında yeni erişim/devir akışı açılmaz.

### S2.6 — Kişisel ekip hesabı ve yetki yönetimi (M)

**Kullanıcı / ihtiyaç:** Platform yöneticisi olarak ekip hesaplarını ve erişimlerini yönetmek istiyorum.  
**Fayda:** Destek işleri kişisel, izlenebilir ve gerektiğinde kapatılabilir hesaplarla yürür.  
**Akış:** Ekip listesi açılır → kişi için hesap/yetki tanımlanır → gerektiğinde yetki, aktiflik veya şifre değiştirilir.

#### Kabul kriterleri

- [ ] Ekip hesabı listeleme/oluşturma/yetki/aktiflik/sıfırlama işlemleri yalnız platform yöneticisine açıktır. Sıradan ekip, sahip ve şoför doğrudan istek gönderse de yapamaz.
- [ ] Hesap, kişisel ve benzersiz kullanıcı adıyla oluşturulur; mevcut kullanıcı adına ikinci hesap açma reddedilir. Araç veya ortak şoför şifresi ekip hesabı olarak kullanılmaz.
- [ ] Yetki doğrulanmış yönetici işlemiyle atanır. İstemci alanlarını değiştirerek yetki yükseltilemez; mimarideki yönetici/destek ayrımına yeni rol hiyerarşisi eklenmez.
- [ ] Pasife alma ve parola sıfırlama eski ekip oturumlarını geçersiz kılar. Yetki azaltıldığında sonraki istekte yeni sınır uygulanır; eski yönetici oturumu haklarını sürdüremez.
- [ ] Mevcut şifre/hash gösterilmez; yeni şifre E1’in güvenli yöntemiyle saklanır. Başarısız işlem hesap ve izinleri kısmen güncellemiş bırakmaz.
- [ ] Hesap/şifre/yetki değişikliğinde işlemi yapan yönetici, hedef ekip kullanıcısı, zaman ve gizli değer içermeyen önce/sonra izi S2.5’te görülebilir. Geçmiş, ekip hesabı pasifleşince kaybolmaz.
- [ ] İlk yönetici kurulumu S1.3’te kalır. Halka açık ekip kaydı, otomatik davet veya müşteri bildirim hizmeti eklenmez.

**Bağımlılık:** S1.3, S1.4, S1.5, S2.5.  
**Referans:** [PRD](PRD.md) §6–8, §9: 22; [Architecture](ARCHITECTURE.md) §1.1, §2, §4, §6; [Design](DESIGN.md) §2.9.  
**Açık sınır:** K9 ekip şifresinin teslim yöntemi. Kişisel ekip hesapları müşterinin şoför kişi listesiyle birleştirilmez.

## E3 — Günlük kayıt ve hesap

### S3.1 — Aktif kişi, tarih ve saatlerle günlük form (M)

**Kullanıcı / ihtiyaç:** Şoför olarak hangi gün ve saatler arasında çalıştığımı kendi adımla kaydetmek istiyorum.  
**Fayda:** Çalışma sürem doğru kişiye yazılır; toplam saati kendim hesaplamam gerekmez.  
**Akış:** Günlük form açılır → ad seçilir → hazır tarih kontrol edilir → başlangıç/bitiş seçilir → süre görülür.

#### Kabul kriterleri

- [ ] Giriş yapılan plaka sabit görünür; tarih bugün hazır gelir ve değiştirilebilir. Çalışma tarihi gün/ay/yıl olarak açıkça gösterilir; sunucunun kayıt zamanı bunun yerine geçmez.
- [ ] Kişi alanı “Adını seç” ile açılır; yalnız araçtaki aktif, seçilebilir şoförler bulunur. Ortak telefonda önceki şoför otomatik seçilmez; serbest isim veya kimlik numarası istenmez.
- [ ] Listede kişi yoksa mal sahibinden ad eklemesini isteyen açıklama gösterilir. Listeyi alamamak boş şoför listesi gibi sunulmaz; hatalı durumda yeniden deneme mümkündür.
- [ ] Başlangıç ve bitiş seçilir, toplam dakika otomatik hesaplanır. Aynı gün 08:00–17:30 arası 9 saat 30 dakika gösterilir; süre elle girilmez.
- [ ] Eksik kişi, geçersiz takvim tarihi veya saat alanı ilgili yerde açıklanır; eksik form geçerli süre göstermez. Girilen diğer alanlar korunur.
- [ ] Form açıkken kişi/araç erişimi pasifleştirilirse kaydetme anında güncel durum denetlenir. İstemcide kalan eski liste yeni çalışma açma hakkı vermez.
- [ ] Aynı gün aynı araç/kişi için ikinci gerçek çalışma açılabilir; tarih alanı önceki kaydı değiştirme anahtarı olarak kullanılmaz. Kalıcı iki kaydın doğrulaması S3.4 ile tamamlanır.

**Bağımlılık:** S1.2, S1.5, S2.2, S2.4.  
**Referans:** [PRD](PRD.md) §3, §5, §9: 2–3, 9, 13; [Architecture](ARCHITECTURE.md) §1.2, §3.3; [Design](DESIGN.md) §2.2.  
**Açık sınır:** K3: gece geçişi, eşit saatler ve süre sınırları. Bu durumlar karara bağlanmadan sessizce aynı gün veya 24 saat kabul edilmez; aynı günün açık zaman örneği kesin kapsamdır. Gece desteğinin son kabulü K3 kararını gerektirir.

### S3.2 — Para girdileri, otomatik pay/kalan ve sunucu hesapları (M)

**Kullanıcı / ihtiyaç:** Çalışan kişi olarak topladığım parayı ve masrafları yazınca payı ve kalanı görmek istiyorum.  
**Fayda:** Gün sonu hesabını elle hesaplamak zorunda kalmam.
**Akış:** Hasılat ve mazot girilir → varsa diğer masraf eklenir → hesap özeti Kaydet'ten önce görünür → sunucu hesapları yeniden doğrular.

#### Kabul kriterleri

- [ ] Hasılat ve mazot zorunludur; açıkça girilmiş 0 kabul edilir, boş zorunlu alan sıfır sayılmaz. Diğer masraf isteğe bağlıdır; kullanılmazsa 0'dır. Dolu masraf bölümü kapatılırken tutar sessizce kaybolmaz.
- [ ] Tutarlar TL/kuruş etiketiyle girilir. Türkçe para gösterimi ve ondalık girdi kayıpsız kuruşa çevrilir; geçersiz biçim, negatif girdi, kuruştan fazla hassasiyet ve veri tipi sınırı aşımı açıklanır. Sessiz kesme veya kayan noktalı para çarpımı yapılmaz.
- [ ] Şoförün 10.000 TL hasılat, 1.500 TL mazot ve 300 TL masrafı için pay 2.000 TL, beklenen teslim 6.200 TL görünür. Pay hasılatın brüt %20'sidir; gider çıkarıldıktan sonra hesaplanmaz.
- [ ] Sahibin kendi çalışmasında aynı girdiler pay 0, kalan 8.200 TL üretir. Hesap çalışma türü ve doğrulanmış kişiye dayanır; kaydı giren hesabın rolü tek başına oranı değiştirmez.
- [ ] Özet Kaydet'ten önce okunabilir; hesaplanan pay ve kalan elle düzenlenmez. Eksik/geçersiz girdi tamamlanmadan “—” gösterilir; yanlış kesin toplam sunulmaz.
- [ ] Sunucu süreyi, payı ve kalanı girdilerden hesaplar; değiştirilmiş istemci toplamını esas almaz. Kuruş tam sayı hesabı, yarım yukarı yuvarlama, kural sürümü ve kullanılan oran korunur. Örneğin 0,03 TL brüt şoför hasılatının payı 0,01 TL'dir.
- [ ] Negatif hesaplanan kalan sıfıra çevrilmez: 10.000 TL hasılat, 9.000 TL toplam gider ve 2.000 TL pay matematiksel olarak −1.000 TL verir. Bu durumun kayıt/teslim ekranındaki son akışı K5 ile tamamlanır; otomatik borç kaydı üretilmez.

**Bağımlılık:** S3.1.  
**Referans:** [PRD](PRD.md) §3–4, §9: 4, 7–8, 17; [Architecture](ARCHITECTURE.md) §3.3; [Design](DESIGN.md) §2.2, §2.4.  
**Açık sınır:** K5 negatif kalan akışı; K6 masraf kalemi/kategorisi ve bağımsız sahip giderleri. Günlük isteğe bağlı masraf kesindir; tek tutar/not başlangıç önerisi bu belgeyle yeni kesin karara dönüştürülmez. Hesaplanan kalan net işletme kârı veya banka bakiyesi diye adlandırılmaz.

### S3.3 — Sahip çalışması ve müşteri adına kayıt (M)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak kendi çalışmamı veya şoför adına bir çalışmayı; ekip üyesi olarak müşteri adına aynı kaydı girmek istiyorum.  
**Fayda:** Telefon kullanımında zorlanan kişiye yardımcı olurken hesabın gerçek çalışana ait kalmasını sağlarım.  
**Akış:** Sahip çalışma türünü seçer veya ekip önce hedef aracı açar → çalışan kişi doğrulanır → ortak günlük form doldurulur → tek Kaydet kullanılır.

#### Kabul kriterleri

- [ ] Sahip alanında “Kendim çalıştım” tanımlı sahip kişisini gösterir; pay 0'dır. “Şoför adına” seçimi aktif şoför listesini açar ve pay %20 olur. Kullanıcıya ayrı oran ayarı sunulmaz.
- [ ] Sahip başka şoför adına girdiğinde çalışma/saat/hasılat seçilen şoföre bağlanır; kaydı giren sahip oturumu ayrıca izlenir. Sahip oturumu bütün çalışmaları kendi üzerine veya sıfır payla yazamaz.
- [ ] Ortak şoför oturumu “Kendim çalıştım” sahip akışına erişemez. Sunucuya sahip türü veya sahip kişi ID'si göndererek sıfır paylı çalışma oluşturamaz; araç sahibi normal şoför listesinde seçilebilir kişi değildir.
- [ ] Ekip kendi hesabıyla doğrulanmış işletme/araç ekranından her iki çalışma türünü girebilir. Hedef plaka, işletme ve adına çalışılan kişi görünür; müşterinin şifresiyle giriş veya ayrı destek talebi gerekmez.
- [ ] Destek kaydında gerçek ekip kullanıcısı, hedef ve kim adına işlem yaptığı saklanır. Hedefle çelişen kişi/araç ilişkisi veri yazmadan reddedilir; müşteri kendi girmiş gibi işlem izi oluşturulmaz.
- [ ] Sahibin kendi çalışmasının sonucu “Kaydedildi — onay gerekmiyor” olur; teslim alacağı tutar girişi veya “Parayı aldım” işlemi çıkmaz. Çalışmanın saati/hasılatı saklanır; rapor görünümü S5.3 ile tamamlanır.
- [ ] Sahip ve ekip, şoförle aynı tarih/para/süre kontrollerini kullanır. S3.4 tamamlandığında bu üç aktörün kaydı da aynı kalıcılık, revizyon ve tekrar gönderim kontrollerinden geçer.

**Bağımlılık:** S3.2, S2.5.  
**Referans:** [PRD](PRD.md) §2–4, §6–8, §9: 7–8, 25, 28; [Architecture](ARCHITECTURE.md) §2, §3.3; [Design](DESIGN.md) §2.4, §2.9.  
**Sınır:** K2/K8 kararı olmadan başka araç erişimi veya sahiplik devri eklenmez. Bu hikâye kayıt formundaki aktör/tür ayrımıdır; para teslimini ekip adına doğrulama S4.5'tedir.

### S3.4 — Kalıcı kayıt, ilk revizyon ve tekrar gönderim koruması (M)

**Kullanıcı / ihtiyaç:** Günlük hesabı giren kişi olarak Kaydet dediğimde verimin korunmasını ve tekrar denemede çoğalmamasını istiyorum.  
**Fayda:** Bağlantı veya telefon sorunu hesabı bozmaz; kaydın ilk hâli de izlenebilir.  
**Akış:** Doğrulanmış form gönderilir → sunucu yetki/hesabı denetler → kayıt ve işlem izi birlikte saklanır → kesin sonuç gösterilir.

#### Kabul kriterleri

- [ ] Tek Kaydet, güncel çalışma kaydı, ilk revizyon, kullanılan oran/kural ve tekrar gönderim sonucunu birlikte yazar; ekip işleminde destek izi de aynı işlem içindedir. Başarı yalnız tamamı kalıcı kayda geçtikten sonra döner.
- [ ] İlk şoför çalışması “Henüz doğrulanmadı”, sahip çalışması “Onay gerekmiyor” durumundadır; ikisi de para onayı yaratmaz. Başarılı kayıt, yetkili sahip listesi ve raporlama sorguları tarafından okunabilir.
- [ ] Aynı gönderim kimliği ve aynı içerikle 100 tekrar tek çalışma üretir. Kalıcı kayıt tamamlandıktan sonra yanıtın kaybolduğu denemede de aynı kimlikle tekrar, önceki kayıt sonucuna ulaşır; ikinci kayıt/revizyon oluşturmaz.
- [ ] Aynı gönderim kimliği farklı içerikle kullanılırsa çakışma bildirilir. Sonucu belirsiz gönderimin içeriği/kimliği korunur; sonuç çözülmeden değiştirilmiş form yeni çalışma olarak gönderilmez. Bulunan başarılı kayıt gerekirse düzenleme akışına alınır.
- [ ] Ayrı iki gerçek çalışma ayrı işlem kimlikleriyle aynı tarih/kişi/araç altında saklanır; biri diğerini ezmez. Önceki işlemin yeniden gönderimi yeni gerçek çalışmadan ayırt edilir.
- [ ] Yazmanın farklı aşamalarına verilen hata/çökme, yarım kayıt/revizyon/işlem sonucu bırakmaz. Yeniden başlatmada ya önceki durum ya tam yeni kayıt okunur; başarılı denilen kayıt normal süreç yeniden başlatmasında kaybolmaz.
- [ ] Yetki/aktiflik, işlem tamamlanırken ve eski işlem sonucuna erişilirken denetlenir. Aynı kapsamda tekrar giriş sonrası sonuç çözümlenebilir; iptal edilmiş oturum veya başka işletme aynı kimlikle veri okuyamaz.
- [ ] SQLite yazma beklemesi sınırlıdır; kilit sorunu açıklanabilir geçici hata ve aynı işlemle yeniden deneme davranışı verir. Uzun rapor/ağ işlemi yazma kilidi içinde tutulmaz; mali işlem sonucu ve revizyon saklama süresi korunur.

**Bağımlılık:** S3.3.  
**Referans:** [PRD](PRD.md) §3, §7–8, §9: 5, 9, 13–14, 25; [Architecture](ARCHITECTURE.md) §3.2–3.6; [kayıt bütünlüğü kararı](architecture-decision-records/002-kayit-butunlugu.md).  
**Açık sınır:** K7 çevrimdışı kuyruk/senkronizasyon ayrı karardır. Yerel taslak başarılı sunucu kaydı değildir. Makine kaybından kurtarma E6'dadır; süreç yeniden başlatmasında kalıcılık yedek garantisi olarak sunulmaz.

### S3.5 — Onaysız/sahip çalışmasını düzeltme ve sürüm çakışması (M)

**Kullanıcı / ihtiyaç:** Mal sahibi veya yetkili ekip üyesi olarak yanlış girilmiş, henüz onaylanmamış çalışmayı düzeltmek istiyorum.  
**Fayda:** Eski bilgiyi kaybetmeden doğru hesabı elde ederim.  
**Akış:** Güncel kayıt açılır → günlük alanlar düzeltilir → “Değişiklikleri kaydet” seçilir → güncel sürüm veya açıklanmış çakışma gösterilir.

#### Kabul kriterleri

- [ ] Yetkili sahip/ekip onaysız şoför çalışmasını ve sahibin kendi çalışmasını düzenleyebilir. Eski kayıttaki artık pasif kişi aynı kayıtta korunabilir; başka kişi seçimi yetkili araç ilişkisiyle doğrulanır, yeni çalışma pasif kişi adına açılamaz.
- [ ] Tarih, saat veya para değişince süre/pay/kalan sunucuda yeniden hesaplanır. Aynı türde şoför çalışması onaysız kalır; sahibin kendi çalışması sıfır pay ve “Onay gerekmiyor” durumunu korur.
- [ ] Düzenleme yeni sürüm, revizyon, işlem sonucu ve varsa destek izini birlikte saklar; eski sürüm silinmez. Normal düzenleme para onayı oluşturmaz.
- [ ] Aynı sürümü açmış iki kullanıcı kaydederse ilk geçerli işlem tamamlanır, diğeri “Kayıt değişmiş, güncel halini açın.” mesajını alır. İkinci işlem ilkinin bilgisini sessizce ezmez; kullanıcının düzeltme taslağı karşılaştırma için korunur.
- [ ] Genel düzenleme isteği onaylı kayda uygulanamaz. Form açıldıktan sonra kayıt onaylanmışsa eski düzenleme reddedilir; yetkili kullanıcı S4.3'ün güncel onaylı düzeltme akışına yönlendirilir.
- [ ] Aynı düzenlemenin tekrar gönderimi ikinci sürüm üretmez; işlem hatasında eski tam kayıt korunur. Ekip için gerçek aktör ve önce/sonra bilgileri kaybolmaz.
- [ ] Ortak şoföre ad seçimiyle sahip yetkisi veya sınırsız düzenleme verilmez. Şoförün onay öncesi görebileceği/düzeltebileceği kayıtlar K1 kararı sonrası ayrı izin ve reddetme örnekleriyle doğrulanır; bu parça açıkken tamamlandı sayılmaz.

**Bağımlılık:** S3.4.  
**Referans:** [PRD](PRD.md) §7–8; [Architecture](ARCHITECTURE.md) §3.3–3.4, §4; [Design](DESIGN.md) §2.4, §2.10.  
**Açık sınır:** K1 şoförün onaysız düzeltme kapsamı, K3 zaman, K5/K6 para/gider kenarları. Çalışma türünü değiştirme ayrı karar gerektiren durumlarla karıştırılmaz; bu hikâyenin kesin kabulü aynı türde düzeltmedir.

### S3.6 — Kayıt sonucu, bağlantı hataları ve telefon kullanım doğrulaması (M)

**Kullanıcı / ihtiyaç:** Telefonda günlük hesabımı giren kişi olarak kaydın başarılı olup olmadığını açıkça anlamak istiyorum.  
**Fayda:** İkinci kayıt açarak hesabı karıştırmadan işlemi bitirebilirim.  
**Akış:** Form doldurulur → Kaydet → bekleme veya açıklanmış hata → doğrulanmış kayıt özeti → istenirse başka gerçek çalışma açılır.

#### Kabul kriterleri

- [ ] Günlük form ve sonuç 320 px genişlikte tek sütun kullanılabilir; uzun isim/tarih/tutar taşmaz. Mavi-beyaz görünüm, okunur yazı, en az 48 px alan ve 56 px ana düğme Design ölçülerine uyar.
- [ ] Saat seçimi ve para için uygun telefon klavyesi, görünür etiket/odak, klavye erişimi ve %200 yakınlaştırma doğrulanır. Hata, başarı ve teslim durumu yalnız renkle anlatılmaz; ekran okuyucuya da bildirilir.
- [ ] Kaydet sürerken bekleme görünür ve tekrarlı dokunma ayrı işlem başlatmaz. Başarı ekranı sunucunun sakladığı kişi/plaka/tarih/saat ve tutarı gösterir; gönderilmemiş formdan başarı özeti üretilmez.
- [ ] Bağlantı yokluğu veya bilinen hata, alanları sessizce sıfırlamaz. Sonucu bilinmeyen gönderimde “Sonuç kontrol ediliyor” benzeri açık metin ve aynı işlemi çözümleme yolu vardır; kesin kaydedilmedi iddiasıyla yeni kayıt açılmaz.
- [ ] Oturum biterse giriş istenir; aynı yetkili bağlama dönüldüğünde belirsiz işlem S3.4 kuralıyla çözümlenir. Başka araç/hesapla giriş yapıldığında önceki müşterinin taslağı ekranda açılmaz.
- [ ] Başarılı şoför kaydından sonra ikinci “Teslim ettim / Onaya gönder” düğmesi yoktur. “Henüz doğrulanmadı” fiziksel para borcu diye anlatılmaz; sahip kendi çalışmasında “Onay gerekmiyor” görür. Sonradan teslim durumunu güncelleme S4.6 ile tamamlanır.
- [ ] “Başka bir çalışma kaydı gir” yalnız önceki gönderimin sonucu biliniyorken ayrı form/işlem başlatır. Yeni form önceki şoförü otomatik seçmez ve önceki kaydı ezmez.
- [ ] Telefon tarayıcısında temsili kullanıcıyla günlük form denenir; PRD'nin yaklaşık 30–60 saniyelik giriş hedefi, hatalar ve takılan adımlar ölçülür. Yalnız geliştiricinin hızlı doldurması kullanım kolaylığı kanıtı sayılmaz.

**Bağımlılık:** S3.4, S3.5.  
**Referans:** [PRD](PRD.md) §3, §6, §8, §9: 1, 5, 14; [Design](DESIGN.md) §2.2–2.4, §2.10, §3; [Architecture](ARCHITECTURE.md) §3.4, §6.  
**Açık sınır:** K7 çevrimdışı senkronizasyon ve K1 yeniden açılabilecek geçmiş. Buradaki bağlantı hatası/tekrar gönderim davranışı bu özellikleri onaylamaz; kurulum mecburiyeti eklenmez.

## E4 — Para onayı, düzeltme ve geçmiş

### S4.1 — Kayıt detayı ve ilk alınan para onayı (M)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak günlük hesabı ve gerçekten aldığım parayı birlikte kontrol edip teslimi doğrulamak istiyorum.  
**Fayda:** Şoförün kaydettiği hesap ile benim teslim aldığımı doğruladığım tutar ayrı ve anlaşılır kalır.  
**Akış:** Yetkili araçtaki kayıt açılır → kişi, çalışma tarihi ve hesap incelenir → alınan tutar kontrol edilir → “Parayı aldım, tutar doğru” ile ilk onay tamamlanır.

#### Kabul kriterleri

- [ ] Kayıt detayında kişi, plaka, çalışma tarihi/saatleri, hasılat, mazot, diğer masraf, pay ve beklenen teslim birlikte görünür. Yetkili kapsam dışındaki kayıt ID’si ekran veya doğrudan API üzerinden açılamaz.
- [ ] “Aldığım tutar” beklenen tutarla hazır gelebilir; alanın dolu olması onay sayılmaz. Kullanıcı düğmeye basana kadar kayıt “Henüz doğrulanmadı” durumundadır; bu durum paranın fiziksel olarak verilmediği anlamında sunulmaz.
- [ ] İstekte gerçek alınan tutar açıkça bulunur; sunucu eksik alanı beklenen tutarla kendiliğinden onaylamaz. 10.000 TL hasılat, 1.500 TL mazot ve 300 TL masrafta beklenen 6.200 TL, tam teslim onayında alınan 6.200 TL olur.
- [ ] Sahip “Parayı aldım, tutar doğru” düğmesine bir kez basar; ikinci onay ekranı gerekmez. Ortak şoför oturumu doğrudan istek gönderse de onay oluşturamaz. Sahibin kendi sürüşüne para onayı açılmaz.
- [ ] İlk onay, yeni kayıt sürümü/revizyonu, alınan tutara bağlı onay, aktör/zaman ve tekrar gönderim sonucu birlikte yazılır. Arada hata olursa önceki tam durum korunur; ekranda başarı yalnız işlem tamamen tamamlanınca gösterilir.
- [ ] Aynı işlem anahtarı ve içerikle tekrar gönderim tek onay üretir. Aynı sürüm için ayrı işlemler eşzamanlı gönderildiğinde biri başarılı olur, diğeri sürüm çakışması alır; onaylanmış kayıt ikinci kez ilk onay yolundan değiştirilemez.
- [ ] Başarıda “Teslim doğrulandı”, gerçek alınan tutar ve onay zamanı görünür. Onay bir kayıt sürümüne bağlıdır; müşteri işleminin araç/rol oturumu doğrulanmış bireysel kişi kimliği gibi gösterilmez.
- [ ] Ağ nedeniyle sonuç belirsizse “Kaydın sonucu kontrol ediliyor” gösterilir; aynı işlemin sonucu çözülmeden yeni onay gönderilmez. Kesin hata, bekleme ve başarı metinleri ayrıdır; SQL veya gizli oturum bilgisi kullanıcıya gösterilmez.

**Bağımlılık:** S3.4, S1.5.  
**Referans:** [PRD](PRD.md) §3–4, §7–8, §9: 6, 13, 20; [Architecture](ARCHITECTURE.md) §1.3, §3.3–3.4, §4; [Design](DESIGN.md) §2.6, §2.10.  
**Açık sınır:** Beklenenden farklı alınan tutarın ayrıntıları S4.2, ekip görünümü S4.5, şoför geri bildirimi S4.6’dadır. K5 negatif kalan akışı açık kalır. Onay sonucunun rapor ekranında toplanması E5 ile birlikte doğrulanır; S4.1’in veri ve yetki kontrolleri E5’i beklemez.

### S4.2 — Beklenenden farklı alınan tutarı doğrulama (S)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak aldığım para hesaplanan teslimden farklıysa gerçek tutarı yazıp onaylamak istiyorum.  
**Fayda:** Günlük hasılatı veya şoför payını değiştirmeden gerçekten aldığım tutarı takip edebilirim.  
**Akış:** Beklenen teslim görülür → “Aldığım tutar” değiştirilir → fark açıkça gösterilir → aynı ilk onay işlemi tamamlanır.

#### Kabul kriterleri

- [ ] Beklenen teslim ile düzenlenebilir alınan tutar aynı ekranda ayrı etiketlerle görünür. Kullanıcı yalnız alınan tutarı değiştirince hasılat, giderler, pay ve beklenen teslim değişmez.
- [ ] Beklenen 6.200 TL iken 6.000 TL girildiğinde “Beklenenden 200,00 TL az” gibi anlaşılır fark gösterilir. “Parayı aldım, tutar doğru” düğmesindeki doğru, alınan 6.000 TL’yi doğrular; iki tutarın eşit olması şart değildir.
- [ ] Bu örnekte onay sonrasında hasılat 10.000 TL, mazot 1.500 TL, diğer masraf 300 TL, pay 2.000 TL ve beklenen 6.200 TL kalır; doğrulanmış alınan tutar 6.000 TL olur.
- [ ] Alınan tutar kuruş hassasiyetinde doğrulanır; boş/geçersiz veya negatif değer onaylanmaz. Sunucu, istemcinin değiştirerek gönderdiği beklenen tutarı veya payı alınan para alanıyla birlikte kabul etmez.
- [ ] Fark için ayrı borç, red, uyuşmazlık veya kısmi ödeme/tahsilat iş akışı açılmaz. Tek düğmeyle aynı onay tamamlanır; “Ödenmedi” gibi fiziksel teslimi kesinleştiren etiket kullanılmaz.
- [ ] S4.1’in atomik yazma, tekrar gönderim ve sürüm kontrolleri farklı tutarda da çalışır. Yeniden açıldığında gerçek alınan tutar korunur; hazır değer yeniden beklenene çevrilmez.
- [ ] Güncel onay verisi rapora 6.000 TL verir; 6.200 TL beklenen veya 200 TL fark ayrıca teslim toplamına eklenmez. E5 ile birleşik örnekte sahip sürüşü dahil toplam kalan 14.400 TL, onaylı teslim 6.000 TL olur.

**Bağımlılık:** S4.1.  
**Referans:** [PRD](PRD.md) §4, §7, §9: 20, 27; [Architecture](ARCHITECTURE.md) §1.3–1.4, §3.3; [Design](DESIGN.md) §2.5–2.7.  
**Açık sınır:** K5, hesaplanan kalan negatifken kayıt/teslim metni ve kabul davranışını belirler. Bu hikâye o açık durumu çözmez; pozitif beklenen tutardan farklı gerçek alınanı kaydetme kesin kapsamdır. Sonradan onaylı alınan tutarı değiştirmek S4.3 yolunu kullanır.

### S4.3 — Onaylı kaydı tek işlemde düzeltme ve onaylama (M)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak onayladığım kayıtta hata fark edersem hesabı ve alınan tutarı aynı işlemde düzeltmek istiyorum.  
**Fayda:** Rapor güncel doğru değerleri kullanır; önceki hesabın ve onayın geçmişi kaybolmaz.  
**Akış:** Onaylı kayıtta “Kaydı düzenle” açılır → günlük bilgiler ve mevcut alınan tutar kontrol edilir → “Düzelt ve onayla” ile yeni sürüm kaydedilir.

#### Kabul kriterleri

- [ ] Yalnız yetkili sahip veya onun adına platform ekibi onaylı kaydı düzenleyebilir. Ortak şoförün isteği reddedilir; onaylı kayda genel onaysız düzenleme yolundan değişiklik yapılamaz.
- [ ] Günlük bilgiler, yeni hesaplanan beklenen teslim ve mevcut gerçek alınan tutar aynı formda görünür. Hasılat/gider değişmesi alınan tutarı kendiliğinden yeni beklenene eşitlemez; sunucu onay isteğinde alınan tutarı ayrıca arar.
- [ ] “Düzelt ve onayla” tek ana işlemdir; düzeltmeyi kaydedip ayrı para onayını bekleten ikinci adım açılmaz. Yeni kayıt, yeni revizyon, yeni sürüme bağlı para onayı ve işlem sonucu tek transaction içinde tamamlanır.
- [ ] İşlemin herhangi bir yazma adımında hata üretildiğinde eski kayıt ve onay eksiksiz korunur. Başarılı durumda yalnız yeni tam sürüm görünür; yeni hasılatla eski onay veya yarım geçmiş birlikte gösterilmez.
- [ ] Aynı işlem tekrarlanınca yeni sürüm/onay çoğalmaz. Aynı eski sürüme iki farklı düzeltme gönderilirse biri uygulanır; diğeri “Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et” mesajı alır ve ilk değişikliği ezmez.
- [ ] Yalnız alınan tutar 6.000 TL’den 6.100 TL’ye düzeltildiğinde hasılat/pay/beklenen değişmez; yeni onay 6.100 TL’dir. Önceki 6.000 TL onayı geçmişte kalır, güncel alınan toplamı 12.100 TL’ye dönüşmez.
- [ ] Aynı sürüş türünde izinli kişi, tarih, saat veya tutar düzeltmesi yeni sürüme bağlanır. Tarih/kişi değişince güncel rapor verisi eski kişi/dönemden yenisine taşınır; önceki dağılım revizyonlardan izlenir. Sunucu kişi–araç/işletme ilişkisini ve hesap kurallarını yeniden denetler.
- [ ] Başarıda “Kayıt düzeltildi ve onaylandı” gösterilir; vazgeçmek sunucudaki onaylı kaydı değiştirmez. Eski/yeni değer, işlem zamanı ve gerçek aktör izi korunur; sonucun belirsiz kaldığı ağ hatasında aynı işlem çözümlenir.

**Bağımlılık:** S4.1, S4.2, S3.5.  
**Referans:** [PRD](PRD.md) §7–8, §9: 15, 26; [Architecture](ARCHITECTURE.md) §1.3, §3.3–3.5 ve [kayıt bütünlüğü kararı](architecture-decision-records/002-kayit-butunlugu.md); [Design](DESIGN.md) §2.6, §2.10.  
**Açık sınır:** K4 şoför/sahip sürüş türleri arasındaki dönüşümün eski teslimi nasıl etkileyeceğini belirler; bu dönüşüm kararı verilmeden açılmaz. K5 negatif kalan davranışı açıktır. Sahibin onay gerektirmeyen kendi çalışmasının sıradan düzeltmesi S3.5’tedir; bu hikâye ona para onayı eklemez. Tam dönem raporu kabulü E5 ile yapılır.

### S4.4 — Sürüm, önce/sonra değerler ve onay geçmişini gösterme (M)

**Kullanıcı / ihtiyaç:** Mal sahibi veya yetkili ekip üyesi olarak kayıtta neyin değiştiğini ve hangi tutarın ne zaman onaylandığını görmek istiyorum.  
**Fayda:** Güncel hesabın nasıl oluştuğunu önceki değerleri kaybetmeden anlayabilirim.  
**Akış:** Yetkili kayıt detayı açılır → “Geçmişi gör” seçilir → oluşturma, düzeltme ve onaylar zaman/sürüm sırasıyla incelenir.

#### Kabul kriterleri

- [ ] Geçmiş yalnız yetkili kayıt/işletme/araç kapsamında açılır; kapsam dışındaki kayıt veya sürüm ID’si doğrudan gönderilince veri dönmez. Ortak şoför oturumu sahip/ekip geçmiş ekranını açamaz.
- [ ] İlk kayıtta oluşturulduğu anlaşılır; olmayan bir önceki değer üretilmez. Sonraki sürümlerde değişen kişi/tarih/saat ve parasal girdiler ile önce/sonra değerler okunabilir biçimde gösterilir.
- [ ] Her para onayında onaylanan kayıt sürümü, gerçek alınan tutar, zaman ve aktör bulunur. Önceki 6.000 TL onayı ile yeni 6.100 TL onayı iki ayrı tarihçe satırıdır; güncel onayın hangisi olduğu açıktır.
- [ ] Sahip/şoför kaydı araç ve rol oturumuyla; platform desteği gerçek ekip kullanıcısı ve kim adına yapıldığıyla gösterilir. Ortak şifre kullanımından gerçek kişinin kimliği doğrulanmış sonucu çıkarılmaz.
- [ ] Eski sürüm veya onay için düzenle/sil işlemi bulunmaz; mevcut kaydı değiştirme yalnız ilgili yetkili akışla yeni sürüm üretir. Kişi ya da araç pasifleştirilmesi geçmişi yok etmez.
- [ ] Şifre, parola hash’i, gizli cookie/token veya teknik yığın izi geçmiş ekranına girmez. Oturum temizliği önceki aktör/zaman izini kaldırmaz.
- [ ] Güncel kayıt özeti ile tarihçe birbirinden ayrılır; tarihçe satırları gelir veya teslim toplamı gibi toplanmaz. S4.3’te tarih/kişi değişmiş örneğin eski ve yeni sürümleri korunur; E5 güncel raporla birlikte doğrular.

**Bağımlılık:** S3.4, S4.3.  
**Referans:** [PRD](PRD.md) §7–8, §9: 15, 26; [Architecture](ARCHITECTURE.md) §3.2–3.5, §4; [Design](DESIGN.md) §2.6, §2.9.  
**Sınır:** Bu ekran mali kayıt/revizyon/onay geçmişidir; işletme, araç ve kişi tanımlama geçmişinin yazılması/gösterilmesi S2.5’teki sorumluluk olarak kalır. K1’deki şoförün kayıt/teslim bilgisi erişimi, sahip/ekip tarihçe ekranına otomatik izin vermez.

### S4.5 — Platform desteği adına teslim ve düzeltme (M)

**Kullanıcı / ihtiyaç:** Yetkili ekip üyesi olarak müşteri adına alınan tutarı doğrulamak veya onaylı hesabı düzeltmek istiyorum.  
**Fayda:** Müşteriye kendi yönetim ekranımızdan yardımcı olurken hesabı ve işlemin gerçek kaynağını koruyabilirim.  
**Akış:** Destek hedefi seçilir → ilgili kayıt açılır → sahip adına alınan tutar doğrulanır veya “Düzelt ve onayla” kullanılır → ekip iziyle sonuç görünür.

#### Kabul kriterleri

- [ ] İşletme, araç, sahip ve işlemi yapan gerçek ekip kullanıcısı destek formunda görünür. Kayıt hedefle uyuşmuyorsa sunucu reddeder; müşteri rolü taklit eden istemci alanı yetki oluşturmaz.
- [ ] Ekip müşterinin şifresiyle giriş yapmaz. İlk onayda “Sahip adına alınan tutar” ve “Sahip adına teslimi onayla” etiketleri kullanılır; onaylı düzeltmede “Düzelt ve onayla” tek işlem olarak korunur.
- [ ] Beklenen 6.200 TL için sahip adına 6.000 TL onaylandığında hasılat 10.000 TL, pay 2.000 TL ve beklenen 6.200 TL kalır. Destek rolü farklı bir hesap formülü veya kendiliğinden sıfır pay üretmez.
- [ ] İlk onay ve onaylı düzeltme S4.1–S4.3’ün aynı yetki, ilişki, hesap, sürüm ve tekrar gönderim kontrollerinden geçer. Ayrı daha gevşek destek yazma yolu bulunmaz.
- [ ] Müşteri detayında ve geçmişte “Sahip adına platform desteği” ile gerçek ekip kullanıcısı, zaman, onaylanan tutar/sürüm görünür. İşlem müşteri bizzat yapmış veya ekip parayı fiziksel olarak almış gibi gösterilmez.
- [ ] Destek değişikliği, mali kayıt/onay ve aktör izi birlikte tamamlanır; hata yarım destek işlemi bırakmaz. Tekrar gönderim geçmişi veya alınan para toplamını çoğaltmaz.
- [ ] Hedef başka müşteriye değiştirilirken mevcut form sessizce taşınmaz. Mevcut kullanıcı işlemleri dışında her kayıt için ayrı destek talebi, ek izin veya ikinci onay akışı zorunlu tutulmaz.

**Bağımlılık:** S2.5, S4.3, S4.4.  
**Referans:** [PRD](PRD.md) §6–8, §9: 26–28; [Architecture](ARCHITECTURE.md) §2, §3.2–3.4, §4; [Design](DESIGN.md) §2.9–2.10.  
**Açık sınır:** K4/K5’in açık tür dönüşümü ve negatif kalan sınırları ekip için de aynıdır; destek yetkisi bu kuralları aşmaz. Müşteri adına yeni çalışma oluşturma S3.3’te kalır; bu hikâye yeni çalışma kaydı veya yeni platform raporu kapsamı eklemez.

### S4.6 — Şoföre teslim durumunu gösterme ve yetkisiz değişikliği önleme (S)

**Kullanıcı / ihtiyaç:** Şoför olarak girdiğim hesabın para tesliminin mal sahibi tarafından doğrulanıp doğrulanmadığını görmek istiyorum.  
**Fayda:** Kaydı tekrar girmeden hesabın ve teslim bilgisinin durumunu anlayabilirim.  
**Akış:** Başarılı kayıt sonucu veya erişim kuralının izin verdiği kayıt açılır → mevcut teslim durumu görülür → “Yenile” ile sunucudaki güncel durum alınır.

#### Kabul kriterleri

- [ ] Başarılı günlük kayıttan sonra ayrıca “Teslim ettim” veya “Onaya gönder” düğmesi çıkmaz. Yetkili sonuç görünümünde kişi, plaka, çalışma tarihi ve hesaplanan teslim tutarı anlaşılır biçimde gösterilir.
- [ ] İlk durumda “Henüz doğrulanmadı” yazılır; bu metin borç, kesin teslim edilmemiş para veya başarısız çalışma kaydı anlamında sunulmaz. Para onayı beklemek günlük kaydın geçerliliğini durdurmaz.
- [ ] Yetkili görünüm sunucudan onaylı sonucu aldığında “Teslim doğrulandı”, gerçek alınan tutar ve onay zamanı görünür. Beklenen 6.200 TL ve doğrulanan 6.000 TL ayrı gösterilir; birbirinin yerine yazılmaz.
- [ ] Durum açılışta veya “Yenile” ile güncellenir; sürekli arka plan sorgusu veya yeni mesajlaşma hizmeti gerekmez. Yükleme hatası onayı silmiş gibi gösterilmez; eski veri tutulacaksa güncellenemediği açıkça belirtilir.
- [ ] Şoför arayüzünde para onayı/onaylı düzeltme işlemi bulunmaz. Doğrudan onay, onaylı düzenleme veya sahip/ekip tarihçe endpoint’ine yapılan istekler de reddedilir; kayıt ID’si veya seçili adı değiştirmek bu yetkiyi vermez.
- [ ] K1 kapsamında karara bağlanan yeniden açma/geçmiş kuralı sunucuda uygulanır ve izin verilen/verilmeyen kayıt örnekleriyle sınanır. Bu karar gelmeden yalnız kişinin adını seçtiği için geniş geçmiş erişimi açılmaz veya bireysel gizlilik güvencesi verilmez.
- [ ] Sahip veya ekip onaylı kaydı düzelttiğinde, erişim kapsamında yeniden alınan sonuç yeni sürümün tutarını gösterir. Destek kaynaklı onay gerektiğinde “Sahip adına platform desteği” bilgisiyle ayrılır; ekran yeni hesap ile eski alınan tutarı karıştırmaz.

**Bağımlılık:** S3.6, S4.1, S4.3, S1.5.  
**Referans:** [PRD](PRD.md) §2–3, §6–7, §9: 5–6, 15; [Architecture](ARCHITECTURE.md) §2, §3.4–3.5, §4–5, §10; [Design](DESIGN.md) §2.3, §2.10–2.11.  
**Açık sınır:** K1’de şoförün hangi eski kayıt/teslim durumunu yeniden açacağı ve onaysız düzeltme sınırı kesinleşmemiştir. Kesin onay geri bildirimi ve yetkisiz değişiklik reddi hazırlanabilir; kapsam kararı ve ilgili testler tamamlanmadan tüm hikâye tamamlandı sayılmaz. Şoförün onaysız düzenleme akışı S3.5’tedir; burada aynı gün sınırı onaylanmış varsayılmaz.

## E5 — Özet ve raporlar

### S5.1 — Sahip özeti ve doğrulanmamış kayıt listesi (S)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak seçtiğim dönemin hesabını ve henüz doğrulamadığım şoför kayıtlarını birlikte görmek istiyorum.  
**Fayda:** Hesaplanan kalanla gerçekten alınan parayı karıştırmadan hangi kaydı açacağımı anlayabilirim.  
**Akış:** Sahip özeti açılır → dönem seçilir → araç toplamları ve dönemin doğrulanmamış kayıtları görülür → ilgili kayıt açılır.

#### Kabul kriterleri

- [ ] Özet yalnız geçerli sahip oturumunun yetkili araç kapsamını gösterir; plaka ve sahip adı başlıkta görünür. Ortak şoför oturumu veya kapsam dışı araç kimliğiyle aynı özet API üzerinden de okunamaz.
- [ ] Hafta/ay/yıl seçimi ve önceki/sonraki dönem gezinmesi, sunucunun sorguladığı başlangıç-bitiş tarihlerini gösterir. Dönem değişirken eski rakamlar yeni tarih başlığı altında gösterilmez; geç gelen eski isteğin yanıtı yeni seçimin üzerine yazmaz.
- [ ] Hasılat, mazot, diğer masraf, şoför payı ve hesaplanan kalan ayrı etiketlerle görünür. “Teslim alınan (onaylı)” ayrı bloktadır ve yalnız doğrulanmış şoför teslimlerini anlattığı belirtilir; tek bir “Kazanç” tutarında birleştirilmez.
- [ ] PRD'nin iki çalışma örneğinde özet 20.000 TL hasılat, 3.000 TL mazot, 600 TL diğer masraf, 2.000 TL şoför payı ve 14.400 TL kalan gösterir. Ahmet'in onayı yokken alınan 0 TL; 6.000 TL onaylandığında alınan 6.000 TL olur, kalan değişmez.
- [ ] Doğrulanmamış liste yalnız seçili dönemin henüz onaylanmamış şoför çalışmalarını içerir. Sahibin “onay gerekmiyor” kaydı ve onaylı kayıtlar bu listeye girmez; başlık listenin dönem sınırını belirtir. “Borçlu” veya kesin “Ödenmedi” ifadesi kullanılmaz.
- [ ] Her bekleyen satırda kişi, çalışma tarihi/saatleri, beklenen teslim ve “Kaydı aç” bulunur. Bağlantı aynı yetkili kaydın detayına gider; listeden satırı açmak kendiliğinden para onayı oluşturmaz. Uzun liste S5.4'ün sınırlı sayfalama yaklaşımını kullanır.
- [ ] Başarılı kayıt/onay/düzeltmeden özete dönüldüğünde sunucu verisi yenilenir; onaylanan kayıt bekleyen listeden çıkar ve ilgili toplam birlikte güncellenir. Başarısı belirsiz veya reddedilmiş işlem özete tamamlanmış gibi eklenmez; sürekli arka plan sorgusu gerekmez.
- [ ] Yükleme, rapor hatası, gerçekten boş dönem ve yalnız bekleyen listesi boş olan dönem ayırt edilir. Bekleyen liste boş diye mevcut araç toplamları sıfırlanmaz. Telefon ekranında etiketli tutarlar ve gezinme yatay kaydırmadan okunur; hata halinde “Tekrar dene” vardır.

**Bağımlılık:** S5.2, S5.4; kayıt detayına geçiş S4.1 ile tamamlanır.  
**Referans:** [Epics](EPICS.md) E5; [PRD](PRD.md) §4–6, §9: 10, 11; [Architecture](ARCHITECTURE.md) §1.4, §3.5, §5; [Design](DESIGN.md) §2.5, §2.10.  
**Açık sınır:** K1 ortak şoförün kayıt/teslim erişimini belirler; sahip özeti şoföre açılmaz. K2 kararı olmadan filo seçici veya diğer araçların toplamı eklenmez. K3 dönem sınırlarının, K5 negatif kalan metninin ve K6 gider kapsamının ilgili kabulü ayrıca tamamlanır. “Bu ay” başlangıcı tasarım önerisidir; yeni kesin ürün kararı sayılmaz.

### S5.2 — Araç dönem hesabı ve güncel teslim toplamı (M)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak aracın seçtiğim dönemde ne topladığını, hangi giderlerin düşüldüğünü ve ne kadar teslimi doğruladığımı görmek istiyorum.  
**Fayda:** Kayıtlara dayanan araç hesabını, gerçek alınan para bilgisinden ayrı değerlendirebilirim.  
**Akış:** Yetkili araç ve dönem açılır → hesap dökümü görüntülenir → hesaplanan kalan ile güncel onayların toplamı karşılaştırılır.

#### Kabul kriterleri

- [ ] Araç/dönem hesabı sunucuda doğrulanmış işletme ve araç kapsamındaki güncel çalışma kayıtlarından hazırlanır. Aynı işletmedeki yetkisiz araç veya başka işletme, filtre/URL değiştirilerek toplama katılamaz.
- [ ] 10.000 TL hasılat, 1.500 TL mazot ve 300 TL diğer masraf içeren bir şoför ve bir sahip çalışması aynı dönemde toplam 20.000 TL hasılat, 3.000 TL mazot, 600 TL diğer masraf, 2.000 TL pay ve 14.400 TL kalan üretir; iki kaydın süreleri de araç toplamına girer.
- [ ] Şoför için hiç onay yokken teslim toplamı 0 TL'dir. 6.200 TL onayında toplam 6.200 TL; bunun yerine 6.000 TL onayında toplam 6.000 TL'dir. Sahibin 8.200 TL kalanı, beklenen teslim ve onay ekranının yalnız önceden doldurulmuş alanı teslim toplamına eklenmez.
- [ ] Onaysız çalışma hasılat/gider/pay/kalan hesabına girer; onaysız para teslim toplamına girmez. Onaylı teslim yalnız güncel kayıt sürümüyle aynı işletme/kayıt/sürüm bağını taşıyan tek onaydan alınır; eski revizyonlar ve eski onaylar ayrıca toplanmaz.
- [ ] S4.3 ile aynı sürüş türündeki onaylı kayıt düzeltildiğinde hesap ve alınan tutar yeni tam sürüme göre yenilenir. Kişi veya çalışma tarihi değişince kayıt eski kişi/dönemden çıkar, yeni kişi/döneme girer; eski onay yeni dağılıma ikinci kez eklenmez. Hata halinde rapor eski tam durumu korur.
- [ ] Dönem başlangıcındaki kayıt dahil, sonraki dönemin başlangıcındaki kayıt hariç tutulur. Ekrandaki tarihler ve SQL filtreleri aynı sınırları kullanır; teslimi daha sonra onaylamak tek başına çalışmanın rapor dönemini değiştirmez. Haftanın başlangıcı ve gece çalışmasının dağılımı K3 kararı geldikten sonra o kuralla sınanır.
- [ ] Para toplamları kuruş tam sayılarıyla hesaplanır; API taşıma ve ekran biçimlendirmesi mimarinin tam sayı metni sözleşmesini korur. JavaScript'in güvenli tam sayı sınırını aşan toplam için hassasiyet testi bulunur; sessiz yuvarlanmış mali sonuç gösterilmez.
- [ ] “Hesaplanan kalan” yalnız kayıtlara girilmiş gider ve paylardan sonraki tutar olarak açıklanır; kesin net kâr, banka bakiyesi veya eldeki toplam nakit diye adlandırılmaz. Geçerli kayıtlardan gelen negatif sonuç sıfıra çevrilmez. Liste sayfası/kişi filtresi araç dönem toplamını sessizce daraltmaz.

**Bağımlılık:** S1.5, S3.2, S3.4; onay/düzeltme kabulü için S4.1, S4.2, S4.3. E3 verisiyle hesap kısmı önceden geliştirilebilir.  
**Referans:** [Epics](EPICS.md) E5; [PRD](PRD.md) §4–5, §7, §9: 10, 11, 20; [Architecture](ARCHITECTURE.md) §1.3–1.4, §3.3–3.5, §4; [Design](DESIGN.md) §2.5–2.7.  
**Açık sınır:** K2 diğer araç erişimi; K3 hafta/gece/dönem dağılımı; K4 onaylı şoför/sahip sürüş türü dönüşümü; K5 negatif kalan akışı; K6 masraf kalemleri ve bağımsız sahip giderleri. Bu kararlar verilmeden tür dönüşümü, borç/tahsilat veya bağımsız gider hesabı eklenmez. Aynı türde düzeltmenin güncel rapora yansıması kesin kapsamdır.

### S5.3 — Kişi çalışma günleri, saatler ve para dökümü (M)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak şoförlerin ve kendi çalışmamın gün, saat ve para dökümünü görmek istiyorum.  
**Fayda:** Aynı gün birden fazla çalışma olsa veya kişinin adı değişse de kimin ne kadar çalıştığını doğru anlayabilirim.  
**Akış:** Rapor dönemi açılır → Kişiler seçilir → kişinin özet ve ayrıntısı görüntülenir → ilgili çalışmaya gidilir.

#### Kabul kriterleri

- [ ] Kişi özeti ve ayrıntısı sunucunun izin verdiği işletme/araç/dönemle sınırlıdır. Kişinin başka araçta da çalışması veya kişinin kimliğinin bilinmesi diğer aracın mali kayıtlarını açmaz.
- [ ] Kişi kartında ad, toplam süre, çalışılan gün sayısı, çalışma sayısı, hasılat ve ayrılan pay görünür. Ayrıntıda mazot, diğer masraf, kalan ve ilgili çalışmalar vardır; kişiye özel tutar ile tüm araç tutarı açıkça ayrılır.
- [ ] Aynı kişinin aynı çalışma tarihinde 08:00–12:00 ve 13:00–17:00 kayıtları iki çalışma, bir çalışma günü ve toplam sekiz saat üretir. Gün sayısı farklı çalışma tarihlerinden, süre kaydedilmiş dakikalardan hesaplanır; çalışma sayısı gün sayısına eşitlenmez.
- [ ] S2.4 ile kişinin adı düzeltildiğinde eski ve yeni çalışmalar aynı sabit kişi altında, güncel adla gösterilir. Aynı ad-soyadı taşıyan iki farklı kişinin kayıtları birleşmez; metin eşitliği gruplama anahtarı olarak kullanılmaz.
- [ ] Şoförün araç ataması veya kişi aktifliği kapatıldığında geçmiş çalışmaları ve toplamları rapordan kaybolmaz. Rapor sorgusu yeni çalışma seçicisindeki “yalnız aktif kişi” filtresini geçmişe uygulamaz.
- [ ] Sahibin kendi sürüşü aynı kişi listesinde adı ve sahip niteliğiyle görünür; süre ve hasılatı eklenir, ayrılan pay sıfırdır. Design örneğinde Ahmet ve Görkem ayrı ayrı 9 saat 30 dakika ve birer çalışma günü gösterir; araç süre toplamı 19 saattir. Kişi-gün toplamı araçta farklı gün sayısı diye etiketlenmez.
- [ ] Güncel kaydın aynı sürüş türünde başka kişiye veya başka çalışma tarihine düzeltilmesi eski kişi/dönem toplamını azaltır, yeni kişi/dönem toplamını artırır. Kişi listesi ve ayrıntı eski revizyonu ikinci çalışma olarak saymaz; onaylı düzeltmede S4.3'ün tam sonucu kullanılır.
- [ ] Kişi/dönem değiştirilirken eski kişinin verisi yeni başlığın altında gösterilmez. Boş sonuç ancak başarılı sorgudan sonra belirtilir; yükleme/hata sahte sıfır gün, saat veya tutar üretmez. Ayrıntıdan çalışma açma aynı yetki sınırını korur ve telefonda kart/metinler okunur.

**Bağımlılık:** S1.5, S2.4, S3.4, S3.5; onaylı kişi/tarih düzeltmesiyle ortak kabul S4.3 sonrası tamamlanır.  
**Referans:** [Epics](EPICS.md) E5; [PRD](PRD.md) §2, §5–8, §9: 9, 11, 19; [Architecture](ARCHITECTURE.md) §1.4, §3.2, §3.5; [Design](DESIGN.md) §2.7–2.8.  
**Açık sınır:** K2 araç kapsamı ve K3 gece/gün/dönem dağılımı. Gün sayısı testleri kesin çalışma tarihleriyle yapılır; geceyi başlangıç gününe bağlama veya pazartesi hafta başlangıcı sessizce kabul edilmez. K5/K6 negatif kalan metni ve gider ayrıntısı ayrıca korunur. Ortak şoför için kişisel rapor erişimi veya doğrulanmış bireysel kimlik güvencesi eklenmez.

### S5.4 — Gün gün kayıtlar, filtreler ve sayfalama (M)

**Kullanıcı / ihtiyaç:** Mal sahibi olarak seçtiğim dönemin çalışmalarını gün gün inceleyip kişi veya teslim durumuna göre daraltmak istiyorum.  
**Fayda:** Uzun listede ilgili kayda ulaşırken dönem hesabını yanlışlıkla eksik görmem.  
**Akış:** Gün gün görünümü açılır → dönem/kişi/teslim durumu seçilir → kayıtlar incelenir → gerekirse Daha fazla göster veya kayıt detayı açılır.

#### Kabul kriterleri

- [ ] Telefon kartında çalışma tarihi, kişi, başlangıç/bitiş, hasılat, beklenen teslim, varsa doğrulanmış alınan tutar ve durum görünür. Onaysız kayıtta beklenen tutar alınmış gibi gösterilmez; onay gerekmeyen sahip sürüşü teslim bekleyen kaydı gibi sunulmaz.
- [ ] “Günlük kayıtları filtrele” alanındaki kişi ve teslim durumu yalnız listeyi daraltır. Üstteki özet aynı aracın seçili dönem toplamı olarak etiketlenir; liste filtresi uygulandı diye sessizce değişmez. Tarih/dönem seçimi değiştiğinde liste ve dönem özeti yeni tarihlerle birlikte yenilenir.
- [ ] Filtrede başka işletmenin veya yetkisiz aracın kişi/kayıt kimliği gönderilirse sunucu veri açmaz. Dönem, kişi, durum veya ekip hedefi değiştiğinde eski sayfalama konumu taşınmaz; önceki kapsamın kayıtları yeni listeye eklenmez.
- [ ] Detay liste isteği mimarideki başlangıç 50 ve en fazla 100 kayıt sınırını uygular; “Daha fazla göster” sonraki sayfayı ekler. (work_date, id) konumuyla, aynı tarihte çok sayıda kayıt içeren değişmeyen veri kümesi baştan sona gezildiğinde kayıt atlanmaz veya tekrarlanmaz.
- [ ] Yalnız ilk sayfa görünürken de araç ve kişi dönem toplamları ilgili kapsamın bütün döneminden gelir. Daha fazla kayıt gösterilmesi toplamları sayfa büyüklüğü kadar artırmaz; farklı sayfa boyları aynı veri için aynı dönem hesabını verir.
- [ ] Tek rapor isteği için mimarideki en fazla bir takvim yılı sorgu bütçesi uygulanır; geçersiz/aşırı aralık açıklanır. En az beş yıllık kayıt saklama korunur ve eski yıllar ayrı seçilerek okunabilir; sorgu sınırı veya sayfalama eski veriyi silmez/gizlice dışlamaz.
- [ ] Yeni sayfa yükleme hatasında aynı kapsamdaki yüklenmiş kayıtlar korunur ve yeniden deneme sunulur; liste sıfırlanmış veya tamamlanmış gibi gösterilmez. Hızlı filtre değişiminde geç gelen eski yanıt yeni başlığın altına yerleşmez; boş liste yalnız başarılı sorguyla gösterilir.
- [ ] Karttaki Kaydı aç ilgili yetkili detay ekranına gider; sayfalama veya filtreleme veri değiştirmez/onay vermez. 320 px telefon genişliğinde yatay tablo kaydırması zorunlu değildir; durum yalnız renkle anlatılmaz ve metinli Daha fazla göster klavyeyle kullanılabilir.

**Bağımlılık:** S1.5, S2.4, S3.4, S5.2; kayıt detayı ve teslim durumu için S4.1.  
**Referans:** [Epics](EPICS.md) E5; [PRD](PRD.md) §5–6, §8, §9: 11, 21; [Architecture](ARCHITECTURE.md) §1.4, §3.5, §4–5; [Design](DESIGN.md) §2.7, §2.10.  
**Açık sınır:** K1 ortak şoförün yeniden açma/geçmiş erişimi; K2 araç/plaka geçişi; K3 hafta/gece sınırları; K5 negatif kalan sunumu; K6 masraf türü/kalemi filtresi. Bu hikâye masraf kategorisi, yeni araç erişimi veya bireysel şoför raporu yaratmaz. PDF/Excel/indirme eklenmez.

### S5.5 — Rapor tutarlılığı, sorgu planı ve destek görünümü (M)

**Kullanıcı / ihtiyaç:** Mal sahibi ve yetkili destek ekibi olarak aynı kayıtların aynı, güncel ve anlaşılır raporu üretmesini istiyorum.  
**Fayda:** Müşteriye yardımcı olurken başka aracın verisini veya eski onayların şişirdiği hesabı kullanmam; geçmiş büyüdüğünde de rapora ulaşabilirim.  
**Akış:** Sahip veya ekip yetkili raporu açar → veriler kapsam ve sürüme göre okunur → güncel toplam/detay doğrulanır → kayıt değişince rapor yenilenir.

#### Kabul kriterleri

- [ ] Ekip, S2.5'te seçtiği müşterinin özet, araç, kişi ve gün gün raporlarını aynı rapor kurallarıyla görür. Destek başlığında işletme, plaka, sahip ve gerçek ekip kullanıcısı görünür; aynı veri/dönem için sahip ve ekip ekranları aynı mali toplamları üretir.
- [ ] Özet, kişi, araç ve detay sorgularının tamamında doğrudan kapsam değiştirme testleri vardır. Oturumsuz, iptal edilmiş, ortak şoför veya yanlış hedefli istek mimarinin yetki sözleşmesine göre reddedilir; başka müşterinin tutarı/kişi adı hata yanıtına sızmaz.
- [ ] Müşteriye özel rapor API ve sayfaları private/no-store davranışını korur. Çıkış, farklı araçla giriş veya ekip hedefi değişiminden sonra önceki müşterinin raporu yeni kapsamda görünmez; paylaşılan kalıcı mali cache oluşturulmaz.
- [ ] Bir rapor yanıtının toplam ve detay sorguları aynı kısa okuma görüntüsünden hazırlanır. Araya onaylı düzeltme giren testte yanıt eski tam sürümü veya yeni tam sürümü gösterir; yeni hesap/eski para onayı karışımı oluşmaz. Ayrı sayfa istekleri boyunca uzun açık DB transaction'ı tutulmaz.
- [ ] Toplamlar yetkili kapsam ve dönem koşullu SQL SUM/GROUP BY ile, kişi günleri sabit kişi kimliği ve farklı çalışma tarihleriyle hesaplanır; sayfalı ayrıntı sınırlıdır. Tüm geçmişi Node belleğine yükleyip her istekte orada toplama yapılmaz; yalnız güncel kayıt sürümünün onayı eşlenir.
- [ ] Beş yıllık temsili veri kümesinin araç, kişi ve çalışma hacmi kaydedilir; özet, kişi, durum filtreli liste ve eski yıl sorguları için EXPLAIN QUERY PLAN ile süre ölçümü raporlanır. Mimari indeks/sorgu bütçesi doğrulanır ve bulunan darboğaz düzeltilir. Hedef Lightsail'daki 100 aktif kullanıcı ve rapor p95 kabulü S6.6'da aynı sorgularla tamamlanır.
- [ ] E3/E4'ün başarılı kayıt, ilk onay, farklı alınan tutar, onaysız düzeltme ve Düzelt ve onayla işlemleri sonrasında ilgili rapor tekrar sorgulanır. Sonucu bilinmeyen veya reddedilmiş yazma başarı gibi toplama katılmaz. Açılış/Yenile davranışı yeterlidir; sürekli arka plan sorgusu veya canlı bağlantı şartı eklenmez.
- [ ] Birleşik testte 14.400 TL kalan ile 0/6.200/6.000 TL alternatif onay sonuçları, sahibin sıfır payı, pasif/adı düzelmiş kişiler, aynı gün iki çalışma ve kişi/tarih düzeltmesi hem sahip hem destek görünümünde doğrulanır. Eski revizyonlar/onaylar toplamı çoğaltmaz; hata sahte sıfır üretmez. Rapor ekranında PDF/Excel/indirme, grafik veya gönderme özelliği bulunmaz.

**Bağımlılık:** S5.1, S5.2, S5.3, S5.4, S2.5; gerçek destek teslim/düzeltmesiyle ortak kabul S4.5 sonrası tamamlanır.  
**Referans:** [Epics](EPICS.md) E5; [PRD](PRD.md) §4–8, §9: 10–12, 19, 21, 28; [Architecture](ARCHITECTURE.md) §1.4, §2, §3.5, §5, §9; [Design](DESIGN.md) §2.7, §2.9–2.10; [Tech Stack](TECH-STACK.md) §3, §5, §8.  
**Sınır:** K1–K6'nın ilgili erişim, dönem, tür dönüşümü, negatif kalan ve gider kararları burada da açık kalır; kesinleşmemiş akış başarıyla uygulanmış sayılmaz. Özellik düzeyindeki hesap/yetki/sorgu kontrolleri E5'in sorumluluğudur; S6.6'ya ertelenmez. Bu hikâye S6.6'yı geliştirme bağımlılığı yapmaz; yük testi için doğrulanmış rapor sorguları ve örnek veri sağlar. Yeni raporlama servisi veya veritabanı geçişi eklenmez.

## E6 — Yayın ve işletim

### S6.1 — Hedefle uyumlu derleme, kontroller ve yayın çıktısı (M)

**Kullanıcı / ihtiyaç:** Uygulamayı geliştiren kişi olarak kontrol edilmiş, hedef makinede çalışabilen bir sürüm hazırlamak istiyorum.  
**Fayda:** Canlı sunucuda derleme yapmadan aynı çıktıyı deneyebilir ve yayınlayabilirim.  
**Akış:** Kaynak sürüm seçilir → otomatik kontroller ve üretim derlemesi çalışır → çıktı kimliği ve uyumluluk bilgisiyle saklanır.

#### Kabul kriterleri

- [ ] Seçilen Ubuntu/CPU mimarisi ve Node sürümüyle uyumlu üretim çıktısı GitHub Actions'ta hazırlanır; paket sürümleri lockfile ile sabittir. Mac ortamının node_modules dizini sunucuya kopyalanmaz.
- [ ] better-sqlite3 ve Argon2 native modülleri hedefle uyumlu ortamda çalıştırılır. Gerçek SQLite sürümü ayrıca okunup Architecture §3.6'daki sürüm koşuluyla doğrulanır; yalnız npm paket numarası yeterli sayılmaz.
- [ ] Derleme, tip kontrolü ve o sürüme kadar eklenmiş iş kuralı/yetki/veri testleri geçmeden yayınlanabilir çıktı üretilmez. Henüz uygulanmamış hikâyeler geçmiş test gibi raporlanmaz.
- [ ] Çıktı kaynak sürüm, lockfile, uygulama/şema uyumluluğu ve bütünlük kontrolü bilgisiyle tanınır. Daha sonra farklı içerikle aynı sürüm gibi değiştirilmez.
- [ ] Üretim çıktısı temiz ve hedefle uyumlu ortamda açılır; migration/başlatma komutları kayıtlıdır. Deneme verisi ve ortamı gerçek müşteri verisiyle karışmaz.
- [ ] Gizli giriş/SSH bilgileri kaynak koduna, istemci çıktısına veya CI loglarına yazılmaz. Çalışma çıktısında gerçek müşteri veritabanı bulunmaz.
- [ ] Üretim yayını manuel tetiklenen ayrı adımdır; her push otomatik canlı yayın yapmaz. Actions dakika/artifact bütçesi ve saklama sınırı belirlenir; sınırsız ücretsiz kullanım varsayılmaz.

**Bağımlılık:** S1.1.  
**Referans:** [Tech Stack](TECH-STACK.md) §5, §9; [Architecture](ARCHITECTURE.md) §3.6, §8.4; [Epics](EPICS.md) E6.  
**Açık sınır:** K9 kesin sürümler/hesap erişimi. Bu hazırlık E1 ile başlayabilir; E2–E5 geliştikçe ilgili testler aynı kontrole eklenir. Gerçek Lightsail kurulumu S6.2, son bütünleşik kabul S6.6'dadır.

### S6.2 — Lightsail, HTTPS, kalıcı dizinler ve sürümlü kurulum (M)

**Kullanıcı / ihtiyaç:** Hizmeti yöneten kişi olarak uygulamayı seçilen makinede, verileri yayın sırasında kaybolmadan çalıştırmak istiyorum.  
**Fayda:** Kullanıcılar telefondaki bağlantıdan erişir; kod güncellemesi hesaplarını silmez.  
**Akış:** Seçilen makine ve alan adı hazırlanır → uyumlu sürüm ayrı dizine yerleştirilir → Caddy ve uygulama servisleri başlatılır → HTTPS ve kalıcı veri doğrulanır.

#### Kabul kriterleri

- [ ] Tech Stack'teki tek Lightsail başlangıç paketi ve native Ubuntu/Node kurulumu esas alınır; kaynak oluşturmadan bölge, paket ve güncel bütçe doğrulanır. Bu belge makinenin oluşturulduğuna dair kanıt değildir.
- [ ] Caddy HTTPS üzerinden gelen web/API isteklerini aynı Next.js uygulamasına iletir; sertifika edinme/yenileme ve HTTP'den HTTPS'e yönlendirme denemesi kaydedilir. Telefon tarayıcısında uygulama kurulumu gerekmez.
- [ ] Uygulama root olmayan servis kullanıcısıyla çalışır. Ağ ve dosya izinleri tanımlıdır; DB, hazır yedek, servis sırları ve iç sağlık uçları herkese açık dosya/endpoint olarak sunulmaz.
- [ ] Kod releases/current düzeninde; kalıcı DB, hazır yedekler, migration öncesi kopya ve servis ayarları Architecture §8.1'deki ayrı alanlarda tutulur. Kod temizliği DB/yedek dizinlerine dokunmaz.
- [ ] İlk şema kurulumu açık komutla yapılır. Mevcut kurulumda DB kaybolmuş veya yanlış yol verilmişse uygulama sessizce boş müşteri sistemi açmaz; açıklanabilir işletim hatası verir.
- [ ] Caddy ve uygulama systemd servisleri yeniden makine açılışında çalışır. Süreç yeniden başlatması sonrası önceden başarıyla yazılmış deneme kayıtları korunur; sınırlı otomatik kurtarma S6.3 ile tamamlanır.
- [ ] SQLite bağlantılarında mimarideki WAL, foreign_keys, dayanıklılık ve sınırlı bekleme ayarları doğrulanır. Canlı WAL elle silinmez; DB dosyasını tek başına rastgele kopyalamak yedek yöntemi yapılmaz.
- [ ] İlk servis kurulumu ve sürüm değiştirme adımları tekrarlanabilir biçimde kaydedilir. Kurulum denemesi kullanıcı trafiğine açılma sayılmaz; backup/restore ve bütünleşik kabul bitmeden pilot hazır ilan edilmez.

**Bağımlılık:** S6.1, S1.3.  
**Referans:** [PRD](PRD.md) §1, §8; [Tech Stack](TECH-STACK.md) §5–6, §9; [Architecture](ARCHITECTURE.md) §3.6, §6, §8.1, §8.4.  
**Açık sınır:** K9 alan adı/hesap ve kurulum ayrıntıları. Docker, ikinci uygulama makinesi, S3 veya yönetilen DB eklenmez. Şema ve müşteri ekranları geliştikçe bu kurulumda denenebilir; gerçek kullanıcıya açılma S6.6'dadır.

### S6.3 — Çökme/donma denetimi, dış sağlık kontrolü ve ekip uyarısı (M)

**Kullanıcı / ihtiyaç:** Hizmeti yöneten kişi olarak uygulama durduğunda sınırlı kurtarma yapılmasını ve çözülmeyen sorunun bana bildirilmesini istiyorum.  
**Fayda:** Basit süreç arızaları toparlanır; daha ciddi sorunlar fark edilmeden sürmez.  
**Akış:** Servis ve dış erişim izlenir → arıza türü ayrılır → uygun sınırlı yeniden başlatma veya ekip uyarısı uygulanır → sonuç kaydedilir.

#### Kabul kriterleri

- [ ] Uygulama ve Caddy çökmesi systemd yeniden başlatma davranışıyla denenir; gecikme ve başlangıç sayısı Architecture §8.2 sınırlarına uyar. Sürekli başarısızlık sınırsız döngüye dönüşmez.
- [ ] Uygulamadan bağımsız sağlık görevi canlılık isteğini timeout ile denetler; Node event-loop donması denemesinde arızayı fark eder. Sadece süreç ID'sinin varlığı sağlıklı kabul edilmez.
- [ ] Bakım sırasında ve aynı görev zaten çalışıyorken otomatik düzeltici restart yapılmaz. Yeniden başlatma bütçesi aşılırsa kalıcı kurtarma kilidi oluşur; zaman geçmesi veya makine reboot'u kilidi kendiliğinden açmaz.
- [ ] Ekip nedeni inceleyip kontrollü kilit kaldırma yapana kadar yeni otomatik kurtarma başlamaz. Görev systemd başlangıç sayacını sıfırlayarak kendi sınırlarını aşamaz.
- [ ] Canlılık ile DB/şema hazırlığı ayrı ölçülür. DB hatası, bozulma veya disk dolması örnekleri aralıksız restart üretmez; tam bütünlük taraması her sağlık isteğinde çalıştırılmaz.
- [ ] Makine tamamen kapalı/erişilemezken dış kontrol sorunu algılar ve seçilmiş ekip kanalına uyarı ulaştırır. Yalnız aynı makinedeki görevle bu deneme geçmiş sayılmaz.
- [ ] Yanıt süresi, beklenmeyen hata, RAM/disk, WAL büyümesi ve kilit beklemeleri izlenir; belirlenen eşikler için uyarı denenir. Loglar şifre/token içermez ve boyut sınırında döner; iş kayıtlarıyla karıştırılıp silinmez.
- [ ] Çökme, donma, bakım ve kalıcı arıza denemelerinin zamanı, restart sayısı, kilit ve bildirimi kayıtlıdır. Uyarıyı kimin takip edeceği ve müdahale adımı anlaşılır biçimde yazılmıştır.

**Bağımlılık:** S6.2.  
**Referans:** [Architecture](ARCHITECTURE.md) §8.2, §9; [Tech Stack](TECH-STACK.md) §8–10.  
**Açık sınır:** K9 dış kontrolün yeri ve ekip uyarı kanalı. Bunlar belirlenip bildirim sınanmadan bu hikâye tamamlanmış sayılmaz. Müşteriye SMS/e-posta, otomatik eski DB'ye dönüş veya sınırsız makine yeniden başlatması eklenmez.

### S6.4 — Tutarlı günlük DB kopyası, son yedi snapshot ve saklama kontrolleri (M)

**Kullanıcı / ihtiyaç:** Hizmeti yöneten kişi olarak günlük yedeğin güncel ve kullanılabilir olduğunu bilmek istiyorum.  
**Fayda:** Makine kaybında geri dönebileceğimiz veri belli olur; kopyalar sınırsız birikmez.  
**Akış:** Tutarlı DB kopyası hazırlanır/doğrulanır → manifest ve uyumlu sürüm korunur → Lightsail snapshot tamamlanır → kopya/snapshot ilişkisi ve saklama sınırı kontrol edilir.

#### Kabul kriterleri

- [ ] Günde bir Lightsail otomatik snapshot ve son yedi otomatik snapshot planı uygulanır. Hazırlık/snapshot zamanları ve Türkiye–AWS saat dönüşümü kaydedilir; snapshot'ın tam belirlenen dakikada başlayacağı varsayılmaz.
- [ ] SQLite Backup API ile geçici tutarlı kopya alınır; kopyanın kendi görüntüsünde bütünlük, ilişkiler, son kayıt/revizyon ve mali toplamlar denetlenir. Kopya alınırken değişen canlı toplamla hatalı karşılaştırma yapılmaz.
- [ ] Sağlam kopya ve hash, şema/uygulama sürümü, son işlem, doğrulama zamanı içeren manifest diske güvenli yazılıp hazır konuma atomik taşınır. Hazırlık, yayın/migration/restore ile ortak işletim kilidine uyar.
- [ ] Hazır kopya snapshot penceresinde değiştirilmez; ona uyumlu uygulama çıktısı da korunur. Zaman sınırını kaçıran hazırlık o günün snapshot'ına girmiş kabul edilmez; önceki sağlam kopya durur ve uyarı verilir.
- [ ] Yerelde son iki doğrulanmış günlük kopya saklanır. Başarısız yeni kopya eski sağlamı sildirmez; kopyanın kullandığı release sıradan kod temizliğinde silinmez. Yerel kopya makine kaybına karşı tek başına yeterli sayılmaz.
- [ ] “DB kopyası hazır”, “AWS snapshot başarılı” ve “bu snapshot'tan restore sınandı” ayrı izlenir. Snapshot zamanı/durumu hazırlanmış kopyayla ilişkilendirilemezse yeni başarılı DB yedeği ilan edilmez; ekip uyarılır.
- [ ] Yedek, yerel kopya, log ve CI çıktısı saklama kontrolleri en az beş yıllık iş kayıtlarını, revizyonları ve gerekli mali işlem sonuçlarını silmez. Otomatik yedekleri yediyle sınırlamak uygulamadaki geçmişi sınırlamaz.
- [ ] Kaynak makine silinmeden korunacak otomatik snapshot'ın manuel snapshot olarak saklanması işletim adımında bulunur. Yedek son başarılı kopyadan sonraki kayıtları garanti etmez; başarısız günler kurtarılabilir zaman aralığını uzatır.

**Bağımlılık:** S6.2, S6.3, S4.3.  
**Referans:** [PRD](PRD.md) §8, §9: 14; [Tech Stack](TECH-STACK.md) §6; [Architecture](ARCHITECTURE.md) §8.3–8.4.  
**Sınır:** Hazırlık E1/E3 döneminde başlayabilir; son kabulde E4'ün kayıt/onay revizyonları da kopyada doğrulanır. Takvimdeki saatler mimari başlangıç önerisidir; S3 veya saatlik yedek eklenmez. Bağımsız makinede restore kanıtı S6.5'tedir.

### S6.5 — Restore, migration ve güvenli yayın geri dönüşü (M)

**Kullanıcı / ihtiyaç:** Hizmeti yöneten kişi olarak arıza veya başarısız güncelleme sonrası hangi veriye nasıl döneceğimi bilmek istiyorum.  
**Fayda:** Kurtarma sırasında yeni kullanıcı kayıtlarını silmeden, doğrulanmış duruma geçebilirim.  
**Akış:** Deneme arızası/yayın durumu seçilir → trafik ve işletim kilidi yönetilir → uyumlu veri/kod açılır → kayıt ve rapor kontrolleri yapılır → sonuç ve kurtarılabilir zaman yazılır.

#### Kabul kriterleri

- [ ] Tamamlanmış snapshot ayrı deneme makinesine açılır; içindeki doğrulanmış DB kopyası, manifest/hash ve uyumlu kod/şema kullanılır. Üretim verisi üzerine deneme yapılmaz; geçici makinenin maliyeti ve temizliği işletim planında görünür.
- [ ] Girişler, işletme/kişi/araç ilişkileri, son başarılı kayıt, revizyonlar, güncel teslim onayı ve rapor toplamları restore sonrası doğrulanır. Yalnız makinenin açılması veya DB dosyasının bulunması başarılı restore sayılmaz. Kopyadaki eski oturumlar iptal edilir; güncel erişim/parola/pasiflik bilgisi kontrol edilmeden eski yetkiler trafiğe açılmaz, geçmiş aktör izleri korunur.
- [ ] Kurtarılabilir son işlem zamanı kopyanın içinden ölçülür; snapshot saatinden tahmin edilmez. Toparlanma süresi ve örnek kayıp aralığı raporlanır; günlük yedek sıfır veri kaybı gibi sunulmaz.
- [ ] Yayın, migration, yedek hazırlığı ve restore aynı işletim kilidiyle çakışmadan yürür. Bakım yeni mutasyonları durdurur, devam eden kısa işlemler tamamlanır; sağlık otomasyonu bakım sırasında restart yapmaz.
- [ ] Migration öncesinde doğrulanmış kopya alınır; kopya başarısızsa yayın ilerlemez. Test geçen sürüm/şema uygulanır; readiness ve mali smoke kontrolleri geçmeden müşteri yazmasına açılmaz.
- [ ] Trafik açılmadan başarısız migration/yayın denemesinde uyumlu eski kod veya gerekli eski kod+DB birlikte geri alınabilir. Eski kodun yeni şemayla uyumsuzluğu görmezden gelinmez; yarım yeni durum açılmaz.
- [ ] Yeni müşteri yazmaları alındıktan sonra eski DB'ye otomatik dönüş yapılmaz. Bu durumdaki hata için veriyi koruyan ileri düzeltme/planlı kurtarma yolu kaydedilir; eski canlı DB/WAL gerektiğinde inceleme için korunur, otomatik karıştırılmaz.
- [ ] Bir önceki çalışan kod ve yayın öncesi kopya, yayın doğrulanmadan temizlenmez; hazır yedeklerin referans verdiği kod da korunur. Restore deneme adımları ve sonraki tekrar planı yazılır; gerçek başarı kanıtları sürümle ilişkilidir.

**Bağımlılık:** S6.4, S5.5.  
**Referans:** [PRD](PRD.md) §8, §9: 14; [Architecture](ARCHITECTURE.md) §8.3–8.4, §9; [Tech Stack](TECH-STACK.md) §6, §9.  
**Sınır:** İlk yayından önce restore denemesi gereklidir; aylık tekrar mimaride önerilen işletim sıklığıdır. Bu hikâye yedek tercihinin değişmesi veya kayıtları eski kopyayla gelişigüzel birleştirme yetkisi değildir.

### S6.6 — Yük/veri bütünlüğü kabulü ve pilot işletim rehberi (M)

**Kullanıcı / ihtiyaç:** Ürünü kullanıma açacak kişi olarak temel işlerin doğru çalıştığını ve seçilen makinenin beklenen yükte nasıl davrandığını görmek istiyorum.  
**Fayda:** Kullanıcılara ölçülmemiş kapasite sözü vermeden küçük bir pilot başlatabiliriz.  
**Akış:** Tam uygulama ve temsili geçmiş hazırlanır → iş akışları/yük/arızalar sınanır → bulgular ve kalan engeller yazılır → pilot işletim adımları hazırlanır → belirlenmiş pilot kapsamıyla kontrollü yayın ve yayın sonrası doğrulama yapılır.

#### Kabul kriterleri

- [ ] E1–E5'in kabul kriterleri ve PRD §9'daki 28 senaryo birlikte doğrulanır; sonuçlar kaynak sürümle ilişkilidir. Açık kapsam kararı veya uygulanmamış parça başarı kutusu olarak kapatılmaz.
- [ ] Seçilen hedef Lightsail ve üretim derlemesiyle en az beş yıllık temsili veri kullanılır; araç, kişi ve günlük çalışma adetleri yazılır. Yük üreticisi test edilen makinenin dışında çalışır.
- [ ] 100 kısa aralıklı giriş, 100 aktif kullanıcının gerçekçi beklemeli karışık işlemleri ve 100 yazma isteği tepesi ayrı ölçülür. 500 toplam kullanıcı, 500 eşzamanlı istek gibi yorumlanmaz; üç senaryonun sonuçları birbirinin yerine kullanılmaz.
- [ ] Isınma, kademeli artış ve sürdürülen yük süreleri belirtilir; mimarinin en az 30 dakika sabit yük başlangıç önerisi dikkate alınır. RAM, CPU/burst, event-loop gecikmesi, disk/WAL ve SQLite beklemeleri ölçülür; yalnız kısa tepe testi yeterli sayılmaz.
- [ ] Normal karışık yük için başlangıç hedefleri kayıt p95 ≤2 saniye, rapor p95 ≤3 saniye ve beklenmeyen hata <%1 ile karşılaştırılır. Giriş/yazma tepesinin bekleme ve toparlanma süresi ayrıca yazılır; yalnız ortalama süreyle başarı ilan edilmez.
- [ ] Başarılı mali işlem kaybı, çift işlem ve hesap/onay tutarsızlığı sıfır olmalıdır. Tekrar gönderim, eşzamanlı düzeltme ve işlem ortasında çökme sınanır; beklenen 409/429/yetki reddi ayrı sayılır, meşru kullanıcının engellenmesi başarılı kapasite sayılmaz.
- [ ] S6.3–S6.5'in arıza, ekip uyarısı, yedek ve restore kanıtları aynı yayın kabulüne bağlanır. Önceden yapılmış denemenin uyumsuz sürüm sonucu yeni sürüm için doğrudan geçerli sayılmaz.
- [ ] Pilot öncesinde ilgili açık ürün kararları, hesap/alan adı erişimleri, yardım sorumlusu, günlük sağlık/yedek kontrolü ve kurtarma/yayın adımları kayıtlıdır. Telefon akışı S3.6'daki temsili kullanım sonuçlarıyla birlikte değerlendirilir.
- [ ] Bulgular dar boğaz gösterirse sorgu/işlem iyileştirmesi veya kapasite değişimi gerekçesi yazılır. 4 GB pakete ya da PostgreSQL'e sessizce geçilmez; pilot kapsamı ve başlangıcı belirlendiğinde kontrollü pilot yayını ve yayın sonrası temel giriş/kayıt/onay/rapor kontrolü yapılır. Hazır, yayınlandı ve yayın doğrulandı durumları ayrılır; bu belge teslim tarihi veya canlı yayın kanıtı sayılmaz.

**Bağımlılık:** S1.6, S2.6, S3.6, S4.4, S4.5, S4.6, S5.5, S6.5.  
**Referans:** [PRD](PRD.md) §1, §8–11; [Epics](EPICS.md) PRD kapsam eşlemesi ve E6; [Architecture](ARCHITECTURE.md) §9–11; [Tech Stack](TECH-STACK.md) §5, §8–10.  
**Açık sınır:** K1–K9'un pilot akışını etkileyen kararları. İşletim rehberi mevcut kullanıcı işlerini ve seçilen tek makineyi kapsar; yeni abonelik, müşteri bildirimi veya satış özelliği eklenmez. Testler ilgili hikâyelerle yazılır, tüm test geliştirmesi bu son işe bırakılmaz.

## Bağımlılık ve çalışma sırası

Numaralar hikâyelerin kalıcı kimliğidir; geliştirme sırası bağımlılıklardan gelir. “Bağımlılık” satırları son kabul için gereken işleri de içerir. Bir hesap/form/işletim hazırlığının erken başlanabileceği yer ayrıca belirtilmiştir; erken başlama, ortak kabulün tamamlandığı anlamına gelmez.

| Sıra | Hikâyeler | Elde edilen sonuç |
|---|---|---|
| 1 | S1.1 | Yerel proje, şema ve otomatik kontrol temeli |
| 2 | S1.4 → S1.5 | Oturum ve kapsam kontrolleri |
| 3 | S1.2 ve S1.3 → S1.6 | Araç/ekip girişi ve telefon durumları |
| 4 | S2.1 → S2.2 | Gerçek ekranlardan işletme/sahip/araç oluşturma |
| 5 | S2.3 ve S2.4 → S2.5 → S2.6 | Şifre, şoför, destek hedefi/geçmişi ve ekip yönetimi |
| 6 | S3.1 → S3.2 → S3.3 → S3.4 → S3.5 → S3.6 | Tek form, doğru para hesabı ve kalıcı/düzeltilebilir çalışma |
| 7 | S4.1 → S4.2 → S4.3 → S4.4 → S4.5; S4.6 kendi bağımlılıklarıyla | İlk para onayı, tek işlemde onaylı düzeltme, geçmiş ve şoföre sonuç |
| 8 | S5.2 ve S5.3 → S5.4 → S5.1 → S5.5 | Araç/kişi hesabı, gün gün liste, sahip ve destek raporları |
| Paralel hazırlık | S6.1 E1 ile; S6.2 → S6.3 ilgili kurulum bilgileriyle | Kontrol edilmiş sürüm, kurulum ve arıza denetimi |
| Son kabul | S6.4 → S6.5 → S6.6, ilgili E4/E5 bağımlılıklarıyla | Yedek, gerçek restore, bütünleşik yük/veri kabulü ve pilot rehberi |

E5'in çalışma hesabı E3 verisiyle başlayabilir; güncel para onayı ve onaylı düzeltme kabulü E4'le birleşir. E6'nın yedek/dağıtım hazırlığı son aşamayı beklemez; tam mali veri ve raporla restore sonradan doğrulanır. Testler ilgili işlerle birlikte hazırlanır. Bu tablo teslim tarihi veya tamamlanmış iş listesi değildir; aşamaların kapsamı [MILESTONES.md](MILESTONES.md) belgesinde gruplandırılmıştır.

## Hikâyeleri etkileyen açık kararlar

Karar kodlarının ana kaynağı [Epics karar tablosudur](EPICS.md). Aşağıdaki konular sessizce kesinleştirilmez; etkilenen kabul kriterleri karar ve doğrulama tamamlanmadan kapatılmaz. Kesinleşmiş günlük akış ve tek işlemde onaylı düzeltme yeniden onay sorusuna dönüştürülmez.

| Karar | Bu belgede korunan sınır | Başlıca ilgili hikâyeler |
|---|---|---|
| K1 — Ortak şoför geçmişi / onaysız düzeltme | Ad seçimi kimlik kanıtı değildir; yeniden açma ve düzeltme kapsamı ayrıca belirlenir. | S1.2, S1.5, S3.5, S4.6 |
| K2 — Sahibin diğer araçları / araç bilgileri | Tek plaka erişimi kendiliğinden genişlemez. | S1.5, S2.2, S2.4–S2.5, E5 |
| K3 — Gece, süre, gün ve dönem | Aynı günün açık saat hesabı kesindir; gece dağılımı, eşit saat ve hafta başlangıcı açık kalır. | S3.1, S5.2–S5.4 |
| K4 — Onaylı sürüş türü dönüşümü | Aynı türde Düzelt ve onayla kesindir; şoför/sahip türleri arasında dönüşüm açılmaz. | S4.3, S4.5, S5.2 |
| K5 — Negatif kalan | Matematiksel sonuç sıfıra çekilmez; kayıt/teslim sunumu ve kabul davranışı ayrıca tamamlanır. | S3.2, S4.1–S4.3, E5 |
| K6 — Masraf ayrıntıları / bağımsız gider | Günlük isteğe bağlı gider kesindir; kategori, kalem, sigorta/vergi ve ilgili filtreler karara bağlıdır. | S3.2, S5.2–S5.4 |
| K7 — Çevrimdışı kuyruk / senkronizasyon | Sunucuya kaydedilmemiş taslak başarı sayılmaz; güvenli tekrar gönderim her durumda gereklidir. | S3.4, S3.6, S6.6 |
| K8 — Ortak sahiplik / devir | İlk sahip tanımı geçmişi dönüştüren devir veya ortaklık akışı eklemez. | S2.1–S2.2, S2.5, E4 |
| K9 — Sürüm, şifre teslimi ve işletim erişimleri | Uyumlu sürüm, hesap/alan adı, dış sağlık kontrolü ve ekip kanalı ilgili uygulama öncesi belirlenir. | S1.1, S1.3, S2.3, S2.6, E6 |

## Kabul takibi ve sonraki adım

PRD'nin 28 kabul maddesinin ana sorumlulukları [EPICS.md](EPICS.md) belgesinde korunur. Burada her gruptaki uygulama ve kontrol işleri ayrıntılandırılmıştır:

| Ana grup | PRD §9 maddeleri | Hikâye kapsamı ve birlikte doğrulanacak parçalar |
|---|---|---|
| E1 | 12, 16, 18, 22 | S1.1–S1.6; gerçek şifre/aktiflik değişiklikleri E2 ile |
| E2 | 2, 19, 23, 24, 28 | S2.1–S2.6; #2 formu E3, #19 geçmiş raporu E5, #28 müşteri desteği E3–E5 ile |
| E3 | 1, 3, 4, 5, 7, 8, 9, 13, 17, 25 | S3.1–S3.6; giriş kolaylığı E1, nihai kişi/araç raporu E5 ile |
| E4 | 6, 15, 20, 26, 27 | S4.1–S4.6; güncel onayın dönem hesabı E5 ile |
| E5 | 10, 11, 21 | S5.1–S5.5; sabit kişiler E2, çalışmalar E3, onay/düzeltme E4 ile |
| E6 | 14 | S6.1–S6.6; tekrar gönderim E3/E4'te geliştirilir, kalıcılık ve restore ile birlikte sınanır |

**35 hikâyenin metni hazırdır.** Boş kabul kutuları henüz uygulanıp doğrulanmamış davranışları gösterir; belge hazırlamak testlerin geçtiği anlamına gelmez. Açık kapsam kararları ilgili hikâyelerde işaretlidir.

[Milestones](MILESTONES.md) altı geliştirme aşamasını, [Tasks](TASKS.md) her hikâyenin teknik iş paketini tanımlar. Kullanıcının son talebiyle [QA planı](QA-PLAN.md), [Release](RELEASE.md) ve [Ops](OPS.md) da **koddan önce** hazırlanır. Testler ilgili özelliklerle birlikte uygulanır; yayın ve işletim kanıtları gerçek kurulum/denemelerle tamamlanır.

Bu dosyalardaki planlar uygulama, GitHub Issue, bulut kurulumu veya canlı yayın yapıldığı anlamına gelmez. Geliştirme ilk milestone'un ilgili iş paketinden başlayacaktır; kritik ürün sınırları ve gerçek ortam bilgileri ilgili adımlarda görünür tutulur.

## Onaylar

| Kişi / kapsam | Durum | Tarih |
|---|---|---|
| Doğukan — Stories hazırlama | İlk E1/E2 grubu sonrası “devam” talebiyle kalan hikâyelere geçildi | 2026-09-15 |
| Codex — hikâyelerin yazımı | Altı epic için 35 hikâye, kabul kriterleri ve bağımlılıklar yazıldı | 2026-09-15 |
| Kesin ürün kuralları | Mevcut PRD kararları korundu | 2026-09-15 |
| Açık ürün tercihleri | İlgili sınırlarda görünür; kendiliğinden onaylanmadı | — |
| Uygulama / kabul testleri / süre taahhüdü | Henüz yapılmadı veya verilmedi | — |
