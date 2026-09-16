# ADR-003 — Araç/rol oturumu ile fiilen çalışan kişinin ayrılması

**Tarih:** 2026-09-15 · **Durum:** Seçilmiş giriş modelinin mimari karşılığı  
**Bağlam:** [PRD §2](../PRD.md), [Mimari §6](../ARCHITECTURE.md)

Kullanıcı adı plaka; araç başına sahip ve ortak şoför için iki farklı parola var. Şoför adı listeden seçilir. Seçilen kişi kaydı hesap/rapor kimliğidir, giriş yapan gerçek kişinin doğrulandığı anlamına gelmez.

SQLite’ta iptal edilebilir sunucu oturumu kullanılacak. Tarayıcı yalnız rastgele token taşır; rol, araç ve işletme sunucudan çıkarılır. İstemcinin gönderdiği rol veya kişi seçimi sahip yetkisi kazandırmaz. Parola sıfırlama/pasifleştirme eski oturumları geçersiz kılar.

Back office kişisel ekip hesaplarıyla açılır; destek işlemi müşteri girişine dönüşmez. Gerçek ekip kullanıcısı, hedef işletme/araç ve kim adına çalıştığı geçmişe yazılır. Sahip adına şoför kaydı giren ekip %20 pay hesaplar; yalnız sahibin kendi sürüşünde pay sıfırdır.

Ortak şifre aynı araçtaki kişiler arasında bireysel gizlilik garantisi sağlamaz. Şoför geçmişi ve onaysız düzeltme kapsamı ürün incelemesinde açık tutulur; bu belirsizlik geniş API erişimi verilerek kapatılmaz.

OTP, kimlik numarası, dış auth sağlayıcısı veya herkese açık kayıt eklenmedi. İleride kişiye özel erişim gerekirse kişi hesaplarına geçiş ayrı bir ürün ve mimari kararı olacaktır.

**Karar durumu (2026-09-17):** K1–K8 için buradaki öneriler ürün sahibi tarafından aynen kabul edildi; K9 sürümleri kanıtla sabitlendi. Nihai kararlar ve gerekçeler [DECISIONS.md](../DECISIONS.md) dosyasındadır; bu bölümdeki 'açık/onay bekliyor' ifadeleri tarihsel bağlamdır.
