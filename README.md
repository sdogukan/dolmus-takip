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
| `npm run quality-gate` | Kalite kapısı: `typecheck` → `lint` → `test:unit` → `test:integration`, ilk hatada durur. Hepsi geçerse ve çalışma ağacı baştan sona temiz, HEAD aynıysa `.quality-gate/<tree>.json` kaydını yazar (gitignore'lu); kirli ağaçta adımlar koşar, kayıt yazılmaz. |
| `npm run test:release` | Yayın boru hattı meta-testi (`tests/release/**`) — geçici bir klonda `release:build`/`release:verify`'ı uçtan uca dener. Klonun ağacı için proje kökünde geçerli kapı kaydı varsa onu kullanır, yoksa klonda kalite kapısını bir kez tam koşar (bu konteynerde ölçülen: ~13 dk, bunun ~10,5 dk'sı kapı). `test:integration`'a dahil değildir; CI `quality-gate`'ten sonra ayrı adım olarak koşar. |
| `npm run test:e2e` | Playwright uçtan uca testleri. **Not:** Tarayıcı ikilileri bu pakette indirilmedi; `npx playwright install` T1.6'da ele alınacaktır. |
| `npm run db:init` | Açık ilk şema kurulumu / bekleyen migration'ları uygular (idempotent). |
| `npm run db:seed-dev` | Yerel test verisini kurar (idempotent); yalnız `NODE_ENV=production` DEĞİLKEN çalışır. |
| `npm run db:generate` | `drizzle-kit generate` — şema (`src/server/data/schema.ts`) değiştiğinde yeni migration SQL dosyası üretir (yalnız geliştirici aracı; uygulamayı çalıştırmaz). |
| `npm run release:build` | Yayın arşivi + manifest üretir (bkz. aşağıdaki "Yayın çıktısı" bölümü). Çalışma ağacı kirliyse (`git status --porcelain` boş değilse) `exit 1` ile durur; `--allow-dirty` yoktur. Derlemeden ÖNCE kalite kapısının bu commit'in ağacı için geçtiğini ister (S6.1 AC3): geçerli `.quality-gate` kaydı varsa kapıyı yeniden çalıştırmaz ve bunu yazar; yoksa `typecheck`/`lint`/`test:unit`/`test:integration`'ı **kendi içinde** tam çalıştırır — doğrudan, CI dışında çağrıldığında da testleri atlamaz. |
| `npm run release:verify -- <tar.gz yolu>` | Üretilen arşivi temiz bir ortamda (geçici dizin/DB/port) açar, `db:init` ile şema kurar, standalone sunucuyu başlatıp `/api/v1/health/live`'dan 200 alır. |
| `npm run ci:local` | GitHub Actions `verify` job'ının adımlarını AYNI sırada yerelde çalıştırır (`scripts/ci-steps.json` — tek kaynak): quality-gate (typecheck → lint → unit → integration) → release (meta-test) → e2e → release:build → release:verify. İlk hatada durur, her adımın çıkış kodunu raporlar. (Ayrı bir "build" adımı yoktur — `e2e` kendi `next build`'ini zaten çalıştırır.) |

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
- Gerçek üretim dosya yerleşimi (`/var/lib/dolmus-takip/...`), Caddy/systemd
  yapılandırması (`deploy/`) ve ilk kurulum/sürüm değiştirme komutları
  `docs/SERVER-SETUP.md` içinde hazırlanmıştır; **gerçek sunucuda
  denenmemiştir** (manuel kurulumda denenecek). Yedekleme ve geri yükleme
  `docs/ARCHITECTURE.md` §8 ve M6 paketlerinin kapsamındadır.

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

## Yayın çıktısı (`release:build` / `release:verify`)

`docs/STORIES.md` S6.1 ve `docs/TASKS.md` T6.1 — hedefle uyumlu, tekrar
üretilebilir bir üretim çıktısı ve bütünlük manifesti. Bu iki komut yerelde
de çalıştırılabilir; **aynı zamanda** aşağıdaki "GitHub Actions" bölümünde
anlatılan `ci.yml` ve `release.yml` iş akışlarının birer adımıdır — hedef
Linux/Ubuntu x86_64 native modül çıktısı yalnız CI'da üretilir. Mac
üzerinde yerelde çalıştırıldığında manifest bunu `platform`/`arch`
alanlarıyla açıkça (`darwin`/`arm64`) taşır ve `release:verify` farklı bir
platform/mimari için üretilmiş bir manifesti **açık hatayla reddeder**.

```bash
npm run release:build
# → dist/dolmus-takip-<kısa-sha>-<platform>-<arch>.tar.gz
# → dist/dolmus-takip-<kısa-sha>-<platform>-<arch>.manifest.json

npm run release:verify -- dist/dolmus-takip-<kısa-sha>-<platform>-<arch>.tar.gz
```

`release:build` şunları yapar (hepsi başarısız olursa açık hatayla durur,
kısmi/sessiz geçiş yoktur):

1. **Temiz ağaç kapısı** (S6.1 AC4): `git status --porcelain` boş
   değilse `exit 1`; devre dışı bırakma bayrağı yoktur.
2. **Kalite kapısı** (S6.1 AC3, düzeltme turu 3; kapı kaydı 2026-09-25):
   kapının bu commit'in içeriği (`git rev-parse HEAD^{tree}`) için geçtiği
   kanıtlanmadan arşiv üretilmez. `.quality-gate/<tree>.json` kaydı şimdiki
   tree, güncel adım listesi ve Node sürümüyle birebir eşleşiyorsa kapı
   yeniden çalıştırılmaz ("Kalite kapısı yeniden çalıştırılmıyor" satırı).
   Kayıt yoksa veya tutmuyorsa (başka tree, farklı adım listesi, başka Node
   sürümü, bozuk JSON) `npm run typecheck` → `npm run lint` →
   `npm run test:unit` → `npm run test:integration`'ı **script'in KENDİSİ**
   çalıştırır; herhangi biri başarısız olursa derlemeye HİÇ girmeden
   `exit 1` ile durur ve kayıt yazılmaz. Kaydı yalnız dört adımın hepsini
   geçen, ağacı baştan sona temiz gören bir koşu yazar (`npm run
   quality-gate` ya da `release:build`'in kendi tam kapısı). Kayıt bir kaza
   korumasıdır, kurcalamaya karşı koruma değildir: checkout'a yazabilen
   biri kaydı da taklit edebilir. Bu adım yalnız CI'nın adım SIRASINA
   güvenmez — `release:build` doğrudan/elle çağrıldığında da (CI dışında)
   testleri atlamadan uygulanır. (Bu script'in kendi meta-testi
   `tests/release/release-build.test.ts` ayrı `test:release` komutundadır;
   kapı onu çalıştırmaz, aksi halde script kendini sonsuz derinlikte
   çağırırdı — bkz. `scripts/release-build.ts` üst notu.)
3. Önce `.next` klasörünü siler, ardından temiz bir `npm run build`
   (`next build` + `scripts/prepare-standalone.ts`) çalıştırır.
4. Standalone çıktısına `scripts/db-init.ts` ve onun `src/server/data/
   {db,schema}.ts` bağımlılıklarını (+ ilgili `package.json` ESM
   işaretleri) aynı göreli konumda ekler — hedef makinede açık ilk
   şema kurulumu (`node scripts/db-init.ts`) çalıştırılabilsin diye.
5. Standalone'un **kendi** `node_modules`'undan `require('better-sqlite3')`
   ve `require('argon2')`'yi dener; ardından `SELECT sqlite_version()`
   sonucunu `docs/ARCHITECTURE.md` §3.6'daki asgari sürümle (`3.51.3`)
   karşılaştırır — yalnız npm paket numarasına güvenmez.
6. `drizzle/**` ve migration journal'ının standalone çıktısında var
   olduğunu doğrular.
7. Standalone içinde gizli/veri dosyası (`.env*`, `*.sqlite*`, kök
   `data/`, `node_modules` dışı geçici dosya) olmadığını tarar.
8. `.next/standalone` içeriğini `dist/…tar.gz` olarak arşivler ve
   yanına kaynak commit/ref, lockfile hash'i, Node/Next/SQLite sürümü,
   şema (migration idx + hash listesi), arşiv hash'i/boyutu ve platform/
   mimariyi içeren `…manifest.json`'ı yazar.

`release:verify -- <tar.gz>` arşivi geçici bir dizine açar, manifest
hash'i ile arşivin gerçek hash'ini karşılaştırır, açılmış içerikte gizli/
veri dosyası olmadığını yeniden doğrular, geçici bir `DOLMUS_DB_PATH` ile
arşivin kendi `db-init`'ini çalıştırır ve arşivin kendi `server.js`'ini
geçici `PORT`/`HOSTNAME=127.0.0.1`/`APP_ORIGIN` ile başlatıp
`/api/v1/health/live`'dan 200 aldıktan sonra süreci kapatır.

`tests/release/release-build.test.ts` (`npm run test:release`) bu iki
komutu gerçek (geçici) bir `git clone` içinde uçtan uca dener; kirli
ağaçta reddi, **temiz ağaçta ama başarısız bir birim testiyle reddi**
(S6.1 AC3, düzeltme turu 3) ve manifest alanlarının doluluğunu da
kapsar. Bu test uzun sürebileceğinden dosyaya özel bir Vitest zaman
aşımı tanımlıdır ve rutin `test:integration`'a dahil değildir.

## GitHub Actions (`.github/workflows/`)

`docs/STORIES.md` S6.1 AC1/AC3/AC7 ve `docs/TECH-STACK.md` §9 —
"production'a her push'ta otomatik yayın yoktur" ve "Actions dakika/
artifact kotaları sınırlıdır" gereği iki ayrı iş akışı vardır:

- **`ci.yml`** — her push'ta (tüm dallar) ve her pull request'te tetiklenir;
  `ubuntu-24.04` üzerinde yukarıdaki tüm komutları (`quality-gate`
  [`typecheck` → `lint` → `test:unit` → `test:integration`] → `test:release` →
  Playwright tarayıcı kurulumu → `test:e2e` → `release:build` →
  `release:verify`) sırayla
  çalıştırır — ayrı bir `build` adımı BİLEREK yoktur, çünkü `test:e2e`
  kendi `next build`'ini zaten çalıştırır (bkz. `scripts/ci-steps.json`).
  Başarısız bir adım sonrakileri ÇALIŞTIRMAZ; yayın çıktısı
  (`dist/*.tar.gz` + manifest) yalnız TÜM adımlar geçerse artifact olarak
  saklanır (`release-${{ github.sha }}`, 14 gün). Playwright HTML raporu
  yalnız BAŞARISIZLIKTA ayrı bir artifact'e (7 gün) yazılır. Aynı dal/PR
  referansı için önceki koşu otomatik iptal edilir (`concurrency`).
  **HİÇBİR GitHub secret'ı kullanılmaz.**
- **`release.yml`** — YALNIZ elle (`workflow_dispatch`, `ref` girdisi) ile
  tetiklenir; `ci.yml` ile AYNI doğrulama zincirini çalıştırıp yayın
  çıktısını 30 gün saklar. **Gerçek sunucuya dağıtım (deploy) adımı
  YOKTUR** — yayın SSH ile `docs/TASKS.md` T6.2/T6.5 (`docs/RELEASE.md`)
  kapsamında ayrıca, manuel yapılır; bu depoda henüz tanımlı bir secret
  yoktur.

**Özel repoda GitHub Actions dakika ve artifact kotası sınırlıdır;
`timeout-minutes` (30 dk) ve `retention-days` (7/14/30 gün) ile
sınırlandırıldı** (`docs/TECH-STACK.md` §9) — sınırsız ücretsiz kullanım
varsayılmaz.

`tests/unit/ci-workflows.test.ts`, bu iki dosyanın varlığını, tetikleyici/
`secrets` kısıtlarını ve adım sırasının `scripts/ci-steps.json` (aşağıdaki
`ci:local` ile PAYLAŞILAN tek kaynak) ile aynı olduğunu metinsel olarak
doğrular; yeni bir `yaml` ayrıştırma paketi EKLENMEDİ.

## Test stratejisi (özet)

`docs/QA-PLAN.md` §1 kuralı: mali/DB testleri yalnız gerçek geçici SQLite
dosyası ve gerçek migration ile yapılır; mock veya `:memory:` üzerinde
kabul edilmez. Bu yüzden `test:integration` testleri paralel çalışmaz
(`vitest.config.mts` — `fileParallelism: false`) ve her test kendi geçici
dosyasını açıp temizler.
