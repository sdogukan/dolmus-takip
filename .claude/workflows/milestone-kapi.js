export const meta = {
  name: 'dolmus-milestone-kapi',
  description: 'Bir milestone bitiminde STORIES kabul kriterlerini ve MILESTONES tamamlanma kutularını Sonnet 5 denetçileriyle koda karşı doğrula',
  phases: [
    { title: 'Story denetimi', detail: 'her story için bir denetçi: tüm AC kutuları kanıtla', model: 'claude-sonnet-5' },
    { title: 'Milestone kutuları', detail: 'MILESTONES §Mx tamamlanma ve çıkış ölçütleri', model: 'claude-sonnet-5' },
  ],
}
const M = 'claude-sonnet-5'
const ROOT = '/Users/dogukan/Projects/dolmus-takip/'
const milestone = args.milestone     // 'M1'
const stories = args.stories         // ['S1.1', ...]
const extra = args.extraContext || ''

const STORY_SCHEMA = { type: 'object', required: ['story', 'acs', 'verdict', 'notes'], properties: {
  story: { type: 'string' },
  acs: { type: 'array', items: { type: 'object', required: ['index', 'text', 'status', 'evidence'], properties: {
    index: { type: 'integer' }, text: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'missing', 'manual_pending', 'deferred_by_doc'] },
    evidence: { type: 'string' } } } },
  verdict: { type: 'string', enum: ['pass', 'pass_with_manual', 'fail'] },
  notes: { type: 'string' },
} }
const MS_SCHEMA = { type: 'object', required: ['boxes', 'exit_criteria', 'verdict', 'notes'], properties: {
  boxes: { type: 'array', items: { type: 'object', required: ['text', 'status', 'evidence'], properties: { text: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'missing', 'manual_pending'] }, evidence: { type: 'string' } } } },
  exit_criteria: { type: 'array', items: { type: 'object', required: ['text', 'status', 'evidence'], properties: { text: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'missing', 'manual_pending'] }, evidence: { type: 'string' } } } },
  verdict: { type: 'string', enum: ['pass', 'pass_with_manual', 'fail'] },
  notes: { type: 'string' },
} }

const common = `Proje kökü: ${ROOT}. Bağımsız, şüpheci bir kabul denetçisisin. Kod DEĞİŞTİRME, docs DEĞİŞTİRME, commit YAPMA. Dosyaları kendin oku, testleri kendin çalıştır (npm run test:unit / test:integration / test:e2e gerektiği kadar; e2e uzun sürerse yalnız ilgili spec'i çalıştır: npx playwright test <dosya>). Kanıt = dosya:satır, test adı veya çalıştırdığın komutun çıktısı. docs/DECISIONS.md'deki kesin kararları (K1–K9, F*, T* kararları) bağlayıcı kabul et. Yanıtı kısa tut: her evidence 1-2 cümle, notes en fazla 4 cümle; tek bir yanıt 3 dakikayı aşarsa kesilir.
${extra}`

phase('Story denetimi')
const storyResults = await parallel(stories.map(s => () => agent(`${common}
Görev: docs/STORIES.md içindeki "${s}" bölümünün HER kabul kriteri kutusunu (- [ ] ile başlayan satırlar) sırayla al. Her biri için koda/testlere bakarak durum ver: done (kanıtla), partial (hangi parça eksik), missing, manual_pending (yalnız gerçek cihaz/insan kanıtı gerektirenler — tests/e2e/MANUAL-CHECKS.md'de listeli olmalı), deferred_by_doc (story'nin kendi 'Sınır/Açık sınır' notu veya DECISIONS.md bunu başka pakete/sürüme devrediyorsa; hangi cümle olduğunu yaz). verdict: tüm AC'ler done/manual_pending/deferred_by_doc ise pass (manual varsa pass_with_manual); missing veya partial varsa fail.`,
  { model: M, effort: 'high', phase: 'Story denetimi', label: `story:${s}`, schema: STORY_SCHEMA })))

phase('Milestone kutuları')
const ms = await agent(`${common}
Görev: docs/MILESTONES.md içindeki "## ${milestone}" bölümünün "Tamamlanma ve gösterim" kutularını ve "Çıkış" paragrafındaki ölçütleri tek tek al; ayrıca "Ortak tamamlanma ölçütü" bölümündeki 5 kutuyu bu milestone için değerlendir (exit_criteria içine 'ORTAK: ...' önekiyle ekle). Her biri için koda/testlere bakarak durum ve kanıt ver. Gerçek yayın/Lightsail/GitHub koşusu gerektiren ölçütler için 'manual_pending' ve nedenini yaz. verdict kuralı story denetimiyle aynı.`,
  { model: M, effort: 'high', phase: 'Milestone kutuları', label: `milestone:${milestone}`, schema: MS_SCHEMA })

return { milestone, stories: storyResults.filter(Boolean), milestone_boxes: ms }
