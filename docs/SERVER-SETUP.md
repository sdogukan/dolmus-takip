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
| `/opt/dolmus-takip/releases/<release-id>.manifest.json` | O sürümün arşiv manifesti (§4); ona bağlı bir DB kopyası tutulduğu sürece silinmez | `root:root` | `0644` |
| `/opt/dolmus-takip/current` | Aktif sürüme sembolik bağ | `root:root` | — |
| `/var/lib/dolmus-takip/` | Kalıcı veri kökü. `caddy` kullanıcısı bakım işaretini `stat` edebilmek için bu dizini **geçebilmelidir**; geçemezse Caddy işareti yok sayar ve bakımda trafik uygulamaya akar | `root:root` | `0755` |
| `/var/lib/dolmus-takip/data/` | Kalıcı DB (`app.sqlite`, `-wal`, `-shm`) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/backup-ready/` | Doğrulanmış tarihli DB kopyaları (T6.4) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/pre-migration/` | Yayın öncesi DB kopyası (T6.5) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/preserved/` | Restore veya DB geri dönüşünde yerinden çıkarılan `app.sqlite`/`-wal`/`-shm` dosyaları (`preserved/<zaman>/`); canlı DB/WAL silinmez, yalnız buraya taşınır (T6.5) | `dolmus-takip:dolmus-takip` | `0750` |
| `/var/lib/dolmus-takip/release-state/` | Yayın durumu kaydı: sürüm, önceki sürüm, faz, DB parmak izi, `traffic_opened_at` (T6.5). Yalnız root okur/yazar | `root:root` | `0700` |
| `/var/lib/dolmus-takip/ops.lock` | **Ortak işletim kilidi** (`flock`): sürüm değiştirme/migration (root, §4) ve günlük yedek (`dolmus-takip`) aynı dosyayı kilitler. Yedek birimi dosyayı okuma kipinde açar; bu yüzden grup okuma izni yeter | `root:dolmus-takip` | `0640` |
| `/opt/dolmus-takip/health/` | Sağlık görevi betikleri (`deploy/health/`; `current`'a bağlı değildir) | `root:root` | `0755` |
| `/var/lib/dolmus-takip/health/` | Sağlık görevi durumu: `state.json`, `run.lock`, **`recovery.lock`** (kalıcı kurtarma kilidi). Sağlık biriminin yazabildiği tek yol; servis kullanıcısı yazamaz | `root:root` | `0700` |
| `/var/lib/dolmus-takip/maintenance` | Bakım işareti. Dosya varken Caddy sağlık uçları dışındaki her dış isteği `503` + `Retry-After` ile keser (uygulamaya iletmez; her istekte dosya kontrolü, Caddy reload gerekmez) ve sağlık görevi restart etmez. T6.5 bakım akışı oluşturur/kaldırır | `root:root` | `0644` |
| `/etc/dolmus-takip/` | Servis ayarları | `root:dolmus-takip` | `0750` |
| `/etc/dolmus-takip/app.env`, `domain.env` | Ayar dosyaları | `root:dolmus-takip` | `0640` |

`release-id`, arşiv adındaki kısa commit'tir (`dolmus-takip-<sha>-<platform>-<arch>.tar.gz`). Kod (`/opt`) ve kalıcı veri (`/var/lib`) ayrıdır: sürüm değişimi veriye dokunmaz. Bir DB komutu **root olarak çalıştırılmaz** (günlük yedek birimi de `dolmus-takip` olarak çalışır); root sahipli `app.sqlite`/`-wal`/`-shm` dosyalarına servis kullanıcısı yazamaz.

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
# Kalıcı veri kökü açıkça 0755: caddy kullanıcısı bakım işaretini stat edebilmeli (§2)
sudo install -d -m 0755 -o root -g root /var/lib/dolmus-takip
sudo install -d -m 0750 -o dolmus-takip -g dolmus-takip \
  /var/lib/dolmus-takip/data /var/lib/dolmus-takip/backup-ready /var/lib/dolmus-takip/pre-migration \
  /var/lib/dolmus-takip/preserved
# Yayın durumu kaydı: yalnız root
sudo install -d -m 0700 -o root -g root /var/lib/dolmus-takip/release-state
sudo install -d -m 0750 -o root -g dolmus-takip /etc/dolmus-takip
# Sağlık görevi: betikler ve kök sahipli durum/kilit dizini (servis kullanıcısı yazamaz)
sudo install -d -m 0755 -o root -g root /opt/dolmus-takip/health
sudo install -d -m 0700 -o root -g root /var/lib/dolmus-takip/health
# Ortak işletim kilidi: yayın/migration (root) ve günlük yedek (dolmus-takip) AYNI dosyayı kilitler
sudo install -m 0640 -o root -g dolmus-takip /dev/null /var/lib/dolmus-takip/ops.lock
```

`/var/lib/dolmus-takip` üst dizini açıkça `root:root` `0755` kurulur (dizin önceden varsa sahip ve mod düzeltilir); servis kullanıcısı yalnız alt dizinlere yazar. Caddy'nin bakım kapısı işareti her istekte `caddy` kullanıcısıyla `stat` eder; dizin geçilemezse işaret yok sayılır ve bakımda trafik akar. Bu, kurulumda satır 24 ile doğrulanır. `data` dizini DB komutlarından **önce** ve servis kullanıcısı sahipli yaratılmalıdır (yukarıdaki sıra). `flock` kilit dosyasını `O_CREAT` ile açar; dosya kurulumda yaratıldığı için yedek birimi (yazma izni olmayan, `ProtectSystem=strict` altında çalışan `dolmus-takip`) onu yalnız okuma kipinde açıp kilitler. Bu, kurulumda satır 17 ile doğrulanır; varsayılmaz.

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
# Günlük DB kopyası (ARCHITECTURE §8.4): oneshot birim ve 02:30 Europe/Istanbul zamanlayıcısı
sudo install -m 0644 deploy/systemd/dolmus-takip-backup.service /etc/systemd/system/dolmus-takip-backup.service
sudo install -m 0644 deploy/systemd/dolmus-takip-backup.timer /etc/systemd/system/dolmus-takip-backup.timer
# journald: toplam ~200 MB, kalıcı depolama
sudo install -D -m 0644 deploy/journald/dolmus-takip.conf /etc/systemd/journald.conf.d/dolmus-takip.conf
sudo systemctl restart systemd-journald
sudo systemctl daemon-reload
sudo systemctl enable dolmus-takip.service caddy.service   # açılışta etkin
```

Zamanlayıcı (`dolmus-takip-health.timer`) **§3.4'te servisler başlatıldıktan sonra** etkinleştirilir. Sağlık görevi `node:` yerleşikleriyle çalışır (`/usr/bin/node`), uygulamanın `node_modules`'una bağlı değildir ve `flock` (util-linux) gerektirir. Yedek zamanlayıcısı (`dolmus-takip-backup.timer`) de §3.4'te etkinleştirilir: her gün 02:30 Europe/Istanbul'da `dolmus-takip` olarak `scripts/db-backup.ts run` koşar, ortak işletim kilidini en çok 600 sn bekler (`flock -w 600`) ve `Persistent=false` olduğu için makine kapalıyken kaçan koşu açılışta telafi edilmez. Zamanlayıcı bakım işaretini oluşturmaz/kaldırmaz ve sağlık görevi yedeği bakım saymaz. Kurtarma kilidi `AssertPathExists=!` ile uygulama birimini koşullandırır: kilit varken `systemctl start` bilinçli olarak **başarısız olur** ve journal'a "Assertion failed" yazılır (sessiz atlanmaz).

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
# 7) günlük yedek zamanlayıcısı: current bağlı ve DB oluştuktan sonra
sudo systemctl enable --now dolmus-takip-backup.timer
systemctl list-timers dolmus-takip-backup.timer --no-pager
```

### 3.5 Lightsail otomatik snapshot (00:00 UTC)

Yerel kopya makine kaybına karşı yedek değildir; makine dışı kopyayı Lightsail otomatik snapshot'ı sağlar. Snapshot **00:00 UTC**'ye ayarlanır. Türkiye/UTC eşlemesi: Türkiye sabit UTC+3'tedir (yaz saati uygulaması yok), yani **00:00 UTC = 03:00 Europe/Istanbul**. Yedek zamanlayıcısı 02:30'da başlar ve kopya en geç 02:55'te (= 23:55 UTC) hazır olur; böylece hazır kopya snapshot'tan önce yayımlanmış olur. Snapshot'ın tam o dakikada başladığı varsayılmaz: gerçek başlangıç ve tamamlanma zamanı aşağıdaki sorguyla okunur ve kayda geçer. Lightsail son 7 otomatik snapshot'ı tutar (AWS varsayılanı; kurulumda sorguyla doğrulanır, varsayım olarak işaretlidir).

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
aws lightsail enable-add-on --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --resource-name "$DOLMUS_INSTANCE" \
  --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=00:00}'
aws lightsail get-auto-snapshots --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --resource-name "$DOLMUS_INSTANCE" --query 'autoSnapshots[].[date,status,fromAttachedDisks[0].path]' --output table
# get-instance çıktısında addOns[].snapshotTimeOfDay değeri 00:00 olmalı:
aws lightsail get-instance --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --instance-name "$DOLMUS_INSTANCE" --query 'instance.addOns' --output json
```

## 4. Sürüm değiştirme (tekrarlanabilir)

> Hazırlandı, henüz gerçek sunucuda denenmedi. Sürüm değişimi yeni release'in içindeki `scripts/release-apply.ts` ile yapılır: bakım işareti, yayın öncesi DB kopyası, migration, `current` değişimi, localhost hazırlık ve salt okunur mali kontrol, trafiğin açılması tek komuttur ve hepsi günlük yedekle **aynı** ortak işletim kilidi (`/var/lib/dolmus-takip/ops.lock`, en çok 900 sn beklenir; alınamazsa 75 ile çıkar) altında çalışır. Yayın sırası ve geri dönüş kararı [RELEASE.md](RELEASE.md) §5 ve §7'dedir.

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
# 4) sürüm manifestini release'in yanına koy: yayın aracı release dizinindeki migration
#    dosyalarını bu manifestteki hash'lerle denetler (§4 temizlik kuralı da ona bağlıdır)
sudo install -m 0644 -o root -g root <archive-manifest>.json "/opt/dolmus-takip/releases/<yeni-id>.manifest.json"
# 5) yayın: root olarak, YENİ release dizininden; çıkış 0 ve event=release_traffic_opened olmadan yayın bitmemiştir
cd "$REL" && sudo node scripts/release-apply.ts deploy
# 6) yayın durumu kaydı (sürüm, önceki sürüm, faz, pre_migration, migrations_applied, traffic_opened_at)
sudo cat /var/lib/dolmus-takip/release-state/state.json
```

Yayın sonrası doğrulama ([RELEASE.md](RELEASE.md) §6) bittikten sonra sonuç kaydedilir ve eski sürümler temizlenir; geri dönüş yalnız [RELEASE.md](RELEASE.md) §7 kararıyla ve geri alınan (yeni) release'in dizininden çalıştırılır:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
cd /opt/dolmus-takip/current && sudo node scripts/release-apply.ts mark-verified
cd /opt/dolmus-takip/current && sudo node scripts/release-apply.ts cleanup
# geri dönüş (RELEASE §7): yalnız kod / trafik açılmadan kod + DB
cd /opt/dolmus-takip/releases/<yeni-id> && sudo node scripts/release-apply.ts rollback --code
cd /opt/dolmus-takip/releases/<yeni-id> && sudo node scripts/release-apply.ts rollback --code-and-db
```

- **`deploy` sırası:** ön kontrol (`current` var ve yeni release değil, `recovery.lock` yok, release manifesti migration dosyalarıyla aynı) → kilit → önceki yayın çözülmüş (trafik açık, doğrulanmış veya geri alınmış) ve bakım işareti yok → bakım işareti → `dolmus-takip.service` durdurulur → **çalışan eski release'in** `db-backup.ts pre-migration`'ı doğrulanmış yayın öncesi kopyayı `/var/lib/dolmus-takip/pre-migration/` altına yazar (manifest `backup-ready` ile aynı biçim, `release_id` = eski release) → yeni release'in `db-init.ts --existing`'i tek kez → uygulanan migration sayısı DB'den ölçülür → `current` değişir → başlatılır → `http://127.0.0.1:3000/api/v1/health/live` ve `/ready` → salt okunur mali kontrol → `traffic_opened_at` yazılır → bakım işareti kalkar. Her fazda `release-state/state.json` atomik yazılır.
- **Bakım işareti servis durmadan önce konur:** Caddy yeni dış istekleri `503` ile keser; Next.js standalone sunucusu `SIGTERM`'de yeni bağlantı almayı bırakıp süren istekleri bitirdikten sonra çıkar (`next` 16.3.5 `dist/server/lib/start-server.js`, `server.close`); systemd durdurma zaman aşımı (varsayılan 90 sn) dolarsa `SIGKILL` gelir.
- **Başarısızlıkta işaret yerinde kalır**, başarısız faz `state.json`'a yazılır ve yeni bir `deploy` o yayın çözülene dek reddedilir. Yayın öncesi kopya başarısızsa `db-init` hiç çalışmaz, eski release `current`'ta kalır ve bakım altında yeniden başlatılır; bakımdan çıkış [RELEASE.md](RELEASE.md) §7'deki `rollback --code` ile olur.
- Geçişte **`--existing`** kullanılır (araç `db-init.ts`'i böyle çağırır): yol yanlış ya da kayıpsa düz `db-init` boş bir DB yaratır ve uygulama boş bir müşteri sistemi açardı; `--existing` bu durumda hata verip durur. İlk şema yalnız §3.4'tür; `current` yoksa `deploy` reddeder.
- DB'ye dokunan her adım (yayın öncesi kopya, `db-init`, mali kontrol, DB geri dönüşü) servis kullanıcısıyla (`runuser -u dolmus-takip`, `--env-file=/etc/dolmus-takip/app.env`) çalışır; araç root olarak yalnız servisi, `current`'ı, bakım işaretini ve `release-state`'i yönetir. Yayın durumu dizini root'a ait `0700` değilse araç çalışmaz.
- `current` yalnız geçici bağ + rename ile değişir (`ln -sfn` + `mv -T` ile aynı atomik değişim); yarım açılmış bir çıktı hiçbir an `current` olmaz.
- Kilit alınamazsa (75) hiçbir adım çalışmaz; sürüm değiştirme, çalışan bir yedek bitmeden başlatılmaz. Kilidin sahibini doğrulamadan dosyayı silme ([OPS](OPS.md) §3). `recovery.lock` varken araç başlatmaz; `start-limit-hit` birim durumuyla hata olarak yazılır, `systemctl reset-failed`'ı araç asla çağırmaz ([OPS](OPS.md) §5-B).
- **Release manifesti ve temizlik kuralı:** her kopya, uyumlu olduğu release'in kimliğini (`release_id`) manifestinde taşır. Bir release dizini ve `<release-id>.manifest.json` dosyası, o release'e bağlı bir DB kopyası (`backup-ready`, en yeni iki sağlam kopya) veya pre-migration kopyası tutulduğu sürece **silinmez**; `current` de silinmez. Temizliği `cleanup` yapar: `current`, yayın durumundaki release, `mark-verified` öncesi önceki release ve yayın öncesi kopyası ile `backup-ready`/`pre-migration` manifestlerinin `release_id`'leri korunur; okunamayan veya yarım bir manifest varsa hiçbir şey silinmez. Hangi release'lerin kopyalarca gerektiği elle de okunabilir: `cd /opt/dolmus-takip/current && sudo -u dolmus-takip env DOLMUS_BACKUP_DIR=/var/lib/dolmus-takip/backup-ready node --env-file=/etc/dolmus-takip/app.env scripts/db-backup.ts status` çıktısındaki `release_ids=` listesi.
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
| 17 | Ortak işletim kilidi: yedek birimi sandbox altında kilidi açar | `stat -c '%U:%G %a' /var/lib/dolmus-takip/ops.lock`; `sudo systemctl start dolmus-takip-backup.service`; `sudo journalctl -u dolmus-takip-backup.service -n 20 --no-pager`; ayrı bir oturumda `sudo flock -w 900 /var/lib/dolmus-takip/ops.lock sleep 60` çalışırken yedek birimini yeniden başlat | Kilit `root:dolmus-takip 640`; kilit boştayken koşu `Permission denied` vermeden başlar; kilit tutuluyken birim beklemeli, en fazla 600 sn sonra 75 ile başarısız olur ve journal'a yazar (kopya denenmez) | elle kurulumda doğrulanacak |
| 18 | Günlük kopya birimi: `dolmus-takip` olarak, WAL DB'yi okuyup kopya yayımlar | `sudo systemctl start dolmus-takip-backup.service`; `sudo journalctl -u dolmus-takip-backup.service -n 30 --no-pager`; `ls -l /var/lib/dolmus-takip/backup-ready`; `systemctl show -p User dolmus-takip-backup.service` | Uygulama çalışırken de çıkış 0 (`data` ve `backup-ready` yazılabilir, `-shm` erişimi çalışır); `backup-ready` altında kopya + manifest; `User=dolmus-takip`; koşu 02:55–04:00 penceresine düşerse CLI reddeder (beklenen) | elle kurulumda doğrulanacak |
| 19 | Yedek zamanlayıcısı 02:30 Europe/Istanbul; telafi yok | `systemctl list-timers dolmus-takip-backup.timer --no-pager`; `systemctl cat dolmus-takip-backup.timer`; `sudo reboot` (02:30 sonrası), dönünce `systemctl list-timers dolmus-takip-backup.timer` | Sonraki tetik 02:30 Europe/Istanbul (= 23:30 UTC); `Persistent` yok, reboot sonrası kaçan koşu telafi edilmez, sonraki gün 02:30'da çalışır | elle kurulumda doğrulanacak |
| 20 | Lightsail otomatik snapshot 00:00 UTC; Türkiye eşlemesi | §3.5'teki `get-instance` ve `get-auto-snapshots` komutları; ertesi gün `date` ve `status` | `addOns[].snapshotTimeOfDay` = `00:00` (03:00 Europe/Istanbul); en az bir snapshot `Success`; gerçek başlangıç/tamamlanma zamanı kayda yazılır, tam dakika varsayılmaz | elle kurulumda doğrulanacak |
| 21 | Kopya–snapshot ilişkisi | Snapshot tarihi/kimliği ile en yeni kopyanın manifestindeki `published_at` zamanını yan yana koy: `sudo -u dolmus-takip sh -c 'cat /var/lib/dolmus-takip/backup-ready/*.manifest.json'` (release kimliği için §4'teki `status` komutu) | Kopya, snapshot başlangıcından önce yayımlanmış (23:55 UTC öncesi); bağ kurulamıyorsa o gün yeni başarılı DB yedeği ilan edilmez ([OPS](OPS.md) §4) | elle kurulumda doğrulanacak |
| 22 | Bakım kapısı: işaret varken dışarıya 503, reload yok | Caddy'ye reload/restart komutu vermeden: `sudo install -m 0644 -o root -g root /dev/null /var/lib/dolmus-takip/maintenance`; dışarıdan `curl -si "https://$DOLMUS_DOMAIN/"`, `curl -si "https://$DOLMUS_DOMAIN/api/v1/session"`, `curl -si "https://$DOLMUS_DOMAIN/api/v1/health/live" \| head -1`; sunucuda `curl -fsS http://127.0.0.1:3000/api/v1/health/live`, `curl -fsS http://127.0.0.1:3000/api/v1/health/ready` | Sayfa ve API yolları `503` ve `Retry-After: 120`; gövde Caddy'nin bakım metnidir (`Bakım çalışması sürüyor`), yani istek uygulamaya iletilmedi; sağlık ucu dışarıdan yine `404`; yerelde `live`/`ready` `200`; hepsi işaret konduktan hemen sonra, Caddy reload edilmeden | elle kurulumda doğrulanacak |
| 23 | Bakım kapısı: işaret kalkınca trafik açılır, reload yok | (22)'nin devamı, yine reload/restart yok: `sudo rm /var/lib/dolmus-takip/maintenance`; dışarıdan `curl -si "https://$DOLMUS_DOMAIN/" \| head -1`; tarayıcıdan giriş | İlk istekten itibaren normal yanıt (503 değil), giriş çalışır | elle kurulumda doğrulanacak |
| 24 | Bakım kapısı açık kalamaz: `caddy` işareti görür; yayın dizinleri | `stat -c '%U:%G %a %n' /var/lib/dolmus-takip /var/lib/dolmus-takip/release-state /var/lib/dolmus-takip/preserved`; işaret varken `sudo -u caddy stat /var/lib/dolmus-takip/maintenance`; `systemctl show caddy -p User` | `root:root 755`, `root:root 700`, `dolmus-takip:dolmus-takip 750`; `caddy` kullanıcısıyla `stat` başarılı (`Permission denied` yok); Caddy `User=caddy`. `stat` başarısızsa kapı açık kalır (trafik akar): kurulum durur, dizin modu düzeltilir | elle kurulumda doğrulanacak |
| 25 | Yayın aracı: bakım, eski release'in yayın öncesi kopyası, migration, trafik | Deneme kaydı varken yeni `<yeni-id>` ile §4 adım 1–6; yayın sürerken ayrı oturumda dışarıdan `curl -si "https://$DOLMUS_DOMAIN/" \| head -1` tekrarla; sonra `sudo cat /var/lib/dolmus-takip/release-state/state.json`, `sudo -u dolmus-takip sh -c 'cat /var/lib/dolmus-takip/pre-migration/*.manifest.json' \| grep -E '"(stem\|release_id)"'`, `ls -l /var/lib/dolmus-takip/data` | Yayın boyunca dışarıya `503`, `event=release_traffic_opened` sonrası normal yanıt; `state.json` `phase=traffic_open`, `pre_migration` ve `traffic_opened_at` dolu, `migrations_applied` beklenen sayı; pre-migration manifestinin `release_id`'si önceki release (kopya `runuser` ortamıyla `DOLMUS_BACKUP_DIR`'ı aldı); `data` dosyaları `dolmus-takip` sahipli; deneme kaydı duruyor | elle kurulumda doğrulanacak |
| 26 | Yayın aracı: trafik açılmadan DB geri dönüşü | Yalnız deneme kaydıyla: yeni bir `deploy` sürerken journal'da `event=release_service_started` görününce ayrı oturumda `sudo systemctl stop dolmus-takip.service` (hazırlık süresi dolar, yayın `reason=readiness_failed` ile bakımda kalır); sonra `cd /opt/dolmus-takip/releases/<yeni-id> && sudo node scripts/release-apply.ts rollback --code-and-db`; `ls -l /var/lib/dolmus-takip/preserved/*/` | `event=restore_installed` (ortak kilit `runuser` üzerinden devralındı: `ops_lock_busy`/`ops_lock_unavailable` yok); yeni DB/WAL `preserved/<zaman>/` altında, silinmedi; `current` önceki release; eski oturumlar iptal (yeniden giriş gerekir); trafik açık, `state.json` `phase=rolled_back` | elle kurulumda doğrulanacak |
| 27 | Yayın aracı: trafik açıldıktan sonra DB geri dönüşü reddedilir | Satır 25'teki yayında: `cd /opt/dolmus-takip/releases/<yeni-id> && sudo node scripts/release-apply.ts rollback --code-and-db`; `systemctl is-active dolmus-takip`; `ls /var/lib/dolmus-takip/maintenance` | `reason=traffic_opened`, çıkış 1; servis `active` kalır, bakım işareti yok, DB'ye dokunulmaz ([RELEASE](RELEASE.md) §7 F5 yolu) | elle kurulumda doğrulanacak |
| 28 | Yük DB'si ayrı yolda; üretim yolunda veri seti kurulmadı | §5.1 adım 1–2 | Yük DB'sinin sha256'sı yan dosyadaki `database.sha256` ile aynı; dosya `/var/lib/dolmus-takip/data/load-test/load.sqlite`, `dolmus-takip` sahipli; `app.sqlite` yerinde, `load:seed` hedefte hiç çalışmadı | elle kurulumda doğrulanacak |
| 29 | Uygulama servisi yük DB'sini kullanıyor; diğer birimler üretim DB'sinde | §5.1 adım 3; `systemctl cat dolmus-takip-backup.service dolmus-takip-health.service \| grep -c load-test` | Süreç ortamında `DOLMUS_DB_PATH=/var/lib/dolmus-takip/data/load-test/load.sqlite`; yerel `ready` 200; yedek ve sağlık birimlerinde `load-test` yok (0) | elle kurulumda doğrulanacak |
| 30 | Üç senaryo ayrı koşuldu | [QA-PLAN](QA-PLAN.md) §3; üreticideki üç rapor | Üç rapor `acceptance_eligible=true`, `release.sourceCommit` = yayın adayı commit; koşular arası ≥ 15 dk; sağlık görevi açıktı | elle kurulumda doğrulanacak |
| 31 | Süreç öldürme denemesi (`write-peak` sırasında) | §5.1 adım 4 | ~10 sn sonra `active`; rapor defteri `lost`/`duplicate`/`inconsistent` 0; zaman ve toparlanma süresi kayıtlı | elle kurulumda doğrulanacak |
| 32 | Her koşu sonrası bütünlük | §5.1 adım 5 | `db-backup.ts run` çıkış 0; üreticide `integrity:check` `event=integrity_passed`, çıkış 0 | elle kurulumda doğrulanacak |
| 33 | Üretim DB'sine dönüş ve yük verisinin kaldırılması (pilot öncesi zorunlu) | §5.1 adım 7 | Süreç ortamında `DOLMUS_DB_PATH=/var/lib/dolmus-takip/data/app.sqlite`; `ready` 200; `systemctl cat dolmus-takip.service` içinde `load-test` yok; satır 8'deki deneme kaydı listelenir; `load-test` dizini ve üreticideki kimlik bilgisi dosyası silindi | elle kurulumda doğrulanacak |

**PİLOT İÇİN HAZIR DEĞİL.** Bu tablo tamamlanıp kaydedilene ve M6'nın kalan işleri (sağlık otomasyonunun 10–16. satırlarla gerçek denemesi, restore, yük ve veri bütünlüğü kabulü ile 17–33. satırların gerçek denemesi) yapılana dek bu makine gerçek müşteri verisi taşımaz.

### 5.1 Yük kabulü: ayrı yük DB'si ve üretim DB'sine dönüş (S6.6)

Sıra, eşikler ve ölçüm kaynakları [QA-PLAN](QA-PLAN.md) §3 "Yük ve veri bütünlüğü kabul prosedürü"ndedir; bu bölüm hedef makinedeki adımlardır. Kurallar:

- Yük verisi müşteri verisine karışmaz. `load:seed` yalnız **yük üreticisinde** (hedef dışı makine) çalışır; hedefte ve `/var/lib/dolmus-takip/data/app.sqlite` üzerinde çalıştırılmaz. Yük DB'si `/var/lib/dolmus-takip/data/load-test/` altındadır (uygulama servisinin yazabildiği tek yol `data/` olduğu için orada).
- Yalnız uygulama servisi yük DB'sine bağlanır: ek ayar dosyası `/etc/dolmus-takip/load-test.env` bir drop-in ile `app.env`'den sonra okunur ve `DOLMUS_DB_PATH`'i ezer. `app.env` değiştirilmez; yedek, sağlık ve yayın birimleri üretim DB'sinde kalır. Bağlantı süreç ortamından doğrulanmadan yük başlatılmaz.
- Yük penceresinde yayın (`release-apply`) veya restore yapılmaz; sağlık zamanlayıcısı **durdurulmaz**. Sağlık görevinin düzeltici restart'ı veya kurtarma kilidi bir bulgudur (QA-PLAN §3).
- Her başlatma (adım 3, adım 4, adım 7) 900 sn'de 3 başlatma sınırına sayılır; iki başlatma arasında en az 15 dk bırakılır.
- Pilot trafiğinden önce adım 7 zorunludur. Yük oturumları yalnız yük DB'sindeki `sessions` tablosunda yaşar; üretim DB'sine dönüş ve `load-test` dizininin silinmesiyle geçersiz kalırlar.

Adım 1 — üreticide doğrula ve hedefe kopyala:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# ÜRETİCİDE (hedefte DEĞİL). load:seed yan dosyası: sourceCommit = yayın adayı commit, sourceTreeDirty = false
LOAD_SRC="<üretici>/load.sqlite"
sha256sum "$LOAD_SRC"
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(s.database.sha256, s.sourceCommit, s.sourceTreeDirty)' "$LOAD_SRC.counts.json"
IP="$(aws lightsail get-static-ip --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --static-ip-name "$DOLMUS_STATIC_IP_NAME" --query 'staticIp.ipAddress' --output text)"
scp -i "$DOLMUS_SSH_KEY" "$LOAD_SRC" ubuntu@"$IP":~/load.sqlite
```

Adım 2 — hedefte ayrı dizine yerleştir:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# HEDEFTE. Dizin zaten varsa önceki yük verisi incelenmeden DUR (üzerine yazılmaz)
LOAD_DIR=/var/lib/dolmus-takip/data/load-test
sudo test ! -e "$LOAD_DIR" || { echo "$LOAD_DIR zaten var; DUR" >&2; false; }
sudo install -d -m 0750 -o dolmus-takip -g dolmus-takip "$LOAD_DIR" "$LOAD_DIR/copies"
sudo install -m 0640 -o dolmus-takip -g dolmus-takip ~/load.sqlite "$LOAD_DIR/load.sqlite"
sudo sha256sum "$LOAD_DIR/load.sqlite"   # adım 1'deki değerle aynı olmalı; değilse DUR
rm ~/load.sqlite
```

Adım 3 — yalnız uygulama servisini yük DB'sine bağla ve doğrula:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
printf 'DOLMUS_DB_PATH=/var/lib/dolmus-takip/data/load-test/load.sqlite\n' | sudo tee /etc/dolmus-takip/load-test.env >/dev/null
sudo chown root:dolmus-takip /etc/dolmus-takip/load-test.env
sudo chmod 0640 /etc/dolmus-takip/load-test.env
sudo install -d -m 0755 -o root -g root /etc/systemd/system/dolmus-takip.service.d
printf '[Service]\nEnvironmentFile=/etc/dolmus-takip/load-test.env\n' | sudo tee /etc/systemd/system/dolmus-takip.service.d/load-test.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart dolmus-takip.service
# çalışan süreç yük DB'sini göstermeli; app.sqlite görünürse yük BAŞLATILMAZ, drop-in incelenir
sudo cat "/proc/$(systemctl show -p MainPID --value dolmus-takip)/environ" | tr '\0' '\n' | grep '^DOLMUS_DB_PATH='
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
systemctl cat dolmus-takip-backup.service dolmus-takip-health.service | grep -c load-test   # 0 olmalı
```

Adım 4 — süreç öldürme denemesi (yalnız `write-peak`'in sürdürülen aşamasında, bir kez):

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
date -u +%Y-%m-%dT%H:%M:%SZ   # öldürme zamanı kayda yazılır
sudo kill -9 "$(systemctl show -p MainPID --value dolmus-takip)"
# systemd 10 sn sonra açar (Restart=on-failure, RestartSec=10s); sağlık görevi durdurulmaz
sleep 15
systemctl is-active dolmus-takip
sudo journalctl -u dolmus-takip.service -u dolmus-takip-health.service --since "-2min" --no-pager | tail -n 20
```

Adım 5 — her senaryodan sonra tutarlı kopya ve bütünlük denetimi:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# HEDEFTE, senaryo bittikten sonra. Kopya SQLite Backup API ile, ortak işletim kilidi altında alınır ve
# kendi görüntüsünde doğrulanır. 02:55–04:00 Europe/Istanbul arasında araç reddeder; o saatte çalıştırılmaz.
cd /opt/dolmus-takip/current && sudo flock -w 900 -E 75 /var/lib/dolmus-takip/ops.lock \
  sudo -u dolmus-takip env DOLMUS_DB_PATH=/var/lib/dolmus-takip/data/load-test/load.sqlite \
  DOLMUS_BACKUP_DIR=/var/lib/dolmus-takip/data/load-test/copies node scripts/db-backup.ts run
# en yeni kopya (yalnız sentetik yük verisi) SSH kullanıcısına verilir
COPY="$(sudo sh -c 'ls -1t /var/lib/dolmus-takip/data/load-test/copies/app-*.sqlite | head -n 1')"
sudo install -m 0600 -o "$USER" -g "$USER" "$COPY" ~/
# ÜRETİCİDE, aday commit checkout'unda: kopyayı al ve denetle; beklenen event=integrity_passed, çıkış 0
#   scp -i "$DOLMUS_SSH_KEY" ubuntu@"$IP":~/app-<zaman>.sqlite <üretici>/kopyalar/
#   npm run integrity:check -- <üretici>/kopyalar/app-<zaman>.sqlite
```

Adım 6 — yük boyunca ve sonrasında ölçümleri topla:

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# HEDEFTE, yük boyunca ayrı bir oturumda: yük DB'sinin -wal boyutu (sağlık satırındaki wal_bytes üretim DB'sinindir)
while sleep 30; do printf '%s load_wal_bytes=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(sudo stat -c %s /var/lib/dolmus-takip/data/load-test/load.sqlite-wal 2>/dev/null || echo 0)"; done | tee -a ~/load-wal.log
```

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# HEDEFTE, koşu bitince: raporun UTC başlangıç/bitişiyle uygulama ve sağlık satırları
# DB hazırlığı buradan okunur: event=probe ready (yerel durum kodu) ve event=metrics ready_ms; load:run'ın GET /giris sondası DB'yi göstermez
START="<YYYY-MM-DD HH:MM:SS> UTC"; END="<YYYY-MM-DD HH:MM:SS> UTC"
sudo journalctl -u dolmus-takip.service --since "$START" --until "$END" -o cat --no-pager | grep 'event=runtime_metrics' > ~/runtime-metrics.log
sudo journalctl -u dolmus-takip-health.service --since "$START" --until "$END" -o cat --no-pager | grep -E 'event=(metrics|probe|decision|corrective_restart|recovery_lock_written)' > ~/health.log
sudo journalctl -u dolmus-takip.service --since "$START" --until "$END" -o cat --no-pager | grep -cE 'RATE_LIMITED|HASH_QUEUE_FULL|runtime_metrics_failed'
```

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
# ÇALIŞMA MAKİNESİNDE: aynı pencere için Lightsail CPU ve burst (ISO 8601, UTC)
for m in CPUUtilization:Percent BurstCapacityPercentage:Percent BurstCapacityTime:Seconds; do
  aws lightsail get-instance-metric-data --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    --instance-name "$DOLMUS_INSTANCE" --metric-name "${m%%:*}" --unit "${m##*:}" \
    --period 60 --statistics Average Maximum Minimum \
    --start-time "<başlangıç ISO UTC>" --end-time "<bitiş ISO UTC>" --output json > "lightsail-${m%%:*}.json"
done
```

Adım 7 — üretim DB'sine dönüş ve yük verisinin kaldırılması (pilot trafiğinden önce zorunlu):

```bash
# hazırlandı, denenmedi (elle kurulumda denenecek)
sudo rm /etc/systemd/system/dolmus-takip.service.d/load-test.conf /etc/dolmus-takip/load-test.env
sudo systemctl daemon-reload
sudo systemctl restart dolmus-takip.service
sudo cat "/proc/$(systemctl show -p MainPID --value dolmus-takip)/environ" | tr '\0' '\n' | grep '^DOLMUS_DB_PATH='   # .../data/app.sqlite olmalı
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
systemctl cat dolmus-takip.service | grep -c load-test   # 0 olmalı
# YALNIZ yukarıdaki satır app.sqlite gösterdiyse ve kanıtlar (raporlar, kopyalar, loglar) makine dışına alındıysa:
sudo rm -r /var/lib/dolmus-takip/data/load-test
rm -f ~/app-*.sqlite ~/runtime-metrics.log ~/health.log ~/load-wal.log
```

Üreticideki kimlik bilgisi dosyası kanıtlar kaydedildikten sonra silinir; yük DB'si veya kimlik bilgileri hiçbir zaman üretim DB'sine aktarılmaz.

## 6. Kapsam dışı ve durum

Bu belge kaynak oluşturmaz ve AWS'ye komut çalıştırmaz; kurulum, sertifika alma ve yeniden başlatma denemeleri elle kurulum sırasında yapılır (§5). Önceki gerçek makine denemeleri (ISSUE-24/25/26/28) elle kurulum tamamlanana dek ertelenmiştir ([PROGRESS](PROGRESS.md)). 30 saniyelik sağlık zamanlayıcısı, kalıcı kurtarma kilidi, journald sınırı ve Caddy erişim günlüğü **hazırlandı, denenmedi** (`deploy/health/`, §3.3, §5 satır 10–16; işleyiş ve kilit kaldırma yordamı [OPS](OPS.md) §2, §5-B). Günlük yedek birimi ve zamanlayıcısı ile Lightsail otomatik snapshot da **hazırlandı, denenmedi** (§3.3, §3.5, §5 satır 17–21; [OPS](OPS.md) §4). Caddy bakım kapısı (işaret varken dışarıya 503) ve `release-state`/`preserved` dizinleri de **hazırlandı, denenmedi** (§2, §3.1, §5 satır 22–24). Yük kabulü için ayrı yük DB'si, süreç öldürme denemesi ve üretim DB'sine dönüş adımları da **hazırlandı, denenmedi** (§5.1, §5 satır 28–33); yük üreticisi hazırlıkta ve koşu boyunca Caddy üzerinden oturumsuz `GET /giris` ile erişilebilirliği sınar (503 = bakım kapısı), sağlık uçları yalnız localhost içinde kalır ve DB hazırlığı koşu sırasında `dolmus-health` `event=probe` `ready` / `event=metrics` `ready_ms` satırlarından okunur ([QA-PLAN](QA-PLAN.md) §3). Hedef makine olmadığı için hiçbir yük koşusu yapılmadı. Bakım işaretini koyan/kaldıran yayın aracı (`scripts/release-apply.ts`, §4) da **hazırlandı, denenmedi** (§5 satır 25–27); işaret varken sağlık görevi restart yapmaz, başlatmadan sonra 90 saniyelik tolerans işler. Uygulama servis dosyası `Restart=on-failure`, `RestartSec=10s`, `StartLimitIntervalSec=900`, `StartLimitBurst=3` değerlerini taşır; sağlık görevi systemd'nin start sınırını hiçbir zaman sıfırlamaz.

Sürüm dizini `ProtectSystem=strict` ile salt okunurdur ve `ReadWritePaths` yalnız `/var/lib/dolmus-takip/data`'dır. Uygulama `next/image` veya ISR kullanmadığı için çalışma anında sürüm dizinine yazması beklenmez; bu **gerçek makinede doğrulanmamıştır** (manuel kurulumda servis kullanıcısıyla ilk istekler sonrası `journalctl` ile izlenir).

## 7. Otomatik yayın (GitHub Actions → SSH zorunlu komut)

2026-09-26'dan beri sürüm değişimi (§4) elle değil, `.github/workflows/deploy.yml` ile yapılır: `main` push'unun CI koşusu yeşil bitince o koşunun `release-<sha>` paketi SSH stdin'inden sunucuya akar ve `/usr/local/sbin/dolmus-deploy-receive` §4 adımlarını uygular. Karar: [DECISIONS](DECISIONS.md) "Otomatik yayın". Sunucuda bir kez:

```bash
# denendi (2026-09-26, gerçek sunucuda; anahtarla başka komut çalışmadığı ve aynı paketin etkisiz olduğu sınandı)
sudo useradd --create-home --shell /bin/sh --comment "GitHub Actions otomatik yayin" deploy && sudo passwd -l deploy
sudo install -m 0755 -o root -g root deploy/ci/dolmus-deploy-receive /usr/local/sbin/dolmus-deploy-receive
sudo visudo -cf deploy/ci/sudoers-dolmus-deploy && sudo install -m 0440 -o root -g root deploy/ci/sudoers-dolmus-deploy /etc/sudoers.d/dolmus-deploy
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
# yalnız alıcıyı çalıştırabilen anahtar (özel anahtar yalnız GitHub secret DEPLOY_SSH_KEY'de):
echo 'restrict,command="sudo -n /usr/local/sbin/dolmus-deploy-receive" ssh-ed25519 <açık-anahtar> github-actions-deploy@dolmus-takip' \
  | sudo tee /home/deploy/.ssh/authorized_keys && sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 0600 /home/deploy/.ssh/authorized_keys
```

- Repo secret'ları: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (sunucunun doğrulanmış ed25519 host anahtarı satırı), `DIJJI_DEPLOY_KEY`.
- Güvenlik duvarı: 22 GitHub runner'ları için herkese açık (parola girişi kapalı; `sshd -T`: `passwordauthentication no`).
- Alıcı `mark-verified` çalıştırmaz: `cleanup` doğrulanmamış yayında önceki release'i ve yayın öncesi DB kopyasını korur; geri dönüş (RELEASE §7) bir sonraki yayına kadar mümkündür.
- Aynı paket tekrar gelirse alıcı `deploy_already_current` yazar ve hiçbir şeye dokunmaz. Başarısızlıkta §4'teki kurallar geçerlidir (bakım işareti yerinde kalır, geri dönüş RELEASE §7 kararıyla elle).
- Günlük: `sudo journalctl -t dolmus-deploy` (alıcı) ve `-t dolmus-release` (yayın aracı).
