import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Çalışma ağacı kopyasında, git'in "değişmedi say" dediği dosyaları git'in
 * gördüğü hâle getirir (`release-build.test.ts` `beforeAll`'u için).
 *
 * Test, commit edilmemiş kodu da paketleyebilmek için çalışma ağacını
 * olduğu gibi kopyalar (o dosyanın üst notu). Ama `skip-worktree` ya da
 * `assume-unchanged` işaretli bir dosyada disk ile git ayrışabilir ve
 * `git status` yine TEMİZ der. Kopya diskteki baytları taşırsa klonun ağacı
 * `HEAD^{tree}`'den ayrılır; kökteki `.quality-gate` kaydı eşleşmez ve kapı
 * klonda baştan koşar.
 *
 * Kanıt (2026-09-25): DIJJI çalışma konteyneri kök `CLAUDE.md`'yi kendi
 * haritasıyla değiştirip `skip-worktree` işaretliyor. Orada `test:release`
 * 785 sn sürdü, CI'da 127 sn; tek fark `CLAUDE.md` idi.
 *
 * Yalnız bu işaretli dosyalara index'teki (git'in gördüğü) hâl yazılır.
 * Diğer her dosya, commit edilmemiş değişiklikler dahil, diskteki hâliyle
 * kalır. İşaretli dosya yoksa (CI, normal geliştirme) hiçbir şey değişmez.
 *
 * @returns Git'in hâli yazılan dosyaların depo-göreli yolları.
 */
export function restoreGitViewOfHiddenFiles(repoRoot: string, snapshotDir: string): string[] {
  // `-v`: skip-worktree `S`, assume-unchanged küçük harf. `-s`: mod ve blob.
  // Satır: "<etiket> <mod> <blob> <aşama>\t<yol>", NUL ile ayrılmış.
  const listed = spawnSync("git", ["ls-files", "-v", "-s", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (listed.status !== 0) {
    throw new Error(`git ls-files başarısız (exit ${listed.status}): ${listed.stderr}`);
  }

  const restored: string[] = [];
  for (const entry of listed.stdout.split("\0")) {
    const match = /^(\S) (\d{6}) ([0-9a-f]+) \d\t(.+)$/s.exec(entry);
    if (!match) continue;
    const [, tag = "", mode = "", blob = "", relPath = ""] = match;
    const hidden = tag === "S" || tag !== tag.toUpperCase();
    // Yalnız normal dosyalar: sembolik bağ (120000) ve alt modül (160000)
    // kopyada olduğu gibi kalır.
    if (!hidden || (mode !== "100644" && mode !== "100755")) continue;

    const content = spawnSync("git", ["cat-file", "blob", blob], { cwd: repoRoot });
    if (content.status !== 0) {
      throw new Error(`git cat-file ${blob} (${relPath}) başarısız: ${content.stderr.toString()}`);
    }
    const target = path.join(snapshotDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content.stdout);
    fs.chmodSync(target, mode === "100755" ? 0o755 : 0o644);
    restored.push(relPath);
  }
  return restored;
}
