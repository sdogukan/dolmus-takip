/**
 * İlk yönetici kurulumu / şifre sıfırlama CLI'sı — `npm run platform-admin`
 * (T1.3 ADIM 1/2, S1.3, DECISIONS.md F11).
 *
 * Kaynak — ARCHITECTURE.md §1.1 (birebir): "Ekibin ilk yönetici hesabı
 * kurulumda, sunucunun yerel yönetim komutuyla oluşturulur; herkese açık
 * yönetici kayıt endpoint'i bulunmaz." ve DECISIONS.md F11: "Yerel CLI:
 * `create-first-admin` (idempotent, S1.3) + `reset-admin-password
 * --username` (yalnız sunucu shell, admin_audit'e yazar, public endpoint
 * yok)."
 *
 * Bu script yalnız SUNUCU SHELL'İNDEN çalışır — hiçbir HTTP endpoint'i
 * (`src/app/api/**`) bu dosyayı ÇAĞIRMAZ ve bu dosya hiçbir Next.js route
 * handler'ı İÇE AKTARMAZ; tek giriş yolu doğrudan `node
 * scripts/platform-admin.ts <alt-komut> ...` çağrısıdır (STORIES.md S1.3
 * AC1 — "herkese açık yönetici kayıt ekranı veya endpoint'i bulunmaz").
 *
 * ## Alt komutlar
 *
 * `create-first-admin --username <ad> [--password-stdin]`
 *   Parola stdin'den okunur; TEKRAR ÇALIŞTIRMA aynı kullanıcı adıyla
 *   mevcut hesabı ÇOĞALTMAZ ve şifre/yetkisini SESSİZCE DEĞİŞTİRMEZ —
 *   "zaten var" durumunu açıkça bildirir, exit 0 (S1.3 AC1/AC2). Argon2id
 *   hash'i (m=19456 KiB, t=2, p=1 — `scripts/db-seed-dev.ts` ile AYNI
 *   parametreler, ARCHITECTURE §6) BEGIN IMMEDIATE transaction'ı
 *   AÇILMADAN ÖNCE üretilir (görev tanımı: "Argon2id hash transaction
 *   Dışında"); yalnız hash + INSERT'ler (platform_users + admin_audit)
 *   TEK bir transaction'da yazılır. admin_audit: action
 *   'platform_user.bootstrap', actor_kind 'platform_user', actor = YENİ
 *   yöneticinin KENDİ id'si (self-bootstrap — henüz kendisinden önce var
 *   olan bir aktör YOKTUR), before_json null, after_json'da parola/hash
 *   YOK.
 *
 * `reset-admin-password --username <ad> [--password-stdin]`
 *   Yeni parola stdin'den okunur; hash güncellenir, credential_version +1
 *   (`../src/server/usecases/access/bump-platform-user-version.ts`
 *   `bumpPlatformUserVersion` YENİDEN KULLANILIR — kendi BEGIN IMMEDIATE
 *   transaction'ı better-sqlite3'ün otomatik SAVEPOINT iç içe geçirmesiyle
 *   [bkz. `node_modules/better-sqlite3/lib/methods/transaction.js`
 *   `wrapTransaction`: `db.inTransaction` true iken `BEGIN` yerine
 *   `SAVEPOINT` kullanılır] BU script'in kendi dış transaction'ının
 *   İÇİNDE, TEK bir atomik birim olarak çalışır — tüm oturumları iptal
 *   eder). admin_audit'e 'platform_user.reset_password' (actor = hedef
 *   kullanıcının KENDİSİ; after_json'a parola/hash YAZILMADAN, yalnız
 *   `{"source":"server-shell"}` notu — bu işlemin bir yönetim EKRANINDAN
 *   değil sunucu shell'inden yapıldığını işaretler). Hesap yoksa hata,
 *   exit 1.
 *
 * DB yolu her iki alt komutta da `DOLMUS_DB_PATH`'ten (bkz. `../src/
 * server/data/db.ts` `resolveDbPathFromEnv`) okunur; migration bekliyorsa
 * (`assertMigrationsApplied`) AÇIK hata verip exit 1 (otomatik migration
 * ÇALIŞTIRILMAZ — ARCHITECTURE §8.1 ile AYNI ilke, `scripts/db-init.ts`ye
 * yönlendirir).
 *
 * Gizli değer kuralı (CLAUDE.md, ARCHITECTURE §6): parola/hash/token HİÇBİR
 * konsol çıktısına yazılmaz — yalnız durum mesajları ("oluşturuldu",
 * "zaten var", "güncellendi") basılır.
 *
 * ESM deseni `scripts/db-seed-dev.ts` ile AYNI (bkz. o dosyanın üst notu ve
 * `./package.json` — bu klasör `"type": "module"`); komşu `.ts`
 * importlarında AÇIK uzantı KASITLIDIR (Node'un yerel ESM çözümleyicisi
 * uzantısız göreli import'u desteklemez).
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argon2id, hash } from "argon2";
import { eq, sql } from "drizzle-orm";
import {
  assertMigrationsApplied,
  createDb,
  openDatabaseConnection,
  resolveDbPathFromEnv,
  withImmediateTransaction,
  type SqliteConnection,
} from "../src/server/data/db.ts";
import { adminAudit, platformUsers } from "../src/server/data/schema.ts";
import { bumpPlatformUserVersion } from "../src/server/usecases/access/bump-platform-user-version.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const migrationsFolder = path.join(projectRoot, "drizzle");

/**
 * ARCHITECTURE.md §6 — "node-argon2 ile Argon2id; başlangıç 19 MiB, t=2,
 * p=1" — `scripts/db-seed-dev.ts` `ARGON2ID_OPTIONS` ile BİREBİR AYNI
 * (tek kaynak değeri burada TEKRARLANIR; iki script birbirini İÇE
 * AKTARAMAZ — `db-seed-dev.ts`'in `isDirectRun` kapısı yalnız KENDİ
 * doğrudan çalıştırılmasını korur, bir sabit-DIŞA-AKTARMA modülü değildir
 * ve bu script'in üretim/test akışına GEREKSİZ bir bağımlılık eklemek
 * anlamına gelirdi).
 */
const ARGON2ID_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// ---------------------------------------------------------------------------
// Argüman ayrıştırma.
// ---------------------------------------------------------------------------

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type Subcommand = "create-first-admin" | "reset-admin-password";

export interface ParsedArgs {
  subcommand: Subcommand;
  username: string;
  passwordStdin: boolean;
}

const USAGE_TEXT =
  "Kullanım: node scripts/platform-admin.ts " +
  "<create-first-admin|reset-admin-password> --username <ad> " +
  "[--password-stdin]";

/**
 * `argv`, `process.argv.slice(2)` ile AYNI biçimdedir (ilk eleman alt
 * komut). Bilinmeyen bir bayrak veya eksik `--username` değeri
 * `CliUsageError` fırlatır — çağıran (`main`) bunu kullanım metniyle
 * birlikte stderr'e yazıp exit 1 döner.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [subcommandRaw, ...rest] = argv;
  if (
    subcommandRaw !== "create-first-admin" &&
    subcommandRaw !== "reset-admin-password"
  ) {
    throw new CliUsageError(
      `Bilinmeyen veya eksik alt komut: "${subcommandRaw ?? ""}". ${USAGE_TEXT}`,
    );
  }

  let username: string | undefined;
  let passwordStdin = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--username") {
      const value = rest[i + 1];
      if (value === undefined) {
        throw new CliUsageError("--username bir değer bekler.");
      }
      username = value;
      i++;
    } else if (arg === "--password-stdin") {
      passwordStdin = true;
    } else {
      throw new CliUsageError(`Bilinmeyen argüman: "${arg}". ${USAGE_TEXT}`);
    }
  }

  if (username === undefined || username.trim().length === 0) {
    throw new CliUsageError(`--username zorunludur. ${USAGE_TEXT}`);
  }

  return { subcommand: subcommandRaw, username, passwordStdin };
}

// ---------------------------------------------------------------------------
// Parola okuma — görev tanımı (birebir): "parola stdin'den okunur
// (--password-stdin; echo'suz TTY prompt da desteklenir)".
// ---------------------------------------------------------------------------

/**
 * `--password-stdin` ile: TÜM stdin'i (ör. `printf '%s' "$SIFRE" | node
 * scripts/platform-admin.ts ...` gibi bir boru hattından) okur; TEK bir
 * sondaki satır sonu (`\n` veya `\r\n`) kırpılır (kabuk/`echo`'nun eklediği
 * satır sonu bir şifre KARAKTERİ SAYILMAZ), başka hiçbir kırpma YAPILMAZ
 * (baştaki/ortadaki boşluklar KORUNUR — şifre içeriği olabilir).
 */
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

/**
 * TTY'de ECHO'SUZ parola istemi — `--password-stdin` VERİLMEDİĞİNDE ve
 * stdin bir terminal İSE kullanılır (görev tanımı: "echo'suz TTY prompt da
 * desteklenir"). Standart "ham mod + karakter karakter oku, ekrana YAZMA"
 * deseni; harici bir paket EKLEMEZ (yeni bağımlılık YASAK kuralı).
 */
function promptHiddenPassword(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(promptText);
    const wasRaw = stdin.isRaw ?? false;
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.setEncoding("utf8");

    let input = "";
    const cleanup = () => {
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk: string) => {
      switch (chunk) {
        case "\n":
        case "\r":
          cleanup();
          stdout.write("\n");
          resolve(input);
          break;
        case "": // Ctrl-C
          cleanup();
          stdout.write("\n");
          reject(new CliUsageError("İptal edildi."));
          break;
        case "": // Ctrl-D (EOF)
          cleanup();
          stdout.write("\n");
          resolve(input);
          break;
        case "": // Backspace
        case "\b":
          input = input.slice(0, -1);
          break;
        default:
          input += chunk;
          break;
      }
    };
    stdin.on("data", onData);
  });
}

export async function readPassword(passwordStdin: boolean): Promise<string> {
  if (passwordStdin) {
    return readAllStdin();
  }
  if (process.stdin.isTTY) {
    return promptHiddenPassword("Şifre: ");
  }
  throw new CliUsageError(
    "Parola sağlanamadı: TTY yoksa --password-stdin ile parolayı stdin'den ver.",
  );
}

// ---------------------------------------------------------------------------
// DB açılışı — her iki alt komutta da AYNI kapı.
// ---------------------------------------------------------------------------

function openReadyDatabase(): SqliteConnection {
  const dbPath = resolveDbPathFromEnv();
  const sqlite = openDatabaseConnection(dbPath);
  assertMigrationsApplied(sqlite, migrationsFolder);
  return sqlite;
}

// ---------------------------------------------------------------------------
// create-first-admin.
// ---------------------------------------------------------------------------

/**
 * `false` dönerse (aynı kullanıcı adıyla mevcut hesap bulundu) hiçbir
 * DB yazması YAPILMAMIŞTIR — S1.3 AC2 "mevcut hesabı çoğaltmaz veya
 * mevcut şifre/yetkisini sessizce değiştirmez" bu erken çıkışla sağlanır.
 */
export async function createFirstAdmin(
  sqlite: SqliteConnection,
  username: string,
  password: string,
): Promise<{ created: boolean }> {
  const db = createDb(sqlite);

  const existing = db
    .select({ id: platformUsers.id })
    .from(platformUsers)
    .where(eq(platformUsers.username, username))
    .all();
  if (existing.length > 0) {
    return { created: false };
  }

  // Argon2id hash'i TRANSACTION DIŞINDA üretilir (görev tanımı, birebir) —
  // DB kilidi TUTULMADAN, olabildiğince ÇOK CPU süren bir işlemdir.
  const passwordHash = await hash(password, ARGON2ID_OPTIONS);

  const newId = crypto.randomUUID();
  const occurredAt = new Date().toISOString();

  try {
    withImmediateTransaction(sqlite, () => {
      db.insert(platformUsers)
        .values({
          id: newId,
          username,
          passwordHash,
          platformRole: "admin",
          active: true,
          credentialVersion: 1,
        })
        .run();

      // admin_audit — actor = YENİ yöneticinin KENDİ id'si (self-bootstrap,
      // görev tanımı birebir); before_json null (ilk kayıt); after_json
      // parola/hash İÇERMEZ.
      db.insert(adminAudit)
        .values({
          id: crypto.randomUUID(),
          businessId: null,
          vehicleId: null,
          entityType: "platform_user",
          entityId: newId,
          action: "platform_user.bootstrap",
          beforeJson: null,
          afterJson: JSON.stringify({
            username,
            platformRole: "admin",
            active: true,
          }),
          actorKind: "platform_user",
          actorSessionId: crypto.randomUUID(),
          actorRole: "admin",
          actorCredentialId: null,
          actorPlatformUserId: newId,
          onBehalfOfKind: null,
          onBehalfOfPersonId: null,
          occurredAt,
        })
        .run();
    });
  } catch (error) {
    // Yarış durumu koruması: iki CLI çağrısı TAM OLARAK aynı anda
    // çalışırsa (yukarıdaki SELECT'in ikisinde de "yok" görünmesi), DB'nin
    // KENDİ `platform_users.username` UNIQUE kısıtı ikinciyi reddeder —
    // bu da S1.3 AC2'nin "çoğaltmaz" garantisini DB DÜZEYİNDE korur.
    // Böyle bir çakışmayı da "zaten var" (exit 0) olarak ele alırız; hiçbir
    // satır COMMIT edilmediğinden (transaction geri alındı) durum güvenli.
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return { created: false };
    }
    throw error;
  }

  return { created: true };
}

// ---------------------------------------------------------------------------
// reset-admin-password.
// ---------------------------------------------------------------------------

export type ResetAdminPasswordResult =
  | { found: true }
  | { found: false };

export async function resetAdminPassword(
  sqlite: SqliteConnection,
  username: string,
  password: string,
): Promise<ResetAdminPasswordResult> {
  const db = createDb(sqlite);

  const rows = db
    .select({ id: platformUsers.id, platformRole: platformUsers.platformRole })
    .from(platformUsers)
    .where(eq(platformUsers.username, username))
    .all();
  const target = rows[0];
  if (!target) {
    return { found: false };
  }

  const passwordHash = await hash(password, ARGON2ID_OPTIONS);
  const occurredAt = new Date().toISOString();

  withImmediateTransaction(sqlite, () => {
    db.update(platformUsers)
      .set({ passwordHash })
      .where(eq(platformUsers.id, target.id))
      .run();

    // `../src/server/usecases/access/bump-platform-user-version.ts` YENİDEN
    // KULLANILIR (görev tanımı, birebir) — credential_version +1 VE tüm
    // oturumların iptali. Kendi `withImmediateTransaction` çağrısı,
    // ZATEN AÇIK olan bu dış transaction'ın İÇİNDE better-sqlite3'ün
    // otomatik SAVEPOINT'iyle (bkz. dosya üstü not) TEK atomik birim olur.
    bumpPlatformUserVersion(db, target.id);

    // admin_audit — actor = HEDEF kullanıcının KENDİSİ (görev tanımı
    // birebir); after_json parola/hash İÇERMEZ, yalnız kaynağı belirtir.
    db.insert(adminAudit)
      .values({
        id: crypto.randomUUID(),
        businessId: null,
        vehicleId: null,
        entityType: "platform_user",
        entityId: target.id,
        action: "platform_user.reset_password",
        beforeJson: null,
        afterJson: JSON.stringify({ source: "server-shell" }),
        actorKind: "platform_user",
        actorSessionId: crypto.randomUUID(),
        actorRole: target.platformRole,
        actorCredentialId: null,
        actorPlatformUserId: target.id,
        onBehalfOfKind: null,
        onBehalfOfPersonId: null,
        occurredAt,
      })
      .run();
  });

  return { found: true };
}

// ---------------------------------------------------------------------------
// CLI giriş noktası.
// ---------------------------------------------------------------------------

/**
 * `argv`/`env` parametreleri yalnız TESTLER içindir (`db-seed-dev.ts`'in
 * AYNI `env` deseni); gerçek CLI çağrısı varsayılanla (`process.argv.slice
 * (2)`, `process.env`) çalışır. Dönüş değeri PROCESS EXIT KODUDUR — bu
 * fonksiyonun kendisi `process.exit` ÇAĞIRMAZ (testlerin gerçek süreci
 * SONLANDIRMADAN sonucu okuyabilmesi için); yalnız aşağıdaki `isDirectRun`
 * bloğu gerçek CLI çağrısında `process.exitCode`'u ayarlar.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`[platform-admin] ${error.message}`);
      return 1;
    }
    throw error;
  }

  let password: string;
  try {
    password = await readPassword(parsed.passwordStdin);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`[platform-admin] ${error.message}`);
      return 1;
    }
    throw error;
  }
  if (password.length === 0) {
    console.error("[platform-admin] Şifre boş olamaz.");
    return 1;
  }

  let sqlite: SqliteConnection;
  try {
    sqlite = openReadyDatabase();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[platform-admin] ${message}`);
    return 1;
  }

  try {
    if (parsed.subcommand === "create-first-admin") {
      const result = await createFirstAdmin(sqlite, parsed.username, password);
      if (result.created) {
        console.log(
          `[platform-admin] İlk yönetici oluşturuldu: "${parsed.username}".`,
        );
      } else {
        console.log(
          `[platform-admin] "${parsed.username}" adlı hesap zaten var; ` +
            "değişiklik yapılmadı.",
        );
      }
      return 0;
    }

    const result = await resetAdminPassword(sqlite, parsed.username, password);
    if (!result.found) {
      console.error(`[platform-admin] "${parsed.username}" adlı hesap bulunamadı.`);
      return 1;
    }
    console.log(
      `[platform-admin] "${parsed.username}" şifresi güncellendi; eski ` +
        "oturumlar iptal edildi.",
    );
    return 0;
  } finally {
    sqlite.close();
  }
}

// ---------------------------------------------------------------------------
// Doğrudan çalıştırma kapısı — `scripts/db-seed-dev.ts`'İN AYNI deseni
// (bkz. o dosyanın üst notu): testler bu modülü Vitest'in bundler
// çözümleyicisiyle İÇE AKTARDIĞINDA `main()`'in yan etkisi (gerçek
// `process.argv`/`process.exit` davranışı) tetiklenmez.
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[platform-admin] Beklenmeyen hata: ${message}`);
      process.exitCode = 1;
    });
}
