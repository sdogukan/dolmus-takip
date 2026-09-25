/**
 * Araç girişi hız sınırı — T1.2 ADIM 1/2, S1.2.
 *
 * Giriş saldırıları kuralı: başarısız denemeler için credential/plaka ve
 * IP bazında süreli sayaç; kalıcı hesap kilidi yok. Başlangıç 20 başarısız
 * plaka/15 dk ve 120 başarısız IP/15 dk; 429/geçici bekleme. Görev tanımı
 * (2, birebir): "başarısız deneme sayacı normalize plaka başına 20 / 15 dk
 * ve IP başına 120 / 15 dk; kayan/süreli pencere; kalıcı kilit YOK; aşımda
 * 429 RATE_LIMITED + Retry-After header'ı ... yalnız başarısız denemeler
 * sayılır; bellek içi (tek süreç), clock enjekte edilebilir, testte
 * sıfırlanabilir."
 *
 * "Yalnız başarısız denemeler sayılır" — bu modülün ürettiği sayaç
 * yalnız GERÇEK bir kimlik doğrulama denemesinin (owner/driver Argon2
 * doğrulaması, bilinen VEYA dummy-hash yolu — ikisi de `../usecases/
 * auth/vehicle-login.ts`'te "başarısız kimlik doğrulama" sayılır)
 * SONUCUNA göre artırılır. 422 alan doğrulama hatası (biçimsiz plaka,
 * boş şifre) BURAYA HİÇ ULAŞMAZ — bu, kullanıcı/plaka tahmini ve giriş
 * saldırıları endişesinin KENDİSİNİN bir kimlik doğrulama denemesi
 * (gerçek veya dummy bir Argon2 karşılaştırması) hakkında olduğu, bir
 * istemci girdi HATASI hakkında OLMADIĞI yorumuna dayanır — bu ayrım bir
 * mühendislik kararıdır, yalnız bu paketin open_issues'ında
 * işaretlenmiştir.
 *
 * "Kayan/süreli pencere" — her anahtar (plaka veya IP) için son
 * `windowMs` içindeki başarısız deneme ZAMAN DAMGALARININ bir listesi
 * tutulur; her okuma/yazmada pencereden ESKİ (artık `windowMs`'den daha
 * eski) damgalar BUDANIR. Bu, sabit pencereli (fixed-window) bir sayaçtan
 * FARKLIDIR: pencere sınırında ani bir "sıfırlanma" YOKTUR, sayaç her an
 * geriye dönük `windowMs`'lik gerçek pencereyi yansıtır.
 *
 * Bellek içi, TEK süreç (ilk sürümde tek Node uygulama süreci
 * kullanılır) `Map`'lerdir; Redis/harici depolama YOKTUR (kural: "Yeni
 * DB servisi ... EKLENMEZ"). Süreç yeniden başlatıldığında sayaçlar
 * sıfırlanır — bu "kalıcı hesap kilidi yok" ilkesiyle TUTARLIDIR (görev
 * tanımı: "kalıcı kilit YOK").
 */
import { systemClock, type Clock } from "./session";

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** 20 başarısız plaka/15 dk. */
export const PLATE_LOGIN_RATE_LIMIT: RateLimitRule = {
  limit: 20,
  windowMs: FIFTEEN_MINUTES_MS,
};

/** 120 başarısız IP/15 dk. */
export const IP_LOGIN_RATE_LIMIT: RateLimitRule = {
  limit: 120,
  windowMs: FIFTEEN_MINUTES_MS,
};

/**
 * Güvenilir IP kaynağı YOKSA (bkz. `resolveClientIp` altı) kullanılan
 * ortak anahtar — görev tanımı (2, birebir): "env yoksa header'a
 * güvenilmez ve 'unknown' anahtarı kullanılır." Bu, güvenilir proxy
 * yapılandırılmamış (ör. yerel geliştirme) ortamda TÜM isteklerin AYNI
 * IP-sayaç kovasını paylaşacağı, dolayısıyla 120/15dk sınırının o
 * ortamda GLOBAL bir sınıra dönüşeceği anlamına gelir — bu, sahte bir
 * istemci IP'sine GÜVENMEKTEN (hız sınırının X-Forwarded-For sahteciliği
 * ile TAMAMEN atlatılabilir olmasından) daha güvenli bir varsayılandır.
 */
export const UNKNOWN_CLIENT_IP_KEY = "unknown";

/**
 * KÖK NEDEN/GEREKÇE (denetim bulgusu, düzeltme turu 1 — "rate-limit.ts
 * sayaç Map'leri sınırsız büyüyebilir — bellek tükenme (DoS) saldırı
 * yüzeyi"): DOĞRULANDI. `pruneTimestamps`'in (aşağıda) süresi geçmiş
 * damgaları BUDAMASI yalnız AYNI anahtar (plaka VEYA IP) tekrar
 * `checkVehicleLoginRateLimit`/`recordFailedVehicleLoginAttempt` ile
 * SORGULANDIĞINDA çalışır — bir anahtar bir KEZ eklenip BİR DAHA HİÇ
 * sorgulanmazsa, süresi 15 dk'da dolan tek girişi Map'te SONSUZA DEK
 * kalır. `PLATE_PATTERN` (bkz. `../../lib/plate.ts`) biçimi geçerli HER
 * plakayı (DB'de var olması ZORUNLU DEĞİL — ~10 milyar biçimsel
 * kombinasyon) kabul ettiğinden, saldırgan HER denemede FARKLI bir plaka
 * göndererek `store.plate`'e KALICI yeni bir giriş EKLEYEBİLİR; hiçbir
 * periyodik süpürme veya boyut sınırı OLMADIĞINDA bu, TEK Node sürecinin
 * belleğini SINIRSIZ tüketebilir. Hash yükü kuralının
 * `../hash-queue.ts`'e uyguladığı "sınırsız bellek kuyruğu yok" ilkesi bu
 * mağazaya da GENİŞLETİLİR: her anahtar için GERÇEK bir kimlik doğrulama
 * denemesi (Argon2/dummy-hash, `../hash-queue.ts`'in KENDİ 4-eşzamanlı/
 * 100-bekleyen kapısından geçmiş olması) gerektiğinden büyüme HIZI zaten
 * o kapıyla sınırlıdır, ama üst SINIR yine de tanımsızdır — bu yüzden
 * aşağıdaki `MAX_TRACKED_KEYS_PER_STORE` sabit bir tavan koyar.
 *
 * Değer seçimi (kanıt): "en fazla 500 toplam kullanıcı" hedefini ve
 * önceki "200 araç" tahminini üst sınır alırsak, meşru trafik bir 15 dk
 * penceresinde birkaç yüz DAHİ farklı plaka/IP üretmez; `50_000` bu
 * gerçekçi tavanın ÇOK üzerinde bir pay bırakırken (her giriş küçük bir
 * dize + en fazla `limit` uzunlukta bir sayı dizisidir — iki mağaza için
 * de birkaç on MB'ı ASLA aşmaz), saldırganın rastgele biçimsel-geçerli
 * anahtar üretme kapasitesini (~10 milyar) SIFIRLAR.
 *
 * Uygulama: `recordFailedVehicleLoginAttempt` YENİ bir anahtar eklemeden
 * ÖNCE `evictIfAtCapacity` çağrılır — mağaza tavandaysa ÖNCE süresi
 * dolmuş TÜM anahtarlar taranıp silinir (bkz. `sweepExpiredKeys`); bu
 * genelde yeterlidir (normal işleyişte tavan hiç DOLMAZ). Süpürmeden
 * SONRA hâlâ tavandaysa (sürmekte olan geniş ölçekli bir saldırı), Map'in
 * EKLEME SIRASINDAKİ en eski anahtarı (JS `Map` yineleme sırası ekleme
 * sırasıdır; `.set()` VAR OLAN bir anahtarın konumunu DEĞİŞTİRMEZ, yalnız
 * YENİ anahtarlar sona eklenir) tahliye edilir. Bu, saldırı ANINDA
 * (mağaza tavandayken) o anki eşzamanlı saldırı anahtarlarından birinin
 * sayacının erken sıfırlanması riskini TAŞIR — ama bu, TÜM sürecin bellek
 * tükenmesiyle ÇÖKMESİNE karşı KABUL EDİLEBİLİR bir bilinçli ödünleşimdir
 * (hash-queue.ts'nin "aşımda 429" ilkesiyle AYNI aile: sınırsız büyüme
 * yerine sınırlı bozulma). Bu ödünleşim yalnız bu paketin
 * open_issues'ında işaretlenmiştir.
 */
export const MAX_TRACKED_KEYS_PER_STORE = 50_000;

interface RateLimitStore {
  plate: Map<string, number[]>;
  ip: Map<string, number[]>;
}

let store: RateLimitStore = { plate: new Map(), ip: new Map() };

/** Yalnız testler içindir — her testin kendi bağımsız sayaç durumuyla
 * başlamasını sağlar (görev tanımı: "testte sıfırlanabilir"). */
export function resetVehicleLoginRateLimitForTests(): void {
  store = { plate: new Map(), ip: new Map() };
}

/** Yalnız testler içindir — `MAX_TRACKED_KEYS_PER_STORE` tavanının
 * (üstteki not) gerçekten uygulandığını, canlı üretim davranışını
 * ETKİLEMEDEN doğrulamak için mağazanın güncel farklı anahtar sayısını
 * döndürür. */
export function getRateLimitTrackedKeyCountsForTests(): {
  plate: number;
  ip: number;
} {
  return { plate: store.plate.size, ip: store.ip.size };
}

/** `windowMs`'den eski zaman damgalarını atar (kayan pencere budaması). */
function pruneTimestamps(
  timestamps: number[] | undefined,
  now: number,
  windowMs: number,
): number[] {
  if (!timestamps || timestamps.length === 0) {
    return [];
  }
  return timestamps.filter((ts) => now - ts < windowMs);
}

/** Bir mağazadaki (plate VEYA ip) süresi dolmuş (artık `windowMs`'den eski
 * damga bırakmamış) TÜM anahtarları tarayıp SİLER — yalnız AYNI anahtar
 * tekrar sorgulandığında değil, HİÇ sorgulanmayan anahtarlar için de
 * belleği geri kazanır (üstteki kök neden notu). */
function sweepExpiredKeys(
  map: Map<string, number[]>,
  now: number,
  windowMs: number,
): void {
  for (const [key, timestamps] of map) {
    if (pruneTimestamps(timestamps, now, windowMs).length === 0) {
      map.delete(key);
    }
  }
}

/** `key` mağazada henüz YOKSA ve mağaza `MAX_TRACKED_KEYS_PER_STORE`
 * tavanındaYSA, önce süresi dolmuş anahtarları süpürüp (`sweepExpiredKeys`)
 * yer açmayı DENER; hâlâ tavandaysa EKLEME SIRASINDAKİ en eski anahtarı
 * tahliye eder. `key` zaten mağazadaysa (var olan bir sayacın GÜNCELLENMESİ
 * mağazanın BOYUTUNU artırmaz) hiçbir şey yapmaz. */
function evictIfAtCapacity(
  map: Map<string, number[]>,
  key: string,
  maxKeys: number,
  now: number,
  windowMs: number,
): void {
  if (map.has(key) || map.size < maxKeys) {
    return;
  }
  sweepExpiredKeys(map, now, windowMs);
  if (map.size >= maxKeys) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }
}

export interface RateLimitDecision {
  limited: boolean;
  /** Yalnız `limited: true` iken anlamlıdır; en az 1 (Retry-After 0
   * olamaz — HTTP anlamında "hemen tekrar dene" ile "sınırlı değil"
   * ayrımını korumak için en az 1 saniyeye yuvarlanır). */
  retryAfterSeconds: number;
}

const NOT_LIMITED: RateLimitDecision = { limited: false, retryAfterSeconds: 0 };

/**
 * Bir anahtarın (plaka VEYA IP) geçerli zaman damgası listesine göre
 * sınıra takılıp takılmadığına karar verir. `retryAfterSeconds`, pencereden
 * DÜŞECEK EN ESKİ damganın ne zaman düşeceğine göre hesaplanır (o damga
 * düştüğü an sayaç yeniden `limit`'in ALTINA iner).
 */
function decide(
  timestamps: number[],
  rule: RateLimitRule,
  now: number,
): RateLimitDecision {
  if (timestamps.length < rule.limit) {
    return NOT_LIMITED;
  }
  const oldest = Math.min(...timestamps);
  const retryAfterMs = rule.windowMs - (now - oldest);
  return {
    limited: true,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

export interface VehicleLoginRateLimitKeys {
  /** `../../lib/plate.ts` `validatePlate(...).normalized` — biçimi
   * GEÇERLİ ama DB'de var olması ZORUNLU DEĞİL (bilinmeyen plaka
   * denemeleri tam olarak bu sayacın hedefidir). */
  plateKey: string;
  /** `resolveClientIp(request)` — bkz. altı. */
  ipKey: string;
}

/**
 * T1.3, S1.3, görev tanımı (b) — "hız sınırı rate-limit.ts ile (anahtar
 * 'platform:'+normalize(username) 20/15 dk ve IP 120/15 dk)". Giriş
 * saldırılarına karşı sayaç credential/plaka ve IP bazındadır —
 * `../usecases/auth/platform-login.ts` bu anahtarı KENDİSİ üretir
 * (`` `platform:${normalize(username)}` ``); bu modül yalnız TAŞIR,
 * normalizasyon YAPMAZ.
 */
export interface PlatformLoginRateLimitKeys {
  /** `` `platform:${username normalize edilmiş}` `` — çağıranın (usecase)
   * ürettiği hazır anahtar. */
  usernameKey: string;
  /** `resolveClientIp(request)` — bkz. altı. */
  ipKey: string;
}

/**
 * `checkVehicleLoginRateLimit`/`checkPlatformLoginRateLimit`'in PAYLAŞTIĞI
 * çekirdek — ikisi de AYNI sayısal kurala (`PLATE_LOGIN_RATE_LIMIT` 20/15dk,
 * `IP_LOGIN_RATE_LIMIT` 120/15dk) tabidir; tek fark hangi "kimlik" anahtarı
 * (normalize plaka VEYA `` `platform:${username}` ``) kullanıldığıdır.
 * `store.plate` Map'i bu yüzden GENEL bir "kimlik bilgisi" kovasıdır — iki
 * anahtar biçimi (plaka biçimi ve `platform:` ön ekli kullanıcı adı)
 * ASLA çakışmaz, bu yüzden aynı Map'te GÜVENLE birlikte tutulabilirler;
 * `getRateLimitTrackedKeyCountsForTests`'in döndürdüğü `plate` alanı GERİYE
 * DÖNÜK UYUMLU adını korur (mevcut `rate-limit.test.ts` bunu kullanır).
 */
function checkCredentialRateLimit(
  credentialKey: string,
  ipKey: string,
  clock: Clock,
): RateLimitDecision {
  const now = clock().getTime();

  const credentialTimestamps = pruneTimestamps(
    store.plate.get(credentialKey),
    now,
    PLATE_LOGIN_RATE_LIMIT.windowMs,
  );
  const ipTimestamps = pruneTimestamps(
    store.ip.get(ipKey),
    now,
    IP_LOGIN_RATE_LIMIT.windowMs,
  );
  // Budanmış listeleri geri yaz — süresi geçmiş damgaların Map'te
  // sonsuza dek BİRİKMESİNİ önler (bellek içi tek süreç için gerekli
  // temizlik; görev tanımı "sınırsız bellek kuyruğu yok" ilkesiyle aynı
  // doğrultuda — bkz. `./hash-queue.ts` üst notu).
  if (credentialTimestamps.length > 0) {
    store.plate.set(credentialKey, credentialTimestamps);
  } else {
    store.plate.delete(credentialKey);
  }
  if (ipTimestamps.length > 0) {
    store.ip.set(ipKey, ipTimestamps);
  } else {
    store.ip.delete(ipKey);
  }

  const credentialDecision = decide(credentialTimestamps, PLATE_LOGIN_RATE_LIMIT, now);
  if (credentialDecision.limited) {
    return credentialDecision;
  }
  return decide(ipTimestamps, IP_LOGIN_RATE_LIMIT, now);
}

/**
 * Salt OKUMA denetimi — herhangi bir sayaç ARTIRMAZ. `../usecases/auth/
 * vehicle-login.ts` bunu Argon2 doğrulamasına (gerçek veya dummy-hash
 * yolu) BAŞLAMADAN ÖNCE çağırır; sınırlıysa DB sorgusu/hash kuyruğu HİÇ
 * ÇALIŞTIRILMAZ (hash yükü sınırıyla aynı savunma-derinliği
 * ilkesi — hız sınırı, hash kuyruğunun ÖNÜNDEKİ ucuz/bellek-içi ilk
 * kapıdır).
 */
export function checkVehicleLoginRateLimit(
  keys: VehicleLoginRateLimitKeys,
  clock: Clock = systemClock,
): RateLimitDecision {
  return checkCredentialRateLimit(keys.plateKey, keys.ipKey, clock);
}

/** `../usecases/auth/platform-login.ts`'in `checkVehicleLoginRateLimit` ile
 * AYNI (paylaşılan `checkCredentialRateLimit`) davranışı — bkz. üstteki not. */
export function checkPlatformLoginRateLimit(
  keys: PlatformLoginRateLimitKeys,
  clock: Clock = systemClock,
): RateLimitDecision {
  return checkCredentialRateLimit(keys.usernameKey, keys.ipKey, clock);
}

/**
 * `recordFailedVehicleLoginAttempt`/`recordFailedPlatformLoginAttempt`'in
 * PAYLAŞTIĞI çekirdek — bkz. `checkCredentialRateLimit` üst notu (aynı
 * gerekçe).
 */
function recordFailedCredentialAttempt(
  credentialKey: string,
  ipKey: string,
  clock: Clock,
): void {
  const now = clock().getTime();

  // Üstteki "KÖK NEDEN/GEREKÇE" notu — YENİ bir anahtar eklemeden önce
  // mağazanın sınırsız büyümesini engeller; var olan bir anahtarın
  // güncellenmesini (aşağıdaki `.set`) ETKİLEMEZ.
  evictIfAtCapacity(
    store.plate,
    credentialKey,
    MAX_TRACKED_KEYS_PER_STORE,
    now,
    PLATE_LOGIN_RATE_LIMIT.windowMs,
  );
  const credentialTimestamps = pruneTimestamps(
    store.plate.get(credentialKey),
    now,
    PLATE_LOGIN_RATE_LIMIT.windowMs,
  );
  credentialTimestamps.push(now);
  store.plate.set(credentialKey, credentialTimestamps);

  evictIfAtCapacity(store.ip, ipKey, MAX_TRACKED_KEYS_PER_STORE, now, IP_LOGIN_RATE_LIMIT.windowMs);
  const ipTimestampsForRecord = pruneTimestamps(
    store.ip.get(ipKey),
    now,
    IP_LOGIN_RATE_LIMIT.windowMs,
  );
  ipTimestampsForRecord.push(now);
  store.ip.set(ipKey, ipTimestampsForRecord);
}

/**
 * Bir BAŞARISIZ kimlik doğrulama denemesinden SONRA çağrılır (bkz. dosya
 * üstü not — "yalnız başarısız denemeler sayılır"). BAŞARILI girişte
 * ASLA çağrılmaz (görev tanımı doğrulaması: "başarılı giriş
 * sayaç artırmaz").
 */
export function recordFailedVehicleLoginAttempt(
  keys: VehicleLoginRateLimitKeys,
  clock: Clock = systemClock,
): void {
  recordFailedCredentialAttempt(keys.plateKey, keys.ipKey, clock);
}

/** `../usecases/auth/platform-login.ts`'in `recordFailedVehicleLoginAttempt`
 * ile AYNI (paylaşılan `recordFailedCredentialAttempt`) davranışı. */
export function recordFailedPlatformLoginAttempt(
  keys: PlatformLoginRateLimitKeys,
  clock: Clock = systemClock,
): void {
  recordFailedCredentialAttempt(keys.usernameKey, keys.ipKey, clock);
}

// ---------------------------------------------------------------------------
// IP kaynağı — görev tanımı (2, birebir): "Caddy arkasında X-Forwarded-
// For'un ilk değeri yalnız bağlantı güvenilir proxy'den geliyorsa
// kullanılır ... TRUSTED_PROXY env (varsayılan yok; production'da
// '127.0.0.1') ve Caddy'nin eklediği X-Forwarded-For; env yoksa header'a
// güvenilmez ve 'unknown' anahtarı kullanılır."
// ---------------------------------------------------------------------------

/**
 * KÖK NEDEN/GEREKÇE — `../auth/app-origin.ts` üst notundaki AYNI mimari
 * kısıtla aynı ailededir: Next.js Route Handler'ın Web `Request`'i
 * bağlantının GERÇEK TCP eş adresini (`net.Socket.remoteAddress`) HİÇ
 * TAŞIMAZ (görev tanımı — "Next route handler'da uzak adres doğrudan
 * yok"); bu yüzden "bu istek GERÇEKTEN güvenilir proxy'den mi geldi?"
 * sorusu, HER İSTEKTE İSTEĞİN KENDİSİNDEN doğrulanamaz. Üretim
 * topolojisi (Next.js uygulaması yalnız 127.0.0.1:3000'i dinler)
 * bunun yerine bir DAĞITIM GARANTİSİ sağlar: Next süreci yalnız
 * localhost'ta dinlediğinden, ona ulaşan HER bağlantı zaten (Caddy'nin
 * kendisi hariç) mantıken localhost'tan (Caddy'den) gelmek ZORUNDADIR.
 * `TRUSTED_PROXY` ortam değişkeni bu DAĞITIM GARANTİSİNİ AÇIKÇA
 * ONAYLAYAN bir anahtardır (değeri `'127.0.0.1'` yalnız BELGE/açıklık
 * amaçlıdır — bu fonksiyon değeri hiçbir şeyle KARŞILAŞTIRMAZ, çünkü
 * karşılaştıracağı bir gerçek bağlantı adresi YOKTUR); tanımlı VE
 * boş-olmayan olduğunda `X-Forwarded-For`'un İLK (Caddy'nin eklediği,
 * gerçek istemci) değerine güvenilir. TANIMLI DEĞİLSE (yerel geliştirme,
 * `.env.example`'da KASITLI OLARAK ayarlanmamıştır — "varsayılan yok"),
 * bu header İSTEMCİ TARAFINDAN SERBESTÇE SAHTELENEBİLECEĞİNDEN
 * (güvenilir proxy'si onaylanmamış bir dağıtımda) TRUSTED SAYILMAZ;
 * `UNKNOWN_CLIENT_IP_KEY` sabit anahtarı kullanılır.
 */
export function resolveClientIp(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string {
  const trustedProxy = env.TRUSTED_PROXY;
  if (!trustedProxy || trustedProxy.trim().length === 0) {
    return UNKNOWN_CLIENT_IP_KEY;
  }
  const header = request.headers.get("x-forwarded-for");
  if (!header) {
    return UNKNOWN_CLIENT_IP_KEY;
  }
  const first = header.split(",")[0]?.trim();
  if (!first || first.length === 0) {
    return UNKNOWN_CLIENT_IP_KEY;
  }
  return first;
}
