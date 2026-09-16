# İlerleme Checklist'i

Kural: her adım bitince `[x]` işaretle, kısa not ekle. Compact sonrası ilk işaretlenmemiş adımdan devam.
Tüm ajanlar `claude-sonnet-5`. Her task paketi = Workflow (uygula → 3 mercek doğrula → düzelt → kapı) → commit.
KAPI: M1 bitince DUR ve kullanıcıdan devam izni al. M2–M6 için de her milestone sonunda DUR. Deploy (AWS) öncesi DUR.
Ajan betiği: scratchpad/task-uygula.js (args: task, story, milestone, steps?, extraContext?). Yoksa yeniden yaz (CLAUDE.md'deki kurallara göre).

## Faz 0 — Anlama ve inceleme
- [x] 0.1 Tüm dokümanlar Sonnet 5 ajanlarıyla okundu ve özetlendi (14 okuyucu, wf_1343f41f-1cc)
- [x] 0.2 38 aday bulgu 3'lü çürütmeden geçti → 20 birleşik bulgu, M1 engeli yok (docs/DECISIONS.md Faz 0 tablosu)
- [x] 0.3 K1–K8 kullanıcı kabul etti (doküman önerileri), K9 sürümler kanıtla sabitlendi → docs/DECISIONS.md (2026-09-17)
- [x] 0.4 Uygulama sırası aşağıya işlendi; mühendislik kararları DECISIONS.md'de
- [ ] 0.5 Doküman senkronu (F1/F2/F7/F19: karar notları, PRD §5 parantezi, 409 metni) + ilk commit

## M1 — Güvenli giriş ve geliştirme temeli (sıra: MILESTONES §M1)
- [ ] T1.1 (S1.1) Uygulama, migration ve otomatik kontrol temeli
- [ ] T1.4 (S1.4) Sunucu oturumu, çıkış ve erişim iptali
- [ ] T1.5 (S1.5) İşletme/araç kapsamı ve işlem yetkileri
- [ ] T1.2 (S1.2) Plaka ve şifreyle araç girişi
- [ ] T1.3 (S1.3) Kişisel ekip girişi ve ilk yönetici kurulumu
- [ ] T1.6 (S1.6) Telefon girişi hata/bekleme/erişilebilirlik
- [ ] T6.1 (S6.1) Hedefle uyumlu derleme, CI ve yayın çıktısı (GitHub'da gerçek koşu push sonrası; yerel eşdeğeri çalışır)
- [ ] M1 KAPI: MILESTONES §M1 tamamlanma kutuları kontrol → kullanıcıya özet → DEVAM İZNİ BEKLE

## M2 — Araç ve şoför yönetimi
- [ ] T2.1 (S2.1) İşletme ve mal sahibi tanımlama
- [ ] T2.2 (S2.2) Araç oluşturma, düzenleme, aktiflik
- [ ] T2.3 (S2.3) Araç şifrelerini belirleme ve sıfırlama
- [ ] T2.4 (S2.4) Şoförlerim, sabit kişi, araç atamaları (+F3 uyarısı)
- [ ] T2.5 (S2.5) Yönetimde müşteri hedefi ve işlem geçmişi
- [ ] T2.6 (S2.6) Kişisel ekip hesabı ve yetki yönetimi
- [ ] M2 KAPI: kullanıcıya özet → DEVAM İZNİ BEKLE

## M3 — Günlük çalışma ve para hesabı
- [ ] T3.1 (S3.1) Aktif kişi, tarih ve saatlerle günlük form (K3)
- [ ] T3.2 (S3.2) Para girdileri, otomatik pay/kalan, sunucu hesabı (K5, K6)
- [ ] T3.3 (S3.3) Sahip çalışması ve müşteri adına kayıt
- [ ] T3.4 (S3.4) Kalıcı kayıt, ilk revizyon, tekrar gönderim koruması (F6 localStorage)
- [ ] T3.5 (S3.5) Onaysız/sahip çalışmasını düzeltme, sürüm çakışması (K1)
- [ ] T3.6 (S3.6) Kayıt sonucu, bağlantı hataları, telefon kullanımı
- [ ] M3 KAPI: kullanıcıya özet → DEVAM İZNİ BEKLE

## M4 — Teslim doğrulaması ve düzeltme
- [ ] T4.1 (S4.1) Kayıt detayı ve ilk alınan para onayı
- [ ] T4.2 (S4.2) Beklenenden farklı alınan tutar
- [ ] T4.3 (S4.3) Onaylı kaydı tek işlemde düzelt ve onayla (K4 kapalı)
- [ ] T4.4 (S4.4) Sürüm, önce/sonra ve onay geçmişi
- [ ] T4.5 (S4.5) Platform desteği adına teslim/düzeltme
- [ ] T4.6 (S4.6) Şoföre teslim durumu, yetkisiz değişiklik engeli (K1)
- [ ] M4 KAPI: kullanıcıya özet → DEVAM İZNİ BEKLE

## M5 — Özet ve dönem raporları
- [ ] T5.2 (S5.2) Araç dönem hesabı ve güncel teslim toplamı (K3, F17)
- [ ] T5.3 (S5.3) Kişi çalışma günleri, saatler, para dökümü
- [ ] T5.4 (S5.4) Gün gün kayıtlar, filtreler, sayfalama
- [ ] T5.1 (S5.1) Sahip özeti ve doğrulanmamış kayıt listesi
- [ ] T5.5 (S5.5) Rapor tutarlılığı, sorgu planı, destek görünümü (+F12 senaryosu)
- [ ] M5 KAPI: kullanıcıya özet → DEVAM İZNİ BEKLE

## M6 — İşletim doğrulaması ve kontrollü pilot
- [ ] M6 ÖN-KAPI: kullanıcıya sor → AWS hesabı/Lightsail, alan adı, şifre teslim yöntemi, uyarı kanalı, dış sağlık kontrolü, KVKK metni/silme politikası (F8/F14/F16), GitHub push
- [ ] T6.2 (S6.2) Lightsail, HTTPS, kalıcı dizinler, sürümlü kurulum
- [ ] T6.3 (S6.3) Çökme/donma denetimi, dış sağlık kontrolü, uyarı (+F13 OPS satırları)
- [ ] T6.4 (S6.4) Tutarlı günlük DB kopyası, snapshot, saklama
- [ ] T6.5 (S6.5) Restore, migration, güvenli geri dönüş (+F5 ileri düzeltme prosedürü)
- [ ] T6.6 (S6.6) Yük/veri bütünlüğü kabulü ve pilot rehberi
- [ ] M6 KAPI: pilot yayını kullanıcı kararı
