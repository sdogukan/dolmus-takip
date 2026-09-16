# ADR-002 — Güncel kayıt, sürüm geçmişi ve atomik para onayı

**Tarih:** 2026-09-15 · **Durum:** Ürün kuralı onaylı; teknik tasarım incelemede  
**Bağlam:** [PRD §7](../PRD.md), [Mimari §3](../ARCHITECTURE.md)

Güncel çalışma kaydı raporları besler. Her mali değişiklik ayrı, değiştirilmeyen revizyon üretir; para onayı belirli kayıt sürümüne bağlanır. Ortak şoför, sahip ve ekip aktörü ile fiilen çalışan kişi ayrı tutulur.

Doğukan onaylı kaydın “Düzelt ve onayla” ile tek işlemde güncellenmesini seçti. Güncel kayıt, yeni revizyon, yeni para onayı ve tekrar gönderim sonucu aynı transaction içinde yazılacak. Hata halinde hiçbir parçası kalmayacak. Raporlar yalnız güncel sürümün onayını toplar; eski onaylar para toplamını çoğaltmaz.

İşlem anahtarı ağ hatasından sonra tekrar gönderimi; sürüm numarası aynı kaydı eşzamanlı düzenlemeyi denetler. Aynı gün birden fazla gerçek çalışmaya izin verildiğinden araç/kişi/tarih benzersizliği kullanılmaz.

Para integer kuruş, oran sabit hesap kuralı sürümüyle tutulur. İşletme kapsamı sorgularda uygulanır; birleşik foreign key’ler işletmeler arasında yanlış ilişkiyi engeller. SQL erişim kontrolünün yerine geçmez.

Bu yapı tam olay kaynaklı sistem veya genel muhasebe motoru değildir. Tarih/kişi düzeltmesi yeni sürümde rapora yansır; önceki dağılım geçmişte kalır. Driver/owner tür dönüşümü, farklı para anlamı taşıdığı için açık ürün kenar durumu olarak tutulur.

**Karar durumu (2026-09-17):** K1–K8 için buradaki öneriler ürün sahibi tarafından aynen kabul edildi; K9 sürümleri kanıtla sabitlendi. Nihai kararlar ve gerekçeler [DECISIONS.md](../DECISIONS.md) dosyasındadır; bu bölümdeki 'açık/onay bekliyor' ifadeleri tarihsel bağlamdır.
