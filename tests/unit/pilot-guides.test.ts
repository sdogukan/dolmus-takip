import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * S6.6 pilot rehberlerinin (QA-PLAN §2 kabul izlenebilirlik tablosu, §3 yük
 * prosedürü, SERVER-SETUP §5.1 yük DB'si adımları) metinsel doğrulaması.
 * `deploy-config.test.ts` ile aynı tutum: belgelerin sözleşme değerlerini
 * commit zamanında yakalar; hedef sunucudaki gerçek koşunun yerini TUTMAZ.
 */

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

function read(relativePath: string): string {
  const filePath = path.join(projectRoot, relativePath);
  expect(fs.existsSync(filePath), `"${relativePath}" yok`).toBe(true);
  return fs.readFileSync(filePath, "utf8");
}

function section(text: string, startHeading: string, endHeading: string): string {
  const start = text.indexOf(startHeading);
  expect(start, startHeading).toBeGreaterThan(-1);
  const end = text.indexOf(endHeading, start + startHeading.length);
  expect(end, endHeading).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** `tests/integration/{a,b}.test.ts` → iki yol; parantezsiz yol olduğu gibi. */
function expandBraces(ref: string): string[] {
  const match = /^(.*)\{([^}]+)\}(.*)$/u.exec(ref);
  if (!match) return [ref];
  const [, head, alternatives, tail] = match;
  return alternatives!.split(",").map((alt) => `${head}${alt}${tail}`);
}

function cells(row: string): string[] {
  return row.split(/(?<!\\)\|/u).slice(1, -1).map((cell) => cell.trim());
}

const qaPlan = read("docs/QA-PLAN.md");
const traceability = section(qaPlan, "### Kabul izlenebilirlik tablosu (S6.6)", "## 3. Çalıştırma ve CI planı");
const storyRows = traceability.split("\n").filter((line) => /^\| S\d\.\d \|/u.test(line));
const prdTable = traceability.slice(traceability.indexOf("| PRD §9 |"));
const prdRows = prdTable.split("\n").filter((line) => /^\| \d+ \|/u.test(line));

describe("QA-PLAN §2 kabul izlenebilirlik tablosu", () => {
  test("STORIES.md'deki 35 hikâyenin her biri tam bir satır", () => {
    const stories = [...read("docs/STORIES.md").matchAll(/^### (S\d\.\d) — /gmu)].map((m) => m[1]);
    expect(stories).toHaveLength(35);
    expect(storyRows.map((row) => cells(row)[0])).toEqual(stories);
  });

  test("PRD §9'un 28 maddesinin her biri sırayla tam bir satır", () => {
    expect(prdRows.map((row) => Number(cells(row)[0]))).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  test("her satır adlandırılmış kanıt, durum ve boş ya da dolu bir aday commit sonucu taşır", () => {
    for (const row of [...storyRows, ...prdRows]) {
      const c = cells(row);
      const evidence = c.slice(1, -2).join(" ");
      expect(evidence, row).toMatch(/`[^`]+`/u);
      expect(c.at(-2), row).toMatch(/^(çalıştırılmadı|açık|geçti|başarısız)(?:\s|$)/u);
      expect(c.at(-1), row).not.toBe("");
    }
  });

  test("aday commit seçilmeden hiçbir satır geçti yazılamaz", () => {
    const candidate = /\*\*Yayın adayı commit:\*\* `([^`]*)`/u.exec(traceability)?.[1] ?? "";
    const passed = [...storyRows, ...prdRows].filter((row) => cells(row).at(-2)!.startsWith("geçti"));
    if (!/^[0-9a-f]{40}$/u.test(candidate)) expect(passed).toEqual([]);
  });

  test("tabloda adı geçen her test dosyası depoda var", () => {
    const refs = new Set<string>();
    for (const row of [...storyRows, ...prdRows]) {
      for (const [, ref] of row.matchAll(/`((?:src|tests)\/[^`\s]+)`/gu)) {
        for (const file of expandBraces(ref!)) refs.add(file);
      }
    }
    expect(refs.size).toBeGreaterThan(50);
    const missing = [...refs].filter((file) => !fs.existsSync(path.join(projectRoot, file)));
    expect(missing).toEqual([]);
  });
});

describe("QA-PLAN §3 yük ve veri bütünlüğü kabul prosedürü", () => {
  const procedure = section(qaPlan, "### Yük ve veri bütünlüğü kabul prosedürü (S6.6)", "## 4. Bulgu ve kanıt takibi");

  test("üç komut ve üç ayrı senaryo adlanır; yük komutları package.json'da var", () => {
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    for (const command of ["load:seed", "load:run", "integrity:check"]) {
      expect(procedure, command).toContain(`npm run ${command} --`);
      expect(scripts[command], command).toBeDefined();
    }
    for (const scenario of ["login-burst", "active-mix", "write-peak"]) expect(procedure, scenario).toContain(`\`${scenario}\``);
  });

  test("ısınma ≥ 5 dk, kademeli artış, sürdürülen ≥ 30 dk ve giriş yoğun koşular arası ≥ 15 dk", () => {
    expect(procedure).toContain("**ısınma ≥ 5 dk** (`--warmup 300`");
    expect(procedure).toContain("**kademeli artış** (`--ramp 300`");
    expect(procedure).toContain("**sürdürülen yük ≥ 30 dk** (`--sustain 1800`");
    expect(procedure).toContain("**Giriş yoğun koşular arasında ≥ 15 dk:**");
  });

  test("hedefler ve ayrı sayılan redler", () => {
    expect(procedure).toContain("**kayıt p95 ≤ 2 sn, rapor p95 ≤ 3 sn, beklenmeyen hata < %1**");
    expect(procedure).toContain("**kaybı, çift işlem ve hesap/onay tutarsızlığı 0**");
    for (const rejection of ["**409**", "**429**", "**yetki reddi**"]) expect(procedure, rejection).toContain(rejection);
  });

  test("RAM, CPU/burst, event-loop, disk, WAL ve SQLite beklemesinin kaynağı adlanır", () => {
    for (const source of [
      "`rss_bytes`",
      "`mem_available_pct`",
      "`BurstCapacityPercentage`",
      "`el_p99_ms`",
      "`disk_used_pct`",
      "`wal_bytes`",
      "`tx_p99_ms`",
      "`tx_lock_failures`",
    ]) {
      expect(procedure, source).toContain(source);
    }
  });

  test("dış sonda Caddy üzerinden GET /giris; sağlık uçları localhost'ta kalır, DB hazırlığı dolmus-health'ten okunur", () => {
    expect(procedure).toContain("Caddy üzerinden oturumsuz `GET /giris`");
    expect(procedure).toContain("503, Caddy'nin bakım kapısıdır");
    expect(procedure).toContain("yalnız localhost içindir ve dışarıya 404 döner");
    const readinessRow = procedure.split("\n").find((line) => line.startsWith("| DB hazırlığı |"));
    expect(readinessRow).toBeDefined();
    expect(readinessRow).toContain("`dolmus-health event=probe` `ready`");
    expect(readinessRow).toContain("`ready_ms`");
    expect(procedure).toContain("üretici onları çağırmaz");
  });
});

describe("S6.6 rehberlerinde giderilmiş load:run engeli", () => {
  const guides = ["docs/QA-PLAN.md", "docs/SERVER-SETUP.md", "docs/DECISIONS.md", "docs/PROGRESS.md"];

  test("hiçbir rehber 'Açık engel' veya koşunun başlayamadığını söylemez", () => {
    for (const guide of guides) {
      const text = read(guide);
      expect(text, guide).not.toContain("Açık engel");
      expect(text, guide).not.toMatch(/dış hazırlık (engeli|kontrolü)/u);
      expect(text, guide).not.toContain("koşu şu an başlayamaz");
    }
  });

  test("S6.6 satırı açık kalır ve tek neden hedef makinenin yokluğudur", () => {
    const row = storyRows.find((line) => cells(line)[0] === "S6.6")!;
    expect(cells(row).at(-2)).toBe("açık — hedef makine yok");
    expect(cells(row).at(-1)).toBe("`________`");
  });

  test("SERVER-SETUP §5.1 kaynak toplama sağlık görevinin probe satırlarını da alır", () => {
    const loadSection = section(read("docs/SERVER-SETUP.md"), "### 5.1 Yük kabulü", "## 6. Kapsam dışı ve durum");
    expect(loadSection).toContain("grep -E 'event=(metrics|probe|decision|corrective_restart|recovery_lock_written)' > ~/health.log");
  });
});

describe("SERVER-SETUP §5.1 yük DB'si", () => {
  const guide = read("docs/SERVER-SETUP.md");
  const loadSection = section(guide, "### 5.1 Yük kabulü", "## 6. Kapsam dışı ve durum");
  const loadCommands = loadSection
    .split("```bash")
    .slice(1)
    .map((block) => block.slice(0, block.indexOf("```")))
    .join("\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));

  test("veri seti hedefte kurulmaz; servis yalnız ayrı yük DB'sine bağlanır", () => {
    expect(loadCommands.some((line) => line.includes("load:seed"))).toBe(false);
    expect(loadSection).toContain(
      "printf 'DOLMUS_DB_PATH=/var/lib/dolmus-takip/data/load-test/load.sqlite\\n' | sudo tee /etc/dolmus-takip/load-test.env",
    );
    // app.env'e yazan veya üretim DB'sini hedefleyen bir yük komutu yok.
    expect(loadCommands.filter((line) => /app\.env|DOLMUS_DB_PATH=\/var\/lib\/dolmus-takip\/data\/app\.sqlite/u.test(line))).toEqual([]);
  });

  test("pilot öncesi dönüş drop-in'i kaldırır ve süreç ortamından doğrulanır", () => {
    const back = loadSection.slice(loadSection.indexOf("Adım 7"));
    expect(back).toContain("sudo rm /etc/systemd/system/dolmus-takip.service.d/load-test.conf /etc/dolmus-takip/load-test.env");
    expect(back).toContain("/environ\" | tr '\\0' '\\n' | grep '^DOLMUS_DB_PATH='");
    expect(back).toContain("sudo rm -r /var/lib/dolmus-takip/data/load-test\n");
  });

  test("yük adımları sağlık zamanlayıcısını durdurmaz", () => {
    const procedure = section(qaPlan, "### Yük ve veri bütünlüğü kabul prosedürü (S6.6)", "## 4. Bulgu ve kanıt takibi");
    for (const text of [loadSection, procedure]) {
      expect(text).not.toMatch(/systemctl (stop|disable|mask)[^\n]*dolmus-takip-health/u);
    }
    expect(loadSection).toContain("sağlık zamanlayıcısı **durdurulmaz**");
  });
});
