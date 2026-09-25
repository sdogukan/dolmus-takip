import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { restoreGitViewOfHiddenFiles } from "../release/git-view-snapshot.ts";

/**
 * `restoreGitViewOfHiddenFiles` — `release-build.test.ts` `beforeAll`'undaki
 * çalışma ağacı kopyasının, git'in "değişmedi say" dediği dosyalarda git'in
 * gördüğü hâli taşıdığını doğrular. Geçici, gerçek git depolarında koşar.
 */

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** `beforeAll`'daki gibi: kopyala (`.git` hariç), yeni depo kur, ağacı döndür. */
function snapshotTree(repo: string, restore: boolean): { dir: string; tree: string } {
  const dir = tempDir("git-view-snapshot-copy-");
  fs.cpSync(repo, dir, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => path.basename(src) !== ".git",
  });
  if (restore) restoreGitViewOfHiddenFiles(repo, dir);
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "snapshot");
  return { dir, tree: git(dir, "rev-parse", "HEAD^{tree}") };
}

function makeRepo(): string {
  const repo = tempDir("git-view-snapshot-repo-");
  git(repo, "init", "-q");
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "müşterinin dosyası\n");
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.writeFileSync(path.join(repo, "scripts", "run.sh"), "#!/bin/sh\necho ok\n");
  fs.chmodSync(path.join(repo, "scripts", "run.sh"), 0o755);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("restoreGitViewOfHiddenFiles", () => {
  test("skip-worktree bir dosya diskte değişmişken kopya HEAD ağacını verir (DIJJI konteyneri)", () => {
    const repo = makeRepo();
    const headTree = git(repo, "rev-parse", "HEAD^{tree}");
    git(repo, "update-index", "--skip-worktree", "CLAUDE.md");
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "DIJJI haritası\n");
    expect(git(repo, "status", "--porcelain")).toBe(""); // git temiz der

    // Düzeltmeden önceki davranış: kopya ağacı HEAD'den ayrılır.
    expect(snapshotTree(repo, false).tree).not.toBe(headTree);

    const { dir, tree } = snapshotTree(repo, true);
    expect(tree).toBe(headTree);
    expect(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe("müşterinin dosyası\n");
  });

  test("skip-worktree dosya diskten silinmişse kopyaya git'teki hâli yazılır", () => {
    const repo = makeRepo();
    const headTree = git(repo, "rev-parse", "HEAD^{tree}");
    git(repo, "update-index", "--skip-worktree", "CLAUDE.md");
    fs.rmSync(path.join(repo, "CLAUDE.md"));

    expect(snapshotTree(repo, true).tree).toBe(headTree);
  });

  test("assume-unchanged dosya da git'in gördüğü hâle döner; çalıştırılabilir bit korunur", () => {
    const repo = makeRepo();
    const headTree = git(repo, "rev-parse", "HEAD^{tree}");
    git(repo, "update-index", "--assume-unchanged", "scripts/run.sh");
    fs.writeFileSync(path.join(repo, "scripts", "run.sh"), "#!/bin/sh\necho değişti\n");

    const { dir, tree } = snapshotTree(repo, true);
    expect(tree).toBe(headTree);
    expect(fs.statSync(path.join(dir, "scripts", "run.sh")).mode & 0o111).not.toBe(0);
  });

  test("işaretsiz dosyalardaki commit edilmemiş değişiklik kopyada KALIR (test çalışma ağacını paketler)", () => {
    const repo = makeRepo();
    const headTree = git(repo, "rev-parse", "HEAD^{tree}");
    fs.writeFileSync(path.join(repo, "a.txt"), "commit edilmemiş değişiklik\n");

    const { dir, tree } = snapshotTree(repo, true);
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("commit edilmemiş değişiklik\n");
    expect(tree).not.toBe(headTree);
  });

  test("işaretli dosya yoksa hiçbir şeye dokunmaz (CI ve normal geliştirme)", () => {
    const repo = makeRepo();
    const dir = tempDir("git-view-snapshot-noop-");
    fs.cpSync(repo, dir, { recursive: true, filter: (src) => path.basename(src) !== ".git" });

    expect(restoreGitViewOfHiddenFiles(repo, dir)).toEqual([]);
  });
});
