import { describe, expect, it } from "vitest";
import {
  backupStem,
  copyDeadline,
  copyFileName,
  decidePublish,
  findRowCountDrops,
  formatLogLine,
  groupBackupSets,
  isInProtectedWindow,
  isOwnTempName,
  istanbulIso,
  istanbulWallClock,
  manifestFileName,
  OFF_WINDOW_BUDGET_MS,
  parseManifest,
  planRetention,
  tempFileName,
  type BackupManifest,
} from "../../scripts/lib/backup-schedule";

/** Europe/Istanbul = UTC+3 (sabit); 02:55 → 23:55Z (önceki gün), 04:00 → 01:00Z. */
const at = (iso: string) => new Date(iso);

describe("istanbul saati", () => {
  it("UTC anı İstanbul duvar saatine çevirir (gün sınırını aşar)", () => {
    const wall = istanbulWallClock(at("2026-09-24T23:30:15Z"));
    expect(wall).toEqual({
      date: "2026-09-25",
      time: "02:30:15",
      minuteOfDay: 150,
      secondOfDay: 150 * 60 + 15,
    });
  });

  it("gece yarısı 24:00 değil 00:00 olarak okunur", () => {
    expect(istanbulWallClock(at("2026-09-24T21:00:00Z")).time).toBe("00:00:00");
  });

  it("manifest için ofsetli ISO üretir", () => {
    expect(istanbulIso(at("2026-09-24T23:30:00.789Z"))).toBe("2026-09-25T02:30:00+03:00");
  });
});

describe("korumalı yayın penceresi 02:55–04:00", () => {
  it.each([
    ["2026-09-24T23:54:59Z", false], // 02:54:59
    ["2026-09-24T23:55:00Z", true], // 02:55:00 — dahil
    ["2026-09-25T00:30:00Z", true], // 03:30
    ["2026-09-25T00:59:59Z", true], // 03:59:59
    ["2026-09-25T01:00:00Z", false], // 04:00:00 — dışlayıcı
    ["2026-09-25T12:00:00Z", false],
  ])("%s → korumalı=%s", (iso, expected) => {
    expect(isInProtectedWindow(at(iso))).toBe(expected);
  });
});

describe("copyDeadline", () => {
  it("02:30'da başlayan koşu için aynı günün 02:55'i", () => {
    expect(copyDeadline(at("2026-09-24T23:30:00Z")).toISOString()).toBe("2026-09-24T23:55:00.000Z");
    expect(copyDeadline(at("2026-09-24T23:30:30Z")).toISOString()).toBe("2026-09-24T23:55:00.000Z");
  });

  it("gece yarısından sonra başlayan koşu için AYNI takvim gününün 02:55'i", () => {
    expect(copyDeadline(at("2026-09-24T22:00:00Z")).toISOString()).toBe("2026-09-24T23:55:00.000Z");
  });

  it("korumalı pencerede başlayan koşunun süresi başından dolmuştur", () => {
    const start = at("2026-09-25T00:10:00Z");
    expect(copyDeadline(start).getTime()).toBe(start.getTime());
  });

  it("pencere dışında (elle) başlayan koşu bütçe kadar süre alır", () => {
    const start = at("2026-09-25T09:00:00Z");
    expect(copyDeadline(start).getTime() - start.getTime()).toBe(OFF_WINDOW_BUDGET_MS);
  });
});

describe("decidePublish", () => {
  const start = at("2026-09-24T23:30:00Z");
  const deadline = copyDeadline(start);

  it("02:55'ten önce yayımlanabilir", () => {
    expect(decidePublish(at("2026-09-24T23:54:59Z"), deadline)).toEqual({ ok: true });
  });

  it("02:55'te ve sonrasında korumalı pencere gerekçesiyle reddeder", () => {
    expect(decidePublish(at("2026-09-24T23:55:00Z"), deadline)).toEqual({
      ok: false,
      reason: "protected_window",
    });
    expect(decidePublish(at("2026-09-25T00:59:59Z"), deadline)).toEqual({
      ok: false,
      reason: "protected_window",
    });
  });

  it("pencere dışı koşuda bütçe aşımı deadline_passed olur", () => {
    const manualStart = at("2026-09-25T09:00:00Z");
    const manualDeadline = copyDeadline(manualStart);
    expect(decidePublish(at("2026-09-25T09:24:59Z"), manualDeadline)).toEqual({ ok: true });
    expect(decidePublish(at("2026-09-25T09:25:00Z"), manualDeadline)).toEqual({
      ok: false,
      reason: "deadline_passed",
    });
  });
});

describe("adlandırma", () => {
  it("dosya adı UTC'dir ve sözlük sırası zaman sırasıdır", () => {
    const a = backupStem(at("2026-09-24T23:30:00.500Z"));
    const b = backupStem(at("2026-09-25T23:30:00Z"));
    expect(a).toBe("app-20260924T233000Z");
    expect(a < b).toBe(true);
    expect(copyFileName(a)).toBe("app-20260924T233000Z.sqlite");
    expect(manifestFileName(a)).toBe("app-20260924T233000Z.manifest.json");
  });

  it("geçici adlar nokta önekli ve yalnız aracın kendi kalıbıdır", () => {
    const stem = "app-20260924T233000Z";
    const tmp = tempFileName(stem, "sqlite", 4242);
    expect(tmp.startsWith(".")).toBe(true);
    expect(isOwnTempName(tmp)).toBe(true);
    expect(isOwnTempName(`${tmp}-wal`)).toBe(true);
    expect(isOwnTempName(`${tmp}-shm`)).toBe(true);
    expect(isOwnTempName(tempFileName(stem, "manifest.json", 1))).toBe(true);
    // Kopya/manifest ya da başka bir dosya asla "kendi geçici dosyası" sayılmaz.
    expect(isOwnTempName(copyFileName(stem))).toBe(false);
    expect(isOwnTempName(".tmp-123")).toBe(false);
    expect(isOwnTempName(".dolmus-backup-tmp-notes.txt")).toBe(false);
    expect(isOwnTempName("app.sqlite")).toBe(false);
  });

  it("geçici adlar kopya listesinde görünmez", () => {
    const stem = "app-20260924T233000Z";
    expect(groupBackupSets([tempFileName(stem, "sqlite", 1), ".hidden", "README"])).toEqual([]);
  });
});

describe("saklama planı", () => {
  const s1 = "app-20260921T233000Z";
  const s2 = "app-20260922T233000Z";
  const s3 = "app-20260923T233000Z";
  const s4 = "app-20260924T233000Z";
  const pair = (stem: string) => [copyFileName(stem), manifestFileName(stem)];

  it("en yeni iki manifesti-tamam kopyayı tutar, gerisini siler", () => {
    const names = [...pair(s1), ...pair(s2), ...pair(s3), ...pair(s4)];
    const plan = planRetention(names, new Set([s1, s2, s3, s4]));
    expect(plan.keepStems).toEqual([s4, s3]);
    expect(plan.removeFiles.sort()).toEqual([...pair(s1), ...pair(s2)].sort());
  });

  it("manifesti olmayan kopya sayılmaz; yarım çift temizlenir", () => {
    const names = [...pair(s1), ...pair(s2), copyFileName(s3), manifestFileName(s4)];
    const plan = planRetention(names, new Set([s1, s2, s3, s4]));
    expect(plan.keepStems).toEqual([s2, s1]);
    expect(plan.removeFiles.sort()).toEqual([copyFileName(s3), manifestFileName(s4)].sort());
  });

  it("geçersiz manifestli çift 'doğrulanmış' sayılmaz, eski sağlam kopya yerinde kalır", () => {
    const names = [...pair(s1), ...pair(s2), ...pair(s3)];
    const plan = planRetention(names, new Set([s1, s2]));
    expect(plan.keepStems).toEqual([s2, s1]);
    expect(plan.removeFiles.sort()).toEqual(pair(s3).sort());
  });

  it("iki taneden az sağlam kopya varsa hepsi tutulur, hiçbir şey silinmez", () => {
    const plan = planRetention(pair(s1), new Set([s1]));
    expect(plan.keepStems).toEqual([s1]);
    expect(plan.removeFiles).toEqual([]);
  });

  it("kalıba uymayan dosyalara asla dokunmaz", () => {
    const names = [...pair(s1), ...pair(s2), ...pair(s3), "notes.txt", "app.sqlite", ".hidden", "app-1.sqlite"];
    const plan = planRetention(names, new Set([s1, s2, s3]));
    for (const untouched of ["notes.txt", "app.sqlite", ".hidden", "app-1.sqlite"]) {
      expect(plan.removeFiles).not.toContain(untouched);
    }
    expect(plan.removeFiles.sort()).toEqual(pair(s1).sort());
  });
});

describe("parseManifest", () => {
  const valid = (): BackupManifest => ({
    manifest_version: 1,
    stem: "app-20260924T233000Z",
    file: "app-20260924T233000Z.sqlite",
    size_bytes: 4096,
    sha256: "a".repeat(64),
    created_at: "2026-09-24T23:30:00.000Z",
    verified_at: "2026-09-24T23:30:02.000Z",
    published_at: "2026-09-24T23:30:03.000Z",
    istanbul: {
      created_at: "2026-09-25T02:30:00+03:00",
      verified_at: "2026-09-25T02:30:02+03:00",
      published_at: "2026-09-25T02:30:03+03:00",
    },
    release_id: "abc1234",
    sqlite_version: "3.53.4",
    schema: { applied_migrations: 4, last_migration_created_at: "1", last_migration_hash: "h" },
    last_committed_record: { work_entry_revision: null, cash_confirmation: null, admin_audit: null },
    row_counts: { work_entries: 3 },
    totals: { gross_cents: "100" },
    checks: {
      integrity_check: "ok",
      foreign_key_violations: 0,
      entry_amount_mismatches: 0,
      unchecked_entries: 0,
    },
  });

  it("geçerli manifesti döndürür", () => {
    expect(parseManifest(JSON.stringify(valid()))?.release_id).toBe("abc1234");
  });

  it.each([
    ["JSON değil", "{oops"],
    ["null", "null"],
    ["sha256 bozuk", JSON.stringify({ ...valid(), sha256: "xyz" })],
    ["sha256 büyük harf", JSON.stringify({ ...valid(), sha256: "A".repeat(64) })],
    ["dosya adı ile stem uyuşmuyor", JSON.stringify({ ...valid(), file: "baska.sqlite" })],
    ["stem kalıba uymuyor", JSON.stringify({ ...valid(), stem: "../etc/passwd", file: "../etc/passwd.sqlite" })],
    ["release_id boş", JSON.stringify({ ...valid(), release_id: "" })],
    ["satır sayısı metin", JSON.stringify({ ...valid(), row_counts: { work_entries: "3" } })],
    ["toplam sayı (metin değil)", JSON.stringify({ ...valid(), totals: { gross_cents: 100 } })],
    ["doğrulama zamanı geçersiz", JSON.stringify({ ...valid(), verified_at: "dün" })],
    ["sürüm farklı", JSON.stringify({ ...valid(), manifest_version: 2 })],
  ])("reddeder: %s", (_name, text) => {
    expect(parseManifest(text)).toBeNull();
  });
});

describe("findRowCountDrops", () => {
  it("korunan tabloda azalmayı bulur, artış/eşitliği bulmaz", () => {
    expect(
      findRowCountDrops(
        { work_entries: 10, work_entry_revisions: 12, cash_confirmations: 5, admin_audit: 3 },
        { work_entries: 9, work_entry_revisions: 12, cash_confirmations: 6, admin_audit: 3 },
      ),
    ).toEqual([{ table: "work_entries", previous: 10, current: 9 }]);
  });

  it("oturumlar gibi korunmayan tablolar küçülebilir", () => {
    expect(findRowCountDrops({ sessions: 50 }, { sessions: 1 })).toEqual([]);
  });

  it("kopyada tablo hiç yoksa 0 satıra düşmüş sayılır", () => {
    expect(findRowCountDrops({ admin_audit: 2 }, {})).toEqual([
      { table: "admin_audit", previous: 2, current: 0 },
    ]);
  });

  it("önceki manifestte olmayan tablo karşılaştırılmaz", () => {
    expect(findRowCountDrops({}, { work_entries: 0 })).toEqual([]);
  });
});

describe("formatLogLine", () => {
  it("tek satır logfmt yazar ve öncelik önekini koyar", () => {
    const line = formatLogLine("err", "backup_failed", { reason: "row_count_drop", n: 2 }, at("2026-09-24T23:30:00Z"));
    expect(line).toBe("<3>dolmus-backup event=backup_failed ts=2026-09-24T23:30:00.000Z reason=row_count_drop n=2");
  });

  it("satır sonu, boşluk ve tırnak log satırını bölemez", () => {
    const line = formatLogLine("warn", "x", { message: 'a b\nc="d"' }, at("2026-09-24T23:30:00Z"));
    expect(line.includes("\n")).toBe(false);
    expect(line).toContain("message=a_b_c__d_");
    expect(line.startsWith("<4>")).toBe(true);
  });

  it("uzun değerleri 120 karaktere keser", () => {
    const line = formatLogLine("info", "x", { v: "a".repeat(500) }, at("2026-09-24T23:30:00Z"));
    expect(line.endsWith(`v=${"a".repeat(120)}`)).toBe(true);
  });
});
