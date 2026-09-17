# Dolmuş Takip

Dolmuş/minibüs işletmeleri için tek Node.js/Next.js uygulaması; yerel SQLite
(Drizzle/better-sqlite3) üzerinde çalışır. Bu belge yalnız **geliştirme
ortamını** kurar; hedef üretim çıktısı ve gerçek sunucu kurulumu M6 (E6)
paketlerinde tamamlanır (bkz. `docs/ARCHITECTURE.md` §8, `docs/TASKS.md`
T6.1+).

## Gereksinimler

- **Node.js 24** — repo kökündeki `.nvmrc` bu sürümü sabitler (`nvm use`).
- **npm** — bağımlılıklar `package-lock.json` ile kilitlenmiştir; başka bir
  paket yöneticisi (yarn/pnpm) kullanılmaz.

Kesin sürümler ve gerekçeleri için `docs/DECISIONS.md` K9'a bakın
(`better-sqlite3`, `argon2`, `drizzle-orm` gibi native/kritik bağımlılıklar
dahil).

## Kurulum

```bash
npm install
cp .env.example .env   # gerekirse DOLMUS_DB_PATH/NODE_ENV değerlerini düzenleyin
npm run db:init         # açık ilk şema kurulumu (bkz. aşağıdaki "Veritabanı" bölümü)
npm run db:seed-dev      # isteğe bağlı: yerel test verisi (yalnız geliştirme/test)
npm run dev
```

`.env` dosyası `.gitignore` ile hariç tutulur; yalnız `.env.example` commit'e
girer. Uygulama `DOLMUS_DB_PATH` tanımlı değilse anlaşılır bir hatayla durur,
sessizce bir varsayılana düşmez.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Next.js geliştirme sunucusu. |
| `npm run build` | Üretim derlemesi (`next build`); standalone çıktı üretir (aşağı bakın). |
| `npm run start` | `build` çıktısını üretim modunda çalıştırır. |
| `npm run typecheck` | `tsc --noEmit` — proje genelinde tip kontrolü. |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`). |
| `npm run test:unit` | Vitest birim testleri (`src/**/*.test.ts`) — dış kaynağa (DB/ağ) dokunmaz. |
| `npm run test:integration` | Vitest entegrasyon testleri (`tests/integration/**`) — gerçek geçici SQLite dosyaları ve gerçek migration ile çalışır; dosyalar arası sıralı yürütülür. |
| `npm run test:e2e` | Playwright uçtan uca testleri. **Not:** Tarayıcı ikilileri bu pakette indirilmedi; `npx playwright install` T1.6'da ele alınacaktır. |
| `npm run db:init` | Açık ilk şema kurulumu / bekleyen migration'ları uygular (idempotent). |
| `npm run db:seed-dev` | Yerel test verisini kurar (idempotent); yalnız `NODE_ENV=production` DEĞİLKEN çalışır. |
| `npm run db:generate` | `drizzle-kit generate` — şema (`src/server/data/schema.ts`) değiştiğinde yeni migration SQL dosyası üretir (yalnız geliştirici aracı; uygulamayı çalıştırmaz). |

## Veritabanı: konum ve kalıcılık

- Bağlantı yolu `DOLMUS_DB_PATH` ortam değişkeninden okunur (`.env.example`
  varsayılanı: `./data/dev.sqlite`). `data/` dizini `.gitignore` ile
  hariçtir — **kod ile kalıcı veri ayrıdır**: `git pull`, `npm install`,
  derleme veya kod geri alma işlemleri bu dosyayı asla silmez/değiştirmez.
- Uygulama eksik bir veritabanı dosyasını **sessizce oluşturmaz**
  (`docs/ARCHITECTURE.md` §8.1). İlk kuruluma yalnız açık `npm run db:init`
  komutu izin verir; dosya zaten varsa aynı komut yalnız bekleyen
  migration'ları uygular ve tanımları çoğaltmaz.
- `npm run db:seed-dev`, `db:init`'in kurduğu şemanın üzerine QA planındaki
  ortak test veri setini (iki işletme, örnek araçlar, iki rolün girişleri,
  ekip hesapları) yazar; sabit kimlikler kullandığından tekrar
  çalıştırılması satırları çoğaltmaz. Üretim ortamında (`NODE_ENV=production`)
  çalışmayı reddeder ve veritabanı dosyasına hiç dokunmaz. Kullandığı test
  şifreleri `.env.example` içinde belgelenir ve **gerçek kurulumda
  kullanılmaz**.
- Gerçek üretim dosya yerleşimi (`/var/lib/dolmus-takip/...`, yedekleme,
  geri yükleme) `docs/ARCHITECTURE.md` §8 ve M6 paketlerinin kapsamındadır;
  bu depo o makineyi kurmaz.

## Üretim çıktısı (standalone) notu

`next.config.ts` içinde `output: "standalone"` seçilidir: `npm run build`
bağımsız çalışabilen küçük bir Node çıktısı (`.next/standalone`) üretir.
`better-sqlite3` ve `argon2` native modüllerinin derlenmiş dosyaları
(`outputFileTracingIncludes`) bu çıktıya açıkça dahil edilir; aksi halde
üretim makinesi bu native bağımlılıklar olmadan çalışamaz. Hedef
Linux/Ubuntu makinede native modüllerin **o mimaride yeniden derlenmesi**
(macOS `node_modules`'ın doğrudan kopyalanmaması) ve gerçek servis kurulumu
`docs/ARCHITECTURE.md` §8.4 ve M6 paketlerinin işidir; bu adım yalnız
derleme yapılandırmasını hazırlar.

## Test stratejisi (özet)

`docs/QA-PLAN.md` §1 kuralı: mali/DB testleri yalnız gerçek geçici SQLite
dosyası ve gerçek migration ile yapılır; mock veya `:memory:` üzerinde
kabul edilmez. Bu yüzden `test:integration` testleri paralel çalışmaz
(`vitest.config.mts` — `fileParallelism: false`) ve her test kendi geçici
dosyasını açıp temizler.
