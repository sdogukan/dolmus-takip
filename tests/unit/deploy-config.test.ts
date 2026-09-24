import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * `deploy/` yapılandırma dosyalarının ve `docs/SERVER-SETUP.md`'nin metinsel
 * doğrulaması. Bilerek YAML/INI ayrıştırıcı paketi eklenmedi (K9 sabit
 * bağımlılık listesi; `ci-workflows.test.ts` ile aynı tutum): satır/regex
 * kontrolleri yalnız "sözleşme değerleri yerinde mi" sorusunu commit
 * zamanında yakalar. Gerçek Caddy/systemd doğrulamasının yerini TUTMAZ;
 * o, elle kurulum sırasındaki gerçek sunucu denemesidir
 * (docs/SERVER-SETUP.md §5).
 */

const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

function read(relativePath: string): string {
  const filePath = path.join(projectRoot, relativePath);
  expect(fs.existsSync(filePath), `"${relativePath}" yok`).toBe(true);
  return fs.readFileSync(filePath, "utf8");
}

/** Yorum ve boş satırlar çıkarılmış, kırpılmış satırlar. */
function activeLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** `opening` satırıyla açılan bloğun, eşleşen kapanış "}" dahil metni. */
function blockText(text: string, opening: string): string {
  const start = text.indexOf(opening);
  expect(start, `"${opening}" yok`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`"${opening}" bloğu kapanmıyor`);
}

describe("deploy/caddy/Caddyfile", () => {
  const caddyfile = read("deploy/caddy/Caddyfile");
  const lines = activeLines(caddyfile);

  test("tek site adresi {$DOLMUS_DOMAIN}; başka üst düzey adres yok (yalnız genel seçenek bloğu ek)", () => {
    // Girintisiz, "{" ile biten satırlar üst düzey bloklardır; adressiz "{"
    // genel seçenek bloğudur, ikinci bir site adresi bunu geçemez.
    const topLevel = caddyfile
      .split("\n")
      .filter((line) => /^(?:[^\s#].*)?\{\s*$/.test(line));
    expect(topLevel).toEqual(["{", "{$DOLMUS_DOMAIN} {"]);
  });

  test("genel seçenek bloğu yalnız adlandırılmış hata logu taşır", () => {
    const start = caddyfile.indexOf("\n{\n") + 1;
    const end = caddyfile.indexOf("\n}\n", start) + 3;
    const globalLines = activeLines(caddyfile.slice(start, end));
    expect(globalLines.filter((l) => /^(log|include|output|format)\b/.test(l))).toEqual([
      "log error_filtered {",
      "output stdout",
      "format filter {",
      "include http.log.error",
    ]);
    expect(globalLines.some((l) => /^(auto_https|admin|email|servers|acme_|debug)\b/.test(l))).toBe(false);
  });

  test("yalnız 127.0.0.1:3000'e reverse_proxy; dosya sunumu yok", () => {
    expect(lines).toContain("reverse_proxy 127.0.0.1:3000");
    expect(lines.filter((line) => line.startsWith("reverse_proxy"))).toHaveLength(1);
    expect(lines.some((line) => /^file_server\b/.test(line))).toBe(false);
    // Tek root satırı bakım eşleştiricisinin içindedir (eşleştirici kapsamlı);
    // site düzeyinde root yoktur.
    const matcher = blockText(caddyfile, "@maintenance file {");
    const outside = activeLines(caddyfile.replace(matcher, ""));
    expect(outside.some((line) => /^root\b/.test(line))).toBe(false);
    expect(lines.filter((line) => /^root\b/.test(line))).toEqual(["root /"]);
  });

  test("HTTPS'i kapatan veya http:// adres/trusted_proxies yok", () => {
    expect(lines.some((line) => /auto_https\s+off|http:\/\//.test(line))).toBe(false);
    expect(lines.some((line) => line.startsWith("trusted_proxies"))).toBe(false);
  });

  test("/api/v1/health/* dışarıdan 404 ve reverse_proxy'den ÖNCE gelir", () => {
    expect(lines).toContain("@health path /api/v1/health /api/v1/health/*");
    expect(lines).toContain('respond "Not Found" 404');
    expect(caddyfile.indexOf("handle @health")).toBeGreaterThan(-1);
    expect(caddyfile.indexOf("handle @health")).toBeLessThan(
      caddyfile.indexOf("reverse_proxy"),
    );
  });

  test("bakım kapısı: işaret yolunda istek başına dosya eşleştiricisi, sağlık uyumlu yol", () => {
    const marker = "/var/lib/dolmus-takip/maintenance";
    // Sağlık görevinin baktığı işaretle AYNI yol.
    expect(read("deploy/health/health-check.mts")).toContain(
      `const MAINTENANCE_FILE = "${marker}";`,
    );
    // root / verilmezse mutlak yol Caddy'nin çalışma dizinine göre birleşir;
    // try_policy/split_path yok (varsayılan first_exist, dosya olarak).
    expect(activeLines(blockText(caddyfile, "@maintenance file {"))).toEqual([
      "@maintenance file {",
      "root /",
      `try_files ${marker}`,
      "}",
    ]);
    expect(lines.filter((line) => line.startsWith("@maintenance"))).toHaveLength(1);
    // Yapılandırma yeniden yüklenmeden açılıp kapanır: işaret env/import/vars
    // ile değil, yalnız bu eşleştiriciyle okunur.
    expect(lines.filter((line) => line.includes(marker))).toEqual([`try_files ${marker}`]);
    expect(lines.some((line) => /^(import|vars|map)\b/.test(line))).toBe(false);
  });

  test("bakım kapısı: 503 + Retry-After, uygulamaya iletmez", () => {
    const gate = activeLines(blockText(caddyfile, "handle @maintenance {"));
    expect(gate[0]).toBe("handle @maintenance {");
    expect(gate.at(-1)).toBe("}");
    const body = gate.slice(1, -1);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatch(/^header Retry-After \d+$/);
    expect(Number.parseInt(body[0]?.split(" ")[2] ?? "0", 10)).toBeGreaterThan(0);
    expect(body[1]).toMatch(/^respond ".+" 503$/);
    expect(gate.some((line) => /reverse_proxy|file_server|handle_errors/.test(line))).toBe(false);
  });

  test("sıra: @health 404, sonra bakım kapısı, en son reverse_proxy", () => {
    const health = caddyfile.indexOf("handle @health {");
    const matcher = caddyfile.indexOf("@maintenance file {");
    const gate = caddyfile.indexOf("handle @maintenance {");
    const proxy = caddyfile.indexOf("reverse_proxy 127.0.0.1:3000");
    expect(health).toBeGreaterThan(-1);
    expect(health).toBeLessThan(matcher);
    expect(matcher).toBeLessThan(gate);
    expect(gate).toBeLessThan(proxy);
    // reverse_proxy eşleştiricisiz son handle'dadır: Caddy aynı yönergeyi
    // (handle) eşleştiricisi olanlar önce, yazıldıkları sırayla dener.
    const handles = activeLines(caddyfile).filter((line) => line.startsWith("handle"));
    expect(handles).toEqual(["handle @health {", "handle @maintenance {", "handle {"]);
    expect(blockText(caddyfile, "\thandle {\n")).toContain("reverse_proxy 127.0.0.1:3000");
  });
});

describe("deploy/caddy/Caddyfile erişim günlüğü", () => {
  const caddyfile = read("deploy/caddy/Caddyfile");
  const lines = activeLines(caddyfile);

  test("site bloğunun İÇİNDE, journald'a (stdout), başlıklar silinerek", () => {
    expect(lines).toContain("log {");
    expect(lines).toContain("output stdout");
    expect(lines).toContain("request>headers delete");
    expect(lines).toContain("resp_headers delete");
    // log bloğu site bloğundan sonra açılır (global seçenek bloğu değil).
    expect(caddyfile.indexOf("{$DOLMUS_DOMAIN} {")).toBeLessThan(caddyfile.indexOf("\tlog {"));
  });

  test("her iki süzgeç (site erişim + genel hata logu) aynı alanları siler/maskeler", () => {
    const filterFields = (text: string) =>
      activeLines(text)
        .join("\n")
        .match(/fields \{[\s\S]*?request>remote_port delete/g) ?? [];
    const blocks = filterFields(caddyfile);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toContain("request>headers delete");
      expect(block).toContain("resp_headers delete");
      expect(block).toMatch(/request>uri query \{\s*delete q\s*delete cursor\s*\}/);
      expect(block).toMatch(/request>remote_ip ip_mask \{\s*ipv4 16\s*ipv6 32\s*\}/);
      expect(block).toMatch(/request>client_ip ip_mask \{\s*ipv4 16\s*ipv6 32\s*\}/);
      expect(block).toContain("request>remote_port delete");
      // Yol lazım: request>uri bütünüyle silinmez, değerler hash'lenmez.
      expect(block).not.toMatch(/request>uri delete|hash/);
    }
    expect(blocks[0]).toBe(blocks[1]);
  });

  test("genel log http.log.error'u içerir", () => {
    expect(lines).toContain("include http.log.error");
  });

  test("başlıkları geri getiren alan yok (delete dışında request>headers/resp_headers eylemi)", () => {
    for (const line of lines.filter((l) => /headers/.test(l))) {
      expect(line).toMatch(/ delete$/);
    }
  });
});

describe("deploy/systemd/dolmus-takip.service", () => {
  const unit = read("deploy/systemd/dolmus-takip.service");
  const lines = activeLines(unit);

  test("root olmayan servis kullanıcısı, sürüm kökünden çalışır", () => {
    expect(lines).toContain("User=dolmus-takip");
    expect(lines).toContain("Group=dolmus-takip");
    expect(lines).toContain("WorkingDirectory=/opt/dolmus-takip/current");
    expect(lines).not.toContain("User=root");
  });

  test("yalnız 127.0.0.1:3000'de dinler (HOSTNAME/PORT)", () => {
    expect(lines).toContain("Environment=HOSTNAME=127.0.0.1");
    expect(lines).toContain("Environment=PORT=3000");
    expect(lines).toContain("Environment=NODE_ENV=production");
    expect(unit).not.toMatch(/HOSTNAME=0\.0\.0\.0/);
  });

  test("ayarlar /etc/dolmus-takip'ten; APP_ORIGIN aynı DOLMUS_DOMAIN'den türer", () => {
    expect(lines).toContain("EnvironmentFile=/etc/dolmus-takip/domain.env");
    expect(lines).toContain("EnvironmentFile=/etc/dolmus-takip/app.env");
    const execStart = lines.find((line) => line.startsWith("ExecStart="));
    expect(execStart).toContain("APP_ORIGIN=https://${DOLMUS_DOMAIN}");
    expect(execStart).toContain("/usr/bin/node server.js");
    // Elle yazılmış ikinci bir APP_ORIGIN değeri yok.
    expect(lines.filter((line) => /APP_ORIGIN=/.test(line))).toHaveLength(1);
  });

  test("yalnız kalıcı DB dizini yazılabilir", () => {
    expect(lines).toContain("ProtectSystem=strict");
    expect(lines).toContain("NoNewPrivileges=true");
    expect(lines.filter((line) => line.startsWith("ReadWritePaths="))).toEqual([
      "ReadWritePaths=/var/lib/dolmus-takip/data",
    ]);
  });

  test("yeniden başlatma değerleri ARCHITECTURE §8.2 ile aynı", () => {
    expect(lines).toContain("Restart=on-failure");
    expect(lines).toContain("RestartSec=10s");
    expect(lines).toContain("StartLimitIntervalSec=900");
    expect(lines).toContain("StartLimitBurst=3");
  });

  test("multi-user.target ile açılışta etkin", () => {
    expect(lines).toContain("WantedBy=multi-user.target");
  });

  test("kurtarma kilidi varken başlamaz: AssertPathExists=! (Condition değil, görünür hata), [Unit] içinde", () => {
    const lockPath = "/var/lib/dolmus-takip/health/recovery.lock";
    expect(lines).toContain(`AssertPathExists=!${lockPath}`);
    expect(lines.some((line) => line.startsWith("ConditionPathExists"))).toBe(false);
    const unitSection = unit.slice(unit.indexOf("[Unit]"), unit.indexOf("[Service]"));
    expect(unitSection).toContain(`AssertPathExists=!${lockPath}`);
    expect(unit).not.toMatch(/ExecStartPre=.*recovery\.lock/);
  });
});

describe("deploy/systemd/dolmus-takip-health.{timer,service}", () => {
  const timer = activeLines(read("deploy/systemd/dolmus-takip-health.timer"));
  const health = read("deploy/systemd/dolmus-takip-health.service");
  const service = activeLines(health);

  test("zamanlayıcı her 30 sn'de sağlık birimini tetikler; timers.target'ta etkin", () => {
    expect(timer).toContain("OnUnitActiveSec=30s");
    expect(timer).toContain("Unit=dolmus-takip-health.service");
    expect(timer).toContain("WantedBy=timers.target");
  });

  test("birim oneshot; yazılabilir tek yol durum dizini", () => {
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("ProtectSystem=strict");
    expect(service).toContain("NoNewPrivileges=true");
    expect(service.filter((line) => line.startsWith("ReadWritePaths="))).toEqual([
      "ReadWritePaths=/var/lib/dolmus-takip/health",
    ]);
    expect(service.some((line) => line.startsWith("StateDirectory="))).toBe(false);
  });

  test("paralel koşu flock -n ile engellenir; betik /opt/dolmus-takip/health'ten, current'a bağlı değil", () => {
    const exec = service.find((line) => line.startsWith("ExecStart="));
    expect(exec).toContain("/usr/bin/flock -n -E 0 /var/lib/dolmus-takip/health/run.lock");
    expect(exec).toContain("/usr/bin/node /opt/dolmus-takip/health/health-check.mts");
    expect(health.replace(/^#.*$/gm, "")).not.toContain("/opt/dolmus-takip/current");
  });

  test("başlatma zaman aşımı uygulamanın durdurma zaman aşımından (varsayılan 90 sn) büyük", () => {
    const value = service.find((line) => line.startsWith("TimeoutStartSec="));
    expect(value).toBeDefined();
    expect(Number.parseInt((value ?? "").split("=")[1] ?? "0", 10)).toBeGreaterThan(90);
    // Uygulama birimi durdurma süresini kısaltmıyorsa varsayılan 90 sn geçerlidir.
    const app = activeLines(read("deploy/systemd/dolmus-takip.service"));
    expect(app.some((line) => line.startsWith("TimeoutStopSec="))).toBe(false);
  });
});

describe("deploy/systemd/dolmus-takip-backup.{timer,service}", () => {
  const timer = read("deploy/systemd/dolmus-takip-backup.timer");
  const timerLines = activeLines(timer);
  const unit = read("deploy/systemd/dolmus-takip-backup.service");
  const service = activeLines(unit);
  const health = activeLines(read("deploy/systemd/dolmus-takip-health.service"));
  const lockPath = "/var/lib/dolmus-takip/ops.lock";

  test("zamanlayıcı her gün 02:30 Europe/Istanbul; telafi yok (Persistent=false)", () => {
    expect(timerLines).toContain("OnCalendar=*-*-* 02:30:00 Europe/Istanbul");
    expect(timerLines).toContain("Persistent=false");
    expect(timerLines.some((line) => /^Persistent=true/.test(line))).toBe(false);
    expect(timerLines).toContain("Unit=dolmus-takip-backup.service");
    expect(timerLines).toContain("WantedBy=timers.target");
  });

  test("birim oneshot ve root değil: dolmus-takip olarak, release kökünden", () => {
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("User=dolmus-takip");
    expect(service).toContain("Group=dolmus-takip");
    expect(service).not.toContain("User=root");
    expect(service).toContain("WorkingDirectory=/opt/dolmus-takip/current");
    expect(service).toContain("EnvironmentFile=/etc/dolmus-takip/app.env");
    expect(service).toContain("Environment=DOLMUS_BACKUP_DIR=/var/lib/dolmus-takip/backup-ready");
    // Doğrulama saati yalnız test içindir; birimde asla ayarlanmaz.
    expect(unit).not.toContain("DOLMUS_BACKUP_NOW");
  });

  test("ortak işletim kilidi flock ile, sınırlı bekleme (-w) ve ayırt edilir çıkış kodu; kopya CLI'si run", () => {
    const exec = service.find((line) => line.startsWith("ExecStart="));
    expect(exec).toBe(
      `ExecStart=/usr/bin/flock -w 600 -E 75 ${lockPath} /usr/bin/node scripts/db-backup.ts run`,
    );
    // Engellemeyen (-n) veya sınırsız bekleyen sarmalayıcı değil.
    expect(exec).not.toMatch(/flock -n|flock (?!-w)/);
    const wait = Number.parseInt(/-w (\d+)/.exec(exec ?? "")?.[1] ?? "0", 10);
    const timeout = Number.parseInt(
      (service.find((line) => line.startsWith("TimeoutStartSec=")) ?? "").split("=")[1] ?? "0",
      10,
    );
    expect(wait).toBeGreaterThan(0);
    expect(timeout).toBeGreaterThan(wait);
  });

  test("sağlık birimiyle aynı sertleştirme; yazılabilir yollar yalnız veri ve hazır kopya dizini", () => {
    for (const line of [
      "NoNewPrivileges=true",
      "PrivateTmp=true",
      "ProtectSystem=strict",
      "ProtectHome=true",
      "PrivateDevices=true",
      "ProtectKernelTunables=true",
      "ProtectKernelModules=true",
      "ProtectControlGroups=true",
      "RestrictNamespaces=true",
      "LockPersonality=true",
    ]) {
      expect(health, `health: ${line}`).toContain(line);
      expect(service, line).toContain(line);
    }
    // WAL DB'yi okumak veri dizinine (-shm) yazma gerektirir; yalnız bu iki yol.
    expect(service.filter((line) => line.startsWith("ReadWritePaths="))).toEqual([
      "ReadWritePaths=/var/lib/dolmus-takip/data /var/lib/dolmus-takip/backup-ready",
    ]);
  });

  test("bakım işaretine ve sağlık kilidine dokunmaz; [Install] yok", () => {
    expect(unit.replace(/^#.*$/gm, "")).not.toMatch(/maintenance|recovery\.lock|health\/run\.lock/);
    expect(service).not.toContain("[Install]");
  });

  test("yedek birimi ile SERVER-SETUP §4 sürüm değiştirme AYNI kilit dosyasını kullanır", () => {
    const guide = read("docs/SERVER-SETUP.md");
    const releaseSection = guide.slice(
      guide.indexOf("## 4. Sürüm değiştirme"),
      guide.indexOf("## 5. Manuel doğrulama tablosu"),
    );
    expect(releaseSection).toContain(`flock -w 900 -E 75 ${lockPath} bash -euc`);
    // Migration kilit altındaki kabuğun içindedir, kilit dışında değil.
    const locked = releaseSection.slice(releaseSection.indexOf("flock -w 900"));
    expect(locked.indexOf("scripts/db-init.ts --existing")).toBeGreaterThan(-1);
    expect(releaseSection.indexOf("flock -w 900")).toBeLessThan(
      releaseSection.indexOf("scripts/db-init.ts --existing"),
    );
  });
});

describe("deploy/health betikleri", () => {
  test("yalnız node: yerleşikleri ve kendi modülü; dış paket yok", () => {
    for (const file of ["deploy/health/health-check.mts", "deploy/health/health-decision.mts"]) {
      const source = read(file);
      for (const spec of source.matchAll(/from\s+"([^"]+)"/g)) {
        expect(spec[1], file).toMatch(/^(node:[a-z_/]+|\.\/health-decision\.mts)$/);
      }
      expect(source, file).toContain("HAZIRLANDI, gerçek sunucuda DENENMEDİ");
    }
  });

  test("dış komutlar execFile ile; kabuk çağrısı yok", () => {
    const source = read("deploy/health/health-check.mts");
    expect(source).toContain("execFile");
    expect(source).not.toMatch(/\bexec\(|execSync|spawnSync|shell:\s*true/);
  });

  test("durum ve kilit kalıcı /var/lib altında; /run ve /tmp yok", () => {
    const source = read("deploy/health/health-check.mts");
    expect(source).toContain('"/var/lib/dolmus-takip/health"');
    expect(source).toContain('"/var/lib/dolmus-takip/maintenance"');
    expect(source).not.toMatch(/"\/(run|tmp)\b/);
  });
});

describe("deploy/journald/dolmus-takip.conf", () => {
  test("toplam ~200 MB sınır, kalıcı depolama", () => {
    const lines = activeLines(read("deploy/journald/dolmus-takip.conf"));
    expect(lines).toContain("[Journal]");
    expect(lines).toContain("SystemMaxUse=200M");
    expect(lines).toContain("Storage=persistent");
  });
});

describe("deploy/systemd/caddy.service.d/override.conf", () => {
  test("Caddy alan adını uygulamayla aynı domain.env'den alır", () => {
    const lines = activeLines(read("deploy/systemd/caddy.service.d/override.conf"));
    expect(lines).toContain("EnvironmentFile=/etc/dolmus-takip/domain.env");
    expect(lines).toContain("Restart=on-failure");
    expect(lines).toContain("RestartSec=10s");
    expect(lines).toContain("StartLimitIntervalSec=900");
    expect(lines).toContain("StartLimitBurst=3");
  });
});

describe("deploy/ dosya başlıkları", () => {
  test("her yeni deploy dosyası 'HAZIRLANDI, gerçek sunucuda DENENMEDİ' başlığını taşır", () => {
    for (const file of [
      "deploy/systemd/dolmus-takip-health.service",
      "deploy/systemd/dolmus-takip-health.timer",
      "deploy/systemd/dolmus-takip-backup.service",
      "deploy/systemd/dolmus-takip-backup.timer",
      "deploy/journald/dolmus-takip.conf",
      "deploy/systemd/dolmus-takip.service",
      "deploy/systemd/caddy.service.d/override.conf",
      "deploy/caddy/Caddyfile",
    ]) {
      expect(read(file), file).toContain("HAZIRLANDI, gerçek sunucuda DENENMEDİ");
    }
  });
});

describe("deploy/env örnekleri", () => {
  test("domain.env.example yalnız DOLMUS_DOMAIN taşır; şema/yol yok", () => {
    const lines = activeLines(read("deploy/env/domain.env.example"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^DOLMUS_DOMAIN=[a-z0-9.-]+$/);
  });

  test("app.env.example DB yolu ve TRUSTED_PROXY'yi taşır; APP_ORIGIN/HOSTNAME/PORT yok", () => {
    const lines = activeLines(read("deploy/env/app.env.example"));
    expect(lines).toContain("DOLMUS_DB_PATH=/var/lib/dolmus-takip/data/app.sqlite");
    expect(lines).toContain("TRUSTED_PROXY=127.0.0.1");
    expect(lines.some((line) => /^(APP_ORIGIN|HOSTNAME|PORT)=/.test(line))).toBe(false);
  });
});

describe("docs/SERVER-SETUP.md", () => {
  const guide = read("docs/SERVER-SETUP.md");

  test("hedef ve doğrulama durağı yazılı; ISSUE-29 göndermesi yok, denenmedi/pilot değil beyanı var", () => {
    expect(guide).toContain("Frankfurt");
    expect(guide).toContain("2 vCPU, 2 GB RAM, 60 GB SSD");
    expect(guide).toContain("DURAK");
    expect(guide).not.toContain("ISSUE-29");
    expect(guide).toContain("PİLOT İÇİN HAZIR DEĞİL");
    for (const file of [
      "README.md",
      "docs/RELEASE.md",
      "deploy/caddy/Caddyfile",
      "deploy/systemd/dolmus-takip.service",
      "deploy/systemd/caddy.service.d/override.conf",
    ]) {
      expect(read(file), file).not.toContain("ISSUE-29");
    }
  });

  test("rehber değişkenler bölümüyle açılır; sonraki komutlarda sabit alan adı/hesap no yok", () => {
    const firstHeading = guide.split("\n").filter((l) => l.startsWith("## "))[0];
    expect(firstHeading).toBe("## Değişkenler");
    for (const v of [
      "DOLMUS_DOMAIN",
      "AWS_PROFILE",
      "AWS_REGION",
      "DOLMUS_INSTANCE",
      "DOLMUS_STATIC_IP_NAME",
      "DOLMUS_SSH_KEY",
    ]) {
      expect(guide, v).toContain(`export ${v}=`);
    }
    // Değişkenler bölümünden sonraki bash bloklarında 12 haneli hesap no yok
    // ve her aws lightsail komutu profil + bölge taşır.
    const afterVars = guide.slice(guide.indexOf("## 1. Hedef"));
    expect(afterVars).not.toMatch(/\b\d{12}\b/);
    const awsCommands = afterVars
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .filter((l) => /^\s*aws lightsail /.test(l));
    expect(awsCommands.length).toBeGreaterThan(5);
    for (const cmd of awsCommands) {
      expect(cmd).toContain('--profile "$AWS_PROFILE"');
      expect(cmd).toContain('--region "$AWS_REGION"');
    }
  });

  test("adımlar sırayla: instance, statik IP, portlar, DNS, kopyalama, Node/Caddy, şema, ilk yönetici, servis başlatma", () => {
    const order = [
      "aws lightsail create-instances",
      "aws lightsail allocate-static-ip",
      "aws lightsail put-instance-public-ports",
      'dig +short A "$DOLMUS_DOMAIN"',
      "scp -i",
      "setup_24.x",
      "apt-get install -y caddy",
      "scripts/db-init.ts\n",
      "scripts/platform-admin.ts create-first-admin",
      "sudo systemctl start dolmus-takip.service caddy.service",
      "sudo systemctl enable --now dolmus-takip-health.timer",
    ];
    let last = -1;
    for (const marker of order) {
      const at = guide.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
    // Yalnız 22/80/443; 3000 açılmaz.
    expect(guide).toContain("fromPort=22,toPort=22");
    expect(guide).toContain("fromPort=80,toPort=80");
    expect(guide).toContain("fromPort=443,toPort=443");
    expect(guide).not.toMatch(/fromPort=3000/);
  });

  test("ilk yönetici servis kullanıcısıyla, parola stdin'den; argv'de parola yok", () => {
    expect(guide).toContain(
      "sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env \\\n  scripts/platform-admin.ts create-first-admin --username \"$ADMIN_USER\" --password-stdin",
    );
    expect(guide).not.toMatch(/--password(?!-stdin)/);
    expect(guide).not.toMatch(/^sudo node .*platform-admin/m);
  });

  test("sağlık görevi kurulumu: betikler, birim, zamanlayıcı, journald sınırı; timer servislerden sonra", () => {
    for (const marker of [
      "deploy/health/health-check.mts deploy/health/health-decision.mts",
      "/opt/dolmus-takip/health/",
      "install -d -m 0700 -o root -g root /var/lib/dolmus-takip/health",
      "deploy/systemd/dolmus-takip-health.service /etc/systemd/system/dolmus-takip-health.service",
      "deploy/systemd/dolmus-takip-health.timer /etc/systemd/system/dolmus-takip-health.timer",
      "deploy/journald/dolmus-takip.conf /etc/systemd/journald.conf.d/dolmus-takip.conf",
      "systemctl restart systemd-journald",
    ]) {
      expect(guide, marker).toContain(marker);
    }
    // Zamanlayıcı yalnız §3.4'te, servisler başlatıldıktan sonra etkinleşir.
    expect(guide.indexOf("enable --now dolmus-takip-health.timer")).toBeGreaterThan(
      guide.indexOf("sudo systemctl start dolmus-takip.service caddy.service"),
    );
    expect(guide).not.toContain("enable dolmus-takip-health.timer\n");
  });

  test("manuel doğrulama bölümü: 24 kontrol (9 kurulum + 7 sağlık otomasyonu + 5 yedek + 3 bakım kapısı), hepsi doğrulanacak işaretli", () => {
    const start = guide.indexOf("## 5. Manuel doğrulama tablosu");
    expect(start).toBeGreaterThan(-1);
    const section = guide.slice(start, guide.indexOf("## 6."));
    const rows = section.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(24);
    for (const row of rows) {
      expect(row).toContain("elle kurulumda doğrulanacak");
    }
    for (const topic of [
      "Sertifika alındı",
      "Sertifika yenileme",
      "HTTP → HTTPS",
      "https://$DOLMUS_DOMAIN",
      "3000",
      "reboot",
      "deneme kaydı",
      "Sürüm değişiminde veri kalır",
      "Sağlık zamanlayıcısı 30 sn'de çalışır",
      "Çökme: systemd yeniden başlatır",
      "Donma: 3 ardışık hata sonrası tek düzeltici restart",
      "Ready hatası tek başına restart üretmez",
      "kalıcı kilit; reboot sonrası da başlatmaz",
      "Bakım işareti restart'ı engeller",
      "Caddy erişim günlüğü başlıksız; journald sınırı",
      "Ortak işletim kilidi: yedek birimi sandbox altında kilidi açar",
      "Günlük kopya birimi: `dolmus-takip` olarak",
      "Yedek zamanlayıcısı 02:30 Europe/Istanbul; telafi yok",
      "Lightsail otomatik snapshot 00:00 UTC; Türkiye eşlemesi",
      "Kopya–snapshot ilişkisi",
      "Bakım kapısı: işaret varken dışarıya 503, reload yok",
      "Bakım kapısı: işaret kalkınca trafik açılır, reload yok",
      "Bakım kapısı açık kalamaz: `caddy` işareti görür; yayın dizinleri",
    ]) {
      expect(section, topic).toContain(topic);
    }
  });

  test("bakım kapısı satırları: dışarıdan 503 + Retry-After, sağlık 404, yerelde live/ready; caddy stat kanıtı", () => {
    const section = guide.slice(guide.indexOf("## 5. Manuel doğrulama tablosu"), guide.indexOf("## 6."));
    const row = (n: number) => section.split("\n").find((l) => l.startsWith(`| ${n} |`)) ?? "";
    const on = row(22);
    expect(on).toContain("/dev/null /var/lib/dolmus-takip/maintenance");
    expect(on).toContain('curl -si "https://$DOLMUS_DOMAIN/api/v1/health/live"');
    expect(on).toContain("http://127.0.0.1:3000/api/v1/health/ready");
    expect(on).toContain("`503` ve `Retry-After: 120`");
    expect(on).toContain("dışarıdan yine `404`");
    expect(row(23)).toContain("sudo rm /var/lib/dolmus-takip/maintenance");
    const traverse = row(24);
    expect(traverse).toContain("sudo -u caddy stat /var/lib/dolmus-takip/maintenance");
    expect(traverse).toContain("`root:root 755`, `root:root 700`, `dolmus-takip:dolmus-takip 750`");
    // Rehberdeki Retry-After değeri Caddyfile'daki ile aynı.
    expect(read("deploy/caddy/Caddyfile")).toContain("header Retry-After 120");
  });

  test("dizin sözleşmesi ARCHITECTURE §8.1 ile aynı yollar", () => {
    for (const p of [
      "/var/lib/dolmus-takip/health/",
      "/var/lib/dolmus-takip/maintenance",
      "/opt/dolmus-takip/health/",
      "/opt/dolmus-takip/releases/<release-id>",
      "/opt/dolmus-takip/current",
      "/var/lib/dolmus-takip/data/",
      "/var/lib/dolmus-takip/backup-ready/",
      "/var/lib/dolmus-takip/pre-migration/",
      "/var/lib/dolmus-takip/preserved/",
      "/var/lib/dolmus-takip/release-state/",
      "/var/lib/dolmus-takip/ops.lock",
      "/etc/dolmus-takip/",
    ]) {
      expect(guide, p).toContain(p);
    }
  });

  test("§2 veri kökü, release-state ve preserved sahip/mod ile; §3.1 onları aynı sahip/modla yaratır", () => {
    const table = guide.slice(guide.indexOf("## 2. Dizinler"), guide.indexOf("## 3. İlk kurulum"));
    const row = (p: string) => table.split("\n").find((l) => l.startsWith(`| \`${p}\` |`)) ?? "";
    expect(row("/var/lib/dolmus-takip/")).toMatch(/\| `root:root` \| `0755` \|$/);
    expect(row("/var/lib/dolmus-takip/")).toContain("`caddy`");
    expect(row("/var/lib/dolmus-takip/release-state/")).toMatch(/\| `root:root` \| `0700` \|$/);
    expect(row("/var/lib/dolmus-takip/preserved/")).toMatch(
      /\| `dolmus-takip:dolmus-takip` \| `0750` \|$/,
    );
    expect(row("/var/lib/dolmus-takip/maintenance")).toContain("Caddy");
    expect(row("/var/lib/dolmus-takip/maintenance")).toMatch(/\| `root:root` \| `0644` \|$/);

    const install = guide.slice(guide.indexOf("### 3.1"), guide.indexOf("### 3.2"));
    expect(install).toContain("sudo install -d -m 0755 -o root -g root /var/lib/dolmus-takip\n");
    expect(install).toContain(
      "sudo install -d -m 0750 -o dolmus-takip -g dolmus-takip \\\n  /var/lib/dolmus-takip/data /var/lib/dolmus-takip/backup-ready /var/lib/dolmus-takip/pre-migration \\\n  /var/lib/dolmus-takip/preserved\n",
    );
    expect(install).toContain("sudo install -d -m 0700 -o root -g root /var/lib/dolmus-takip/release-state\n");
    // Veri kökü alt dizinlerden önce açıkça kurulur (mod umask'a bırakılmaz).
    expect(install.indexOf("-g root /var/lib/dolmus-takip\n")).toBeLessThan(
      install.indexOf("/var/lib/dolmus-takip/data"),
    );
  });

  test("ilk şema ve sürüm geçişi servis kullanıcısıyla; geçişte --existing; atomik current", () => {
    expect(guide).toContain(
      "sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env scripts/db-init.ts\n",
    );
    expect(guide).toContain(
      "sudo -u dolmus-takip node --env-file=/etc/dolmus-takip/app.env scripts/db-init.ts --existing",
    );
    expect(guide).toContain("mv -T /opt/dolmus-takip/current.tmp /opt/dolmus-takip/current");
    expect(guide).toContain("systemctl enable dolmus-takip.service caddy.service");
    // Root olarak db-init çalıştıran satır yok.
    expect(guide).not.toMatch(/^sudo node .*db-init/m);
  });

  test("yedek kurulumu: kilit dosyası, birimler, zamanlayıcı servislerden sonra etkinleşir", () => {
    for (const marker of [
      "sudo install -m 0640 -o root -g dolmus-takip /dev/null /var/lib/dolmus-takip/ops.lock",
      "deploy/systemd/dolmus-takip-backup.service /etc/systemd/system/dolmus-takip-backup.service",
      "deploy/systemd/dolmus-takip-backup.timer /etc/systemd/system/dolmus-takip-backup.timer",
    ]) {
      expect(guide, marker).toContain(marker);
    }
    expect(guide.indexOf("sudo systemctl enable --now dolmus-takip-backup.timer")).toBeGreaterThan(
      guide.indexOf("sudo systemctl start dolmus-takip.service caddy.service"),
    );
    // Kilit dosyası, kullanılacağı §4'ten ve birimlerin kurulumundan önce yaratılır.
    expect(guide.indexOf("/dev/null /var/lib/dolmus-takip/ops.lock")).toBeLessThan(
      guide.indexOf("deploy/systemd/dolmus-takip-backup.service /etc/systemd"),
    );
  });

  test("Lightsail otomatik snapshot 00:00 UTC ve yazılı Türkiye–UTC eşlemesi; her aws satırı profil+bölge taşır", () => {
    expect(guide).toContain("snapshotTimeOfDay=00:00");
    expect(guide).toContain("**00:00 UTC = 03:00 Europe/Istanbul**");
    expect(guide).toContain("UTC+3");
    expect(guide).toContain("aws lightsail get-auto-snapshots");
    const section = guide.slice(guide.indexOf("### 3.5"), guide.indexOf("## 4."));
    const awsCommands = section
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .filter((l) => /^\s*aws lightsail /.test(l));
    expect(awsCommands).toHaveLength(3);
    for (const cmd of awsCommands) {
      expect(cmd).toContain('--profile "$AWS_PROFILE"');
      expect(cmd).toContain('--region "$AWS_REGION"');
    }
  });

  test("release manifesti ve temizlik kuralı: kopyaya bağlı release ve manifesti silinmez", () => {
    expect(guide).toContain("<release-id>.manifest.json");
    expect(guide).toContain("**Release manifesti ve temizlik kuralı:**");
    expect(guide).toContain("scripts/db-backup.ts status");
    expect(guide).toContain("**silinmez**");
  });

  test("her komut bloğunun başında 'denenmedi' işareti var", () => {
    const blocks = guide.split("```bash").slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.split("\n")[1] ?? "").toContain("denenmedi");
    }
  });
});

describe("docs/OPS.md", () => {
  const ops = read("docs/OPS.md");

  test("F13 giriş sayacı ve hash kuyruğu izleme satırları", () => {
    expect(ops).toContain("| Giriş sayacı (F13) |");
    expect(ops).toContain("RATE_LIMITED");
    expect(ops).toContain("| Argon2 hash kuyruğu (F13) |");
    expect(ops).toContain("hash_active=<n> hash_pending=<n> hash_longest_wait_ms=<ms>");
  });

  test("kilit kaldırma yordamı, sağlık görevi kilit kaldırmaz ve tamamen durmuş makine riski", () => {
    expect(ops).toContain("Kilit kaldırma yordamı");
    expect(ops).toContain("sudo rm /var/lib/dolmus-takip/health/recovery.lock");
    expect(ops).toContain("Görev kilidi veya systemd sayacını otomatik sıfırlamaz");
    expect(ops).toContain("**Otomatik olarak algılanmaz**");
  });

  test("Caddy erişim satırının içeriği ve başlık yokluğu yazılı", () => {
    expect(ops).toContain("istek ve yanıt başlıklarını hiç içermez");
    expect(ops).toContain("maskelenmiş istemci IP'si (IPv4 /16, IPv6 /32)");
    expect(ops).toContain("`q` ve `cursor` sorgu değerleri silinir");
    expect(ops).not.toContain("sorgu dizesi dahil");
    expect(ops).not.toContain("varsayım, kodda ayrıca doğrulanmadı");
  });

  test("günlük yedek: üç ayrı kayıt, bağlanamayan snapshot iyi yedek ilan edilmez, journal uyarısı, saklama", () => {
    for (const record of ["'DB kopyası hazır'", "'AWS snapshot başarılı'", "'restore sınandı'"]) {
      expect(ops, record).toContain(record);
    }
    expect(ops).toContain("**üç ayrı günlük kayıt**");
    expect(ops).toContain("**iyi yedek ilan edilmez**");
    expect(ops).toContain("event=backup_failed");
    expect(ops).toContain("Uyarı **yalnız journal'dadır**");
    expect(ops).toContain("en yeni **2** doğrulanmış SQLite kopyası");
    expect(ops).toContain("**00:00 UTC = 03:00 Europe/Istanbul**");
  });

  test("kontrollü restore: ayrı makine denemesi, maliyet ve temizlik kaydı; row_count_drop işletim kararı", () => {
    const section = ops.slice(ops.indexOf("### Kontrollü restore"), ops.indexOf("## 5. Arıza müdahale yolları"));
    expect(section).toContain("**A. Ayrı makinede restore denemesi.**");
    expect(section).toContain("aws lightsail create-instances-from-snapshot");
    expect(section).toContain("aws lightsail delete-instance");
    expect(section).toContain("# beklenen: NotFoundException");
    expect(section).toContain("| Deneme maliyeti |");
    expect(section).toContain("| Temizlik |");
    for (const field of ["recoverable_point", "recovery_duration_s", "loss_window_s"]) {
      expect(section, field).toContain(`restore_record ${field}`);
    }
    expect(section).toContain("reason=row_count_drop");
    expect(section).toContain("bu reddi aşmak için **silinmez**");
    expect(section).toContain("/var/lib/dolmus-takip/preserved/<zaman>/");
  });

  test("OPS'taki db-restore çağrıları aracın gerçek komut/bayraklarıyla ve servis kullanıcısıyla", () => {
    const script = read("scripts/db-restore.ts");
    const lines = ops.split("\n").filter((line) => line.includes("scripts/db-restore.ts "));
    const calls = lines.map((line) => /scripts\/db-restore\.ts (\w+)((?: --[a-z-]+ \S+)*)$/.exec(line.trim()));
    expect(calls.map((call) => call?.[1]).sort()).toEqual(["install", "report", "verify"]);
    for (const [index, call] of calls.entries()) {
      expect(lines[index]).toContain("sudo -u dolmus-takip ");
      const [, command, flags] = call!;
      for (const flag of flags!.match(/--[a-z-]+/g) ?? []) {
        expect(script, `${command} ${flag}`).toMatch(new RegExp(`\\b${command}: \\[[^\\]]*"${flag}"`));
      }
    }
    expect(script).toContain('const DEFAULT_MAINTENANCE_FILE = "/var/lib/dolmus-takip/maintenance";');
    expect(script).toContain('const DEFAULT_PRESERVED_DIR = "/var/lib/dolmus-takip/preserved";');
    expect(script).toContain('const DEFAULT_OPS_LOCK = "/var/lib/dolmus-takip/ops.lock";');
  });

  test("makineyi silmeden önce manuel snapshot adımı; her aws satırı profil+bölge taşır", () => {
    expect(ops).toContain("**Makineyi silmeden önce (zorunlu adım):**");
    expect(ops).toContain("aws lightsail create-instance-snapshot");
    const awsCommands = ops
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .filter((l) => /^\s*aws lightsail /.test(l));
    expect(awsCommands.length).toBeGreaterThan(0);
    for (const cmd of awsCommands) {
      expect(cmd).toContain('--profile "$AWS_PROFILE"');
      expect(cmd).toContain('--region "$AWS_REGION"');
    }
  });
});
