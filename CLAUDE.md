# Dolmuş Takip — Proje Hafızası

## ÖNCE BUNU OKU (compact sonrası devam talimatı)
- İlerleme checklist'i: `docs/PROGRESS.md`. Bağlam sıkışırsa (compact) ÖNCE bu dosyayı oku, ilk işaretlenmemiş adımdan devam et.
- Bu oturumun görevi: dokümanlardaki planı (MILESTONES → TASKS sırası) uygulayıp kod işini bitirmek.
- FAZ KAPISI (kullanıcı talimatı 2026-09-17): Faz 0 bitince kısa rapor ver ve İZİN BEKLEMEDEN M1'e geç. M1 bitince DUR, özet ver, devam izni iste. M2 ve sonrası için de her milestone sonunda DUR ve izin iste. Milestone içindeki task paketleri arasında durma.
- Her adım bitince `docs/PROGRESS.md` içinde `[x]` işaretle ve kısa not düş. Bu dosya oturumun tek ilerleme kaynağıdır.
- Workflow betikleri repoda: `.claude/workflows/task-uygula.js` (bir TASKS paketi: uygula → 3 mercek doğrula → düzelt → kapı; args: task, story, milestone, steps[], extraContext, reviewExtra, checks[], maxRounds) ve `.claude/workflows/milestone-kapi.js` (milestone sonu: her story AC denetimi + MILESTONES kutuları; args: milestone, stories[], extraContext). Workflow aracını `scriptPath` ile bu dosyalara vererek çalıştır. Her paket bitince docs/DECISIONS.md'ye "Tx.y uygulama kararları" bölümü ekle, PROGRESS'i işaretle, commit at.
- Bilinen harness davranışı: bir ajanın tek model isteği ~3 dakikayı aşarsa "Request interrupted" ile kesilip yeniden başlar; betikte efor 'high' ve çıktı uzunluk sınırı bu yüzden var.

## Kesinleşen kararlar (2026-09-17)
- K1–K8 açık ürün kararları: ARCHITECTURE §10 önerileri kullanıcı tarafından AYNEN KABUL edildi. Ayrıntı: `docs/DECISIONS.md`. Tekrar sorma.
- K9 sürümler kanıtla sabitlendi (`docs/DECISIONS.md`): Next 16.3.5, React 19.3.0, TS 5.9.3 (TS 7 değil), drizzle-orm 0.45.2, drizzle-kit 0.31.10, better-sqlite3 13.0.3 (SQLite 3.53.4), argon2 0.45.1, Tailwind 4.3.3, Vitest 5.0.1, Playwright 1.63.0, zod 4.6.5, npm.
- Commit: her task paketi sonunda ayrı commit. Push yok; deploy aşamasında sorulacak.

## Oturum kuralları (kullanıcı talimatı, değişmez)
- Tüm Workflow ajanları `claude-sonnet-5` modelinde çalışır. Ana oturum yalnızca orkestrasyon ve sentez yapar; iş ajanlara yaptırılır.
- Asla varsayım yapma; kanıta dayan. Kök nedeni bul ve düzelt. Kısayol, atlama, devre dışı bırakma, workaround yok.
- Dokümanlardaki plana ve akışa sadık kal: `docs/PRD.md`, `ARCHITECTURE.md`, `TECH-STACK.md`, `DESIGN.md`, `EPICS.md`, `STORIES.md`, `TASKS.md`, `MILESTONES.md`, `QA-PLAN.md`, `RELEASE.md`, `OPS.md` ve `docs/architecture-decision-records/*`.
- Kullanıcıya yalnızca gerçekten onun karar vermesi gereken soruyu sor. Uydurma karar verme.
- AWS'e yükleme (deploy) aşamasına gelince DUR ve kullanıcıya sor. Ondan önce deploy için sorma.
- Kullanıcıyla Türkçe konuş.
