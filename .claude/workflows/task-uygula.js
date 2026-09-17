export const meta = {
  name: 'dolmus-task-uygula',
  description: 'Bir TASKS.md iş paketini Sonnet 5 ajanlarıyla uygula, Stories kabul kriterleriyle 3 mercekten doğrula, bulguları düzelt, kapı kontrolünden geçir',
  phases: [
    { title: 'Uygula', detail: 'iş paketini kodla ve testle', model: 'claude-sonnet-5' },
    { title: 'Doğrula', detail: 'AC uyumu + güvenlik/bütünlük + mimari/kalite mercekleri', model: 'claude-sonnet-5' },
    { title: 'Düzelt', detail: 'bulguları kök nedenden düzelt, tekrar doğrula', model: 'claude-sonnet-5' },
    { title: 'Kapı', detail: 'tüm kontrol komutları temiz geçer', model: 'claude-sonnet-5' },
  ],
}

const M = 'claude-sonnet-5'
const ROOT = '/Users/dogukan/Projects/dolmus-takip/'
const task = args.task            // örn. 'T1.1'
const story = args.story          // örn. 'S1.1'
const milestone = args.milestone  // örn. 'M1'
const extra = args.extraContext || ''
const steps = args.steps || []    // isteğe bağlı: paketi sıralı alt adımlara böl
const maxRounds = args.maxRounds || 3
const checks = args.checks || ['npm run typecheck', 'npm run lint', 'npm run test:unit', 'npm run test:integration', 'npm run build']

const RULES = `
KURALLAR (ihlal edilemez):
- Proje kökü: ${ROOT}. Tüm komutları bu dizinde çalıştır.
- Önce oku: docs/TASKS.md içindeki "${task}" bölümü, docs/STORIES.md içindeki "${story}" bölümü (TÜM kabul kriterleri bağlayıcıdır), bu bölümlerin atıf yaptığı ARCHITECTURE/DESIGN/TECH-STACK bölümleri, docs/QA-PLAN.md ilgili QA grupları, docs/DECISIONS.md (K1–K9 kesin kararlar ve sabit sürümler).
- Mevcut kodu keşfet (dizin yapısı, package.json, src/). Var olan modülleri yeniden yazma; genişlet.
- Varsayım yapma; dokümanda dayanağı olmayan davranış ekleme. Doküman bir şeyi imkânsız kılıyorsa sessizce sapma, open_issues'a kanıtla yaz.
- Kısayol yok: test atlama (skip/only), lint kuralı kapatma, ts-ignore, any ile geçiştirme, mock ile mali/DB testi geçirme YASAK. Mali/DB testleri gerçek geçici SQLite dosyası ve gerçek migration ile yapılır.
- Para: tam sayı kuruş, BigInt/tam sayı hesap; API'de ondalık tam sayı metni. Şoför %20 (share_bps 2000), sahip kendi sürüşü %0. Yuvarlama: floor((brüt × oran + 5000) / 10000).
- Yetki istemciden gelen role dayanmaz; her sorgu işletme/araç kapsamıyla filtrelenir; DB'de birleşik FK.
- Yazma: kısa transaction (BEGIN IMMEDIATE), kayıt + revizyon + makbuz birlikte; request_id ile tekrar gönderim çoğaltmaz; version ile koşullu UPDATE, çakışmada 409.
- Docker, Redis, S3, harici kuyruk, yeni DB servisi, JWT, OTP, e-posta/SMS EKLENMEZ.
- UI: Türkçe metin, mavi-beyaz, tek sütun, sistem fontu, DESIGN §3 ölçüleri (giriş alanı ≥48px, ana düğme ≥56px), 320px genişlikte yatay kaydırma yok.
- docs/*.md dosyalarını DEĞİŞTİRME (yalnızca oku). Git commit YAPMA.
- Gizli değer (parola, token, hash) log/yanıt/istemci çıktısına yazılmaz.
${extra}
`

const IMPL_SCHEMA = { type: 'object', required: ['summary', 'files_changed', 'commands', 'ac_coverage', 'open_issues'], properties: {
  summary: { type: 'string' },
  files_changed: { type: 'array', items: { type: 'string' } },
  commands: { type: 'array', items: { type: 'object', required: ['cmd', 'exit_code', 'summary'], properties: { cmd: { type: 'string' }, exit_code: { type: 'integer' }, summary: { type: 'string' } } } },
  ac_coverage: { type: 'array', items: { type: 'object', required: ['ac', 'status', 'evidence'], properties: { ac: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'deferred', 'not_applicable'] }, evidence: { type: 'string' } } } },
  open_issues: { type: 'array', items: { type: 'object', required: ['title', 'detail', 'needs_user_decision'], properties: { title: { type: 'string' }, detail: { type: 'string' }, needs_user_decision: { type: 'boolean' } } } },
} }

const REVIEW_SCHEMA = { type: 'object', required: ['findings', 'all_checks_pass', 'notes'], properties: {
  findings: { type: 'array', items: { type: 'object', required: ['title', 'severity', 'file', 'detail', 'fix_hint'], properties: {
    title: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
    file: { type: 'string' }, detail: { type: 'string' }, fix_hint: { type: 'string' } } } },
  all_checks_pass: { type: 'boolean' },
  notes: { type: 'string' },
} }

const FIX_SCHEMA = { type: 'object', required: ['outcomes', 'commands', 'summary'], properties: {
  outcomes: { type: 'array', items: { type: 'object', required: ['title', 'outcome', 'detail'], properties: { title: { type: 'string' }, outcome: { type: 'string', enum: ['fixed', 'no_change_needed', 'blocked'] }, detail: { type: 'string' } } } },
  commands: { type: 'array', items: { type: 'object', required: ['cmd', 'exit_code', 'summary'], properties: { cmd: { type: 'string' }, exit_code: { type: 'integer' }, summary: { type: 'string' } } } },
  summary: { type: 'string' },
} }

const GATE_SCHEMA = { type: 'object', required: ['all_pass', 'results'], properties: {
  all_pass: { type: 'boolean' },
  results: { type: 'array', items: { type: 'object', required: ['cmd', 'exit_code', 'summary'], properties: { cmd: { type: 'string' }, exit_code: { type: 'integer' }, summary: { type: 'string' } } } },
} }

// ---------- Uygula ----------
const implPrompt = (stepText, stepIdx, stepTotal) => `Sen bu projede kıdemli full-stack geliştiricisin. Görev: ${milestone} / ${task} (${story}) iş paketini ${stepTotal > 1 ? `ADIM ${stepIdx + 1}/${stepTotal} kapsamında` : 'tamamen'} uygula.
${stepText && stepText !== '(tam paket)' ? `\nBU ${stepTotal > 1 ? 'ADIMIN' : 'PAKETİN'} KAPSAMI:\n${stepText}\n` : ''}
${RULES}
İş bittiğinde şu kontrolleri çalıştır ve HEPSİ geçmeden bitirme: ${checks.join(' ; ')} (bu adımda ilgili olmayan komut henüz tanımlı değilse commands'ta exit_code -1 ve nedenini yaz).
Çıktı (kısa tut; summary en fazla 12 cümle, evidence alanları 1-2 cümle — tek bir yanıt 3 dakikayı aşarsa kesilir): summary; files_changed; commands (gerçek çalıştırdıkların ve çıkış kodları); ac_coverage (STORIES ${story} her kabul kriteri için done/partial/deferred/not_applicable + kanıt: dosya/test adı; bu adımın kapsamı dışındakileri deferred yaz); open_issues (dokümanla çelişki, karar gereken nokta).`

// ---------- Doğrula ----------
const LENSES = [
  { key: 'ac', prompt: `Mercek: KABUL KRİTERİ UYUMU. docs/STORIES.md "${story}" bölümündeki HER kabul kriterini ve docs/TASKS.md "${task}" Doğrulama satırını tek tek al. Kodu ve testleri oku; her kriter için gerçekten karşılanıp karşılanmadığını KANITLA (dosya:satır, test adı). Kriteri karşılamayan, yarım kalan veya sadece UI'da gizlenip sunucuda uygulanmayan her şey bulgu. Test dosyalarını kendin çalıştır.` },
  { key: 'guvenlik', prompt: `Mercek: GÜVENLİK, YETKİ VE VERİ BÜTÜNLÜĞÜ. ARCHITECTURE §2 yetki matrisi, §3.1 birleşik FK, §3.4 transaction/idempotency/version, §6 güvenlik tablosu. Kodda: kapsam kaçağı (business_id/vehicle_id filtresi eksik sorgu), istemciden gelen rol/kişi/işletme alanına güvenme, transaction dışı çok adımlı yazma, request_id koruması eksikliği, parola/token/hash sızıntısı (log, yanıt, istemci bundle), CSRF/origin eksikliği, cookie özellikleri, hız sınırı, timing/enumeration sızıntısı. Somut saldırı senaryosuyla göster.` },
  { key: 'mimari', prompt: `Mercek: MİMARİ VE KALİTE UYUMU. ARCHITECTURE §2 kod sınırları (ekran / kullanım durumu / veri erişimi ayrımı), §3.2 tablo/alan adları ve kısıtlar, §3.5 indeksler, §3.6 SQLite PRAGMA'ları (foreign_keys=ON, synchronous=FULL, WAL, busy_timeout 2000), §4 endpoint sözleşmesi ve HTTP kodları, TECH-STACK para/tam sayı kuralı, DESIGN ekran kuralları, DECISIONS.md sürüm pinleri. Ayrıca: yasak bağımlılık, skip/only/ts-ignore/any kaçağı, mock ile geçirilmiş DB testi, tekrar eden kod, hatalı isimlendirme. Şu komutları kendin çalıştır ve sonucu bildir: ${checks.join(' ; ')}.` },
]
const reviewExtra = args.reviewExtra || ''
const reviewPrompt = (l, implSummary) => `Sen bağımsız, şüpheci bir kod denetçisisin. Proje kökü: ${ROOT}. Paket: ${milestone} / ${task} (${story}).
Uygulayan ajanın özeti (güvenme, doğrula): ${implSummary}

${l.prompt}
${reviewExtra ? `\nEK DENETİM GÖREVİ (her mercek için geçerli): ${reviewExtra}\n` : ''}
Kurallar: Dosyaları kendin oku (Read/Grep), komutları kendin çalıştır. Kod DEĞİŞTİRME. Üslup notu verme; yalnız davranışı, güvenliği, doküman uyumunu etkileyen somut bulgu ver. BULGU SAYILMAZ (raporlama): docs/*.md, PROGRESS.md, DECISIONS.md güncelliği; ajan özet metninin doğruluğu; "open_issues'a kaydedildi" ifadeleri — bunlar orkestratörün işidir. Geçici/debug dosyaların repoda unutulması ise bulgudur. severity: blocker = kabul kriterini ihlal eder veya mali/yetki hatası; high = yanlış davranış; medium = doküman sapması, sonradan sorun; low = küçük. all_checks_pass: çalıştırdığın kontrol komutlarının hepsi geçti mi. notes en fazla 3 cümle; her bulgunun detail alanı en fazla 6 cümle. Yanıtı uzatma: tek bir istek 3 dakikayı aşarsa kesilir.`

// ---------- Düzelt ----------
const fixPrompt = (findings, round) => `Sen bu projede kıdemli geliştiricisin. Paket: ${milestone} / ${task} (${story}). Düzeltme turu ${round}.
${RULES}
Aşağıdaki denetim bulgularını ele al. Her bulgu için önce doğrula (dosyayı oku); gerçekse KÖK NEDENİ düzelt (semptomu değil), gerekli testi ekle/güncelle; yanlış bulguysa no_change_needed ve kanıtla gerekçe; doküman kararı gerekiyorsa blocked ve nedeni.
Bitince şu kontrolleri çalıştır, HEPSİ geçmeli: ${checks.join(' ; ')}.

BULGULAR (JSON):
${JSON.stringify(findings, null, 1)}`

// ---------- Kapı ----------
const gatePrompt = `Proje kökü: ${ROOT}. Şu komutları sırayla çalıştır ve her birinin gerçek çıkış kodunu ve kısa özetini bildir. Kod değiştirme. Komut yoksa exit_code -1 yaz. ${checks.join(' ; ')}. Ayrıca "git status --porcelain" çıktısında docs/*.md değişikliği var mı kontrol et; varsa results'a "DOCS_MODIFIED" satırı ekle.`

// ================= Çalıştır =================
phase('Uygula')
const stepList = steps.length ? steps : ['(tam paket)']
const implResults = []
for (let i = 0; i < stepList.length; i++) {
  log(`${task} uygulama ${stepList.length > 1 ? `adım ${i + 1}/${stepList.length}` : ''} başlıyor`)
  const r = await agent(implPrompt(stepList[i], i, stepList.length), { model: M, effort: 'high', phase: 'Uygula', label: `uygula:${task}${stepList.length > 1 ? ':' + (i + 1) : ''}`, schema: IMPL_SCHEMA })
  if (!r) throw new Error(`Uygulama ajanı sonuç döndürmedi: ${task} adım ${i + 1}`)
  implResults.push(r)
  const failed = (r.commands || []).filter(c => c.exit_code !== 0 && c.exit_code !== -1)
  log(`adım ${i + 1}: ${r.files_changed.length} dosya, başarısız komut: ${failed.length}, açık konu: ${r.open_issues.length}`)
}
const implSummary = implResults.map((r, i) => `[adım ${i + 1}] ${r.summary}\nDosyalar: ${r.files_changed.join(', ')}`).join('\n\n')

// ---------- Doğrula + Düzelt döngüsü ----------
let round = 0
let lastFindings = []
let allFixOutcomes = []
let converged = false
while (round < maxRounds) {
  round++
  log(`Doğrulama turu ${round}: 3 mercek paralel`)
  const reviews = (await parallel(LENSES.map(l => () =>
    agent(reviewPrompt(l, implSummary), { model: M, effort: 'high', phase: 'Doğrula', label: `dogrula:${task}:t${round}:${l.key}`, schema: REVIEW_SCHEMA })
  ))).filter(Boolean)
  const findings = reviews.flatMap((rv, i) => (rv.findings || []).map(f => ({ ...f, lens: LENSES[i] ? LENSES[i].key : '?' })))
  const checksPass = reviews.every(rv => rv.all_checks_pass)
  const actionable = findings.filter(f => f.severity !== 'low')
  const lows = findings.filter(f => f.severity === 'low')
  lastFindings = findings
  log(`tur ${round}: ${findings.length} bulgu (${actionable.length} blocker/high/medium, ${lows.length} low), kontroller ${checksPass ? 'geçti' : 'GEÇMEDİ'}`)
  if (actionable.length === 0 && checksPass) { converged = true; break }
  const fix = await agent(fixPrompt(findings, round), { model: M, effort: 'high', phase: 'Düzelt', label: `duzelt:${task}:t${round}`, schema: FIX_SCHEMA })
  if (fix) allFixOutcomes.push(...(fix.outcomes || []).map(o => ({ ...o, round })))
}
if (!converged) log(`UYARI: ${task} ${maxRounds} turda tam yakınsamadı; kalan bulgular sonuçta`)

// ---------- Kapı ----------
phase('Kapı')
const gate = await agent(gatePrompt, { model: M, effort: 'medium', phase: 'Kapı', label: `kapi:${task}`, schema: GATE_SCHEMA })

return {
  task, story, milestone,
  converged,
  rounds: round,
  impl: implResults.map(r => ({ summary: r.summary, files_changed: r.files_changed, ac_coverage: r.ac_coverage, open_issues: r.open_issues })),
  remaining_findings: converged ? [] : lastFindings,
  fix_outcomes: allFixOutcomes,
  gate,
}
