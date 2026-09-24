# Sunucu kurulum rehberi: Dolmuş Takip

**Durum:** HAZIRLANDI — **gerçek sunucuda DENENMEDİ.** Bu belgedeki her komut bloğu "hazırlandı, henüz gerçek makinede çalıştırılmadı" işaretlidir ve öyle okunmalıdır. Gerçek makinede kurulum, sertifika alma ve yeniden başlatma denemeleri **ISSUE-29** kapsamındadır; deneme sonucu geldikten sonra bu işaretler kaldırılır ([RELEASE.md](RELEASE.md) §5: denenmemiş komut denenmiş gibi sunulmaz).
**Kaynaklar:** [ARCHITECTURE](ARCHITECTURE.md) §2, §8 · [TECH-STACK](TECH-STACK.md) · [RELEASE](RELEASE.md) §3, §5.

Bu rehber tek makineli kurulumun sürümlü düzenini anlatır. Yapılandırma dosyaları depoda `deploy/` altındadır ve tek bir ayara bağlıdır: `DOLMUS_DOMAIN`.

## 1. Hedef ve doğrulama durağı

| Konu | Başlangıç seçimi |
|---|---|
| Sağlayıcı / bölge | AWS Lightsail, Frankfurt (`eu-central-1`) |
| Paket | 2 vCPU, 2 GB RAM, 60 GB SSD, IPv4 — 12 USD/ay ([TECH-STACK](TECH-STACK.md)) |
| İşletim sistemi | Yerel (native) Ubuntu LTS; Docker yok |
| Node | `package.json` `engines`: `>=24`; sürüm ve Ubuntu imajı kurulum öncesi uyumlulukla sabitlenir |
| Güvenlik duvarı | Yalnız 22, 80, 443 |

> **DURAK — kaynak oluşturmadan önce.** Lightsail'de herhangi bir kaynak oluşturulmadan **önce** insan onayıyla şunlar güncel fiyat/konsol ekranında doğrulanır: bölge Frankfurt mu, paket 2 vCPU / 2 GB / 60 GB mı, aylık bütçe (12 USD + snapshot 0,05 USD/GB-ay + alan adı + vergi) kabul edilebilir mi. Biri farklıysa kurulum durur ve karar TECH-STACK'e işlenir. Bu belge kaynak oluşturmaz.

## 2. Dizinler, sahipler ve modlar

| Yol | Amaç | Sahip | Mod |
|---|---|---|---|
| `/opt/dolmus-takip/` | Sürüm kökü | `root:root` | `0755` |
| `/opt/dolmus-takip/releases/<release-id>` | Bir sürümün çıktısı (servis için salt okunur) | `root:root` | `0755` |
| `/opt/dolmus-takip/current` | Aktif sürüme sembolik bağ | `root:root` | — |
| `/var/lib/dolmus-takip/data/` | Kalıcı DB (`app.sqlite`, `-wal`, `-shm`) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/backup-ready/` | Doğrulanmış tarihli DB kopyaları (T6.4) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/pre-migration/` | Yayın öncesi DB kopyası (T6.5) | `dolmus-takip:dolmus-takip` | `0750` |
| `/etc/dolmus-takip/` | Servis ayarları | `root:dolmus-takip` | `0750` |
| `/etc/dolmus-takip/app.env`, `domain.env` | Ayar dosyaları | `root:dolmus-takip` | `0640` |

`release-id`, arşiv adındaki kısa commit'tir (`dolmus-takip-<sha>-<platform>-<arch>.tar.gz`). Kod (`/opt`) ve kalıcı veri (`/var/lib`) ayrıdır: sürüm değişimi veriye dokunmaz. Bir DB komutu **root olarak çalıştırılmaz**; root sahipli `app.sqlite`/`-wal`/`-shm` dosyalarına servis kullanıcısı yazamaz.

## 3. İlk kurulum (tekrarlanabilir)

> Hazırlandı, henüz gerçek sunucuda denenmedi (ISSUE-29). Aşağıdaki her blok, DURAK onaylandıktan ve makine oluşturulduktan sonra çalıştırılır. `<...>` alanları elle doldurulur.

### 3.1 Paketler, kullanıcı ve dizinler

```bash
# hazırlandı, denenmedi (ISSUE-29)
sudo apt-get update
sudo apt-get install -y curl
# Caddy: resmi Caddy apt deposu (kurulum sayfasındaki güncel adımlarla) ve Node >=24 kurulur;
# `node -v` ve `caddy version` çıktısı kurulum kaydına yazılır.

getent passwd dolmus-takip >/dev/null || \
  sudo useradd --system --home-dir /var/lib/dolmus-takip --shell /usr/sbin/nologin dolmus-takip

sudo install -d -m 0755 -o root -g root /opt/dolmus-takip /opt/dolmus-takip/releases
sudo install -d -m 0750 -o dolmus-takip -g dolmus-takip \
  /var/lib/dolmus-takip/data /var/lib/dolmus-takip/backup-ready /var/lib/dolmus-takip/pre-migration
sudo install -d -m 0750 -o root -g dolmus-takip /etc/dolmus-takip
```

`/var/lib/dolmus-takip` üst dizini `install -d` tarafından `root:root` `0755` oluşturulur; servis kullanıcısı yalnız alt dizinlere yazar. `data` dizini DB komutlarından **önce** ve servis kullanıcısı sahipli yaratılmalıdır (yukarıdaki sıra).

### 3.2 Ayar dosyaları (alan adı tek yerde)

```bash
# hazırlandı, denenmedi (ISSUE-29)
# Depodan (veya arşivden) deploy/ dizini makineye kopyalanmış olmalıdır.
sudo install -m 0640 -o root -g dolmus-takip deploy/env/domain.env.example /etc/dolmus-takip/domain.env
sudo install -m 0640 -o root -g dolmus-takip deploy/env/app.env.example    /etc/dolmus-takip/app.env
sudoedit /etc/dolmus-takip/domain.env   # DOLMUS_DOMAIN=<gerçek alan adı>  (şema ve "/" yok)
```

`APP_ORIGIN` elle **yazılmaz**: uygulama servisi onu `https://${DOLMUS_DOMAIN}` olarak aynı dosyadan türetir. Alan adı DNS'te bu makinenin IPv4'üne çözülmeden Caddy sertifika alamaz.

### 3.3 Servis dosyaları ve açılışta etkinleştirme

```bash
# hazırlandı, denenmedi (ISSUE-29)
sudo install -m 0644 deploy/systemd/dolmus-takip.service /etc/systemd/system/dolmus-takip.service
sudo install -D -m 0644 deploy/systemd/caddy.service.d/override.conf \
  /etc/systemd/system/caddy.service.d/override.conf
sudo install -m 0644 deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable dolmus-takip.service caddy.service   # açılışta etkin
```

### 3.4 İlk sürümü alma ve ilk şema

Arşiv ve manifest CI'da üretilir (`npm run release:build`); makinede build yapılmaz. `<id>` kısa commit, `<archive>` arşiv dosya adıdır.

```bash
# hazırlandı, denenmedi (ISSUE-29)
REL=/opt/dolmus-takip/releases/<id>
# 1) arşivin hash'i manifestteki artifact_sha256 ile aynı olmalı
sha256sum <archive>                         # çıktı == manifest.artifact_sha256
grep artifact_sha256 <archive-manifest>.json
# 2) YENİ dizine aç; mevcut current'ın üzerine asla açma
test ! -e "$REL" || { echo "release dizini zaten var: $REL" >&2; exit 1; }
sudo install -d -m 0755 -o root -g root "$REL"
sudo tar -xzf <archive> -C "$REL"
# 3) İLK şema: açık komut, servis kullanıcısı olarak (root olarak DEĞİL)
cd "$REL" && sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env scripts/db-init.ts
# 4) current'ı atomik bağla
sudo ln -sfn "$REL" /opt/dolmus-takip/current.tmp && sudo mv -T /opt/dolmus-takip/current.tmp /opt/dolmus-takip/current
# 5) servisleri başlat
sudo systemctl start dolmus-takip.service caddy.service
```

İlk şema komutu `node scripts/db-init.ts`'tir; DB dosyası yoksa yalnız bu komut oluşturur, uygulama sessizce boş DB açmaz ([ARCHITECTURE](ARCHITECTURE.md) §8.1). Komut dosya varsa yalnız bekleyen migration'ları uygular; tekrarı tanımları çoğaltmaz.

## 4. Sürüm değiştirme (tekrarlanabilir)

> Hazırlandı, henüz gerçek sunucuda denenmedi (ISSUE-29). Bakım modu, ortak işletim kilidi ve migration öncesi kopya adımları [RELEASE.md](RELEASE.md) §5'tedir ve T6.5'te otomatikleşir; burada yalnız sürüm dizini ve `current` mekaniği verilir.

```bash
# hazırlandı, denenmedi (ISSUE-29)
REL=/opt/dolmus-takip/releases/<yeni-id>
# 1) yeni release dizini; varsa DUR (mevcut release'in üzerine açılmaz)
test ! -e "$REL" || { echo "release dizini zaten var: $REL" >&2; exit 1; }
sudo install -d -m 0755 -o root -g root "$REL"
# 2) hash kontrolü (manifest artifact_sha256) — uyuşmazsa DUR
sha256sum <archive>
# 3) arşivi yeni dizine aç
sudo tar -xzf <archive> -C "$REL"
# 4) servisi durdur; migration'ı MEVCUT DB üzerinde çalıştır (servis kullanıcısı olarak)
sudo systemctl stop dolmus-takip.service
cd "$REL" && sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env scripts/db-init.ts --existing
# 5) current'ı atomik değiştir
sudo ln -sfn "$REL" /opt/dolmus-takip/current.tmp && sudo mv -T /opt/dolmus-takip/current.tmp /opt/dolmus-takip/current
# 6) başlat ve iç kontrol
sudo systemctl start dolmus-takip.service
curl -fsS http://127.0.0.1:3000/api/v1/health/live
```

- Geçişte **`--existing`** kullanılır: yol yanlış ya da kayıpsa düz `db-init` boş bir DB yaratır ve uygulama boş bir müşteri sistemi açardı; `--existing` bu durumda hata verip durur.
- `current` yalnız geçici bağ + `mv -T` ile değişir (atomik); yarım açılmış bir çıktı hiçbir an `current` olmaz.
- Eski release dizinleri, yedek/pre-migration kopyasının referans verdiği sürüm dahil, temizlikte korunur ([ARCHITECTURE](ARCHITECTURE.md) §8.4).

## 5. Kurulum sonrası kontrol listesi (denenmedi)

- `sudo systemctl is-enabled dolmus-takip caddy` → `enabled`
- `curl -I http://<alan-adı>/` → HTTPS'e yönlendirme; `https://<alan-adı>/` giriş sayfası
- `curl -i https://<alan-adı>/api/v1/health/live` → **404** (dışarıdan kapalı); yerelde `http://127.0.0.1:3000/api/v1/health/live` → 200
- `ss -ltn` → 3000 yalnız `127.0.0.1`'de; dışarıya yalnız 80/443 (ve 22)
- `ls -l /var/lib/dolmus-takip/data` → dosyalar `dolmus-takip` sahipli

## 6. Kapsam dışı

Bu belge gerçek sunucuda kurulum, sertifika alma ve yeniden başlatma denemesi yapmaz; onlar **ISSUE-29**'dur. 30 saniyelik sağlık zamanlayıcısı, kurtarma kilidi, bakım modu, günlük yedek ve otomatik yayın T6.3–T6.5'tedir. Servis dosyası yalnız `Restart=on-failure`, `RestartSec=10s`, `StartLimitIntervalSec=900`, `StartLimitBurst=3` değerlerini taşır.

Sürüm dizini `ProtectSystem=strict` ile salt okunurdur ve `ReadWritePaths` yalnız `/var/lib/dolmus-takip/data`'dır. Uygulama `next/image` veya ISR kullanmadığı için çalışma anında sürüm dizinine yazması beklenmez; bu **gerçek makinede doğrulanmamıştır** (ISSUE-29'da servis kullanıcısıyla ilk istekler sonrası `journalctl` ile izlenir).
