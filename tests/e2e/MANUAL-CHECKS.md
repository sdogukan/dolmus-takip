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
