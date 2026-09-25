import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * `deploy/` yapılandırma dosyalarının metinsel doğrulaması. Bilerek YAML/INI
 * ayrıştırıcı paketi eklenmedi (K9 sabit bağımlılık listesi;
 * `ci-workflows.test.ts` ile aynı tutum): satır/regex kontrolleri yalnız
 * "sözleşme değerleri yerinde mi" sorusunu commit zamanında yakalar. Gerçek
 * Caddy/systemd doğrulamasının yerini TUTMAZ; o, elle kurulum sırasındaki
 * gerçek sunucu denemesidir.
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

  test("yeniden başlatma: on-failure, 10 sn bekleme, 900 sn'de en fazla 3", () => {
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

  test("yedek birimi ile sürüm değiştirme aracı (release-apply) AYNI kilit dosyasını kullanır", () => {
    const tool = read("scripts/release-apply.ts");
    expect(tool).toContain(`const DEFAULT_OPS_LOCK = "${lockPath}";`);
    // Kilit, yayın aracındaki migration çağrısından ÖNCE alınır ve 900 sn / 75 ortak kilit modülündedir.
    const deploy = tool.slice(tool.indexOf("async function runDeploy("));
    expect(deploy.indexOf("acquireOpsLock(env, DEFAULT_OPS_LOCK)")).toBeGreaterThan(-1);
    expect(deploy.indexOf("acquireOpsLock(env, DEFAULT_OPS_LOCK)")).toBeLessThan(
      deploy.indexOf('["scripts/db-init.ts", "--existing"]'),
    );
    const lock = read("scripts/lib/ops-lock.ts");
    expect(lock).toContain("export const DEFAULT_OPS_LOCK_WAIT_SECONDS = 900;");
    expect(lock).toContain("export const LOCK_BUSY_EXIT = 75;");
    expect(lock).toContain('spawnSync("flock", ["-w", String(wait), "-E", String(LOCK_BUSY_EXIT), "3"]');
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
