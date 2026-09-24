import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * `deploy/` yapılandırma dosyalarının ve `docs/SERVER-SETUP.md`'nin metinsel
 * doğrulaması. Bilerek YAML/INI ayrıştırıcı paketi eklenmedi (K9 sabit
 * bağımlılık listesi; `ci-workflows.test.ts` ile aynı tutum): satır/regex
 * kontrolleri yalnız "sözleşme değerleri yerinde mi" sorusunu commit
 * zamanında yakalar. Gerçek Caddy/systemd doğrulamasının yerini TUTMAZ;
 * o, gerçek sunucu denemesidir (ISSUE-29).
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

describe("deploy/caddy/Caddyfile", () => {
  const caddyfile = read("deploy/caddy/Caddyfile");
  const lines = activeLines(caddyfile);

  test("tek site adresi {$DOLMUS_DOMAIN}; başka üst düzey adres yok", () => {
    // Girintisiz, "{" ile biten satırlar üst düzey bloklardır.
    const topLevel = caddyfile
      .split("\n")
      .filter((line) => /^[^\s#].*\{\s*$/.test(line));
    expect(topLevel).toEqual(["{$DOLMUS_DOMAIN} {"]);
  });

  test("yalnız 127.0.0.1:3000'e reverse_proxy; dosya sunumu yok", () => {
    expect(lines).toContain("reverse_proxy 127.0.0.1:3000");
    expect(lines.filter((line) => line.startsWith("reverse_proxy"))).toHaveLength(1);
    expect(lines.some((line) => /^(file_server|root)\b/.test(line))).toBe(false);
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

  test("hedef, doğrulama durağı ve ISSUE-29 sınırı yazılı", () => {
    expect(guide).toContain("Frankfurt");
    expect(guide).toContain("2 vCPU, 2 GB RAM, 60 GB SSD");
    expect(guide).toContain("DURAK");
    expect(guide).toContain("ISSUE-29");
  });

  test("dizin sözleşmesi ARCHITECTURE §8.1 ile aynı yollar", () => {
    for (const p of [
      "/opt/dolmus-takip/releases/<release-id>",
      "/opt/dolmus-takip/current",
      "/var/lib/dolmus-takip/data/",
      "/var/lib/dolmus-takip/backup-ready/",
      "/var/lib/dolmus-takip/pre-migration/",
      "/etc/dolmus-takip/",
    ]) {
      expect(guide, p).toContain(p);
    }
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

  test("her komut bloğunun başında 'denenmedi' işareti var", () => {
    const blocks = guide.split("```bash").slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.split("\n")[1] ?? "").toContain("denenmedi");
    }
  });
});
