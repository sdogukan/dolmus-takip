# Giriş ekranı — manuel telefon kontrol listesi (S1.6)

Bu liste, `docs/QA-PLAN.md` §5 "Manuel telefon kontrolü" maddelerinden
**yalnız giriş ekranıyla (`/giris`, `/yonetim/giris`) ilgili, otomatikleştirilemeyen**
kısmı kapsar (gerçek dokunma, gerçek ekran okuyucu, gerçek işletim sistemi
klavyesi). `docs/QA-PLAN.md` §5'in geri kalanı (kişi seçimi, saat/para
girişi, sahip onayı vb.) sonraki paketlerin (S3.6, ilgili E2 hikâyeleri)
kapsamındadır ve burada tekrarlanmaz.

Bu dosya bir kabul kanıtı DEĞİLDİR; yalnız pilot/yayın öncesi gerçek
cihazda yürütülecek adımları KAYIT ALTINA alır. Doldurulan kutucuklar
`docs/QA-PLAN.md` §4 "Bulgu ve kanıt takibi" biçimine göre (QA/Story/AC ·
adımlar · beklenen/gerçek · ortam/sürüm · kanıt · sorumlu) ayrı bir bulgu
kaydına dönüştürülür; bu belge kendisi bir bulgu kaydı değildir.

**Ortam:** sürüm/commit: `______`  ·  tarih: `______`  ·  test cihazı:
`______`  ·  tarayıcı/OS sürümü: `______`  ·  test kullanıcısı (plaka/rol
veya kullanıcı adı — `scripts/db-seed-dev.ts` test verisi, gerçek üretim
şifresi DEĞİL): `______`

## 1. Android Chrome — gerçek cihaz

- [ ] `/giris` linkinden gerçek dokunmayla açılır; plaka alanına dokunulduğunda
      ekran klavyesi açılır ve "Giriş yap" düğmesi klavyenin ARKASINDA
      kalmaz (gerekirse sayfa kendiliğinden kaydırılır).
- [ ] Plaka alanı normal metin klavyesi açar (sayı klavyesi DEĞİL); Şifre
      alanı şifre klavyesini açar, "Göster" ile girilen şifre okunabilir.
- [ ] Doğru plaka/şifreyle giriş 30–60 saniye hedefinin İÇİNDE, yardım
      almadan tamamlanır; süre ve varsa yardım ihtiyacı not edilir
      (`docs/QA-PLAN.md` §5 birinci madde — önceden başarı ilan edilmez).
- [ ] Yanlış şifreyle "Plaka veya şifre yanlış." mesajı okunur biçimde
      görünür; plaka alanı SİLİNMEMİŞ.
- [ ] TalkBack açıkken: her alan adı (Plaka/Şifre) okunur; hata oluşunca
      TalkBack hatayı OTOMATİK duyurur (kullanıcı alanı tekrar
      dokunmadan); "Giriş yapılıyor…" durumu duyurulur.
- [ ] Uçak modu açıkken giriş denemesi "Bağlantı kurulamadı. Tekrar dene."
      benzeri anlaşılır bir mesaj verir; teknik hata/yığın izi YOKTUR.
      Uçak modu kapatılıp tekrar denendiğinde giriş başarıyla tamamlanır.
- [ ] Cihazın "Metin boyutu" veya "Görüntü boyutu" ayarı büyütülmüş
      durumda (sistem erişilebilirlik ayarı, tarayıcı yakınlaştırması
      DEĞİL) form hâlâ yatay kaydırma olmadan kullanılabilir.

## 2. iPhone Safari — gerçek cihaz

- [ ] `/giris` linkinden gerçek dokunmayla açılır; klavye açıldığında
      önemli alan/düğme klavyenin ARKASINDA kalmaz.
- [ ] Doğru plaka/şifreyle giriş 30–60 saniye hedefinin İÇİNDE, yardım
      almadan tamamlanır; süre ve varsa yardım ihtiyacı not edilir.
- [ ] Yanlış şifreyle hata mesajı görünür; plaka alanı korunur.
- [ ] VoiceOver açıkken: sağa/sola kaydırma ile alanlar sırayla (Plaka →
      Şifre → Göster/Gizle → Giriş yap) gezilir; her biri adıyla
      (etiketiyle) okunur, yalnız "düzenleme alanı" DENMEZ.
- [ ] VoiceOver açıkken hata oluşunca hata metni OTOMATİK duyurulur
      (`role="alert"`); "Giriş yapılıyor…" durumu da duyurulur.
- [ ] Uçak modu açıkken/kapatılıp tekrar denendiğinde Android Chrome'daki
      ile AYNI davranış (anlaşılır hata → başarılı tekrar deneme).
- [ ] Safari'nin kendi "Sayfayı Büyüt" (yakınlaştırma) hareketiyle
      (parmakla pinch-zoom) form kullanılabilir kalır; yakınlaştırılmış
      alanlara dokunmak doğru alana odaklanır.

## 3. Ortak dokunma/klavye kontrolleri (her iki cihaz)

- [ ] "Giriş yap" ve "Göster/Gizle" dokunma hedefleri parmakla rahat
      dokunulabilir büyüklükte (yanlışlıkla komşu öğeye dokunma YOK).
- [ ] Ekran klavyesi kapatıldıktan sonra (ör. "Bitti"ye basınca) form
      durumu (girilen değerler) KORUNUR.
- [ ] Gerçek dokunmatik double-tap (çift dokunma) ile "Giriş yap"a
      basıldığında YALNIZ tek bir giriş denemesi olur (ör. iki kez ekranın
      açıldığı/geçiş yaptığı gözlenmez).

## Sonuç ve kayıt

- [ ] Bulunan her sapma (beklenen ≠ gerçek) `docs/QA-PLAN.md` §4
      biçiminde ayrı bir bulgu kaydına dönüştürüldü.
- [ ] Bu listenin tamamlanma tarihi ve sonucu ilgili yayın/pilot kararının
      kanıt zincirine eklendi.

# Günlük kayıt ve kayıt sonucu — manuel telefon kontrol listesi (S3.6)

`docs/QA-PLAN.md` §5 "Manuel telefon kontrolü"nün günlük kayıt bölümüdür
(şoför `/sofor`, sahip `/sahip/kayit/yeni`; ekip `/yonetim/araclar/<id>/kayit/yeni`
yalnız 3. bölümde). Otomatik testler (`driver-daily-form.spec.ts`,
`owner-staff-work-entry.spec.ts`) kopmayı ve uçak modunu SİMÜLE eder; burada
gerçek cihaz, gerçek ağ ve gerçek ekran okuyucu denenir. Bu dosya bir kabul
kanıtı DEĞİLDİR; yukarıdaki §1 ile aynı biçimde bulgu kaydına dönüştürülür
ve süreler önceden başarı ilan edilmeden, ölçüldüğü gibi yazılır.

**Ortam:** sürüm/commit: `______`  ·  tarih: `______`  ·  test cihazı:
`______`  ·  tarayıcı/OS sürümü: `______`  ·  test kullanıcısı (plaka/rol —
`scripts/db-seed-dev.ts` test verisi): `______`

## 1. Süre ve yardım (Android Chrome ve iPhone Safari, her cihazda ayrı)

Şoför olarak, ilk kez görmeyen biri değil, pilot kullanıcı profilinde biriyle:
giriş yapıldıktan sonra günlük kayıt formu doldurulup "Kaydedildi" görülene
kadar.

- [ ] Süre (hedef 30–60 sn): `______` sn  ·  yardım alındı mı: `evet / hayır`
- [ ] Yapılan hata sayısı ve türü (yanlış kişi, yanlış saat, virgül/nokta,
      yanlış düğme...): `______`
- [ ] Takıldığı adım ve neden: `______`  (ör. kişi seçimi, saat girişi,
      tutar biçimi, "Kaydet"i bulma)
- [ ] Kayıt sonucu ekranı okundu: kişi, plaka, gün, saat aralığı ve teslim
      edilecek tutar kullanıcının sözüyle doğrulandı: `evet / hayır`
- [ ] Ekranda "teslim ettim" veya "onaya gönder" gibi bir eylem
      ARANDI mı / yanlışlıkla beklendi mi: `______`

## 2. Bağlantı durumları (gerçek ağ)

- [ ] Uçak modu açıkken "Kaydet": "Bağlantı yok. Henüz kaydedilmedi." görünür,
      HİÇBİR alan silinmez; uçak modu kapanınca "Kaydet" tek kayıt yazar.
- [ ] Kayıt sırasında bağlantıyı kes (gönderim başladıktan hemen sonra uçak
      modu): "Kaydın sonucu kontrol ediliyor." görünür, alanlar kilitli,
      "Başka bir çalışma kaydı gir" YOK. Bağlantı gelince kendiliğinden
      "Kaydedildi" görünür veya "Sonucu şimdi kontrol et" ile görünür; sunucuda
      (sahip ekranı / kayıt listesi) YALNIZ bir kayıt vardır.
- [ ] Belirsiz sonuçta sayfayı kapatıp yeniden aç: sonuç kendiliğinden
      kontrol edilir; ikinci kayıt oluşmaz.
- [ ] Oturum bitince (ör. başka cihazdan çıkış) "Oturumun sona erdi. Yeniden
      giriş yap." ve "Yeniden giriş yap" bağlantısı görünür; aynı plaka/şifreyle
      girince bekleyen kayıt çözülür; başka araçla giriş yapılırsa önceki
      aracın taslağı GÖRÜNMEZ.
- [ ] "Yenile" ve "Kaydı aç" çalışır; bağlantı yokken "Yenile" anlaşılır
      bir hata verir ve kayıt ekranı kaybolmaz.

## 3. Dokunma, ekran ve erişilebilirlik

- [ ] 320 px genişlikte (küçük telefon veya yakınlaştırma) form ve kayıt
      sonucu yatay kaydırma OLMADAN okunur; çok uzun bir kişi adı ve büyük
      bir tutarla da taşma yoktur.
- [ ] Tüm düğme/bağlantı/alanlar parmakla rahat dokunulur (en az 48 px);
      "Kaydet" belirgin biçimde daha büyüktür (en az 56 px).
- [ ] "Kaydet"e gerçek çift dokunuşta YALNIZ bir kayıt oluşur.
- [ ] Ekip hesabıyla (`/yonetim/araclar/<id>/kayit/yeni`) aynı kayıt
      sonucu ve bağlantı durumları çalışır.
- [ ] TalkBack (Android) ve VoiceOver (iPhone): "Kaydediliyor…" ve "Kaydın
      sonucu kontrol ediliyor." OTOMATİK duyurulur; kayıt sonrası odak
      "Kaydedildi"ye gider ve ardından kişi/plaka/saat/tutar sırayla okunur;
      hata metinleri kendiliğinden duyurulur.

## Sonuç ve kayıt

- [ ] Bulunan her sapma `docs/QA-PLAN.md` §4 biçiminde ayrı bir bulgu kaydına
      dönüştürüldü (süre hedefi aşıldıysa ve takılma adımı yazıldıysa dahil).
- [ ] Tamamlanma tarihi ve sonucu ilgili pilot kararının kanıt zincirine eklendi.
