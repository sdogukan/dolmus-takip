# Sunucu kurulum rehberi: Dolmuş Takip

**Durum:** HAZIRLANDI — **gerçek sunucuda DENENMEDİ; pilot için HAZIR DEĞİL.** Bu belgedeki her komut bloğu "hazırlandı, henüz gerçek makinede çalıştırılmadı" işaretlidir ve öyle okunmalıdır. Kurulum **elle, bu rehber adım adım izlenerek** yapılır; kurulum, sertifika alma ve yeniden başlatma denemeleri elle kurulum sırasında yapılır ve sonucu kayda geçtikten sonra işaretler kaldırılır ([RELEASE.md](RELEASE.md) §5: denenmemiş komut denenmiş gibi sunulmaz). Karar: [DECISIONS](DECISIONS.md) "T6.2 elle kurulum kararı".
**Kaynaklar:** [ARCHITECTURE](ARCHITECTURE.md) §2, §8 · [TECH-STACK](TECH-STACK.md) · [RELEASE](RELEASE.md) §3, §5.

Bu rehber tek makineli kurulumun sürümlü düzenini anlatır. Yapılandırma dosyaları depoda `deploy/` altındadır ve tek bir ayara bağlıdır: `DOLMUS_DOMAIN`.

## Değişkenler

Aşağıdaki değişkenler **kendi çalışma makinenizde** (AWS CLI'nin ve SSH anahtarının bulunduğu yer) bir kez tanımlanır; sonraki hiçbir komutta gerçek alan adı, hesap numarası veya IP yazılmaz. Gerçek değerler depoya, komut geçmişine paylaşılan bir yere veya bu belgeye yazılmaz.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
export DOLMUS_DOMAIN="<alan-adı>"            # şema ve "/" yok, ör. host.example.com biçiminde
export AWS_PROFILE="<ayrı-hesabın-profil-adı>"  # bu iş için ayrılmış AWS hesabının profili
export AWS_REGION="eu-central-1"             # Frankfurt; DURAK'ta doğrulanır
export DOLMUS_AZ="<bölge-ve-harf>"           # get-regions çıktısındaki bir alt bölge, ör. eu-central-1a biçiminde
export DOLMUS_INSTANCE="<instance-adı>"      # Lightsail instance adı
export DOLMUS_STATIC_IP_NAME="<static-ip-adı>"  # Lightsail static IP kaynağının adı
export DOLMUS_KEY_PAIR="<anahtar-çifti-adı>" # Lightsail'e yüklenen SSH anahtarının adı
export DOLMUS_SSH_KEY="$HOME/.ssh/<anahtar-dosyası>"  # özel anahtar; .pub eşi yanında
export DOLMUS_BLUEPRINT_ID="<get-blueprints çıktısından>"  # §1.1'de seçilir, ezberden yazılmaz
export DOLMUS_BUNDLE_ID="<get-bundles çıktısından>"        # §1.1'de seçilir, ezberden yazılmaz
export RELEASE_ID="<kısa-commit>"            # arşiv adındaki kısa commit
export DOLMUS_ARCHIVE="dolmus-takip-${RELEASE_ID}-<platform>-<arch>.tar.gz"
```

Her `aws lightsail` komutu `--profile "$AWS_PROFILE" --region "$AWS_REGION"` ile çalışır; böylece kaynak yanlış veya varsayılan hesaba düşmez. Statik IP adresi bir değişkende tutulmaz, gerektiğinde §1.2'deki sorguyla okunur.

## 1. Hedef ve doğrulama durağı

| Konu | Başlangıç seçimi |
|---|---|
| Sağlayıcı / bölge | AWS Lightsail, Frankfurt (`eu-central-1`) |
| Paket | 2 vCPU, 2 GB RAM, 60 GB SSD, IPv4 — 12 USD/ay ([TECH-STACK](TECH-STACK.md)) |
| İşletim sistemi | Yerel (native) Ubuntu LTS; Docker yok |
| Node | `package.json` `engines`: `>=24`; sürüm ve Ubuntu imajı kurulum öncesi uyumlulukla sabitlenir |
| Güvenlik duvarı | Yalnız 22, 80, 443 |

> **DURAK — kaynak oluşturmadan önce.** Lightsail'de herhangi bir kaynak oluşturulmadan **önce** insan onayıyla şunlar güncel fiyat/konsol ekranında doğrulanır: bölge Frankfurt mu, paket 2 vCPU / 2 GB / 60 GB mı, aylık bütçe (12 USD + snapshot 0,05 USD/GB-ay + alan adı + vergi) kabul edilebilir mi. Biri farklıysa kurulum durur ve karar TECH-STACK'e işlenir. Bu belge kaynak oluşturmaz.

### 1.1 Lightsail instance oluşturma

DURAK onaylandıktan sonra. Blueprint ve paket kimlikleri **ezberden yazılmaz**; çıktıdan seçilir ve değerleri kontrol edilir.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
aws lightsail get-blueprints --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --query 'blueprints[?type==`os`].[blueprintId,name,version,platform,isActive]' --output table
aws lightsail get-bundles --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --query 'bundles[].[bundleId,cpuCount,ramSizeInGb,diskSizeInGb,price,supportedPlatforms]' --output table
# Kontrol: Linux/UNIX, Ubuntu LTS (CI ile aynı sürüm: 24.04), x86_64;
# paket 2 vCPU / 2 GB RAM / 60 GB SSD ve DURAK'ta onaylanan fiyat. Sonra:
#   export DOLMUS_BLUEPRINT_ID=<seçilen>   DOLMUS_BUNDLE_ID=<seçilen>

ssh-keygen -t ed25519 -f "$DOLMUS_SSH_KEY" -C "$DOLMUS_INSTANCE"   # yoksa; parola sorusunu boş bırakma
aws lightsail import-key-pair --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --key-pair-name "$DOLMUS_KEY_PAIR" --public-key-base64 "$(base64 -w0 < "$DOLMUS_SSH_KEY.pub")"

aws lightsail create-instances --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-names "$DOLMUS_INSTANCE" --availability-zone "$DOLMUS_AZ" \
  --blueprint-id "$DOLMUS_BLUEPRINT_ID" --bundle-id "$DOLMUS_BUNDLE_ID" \
  --key-pair-name "$DOLMUS_KEY_PAIR" --ip-address-type ipv4
aws lightsail get-instance-state --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE"   # running olana dek tekrarlanır
```

Özel anahtar makineden çıkmaz; Lightsail'e yalnız `.pub` yüklenir.

### 1.2 Statik IP

DNS'ten **önce** bağlanır: statik IP olmadan durdur/başlat genel IPv4'ü değiştirir ve DNS A kaydı yeniden başlatmadan sonra bozulur.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
aws lightsail allocate-static-ip --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --static-ip-name "$DOLMUS_STATIC_IP_NAME"
aws lightsail attach-static-ip --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --static-ip-name "$DOLMUS_STATIC_IP_NAME" --instance-name "$DOLMUS_INSTANCE"
aws lightsail get-static-ip --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --static-ip-name "$DOLMUS_STATIC_IP_NAME" --query 'staticIp.[ipAddress,isAttached]' --output text
# çıktıdaki adres DNS A kaydına (§1.5) ve SSH'a (§1.4) yazılacak IP'dir
```

### 1.3 Güvenlik duvarı: yalnız 22, 80, 443

`put-instance-public-ports` mevcut kuralların **yerine** geçer; komut sonrası yalnız bu üç kural kalır. 3000 hiçbir zaman açılmaz.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
aws lightsail put-instance-public-ports --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE" \
  --port-infos fromPort=22,toPort=22,protocol=tcp \
               fromPort=80,toPort=80,protocol=tcp \
               fromPort=443,toPort=443,protocol=tcp
aws lightsail get-instance-port-states --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE" --query 'portStates[].[fromPort,toPort,protocol,state]' --output table
# beklenen: yalnız 22, 80, 443 (tcp, open)
```

### 1.4 SSH: ana makine anahtarını doğrulayarak ilk giriş

İlk bağlantıda sunucu parmak izi **körlemesine kabul edilmez**; Lightsail konsolundaki (instance → Connect → ana makine anahtarı) parmak iziyle karşılaştırılır. Parmak iziyle karşılaştırma yapılmadan `StrictHostKeyChecking=no` kullanılmaz.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
IP="$(aws lightsail get-static-ip --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --static-ip-name "$DOLMUS_STATIC_IP_NAME" --query 'staticIp.ipAddress' --output text)"
ssh-keyscan -t ed25519 "$IP" 2>/dev/null | ssh-keygen -lf -   # SHA256 parmak izi konsoldakiyle aynı olmalı; değilse DUR
ssh -i "$DOLMUS_SSH_KEY" ubuntu@"$IP"                          # aynıysa girişi kabul et
```

Sonraki oturumlarda anahtar `known_hosts`'tan doğrulanır; parola ile SSH kullanılmaz.

### 1.5 DNS A kaydı — Caddy'den ÖNCE

Alan adı sağlayıcısında `DOLMUS_DOMAIN` için **A** kaydı statik IP'ye elle eklenir. **Caddy, kayıt yayılıp doğrulanmadan başlatılmaz:** başarısız ACME denemeleri tekrarlanırsa Let's Encrypt hız sınırına takılır.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
IP="$(aws lightsail get-static-ip --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --static-ip-name "$DOLMUS_STATIC_IP_NAME" --query 'staticIp.ipAddress' --output text)"
[ "$(dig +short A "$DOLMUS_DOMAIN")" = "$IP" ] && echo "DNS hazır" \
  || { echo "DNS henüz statik IP'yi göstermiyor; Caddy BAŞLATILMAZ" >&2; false; }
```

### 1.6 Arşiv ve `deploy/` dosyalarını makineye kopyalama

Arşiv ve manifest CI'da üretilir (`npm run release:build`). `deploy/` dosyaları **arşivle aynı commit'ten** alınır (`RELEASE_ID` = kısa sha); aksi halde servis dosyası ile sürüm birbirinden ayrışabilir.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# depo klasöründe, RELEASE_ID commit'inden deploy/ paketle
git archive --format=tar.gz -o "deploy-${RELEASE_ID}.tar.gz" "$RELEASE_ID" deploy
IP="$(aws lightsail get-static-ip --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --static-ip-name "$DOLMUS_STATIC_IP_NAME" --query 'staticIp.ipAddress' --output text)"
scp -i "$DOLMUS_SSH_KEY" "$DOLMUS_ARCHIVE" "${DOLMUS_ARCHIVE%.tar.gz}.manifest.json" \
  "deploy-${RELEASE_ID}.tar.gz" ubuntu@"$IP":~/
# makinede: deploy/ dosyalarını aç
ssh -i "$DOLMUS_SSH_KEY" ubuntu@"$IP" "mkdir -p ~/deploy-src && tar -xzf ~/deploy-${RELEASE_ID}.tar.gz -C ~/deploy-src"
```

Manifest, arşivin yanındaki `<arşiv-adı-uzantısız>.manifest.json` dosyasıdır. Sonraki adımlar makinede (`ssh -i "$DOLMUS_SSH_KEY" ubuntu@"$IP"`) çalışır; `deploy/` dosyaları `~/deploy-src/deploy/` altındadır.

## 2. Dizinler, sahipler ve modlar

| Yol | Amaç | Sahip | Mod |
|---|---|---|---|
| `/opt/dolmus-takip/` | Sürüm kökü | `root:root` | `0755` |
| `/opt/dolmus-takip/releases/<release-id>` | Bir sürümün çıktısı (servis için salt okunur) | `root:root` | `0755` |
| `/opt/dolmus-takip/current` | Aktif sürüme sembolik bağ | `root:root` | — |
| `/var/lib/dolmus-takip/data/` | Kalıcı DB (`app.sqlite`, `-wal`, `-shm`) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/backup-ready/` | Doğrulanmış tarihli DB kopyaları (T6.4) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/pre-migration/` | Yayın öncesi DB kopyası (T6.5) | `dolmus-takip:dolmus-takip` | `0750` |
| `/opt/dolmus-takip/health/` | Sağlık görevi betikleri (`deploy/health/`; `current`'a bağlı değildir) | `root:root` | `0755` |
| `/var/lib/dolmus-takip/health/` | Sağlık görevi durumu: `state.json`, `run.lock`, **`recovery.lock`** (kalıcı kurtarma kilidi). Sağlık biriminin yazabildiği tek yol; servis kullanıcısı yazamaz | `root:root` | `0700` |
| `/var/lib/dolmus-takip/maintenance` | Bakım işareti (dosya varsa sağlık görevi restart etmez). T6.5 bakım akışı oluşturur/kaldırır | `root:root` | `0644` |
| `/etc/dolmus-takip/` | Servis ayarları | `root:dolmus-takip` | `0750` |
| `/etc/dolmus-takip/app.env`, `domain.env` | Ayar dosyaları | `root:dolmus-takip` | `0640` |

`release-id`, arşiv adındaki kısa commit'tir (`dolmus-takip-<sha>-<platform>-<arch>.tar.gz`). Kod (`/opt`) ve kalıcı veri (`/var/lib`) ayrıdır: sürüm değişimi veriye dokunmaz. Bir DB komutu **root olarak çalıştırılmaz**; root sahipli `app.sqlite`/`-wal`/`-shm` dosyalarına servis kullanıcısı yazamaz.

## 3. İlk kurulum (tekrarlanabilir)

> Hazırlandı, henüz gerçek sunucuda denenmedi. Aşağıdaki her blok makinede (SSH ile), §1.1–§1.6 tamamlandıktan sonra çalıştırılır. `<...>` alanları elle doldurulur.

### 3.1 Paketler, kullanıcı ve dizinler

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node 24 (NodeSource; /usr/bin/node — servis dosyasındaki yol)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Caddy (resmi Caddy apt deposu)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy
# Paket kurulumu Caddy'yi kendisi başlatır; DNS doğrulanmış olsa da bizim Caddyfile'ımız
# yerleşene ve app.env/domain.env hazır olana dek durdurulur (§3.3'te etkinleştirilir).
sudo systemctl stop caddy.service

node -v      # v24.x olmalı (.nvmrc: 24, engines: >=24)
caddy version   # çıktı kurulum kaydına yazılır

getent passwd dolmus-takip >/dev/null || \
  sudo useradd --system --home-dir /var/lib/dolmus-takip --shell /usr/sbin/nologin dolmus-takip

sudo install -d -m 0755 -o root -g root /opt/dolmus-takip /opt/dolmus-takip/releases
sudo install -d -m 0750 -o dolmus-takip -g dolmus-takip \
  /var/lib/dolmus-takip/data /var/lib/dolmus-takip/backup-ready /var/lib/dolmus-takip/pre-migration
sudo install -d -m 0750 -o root -g dolmus-takip /etc/dolmus-takip
# Sağlık görevi: betikler ve kök sahipli durum/kilit dizini (servis kullanıcısı yazamaz)
sudo install -d -m 0755 -o root -g root /opt/dolmus-takip/health
sudo install -d -m 0700 -o root -g root /var/lib/dolmus-takip/health
```

`/var/lib/dolmus-takip` üst dizini `install -d` tarafından `root:root` `0755` oluşturulur; servis kullanıcısı yalnız alt dizinlere yazar. `data` dizini DB komutlarından **önce** ve servis kullanıcısı sahipli yaratılmalıdır (yukarıdaki sıra).

### 3.2 Ayar dosyaları (alan adı tek yerde)

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# deploy/ dizini §1.6'da arşivle aynı commit'ten makineye kopyalandı: ~/deploy-src/deploy
cd ~/deploy-src
sudo install -m 0640 -o root -g dolmus-takip deploy/env/domain.env.example /etc/dolmus-takip/domain.env
sudo install -m 0640 -o root -g dolmus-takip deploy/env/app.env.example    /etc/dolmus-takip/app.env
sudoedit /etc/dolmus-takip/domain.env   # DOLMUS_DOMAIN=<gerçek alan adı>  (şema ve "/" yok)
```

`APP_ORIGIN` elle **yazılmaz**: uygulama servisi onu `https://${DOLMUS_DOMAIN}` olarak aynı dosyadan türetir. Alan adı DNS'te bu makinenin IPv4'üne çözülmeden Caddy sertifika alamaz.

### 3.3 Servis dosyaları ve açılışta etkinleştirme

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
sudo install -m 0644 deploy/systemd/dolmus-takip.service /etc/systemd/system/dolmus-takip.service
sudo install -D -m 0644 deploy/systemd/caddy.service.d/override.conf \
  /etc/systemd/system/caddy.service.d/override.conf
sudo install -m 0644 deploy/caddy/Caddyfile /etc/caddy/Caddyfile
# Sağlık görevi (ARCHITECTURE §8.2): betikler, oneshot birim ve 30 sn zamanlayıcı
sudo install -m 0644 -o root -g root deploy/health/health-check.mts deploy/health/health-decision.mts \
  /opt/dolmus-takip/health/
sudo install -m 0644 deploy/systemd/dolmus-takip-health.service /etc/systemd/system/dolmus-takip-health.service
sudo install -m 0644 deploy/systemd/dolmus-takip-health.timer /etc/systemd/system/dolmus-takip-health.timer
# journald: toplam ~200 MB, kalıcı depolama
sudo install -D -m 0644 deploy/journald/dolmus-takip.conf /etc/systemd/journald.conf.d/dolmus-takip.conf
sudo systemctl restart systemd-journald
sudo systemctl daemon-reload
sudo systemctl enable dolmus-takip.service caddy.service   # açılışta etkin
```

Zamanlayıcı (`dolmus-takip-health.timer`) **§3.4'te servisler başlatıldıktan sonra** etkinleştirilir. Sağlık görevi `node:` yerleşikleriyle çalışır (`/usr/bin/node`), uygulamanın `node_modules`'una bağlı değildir ve `flock` (util-linux) gerektirir. Kurtarma kilidi `AssertPathExists=!` ile uygulama birimini koşullandırır: kilit varken `systemctl start` bilinçli olarak **başarısız olur** ve journal'a "Assertion failed" yazılır (sessiz atlanmaz).

### 3.4 İlk sürümü alma, ilk şema ve ilk yönetici

Arşiv ve manifest §1.6'da makineye kopyalandı (`~` altında). `<id>` kısa commit (`RELEASE_ID`), `<archive>` arşiv dosya adıdır; makinede build yapılmaz.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
REL=/opt/dolmus-takip/releases/<id>
# 1) arşivin hash'i manifestteki artifact_sha256 ile aynı olmalı
sha256sum ~/<archive>                       # çıktı == manifest.artifact_sha256
grep artifact_sha256 ~/<archive-manifest>.json
# 2) YENİ dizine aç; mevcut current'ın üzerine asla açma
test ! -e "$REL" || { echo "release dizini zaten var: $REL" >&2; exit 1; }
sudo install -d -m 0755 -o root -g root "$REL"
sudo tar -xzf ~/<archive> -C "$REL"
# 3) İLK şema: açık komut, servis kullanıcısı olarak (root olarak DEĞİL)
cd "$REL" && sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env scripts/db-init.ts
```

İlk şema komutu `node scripts/db-init.ts`'tir; DB dosyası yoksa yalnız bu komut oluşturur, uygulama sessizce boş DB açmaz ([ARCHITECTURE](ARCHITECTURE.md) §8.1). Komut dosya varsa yalnız bekleyen migration'ları uygular; tekrarı tanımları çoğaltmaz.

**İlk yönetici** (`scripts/platform-admin.ts`, arşivin içindedir; herkese açık kayıt ekranı yoktur). Kullanıcı adı ve parola depoya yazılmaz; parola **stdin'den** gider, komut satırına veya kabuk geçmişine girmez. Komut da servis kullanıcısı olarak, aynı `app.env` ile çalışır:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
cd "$REL"
read -r -p "İlk yönetici kullanıcı adı: " ADMIN_USER
read -r -s -p "Parola (ekrana yazılmaz): " ADMIN_PASS; echo
printf '%s' "$ADMIN_PASS" | sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env \
  scripts/platform-admin.ts create-first-admin --username "$ADMIN_USER" --password-stdin
unset ADMIN_USER ADMIN_PASS
```

Aynı kullanıcı adıyla tekrar çalıştırmak hesabı çoğaltmaz veya değiştirmez ("zaten var" der, çıkış kodu 0). Parola bir parola yöneticisine yazılır, bu belgeye değil.

Sonra `current` bağlanır ve servisler **DNS doğrulandıktan (§1.5) sonra** başlatılır:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# 4) current'ı atomik bağla
sudo ln -sfn "$REL" /opt/dolmus-takip/current.tmp && sudo mv -T /opt/dolmus-takip/current.tmp /opt/dolmus-takip/current
# 5) servisleri başlat (Caddy yalnız DNS A kaydı statik IP'yi gösteriyorsa)
sudo systemctl start dolmus-takip.service caddy.service
sudo systemctl status dolmus-takip.service caddy.service --no-pager
# 6) sağlık zamanlayıcısı: servisler ayaktayken etkinleştirilir
sudo systemctl enable --now dolmus-takip-health.timer
systemctl list-timers dolmus-takip-health.timer --no-pager
sudo journalctl -u dolmus-takip-health.service -n 5 --no-pager
```

## 4. Sürüm değiştirme (tekrarlanabilir)

> Hazırlandı, henüz gerçek sunucuda denenmedi. Bakım modu, ortak işletim kilidi ve migration öncesi kopya adımları [RELEASE.md](RELEASE.md) §5'tedir ve T6.5'te otomatikleşir; burada yalnız sürüm dizini ve `current` mekaniği verilir.

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
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

## 5. Manuel doğrulama tablosu

Bu tablodaki **hiçbir satır henüz doğrulanmadı**; hepsi manuel kurulum sırasında doğrulanacaktır. Sonuç, kurulum kaydına (komut çıktısı, tarih) yazılır. `curl` komutları çalışma makinesinden (dışarıdan), `systemctl`/`ss` komutları sunucuda çalışır; `IP` §1.2'deki sorguyla okunur.

| # | Kontrol | Nasıl | Beklenen | Durum |
|---|---|---|---|---|
| 1 | Sertifika alındı | `curl -vI "https://$DOLMUS_DOMAIN/" 2>&1 \| grep -i 'issuer\|expire'`; `sudo journalctl -u caddy --no-pager \| grep -i 'certificate obtained'` | Geçerli, alan adına ait sertifika; Caddy günlüğünde alındı kaydı | elle kurulumda doğrulanacak |
| 2 | Sertifika yenileme | Bitiş tarihi kayda alınır; Caddy günlüğünde yenileme kaydı izlenir | Otomatik yenileme, ilk kurulumda gözlenemez; bitişe yakın gözlenip kayda geçer | elle kurulumda doğrulanacak |
| 3 | HTTP → HTTPS | `curl -I "http://$DOLMUS_DOMAIN/"` | 301/308 ve `Location: https://…` | elle kurulumda doğrulanacak |
| 4 | `APP_ORIGIN` = `https://$DOLMUS_DOMAIN` | `sudo systemctl show dolmus-takip -p ExecStart`; `https://$DOLMUS_DOMAIN/` üzerinden yönetim girişi (ilk yönetici) başarılı | ExecStart `https://${DOLMUS_DOMAIN}` türetir; tarayıcıdan giriş çalışır | elle kurulumda doğrulanacak |
| 5 | Sağlık ucu dışarıdan kapalı | `curl -i "https://$DOLMUS_DOMAIN/api/v1/health/live"`; sunucuda `curl -fsS http://127.0.0.1:3000/api/v1/health/live` | Dışarıdan 404; yerelde 200 | elle kurulumda doğrulanacak |
| 6 | 3000 dışarıdan erişilemez | `nc -zvw3 "$IP" 3000`; sunucuda `ss -ltn` | Bağlantı reddedilir/zaman aşımı; 3000 yalnız `127.0.0.1`'de, dışarıya yalnız 22/80/443 | elle kurulumda doğrulanacak |
| 7 | DB, yedek ve gizli dosyalar dışarıdan erişilemez | `curl -sI "https://$DOLMUS_DOMAIN/app.sqlite"`; aynısı `/var/lib/dolmus-takip/data/app.sqlite`, `/etc/dolmus-takip/app.env` yolları için; sunucuda `ls -l /var/lib/dolmus-takip/data` | Hiçbiri dosya sunmaz (404); dosyalar `dolmus-takip` sahipli, `0750`/`0640` | elle kurulumda doğrulanacak |
| 8 | Yeniden başlatmada otomatik açılış, deneme kaydı korunur | Yönetim ekranından bir deneme kaydı (ör. deneme işletmesi) oluştur; `sudo systemctl is-enabled dolmus-takip caddy`; `sudo reboot`; dönünce `systemctl is-active dolmus-takip caddy` | `enabled`, sonra `active`; `https://$DOLMUS_DOMAIN/` yanıt verir; deneme kaydı hâlâ listelenir | elle kurulumda doğrulanacak |
| 9 | Sürüm değişiminde veri kalır | Deneme kaydı varken §4'ü yeni bir `<yeni-id>` ile uygula | `current` yeni sürüme bakar; deneme kaydı ve giriş hâlâ çalışır; `/var/lib/dolmus-takip/data` aynı dosyalar | elle kurulumda doğrulanacak |
| 10 | Sağlık zamanlayıcısı 30 sn'de çalışır | `systemctl list-timers dolmus-takip-health.timer --no-pager`; `sudo journalctl -u dolmus-takip-health.service --since "-3min" --no-pager` | Koşular ~30 sn arayla; her koşuda `event=metrics`, `event=probe`, `event=decision action=none` satırları (RAM, disk, WAL, live/ready gecikmesi) | elle kurulumda doğrulanacak |
| 11 | Çökme: systemd yeniden başlatır | `sudo kill -9 "$(systemctl show -p MainPID --value dolmus-takip)"`; ~15 sn sonra `systemctl is-active dolmus-takip` | 10 sn sonra otomatik `active`; sağlık görevi restart **yapmaz**; 900 sn'de 3 başlatma sınırı geçilmezse kilit yazılmaz | elle kurulumda doğrulanacak |
| 12 | Donma: 3 ardışık hata sonrası tek düzeltici restart | `sudo kill -STOP "$(systemctl show -p MainPID --value dolmus-takip)"`; journal izlenir (`journalctl -fu dolmus-takip-health.service`) | Başlangıç toleransından sonra üç başarısız koşu (`live-failing`), sonra `event=corrective_restart`; donmuş süreç SIGTERM'i işlemez, durdurma zaman aşımı (90 sn) sonrası SIGKILL ile yeniden başlar ve health birimi bunu yarıda kesmez; uygulama tekrar `active` | elle kurulumda doğrulanacak |
| 13 | Ready hatası tek başına restart üretmez | Yalnız deneme kaydıyla: `sudo systemctl stop dolmus-takip`; `sudo mv /var/lib/dolmus-takip/data/app.sqlite /var/lib/dolmus-takip/data/app.sqlite.deneme`; `sudo systemctl start dolmus-takip`; 90 sn toleransı aşıp birkaç koşu bekle; sonra durdur, dosyayı **geri koy** (`sudo mv` ile), yeniden başlat | Uygulama boş DB oluşturmaz; süreç ayakta kalıyorsa canlılık DB'ye dokunmadığı için `live` 200, `ready` 503 (süreç açılışta çıkıyorsa bu satır uygulanamaz, sonuç kayda yazılır): `reason=ready-failing-live-ok`, restart yok; dosya geri konunca `ready` 200 ve `healthy` | elle kurulumda doğrulanacak |
| 14 | Restart bütçesi aşımı → kalıcı kilit; reboot sonrası da başlatmaz; kaldırma | Donmayı (12) art arda üç kez tetikle (15 dk içinde); sonra `ls /var/lib/dolmus-takip/health/recovery.lock`, `sudo reboot`, dönünce `systemctl is-active dolmus-takip`; `sudo systemctl start dolmus-takip` | 2 restart sonrası `event=recovery_lock_written reason=restart-budget-exceeded`; reboot sonrası kilit durur, uygulama açılmaz, `start` "Assertion failed" verir; kilit yalnız OPS §5-B'deki elle yordamla kalkar; kendiliğinden hiçbir şey kaldırmaz/sıfırlamaz | elle kurulumda doğrulanacak |
| 15 | Bakım işareti restart'ı engeller | `sudo touch /var/lib/dolmus-takip/maintenance`; (12)'deki gibi donma tetikle; birkaç koşu bekle; işareti `sudo rm` ile kaldır | `reason=maintenance`, restart yok; işaret kalkınca kontrol sürer | elle kurulumda doğrulanacak |
| 16 | Caddy erişim günlüğü başlıksız; journald sınırı | `curl -s -H 'Cookie: gizli=1' -H 'X-Csrf-Token: gizli-csrf' -o /dev/null "https://$DOLMUS_DOMAIN/api/v1/session?q=GIZLIARAMA&cursor=GIZLIIMLEC"`; `sudo journalctl -u caddy -n 5 --no-pager \| grep -ci 'cookie\|authorization\|csrf\|GIZLIARAMA\|GIZLIIMLEC'`; `sudo journalctl -u caddy -n 5 --no-pager \| grep -c 'remote_port'`; `journalctl --disk-usage` | Erişim satırı var; başlık alanı, `q`/`cursor` değeri ve `remote_port` yok (iki grep de 0); `remote_ip`/`client_ip` /16 maskeli (son iki bölüm 0); `journalctl --disk-usage` ~200 MB'ı aşmaz | elle kurulumda doğrulanacak |

**PİLOT İÇİN HAZIR DEĞİL.** Bu tablo tamamlanıp kaydedilene ve M6'nın kalan işleri (sağlık otomasyonunun 10–16. satırlarla gerçek denemesi, yedek, restore, yük ve veri bütünlüğü kabulü) yapılana dek bu makine gerçek müşteri verisi taşımaz.

## 6. Kapsam dışı ve durum

Bu belge kaynak oluşturmaz ve AWS'ye komut çalıştırmaz; kurulum, sertifika alma ve yeniden başlatma denemeleri elle kurulum sırasında yapılır (§5). Önceki gerçek makine denemeleri (ISSUE-24/25/26/28) elle kurulum tamamlanana dek ertelenmiştir ([PROGRESS](PROGRESS.md)). 30 saniyelik sağlık zamanlayıcısı, kalıcı kurtarma kilidi, journald sınırı ve Caddy erişim günlüğü **hazırlandı, denenmedi** (`deploy/health/`, §3.3, §5 satır 10–16; işleyiş ve kilit kaldırma yordamı [OPS](OPS.md) §2, §5-B). Bakım akışının kendisi (bakım işaretini oluşturma/kaldırma), günlük yedek ve otomatik yayın T6.4–T6.5'tedir; o zamana dek §4'te servis durdurulduğu için uygulama etkin değildir ve sağlık görevi restart yapmaz, başlatmadan sonra 90 saniyelik tolerans işler. Uygulama servis dosyası `Restart=on-failure`, `RestartSec=10s`, `StartLimitIntervalSec=900`, `StartLimitBurst=3` değerlerini taşır; sağlık görevi systemd'nin start sınırını hiçbir zaman sıfırlamaz.

Sürüm dizini `ProtectSystem=strict` ile salt okunurdur ve `ReadWritePaths` yalnız `/var/lib/dolmus-takip/data`'dır. Uygulama `next/image` veya ISR kullanmadığı için çalışma anında sürüm dizinine yazması beklenmez; bu **gerçek makinede doğrulanmamıştır** (manuel kurulumda servis kullanıcısıyla ilk istekler sonrası `journalctl` ile izlenir).
