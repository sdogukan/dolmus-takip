# Karar Kaydı (geliştirme oturumu)

**Tarih:** 2026-09-17 · **Karar veren:** Doğukan (ürün sahibi/geliştirici) · **Kaydeden:** Claude (orkestratör)

Bu dosya EPICS.md K1–K9 açık kararlarının kapanış kaydıdır. Kaynak öneriler ARCHITECTURE §10, PRD §10, DESIGN §2.11.

## K1–K8 — 2026-09-17 kabul edildi ("Hepsini kabul et")

| Kod | MVP kararı | Etkilediği paketler |
|---|---|---|
| K1 | Ortak şoför, aynı araçta seçtiği kişinin kayıtlarını listeler. Onaysız düzeltmeyi yalnız çalışma günü (work_date = bugün, Europe/Istanbul) yapabilir. Kişi seçimi kimlik kanıtı değildir. | S1.5, S3.5, S4.6, S5.4 |
| K2 | Sahip oturumu yalnız giriş yapılan aracı kapsar. Çok araçlı dashboard ilk sürümde yok. Sahibin araç bilgisi düzenleme yetkisi yok (ekip yapar). | S1.5, S2.2, S5.x |
| K3 | Gece geçişinde bitiş günü açıkça gösterilir. Süre 0 dk'dan büyük ve en fazla 24 saat (1440 dk). Kayıt work_date = başlangıç günü. Hafta pazartesi başlar. Dönem sınırları [başlangıç, sonraki başlangıç). Eşit saatler = bitiş ertesi gün (24 saat) değil; süre 0 reddedilir, gece geçişi için bitiş tarihi açıkça verilir. | S3.1, S5.2–S5.4 |
| K4 | Onaylı kayıtta driver↔owner sürüş türü dönüşümü ilk sürümde kapalı; correct-and-confirm aynı türde kalır, tür değişimi 422. | S4.3, S5.2 |
| K5 | Hesaplanan kalan negatifse olduğu gibi gösterilir, sıfıra çekilmez, kullanıcı açıkça uyarılır. Alınan tutar ayrı alan, ≥ 0. Borç/ödeme motoru yok. | S3.2, S4.1–S4.2, S5.x |
| K6 | Diğer masraf: tek tutar (other_expense_cents) + açıklama (other_expense_note). Kategori/kalem ve sigorta/vergi gibi bağımsız sahip giderleri ilk sürümde yok. | S3.2, S5.2–S5.4 |
| K7 | Çevrimdışı kuyruk yok. Sunucu bağlantısı şart. Form taslağı ve request_id sessionStorage'da korunur; sunucuda kaydedilmemiş işlem başarı gösterilmez. | S3.4, S3.6 |
| K8 | Araçta tek owner_person_id. Ortak sahiplik ve devir akışı ilk sürümde yok; geçmiş kayıtlar kendiliğinden dönüşmez. | S2.1–S2.2 |

## K9 — Kesin sürümler (2026-09-17, kanıtla sabitlendi)

Yerel ortam: macOS arm64, Node v24.18.0, npm 11.16.0. Hedef: Ubuntu LTS x86_64, Node 24 LTS (güncel 24.21.0).

| Paket | Sürüm | Kanıt |
|---|---|---|
| node | 24.x LTS (engines ">=24") | nodejs.org index: 24.21.0 aktif LTS "Krypton" |
| next | 16.3.5 | npm latest; engines node ≥20.9 |
| react / react-dom | 19.3.0 | next 16 peer ^19 |
| typescript | 5.9.3 | typescript-eslint peer "<6.1.0"; TS 7 (tsgo) eslint-config-next zinciriyle uyumsuz |
| drizzle-orm | 0.45.2 | peer better-sqlite3 ≥7 |
| drizzle-kit | 0.31.10 | npm latest |
| better-sqlite3 | 13.0.3 | Gömülü SQLite **3.53.4** ≥ 3.51.3 (ARCHITECTURE §3.6 kapısı) — `SELECT sqlite_version()` ile doğrulandı |
| argon2 | 0.45.1 | Argon2id m=19456,t=2,p=1 yerel derleme doğrulandı |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | npm latest |
| vitest | 5.0.1 | npm latest |
| @playwright/test | 1.63.0 | next 16 peer ^1.51.1 |
| zod | 4.6.5 | npm latest |
| eslint / eslint-config-next | 10.10.0 / 16.3.5 | npm latest |
| Paket yöneticisi | npm (package-lock.json) | QA-PLAN §3 `npm run ...` komutlarını kullanır |

K9'un kalan kalemleri (şifre teslim yöntemi, alan adı, AWS hesap erişimi, dış sağlık kontrolü, uyarı kanalı) M6/deploy aşamasında kullanıcıya sorulacak; uygulama içinde SMS/e-posta yok.

## Oturum kararları
- Commit stratejisi: her task paketi (T1.1, T1.2, ...) sonunda ayrı commit. Push yok; GitHub/deploy aşamasında sorulacak.

## Faz 0 inceleme bulgularından çıkan mühendislik kararları (2026-09-17)

Faz 0: 14 doküman, 7 mercek, 38 aday bulgu, 3'lü çürütme; 20 birleşik bulgu. Hiçbiri M1'i engellemiyor. Kararlar:

| # | Bulgu | Karar | Uygulanacağı paket |
|---|---|---|---|
| F1/F2/F19 | DECISIONS.md kararları PRD/ARCH/DESIGN/EPICS/ADR'lere yansımamış; PRD §5'te K2 ile çelişen parantez | Dokümanlara "2026-09-17 karar durumu → DECISIONS.md" notu; PRD §5 parantezi K2 ile uyumlu | Faz 0 doküman senkronu |
| F3 | Şoför araçta pasife alınınca ortak şoför şifresi geçerli kalır (model gereği) | Sahip ekranında uyarı: "Ortak şoför şifresi hâlâ geçerli. Erişimi tamamen kesmek için ekipten şifre sıfırlama isteyin." Ekip ekranında pasife alma yanında şifre sıfırlama bağlantısı | T2.4, T2.3 |
| F4 | Native modül paketleme modu belirsiz | Next.js `output: 'standalone'` + `outputFileTracingIncludes` (better-sqlite3, argon2). CI'da standalone çıktısında `require` + `SELECT sqlite_version()` ≥ 3.51.3 doğrulaması | T1.1, T6.1 |
| F6 | request_id yalnız sessionStorage'da; iOS sekme kapanınca çift kayıt riski | Taslak + request_id **localStorage**'da; anahtar = credential/platform_user kimliği + araç; TTL 24 saat; çıkış/oturum değişiminde temizlenir. ARCH §3.4 "tutulabilir" → bu şekilde tutulur | T3.4, T3.6 |
| F7 | 409 metni ARCH ile DESIGN'da farklı | Kanonik metin DESIGN: "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et." | Doküman senkronu; T3.5, T4.3 |
| F10 | Rol seçimsiz giriş = deneme başına ≤2 Argon2 doğrulaması | Hash kuyruğu kapasitesi hash işlemi başına sayılır; M6 yük testinde hash işlem sayısı ayrı raporlanır | T1.2, T6.6 |
| F11 | İlk yönetici erişimi kaybolursa kurtarma yok | Yerel CLI: `create-first-admin` (idempotent, S1.3) + `reset-admin-password --username` (yalnız sunucu shell, admin_audit'e yazar, public endpoint yok) | T1.3 |
| F15 | Başarısız giriş sayacı plaka bazlı; şoför hataları sahibi de yavaşlatabilir | ARCH §6 değerleri korunur (20 plaka/15 dk, 120 IP/15 dk); bilinçli trade-off; M6'da meşru engellenme raporlanır | T1.2 |
| F17 | "İşletme/araç genelinde çalışma günü" metriği adsız | "Araç çalışma günü" = dönemde en az bir kayıt olan farklı work_date sayısı; kişi çalışma günü kişi bazlı COUNT(DISTINCT work_date) | T5.2, T5.3 |

### M6 / deploy aşamasına ertelenenler
- F5: Şema uyumsuz migration + yeni yazma sonrası "ileri düzeltme" prosedürü T6.5'te tasarlanıp RELEASE.md'ye yazılacak.
- F8 + F16: KVKK aydınlatma metni ve silme/anonimleştirme politikası → deploy öncesi **kullanıcıya sorulacak** (teknik yol: people.full_name anonimleştirme, mali kayıt silinmez).
- F12: Ağır rapor sorgusu + eşzamanlı health-check senaryosu T5.5/T6.3 testine eklenecek; rapor aralığı ≤1 takvim yılı sınırı korunur.
- F13: Giriş sayacı ve Argon2 kuyruk izleme satırları OPS.md'ye T6.3'te eklenecek.
- F14: Şifre teslim yöntemi → deploy öncesi kullanıcıya sorulacak.
- F20: Plaka yeniden tahsisi MVP dışı; backlog notu. plate_normalized UNIQUE koşulsuz kalır.
