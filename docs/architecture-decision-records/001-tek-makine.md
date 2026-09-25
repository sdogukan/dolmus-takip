# ADR-001 — Tek makine, tek uygulama ve doğrudan kurulum

**Tarih:** 2026-09-15 · **Durum:** Seçilmiş Tech Stack’in mimari karşılığı  
**Bağlam:** [Tech Stack](../tech-stack.md), [Mimari](../architecture.md)

Hedef en fazla 500 toplam kullanıcıdır; 100 eşzamanlı kullanım test edilecek bir tepe senaryosudur. İlk sürüm tek Lightsail üzerinde Caddy, tek Node/Next uygulaması ve yerel SQLite ile çalışacak. Kod, veri erişim sınırlarıyla bölünecek; bağımsız servisler kurulmayacak.

Docker kullanılmayacak. Caddy ve uygulama systemd ile yönetilecek; donma için ayrı yerel sağlık kontrolü çalışacak. Derleme hedef Linux ortamında CI’da yapılacak, üretim çıktısı SSH ile kontrollü yayınlanacak. Makinenin 2 GB belleğinin üretim derlemesine yeterli olduğu varsayılmayacak.

Bu karar bakım ve servis sayısını küçük tutar. Tek makine arızası tüm uygulamayı etkiler; yüksek erişilebilirlik iddiası yoktur. Daha fazla RAM, sorgu iyileştirmesi ve PostgreSQL farklı sorunlara verilen seçeneklerdir. Ölçüm olmadan kapasite garantisi verilmez.

Yeniden değerlendirme: bellek baskısı, CPU veya sürekli yazma beklemesi; çoklu uygulama sunucusu ihtiyacı; kabul edilmiş kurtarma süresinin günlük snapshot ile karşılanamaması. Docker gelecekte ayrıca ele alınabilir; bugünkü dağıtımın ön koşulu değildir.
