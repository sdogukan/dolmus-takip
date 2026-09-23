# Design

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## Page List (Sitemap)

### Public pages

**Repos:** dolmus-takip

| # | Page | URL |
| --- | --- | --- |
| 1 | Root redirect (no session → vehicle login; session → role home) | / |
| 2 | Araç girişi (vehicle login) | /giris |
| 3 | Ekip girişi (staff login) | /yonetim/giris |

_All three implemented (src/app/page.tsx, giris, yonetim/giris)._

### Admin pages

**Repos:** dolmus-takip

| # | Page | URL |
| --- | --- | --- |
| 1 | Şoför — günlük kayıt formu (implemented T3.1 without saving: fixed plate, date, person picker, start/end time with a 'Bitiş ertesi gün' box and live duration, 'Kontrol et'; amounts and saving M3) | /sofor |
| 2 | Şoför — kayıt sonucu / teslim durumu (planned) | /sofor/kayitlar/:id |
| 3 | Sahip — özet (placeholder implemented with a 'Şoförlerim' link; content M5) | /sahip |
| 4 | Sahip — çalışma kaydı (planned) | /sahip/kayit/yeni |
| 5 | Sahip — kayıt detayı ve düzeltme (planned) | /sahip/kayitlar/:id |
| 6 | Sahip — raporlar (planned) | /sahip/raporlar |
| 7 | Sahip — Şoförlerim (implemented S2.4) | /sahip/soforler |
| 8 | Ekip — işletme/araç bulma (implemented: 'Plaka veya işletme ara' + 'Durum' filter mirrored in the URL; empty query lists businesses, a query lists vehicle cards with 'Destek ekranını aç' / 'Araç bilgisi'; '+ İşletme aç' and 'İşlem geçmişi' links; 'Ekip hesapları' link for admins only) | /yonetim |
| 9 | Ekip — işletme oluşturma (implemented) | /yonetim/isletmeler/yeni |
| 10 | Ekip — işletme düzenleme (implemented; lists the business's vehicles with links and '+ Araç ekle') | /yonetim/isletmeler/:id |
| 11 | Ekip — araç oluşturma / düzenleme, pasife alma ve şifre sıfırlama (implemented; detail page shows the pinned support target header and links to 'Şoförler') | /yonetim/isletmeler/:id/araclar/yeni; /yonetim/araclar/:id |
| 12 | Ekip — araç şoförleri (implemented S2.4; same driver screen as Şoförlerim plus global person deactivation and a password-reset link; pinned support target header) | /yonetim/araclar/:id/soforler |
| 13 | Ekip — müşteriye destek alanı (implemented: pinned support target header + links to Şoförler, Araç bilgisi and this vehicle's history; entry, confirmation and report links not offered until they exist) | /yonetim/araclar/:id/destek |
| 14 | Ekip — işlem geçmişi (implemented: read-only list, optional vehicle or business filter with 'Filtreyi kaldır', 'Daha fazla göster'; team-account rows add 'Ekip hesabı: <username>') | /yonetim/islem-gecmisi |
| 15 | Yönetici — ekip hesapları (implemented S2.6: list incl. inactive accounts with '+ Hesap aç'; each card username, full name, role, Aktif/Pasif, 'Düzenle' and 'Şifre sıfırla') | /yonetim/ekip |
| 16 | Yönetici — ekip hesabı açma (implemented S2.6: username, full name, role, initial password) | /yonetim/ekip/yeni |
| 17 | Yönetici — ekip hesabı düzenleme (implemented S2.6: 'Hesap bilgisi' full name + role, 'Aktiflik' deactivate behind a confirm dialog / reactivate, 'Şifre sıfırlama') | /yonetim/ekip/:id |

_URLs are DESIGN §1 proposals; implemented routes verified in src/app. Hiding a button never replaces server authorization. '+ Araç ekle' is shown only for an active business with an owner; the server rejects the other cases with 422 anyway. Vehicle sessions opening either vehicle page are redirected to /sahip or /sofor. The vehicle detail page carries a 'Şifre sıfırlama' section (#sifre-sifirlama, T2.3); it is disabled with an explanatory text when the vehicle or its business is inactive. S2.4: /sahip/soforler (owner session only; staff → /yonetim, driver → /sofor, none → /giris) and /yonetim/araclar/:id/soforler (staff only; vehicle sessions → /sahip or /sofor; unknown vehicle → 404) both render the shared DriversManager component; the staff mode adds the X-Target-Vehicle header, 'Tüm araçlarda pasife al' / 'Kişiyi yeniden aktifleştir' and a 'Şifre sıfırla' link to /yonetim/araclar/:id#sifre-sifirlama. /sahip gained a 'Şoförlerim' link; the vehicle detail page gained a 'Şoförler' link. Admin support/audit change: /yonetim renders AdminSearch (client-side reads of GET /api/v1/admin/businesses|vehicles) instead of the server-rendered business list, plus an 'İşlem geçmişi' link. /yonetim/araclar/:id/destek and /yonetim/islem-gecmisi use the same session checks as the vehicle page (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; unknown vehicle or business → 404); the support target is derived server-side from the vehicle id in the URL. SupportTargetHeader ('Destek: <business>', 'Araç: <plate> · Sahip: <owner>', 'İşlemi yapan: <username> (<role>)', 'Hedefi değiştir') is rendered on /destek, /yonetim/araclar/:id and /yonetim/araclar/:id/soforler inside UnsavedChangesProvider. The history page filter comes only from ?vehicleId= / ?businessId= (the support page links with vehicleId). Team accounts (S2.6): /yonetim/ekip, /yonetim/ekip/yeni and /yonetim/ekip/:id share readTeamPageContext (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; the role is read fresh per request); a support user gets the unauthorized text and no account data is read; an unknown account id → 404. The detail page wraps TeamUserDetailForm in UnsavedChangesProvider. When an admin deactivates their own account or resets their own password the screen sends them to /yonetim/giris?oturum=bitti, where the staff login page shows 'Oturumun sona erdi. Yeniden giriş yap.' above the form. T3.1: /sofor now renders WorkEntryForm below the plate header instead of the placeholder text. The server computes today's Europe/Istanbul date once (istanbulToday) and passes it as a prop; the form reads the selectable drivers from GET /api/v1/drivers, re-reads the list on submit to check the chosen person is still selectable, and writes nothing — the success note states the entry is not saved yet._

## Wireframes

### Araç girişi — wireframe

**Repos:** dolmus-takip

```
Dolmuş Takip
Günlük hesabını kolayca kaydet

Plaka
[ 35 ABC 123                         ]
Şifre
[ •••••••••                 Göster  ]

[             Giriş yap             ]

Giriş yapamıyorsan hesabını açan
ekipten yardım al.
```

_Mobile layout; desktop: centered, max 480 px form._

### Araç girişi — notes

**Repos:** dolmus-takip

Container: 16 px side padding on phone; centered, max 480 px on wide screens. Labels always visible above inputs.
Behaviour: no owner/driver choice; plate spacing/case normalized; paste and password managers allowed; Show/Hide toggles only the password.
States: idle; loading ("Giriş yapılıyor…", button disabled, aria-live polite); field error (aria-invalid + aria-describedby, focus first invalid field); auth error ("Plaka veya şifre yanlış.", role=alert, form kept); rate limited (429 message); network/5xx ("Bağlantı kurulamadı. Tekrar dene.").
Staff variant (/yonetim/giris): title "Ekip girişi", fields "Kullanıcı adı" + "Şifre"; error "Kullanıcı adı veya şifre yanlış."
Help text shown on both variants (S1.6 AC7).

_Implemented in T1.2/T1.3/T1.6 via the shared LoginForm component._

### Şoför günlük kayıt — wireframe

**Repos:** dolmus-takip

```
35 ABC 123                    Çıkış
Günlük kayıt

Adın
[ Ahmet Yılmaz                    v ]
Çalışma tarihi
[ 14 Eylül 2026                    v ]
Başlangıç               Bitiş
[ 08:00      ]          [ 17:30     ]
Çalışma süresi: 9 saat 30 dakika

Hasılat (TL)
[ 10.000,00                         ]
Mazot (TL)
[ 1.500,00                          ]
[ + Masraf ekle ]
  Diğer masraf (TL) [ 300,00        ]
  Açıklama          [ Otopark       ]

Şoför payın (%20)        2.000,00 TL
Teslim edilecek tutar    6.200,00 TL

[               Kaydet              ]
```

_Conflict between the approved wireframe (value kept unchanged) and the code written for this task (T3.1). The approved layout orders 'Adın' (person) before 'Çalışma tarihi' (date) and shows no overnight control. WorkEntryForm renders, under the plate header and 'Günlük kayıt' heading: 'Çalışılan gün' (native date input prefilled with the server-computed Istanbul date, the formatted date '14 Eylül 2026' shown below it), 'Kim çalıştı?' (select starting at 'Adını seç'), 'Başlangıç saati', 'Bitiş saati' with a 'Bitiş ertesi gün' checkbox, live 'Bitiş: <date> <time>' when overnight and 'Süre: 9 saat 30 dakika', then a single 'Kontrol et' button. Start and end times are stacked, not side by side. Amounts, share preview and 'Kaydet' are not implemented yet (saving is T3.4). Update the wireframe to the implemented order and labels, or keep it and change the code later?_

### Şoför günlük kayıt — notes

**Repos:** dolmus-takip

Fields: plate fixed; date defaults to today (editable); name starts as "Adını seç" from active drivers of the vehicle; no free-text name or ID fields.
Time: labelled start/end pickers, duration auto-computed; overnight shows explicit end date ("Ertesi gün bitti"), 0 < duration ≤ 24 h (K3).
Money: gross and fuel required (explicit 0 allowed); decimal keyboard; summary shows "—" while inputs invalid; single other expense + optional note (K6); negative remainder shown with a clear warning (K5).
States: empty driver list ("Bu araç için şoför eklenmemiş. Mal sahibinden adını eklemesini iste."); saving ("Kaydediliyor…"); success after commit only; unknown result ("Kaydın sonucu kontrol ediliyor." — same request re-checked, form frozen); known not-sent ("Bağlantı yok. Henüz kaydedilmedi."); validation error under field; session expired.
Draft + request_id persisted in localStorage for 24 h (F6); no offline queue (K7).

_Conflict between the approved notes (value kept unchanged) and the code written for this task (T3.1). (1) Empty driver list text: approved 'Bu araç için şoför eklenmemiş. Mal sahibinden adını eklemesini iste.'; WORK_ENTRY_MESSAGES.personEmpty is 'Bu araçta seçilebilir şoför yok. Araç sahibinden şoför eklemesini iste.', shown only on 200 + drivers: [] (never on network, 401/403 or 5xx errors), with the picker disabled. (2) Overnight: approved 'overnight shows explicit end date ("Ertesi gün bitti")'; the code asks for an explicit 'Bitiş ertesi gün' checkbox and shows 'Bitiş: <date> <time>'; a same-day end before start is refused ('Bitiş saati başlangıçtan önce...') and equal same-day times are refused, never read as 24 h (evaluateWorkTime in src/lib/work-time.ts; entered times are always Europe/Istanbul, the device time zone is never used). (3) States not in the approved notes: list loading ('Şoförler yükleniyor…'), list error with 'Tekrar dene' (not after 401), submit re-reads GET /api/v1/drivers and a person no longer selectable clears the choice with 'Bu kişi artık bu araçta seçilemiyor. Liste yenilendi; adını yeniden seç.' while other fields are kept; overlapping list requests are sequenced so a stale response cannot overwrite a newer list. The draft/request_id persistence and saving states are not implemented yet. Update the notes to the implemented texts and states, or keep them and change the code later?_

### Kayıt sonucu — wireframe

**Repos:** dolmus-takip

```
Kaydedildi
Ahmet Yılmaz · 35 ABC 123
14 Eylül 2026 · 08:00–17:30

Teslim edilecek tutar    6.200,00 TL
Henüz doğrulanmadı
Mal sahibi parayı aldığında
burada görebileceksin.

[ Yenile ]
Başka bir çalışma kaydı gir
```

_Mobile layout; same on desktop within max width._

### Kayıt sonucu — notes

**Repos:** dolmus-takip

Pending: "Henüz doğrulanmadı". Confirmed: "Teslim doğrulandı" + received amount + confirmation time; short delivery shows expected 6.200 TL and verified 6.000 TL together.
Refresh on open and via "Yenile"; no background polling. New entry link hidden while a result is unknown.
Driver history scope: entries of the selected person on the same vehicle; unconfirmed edits only on the work day (K1). No "Kayıtlarım" privacy promise.

_K1 accepted 2026-09-17._

### Sahip çalışma kaydı — wireframe

**Repos:** dolmus-takip

```
35 ABC 123
Çalışma kaydı

[ Kendim çalıştım ]  [ Şoför adına ]
Çalışan: Görkem · Mal sahibi

Tarih, başlangıç, bitiş, hasılat,
mazot ve masraf: günlük formla aynı

Şoför payı                  0,00 TL
Giderlerden sonra kalan 8.200,00 TL
Kendi çalışmanda şoför payı ayrılmaz.

[               Kaydet              ]
```

_Segmented choice sets work_kind._

### Sahip çalışma kaydı — notes

**Repos:** dolmus-takip

"Kendim çalıştım" shows the owner's person; share 0; result "Kaydedildi — onay gerekmiyor"; no received-amount field; later edits via "Değişiklikleri kaydet" without a confirmation.
"Şoför adına" opens the active person picker and applies 20%; the vehicle owner is never offered as a driver.
States as in the daily form (saving, unknown result, validation, session expired).

_ARCHITECTURE §3.3 kind rules._

### Sahip özeti — wireframe

**Repos:** dolmus-takip

```
35 ABC 123 · Görkem
[ Özet ]  [ Raporlar ]  [ Şoförlerim ]

[ + Çalışma kaydı gir ]
Dönem [ Bu ay                     v ]
1–30 Eylül 2026

Hasılat                 20.000,00 TL
Mazot                    3.000,00 TL
Diğer masraf               600,00 TL
Şoför payı               2.000,00 TL
Hesaplanan kalan        14.400,00 TL

Teslim alınan (onaylı)    6.000,00 TL
Yalnız doğruladığın şoför teslimleri

Henüz doğrulanmayan kayıtlar
Bu dönemde bekleyen kayıt yok.
```

_Desktop ≥768 px may use two columns._

### Sahip özeti — notes

**Repos:** dolmus-takip

Period default "Bu ay"; week/month/year + previous/next; date range always visible; all figures belong to the same period.
Pending list rows: person, date/times, expected hand-over, "Kaydı aç"; never labelled "Borçlu/Ödenmedi".
Navigation: three text tabs fit phone width; logout is a labelled secondary action.
States: loading ("Kayıtlar yükleniyor…", no 0 amounts), truly empty ("Bu dönemde kayıt yok."), report failed ("Rapor yüklenemedi. Tekrar dene."), inactive/unauthorized.
Scope: only the logged-in vehicle (K2).

_Current /sahip is an honest placeholder with plate + logout (M1 decision)._

### Kayıt detayı ve teslim onayı — wireframe

**Repos:** dolmus-takip

```
< Özete dön
Ahmet Yılmaz · 35 ABC 123
14 Eylül 2026 · 08:00–17:30
Henüz doğrulanmadı

Hasılat                 10.000,00 TL
Mazot                    1.500,00 TL
Diğer masraf               300,00 TL
Şoför payı               2.000,00 TL
Beklenen teslim          6.200,00 TL

Aldığım tutar (TL)
[ 6.000,00                          ]
Beklenenden 200,00 TL az.

[ Parayı aldım, tutar doğru          ]
Kaydı düzenle

--- after confirmation, "Kaydı düzenle" ---
Onaylanmış kaydı düzelt
Ahmet Yılmaz · 35 ABC 123
Günlük form alanları: düzenlenebilir
Yeni beklenen teslim     6.200,00 TL
Aldığım tutar (TL) [ 6.000,00        ]
[         Düzelt ve onayla           ]
Vazgeç                  Geçmişi gör
```

_Two states of the same page._

### Kayıt detayı ve teslim onayı — notes

**Repos:** dolmus-takip

First confirmation: received field may be prefilled with expected (prefill is not confirmation); received ≥ 0 and explicit.
After confirmation: "Teslim doğrulandı", received amount, time and actor (staff shown as "Sahip adına platform desteği · <ad>"). Driver cannot edit.
Correct-and-confirm is one operation; received amount is not auto-synced to new expected; person/date change moves the entry to the new period; driver↔owner kind change closed (K4, 422).
Unconfirmed edit: "Değişiklikleri kaydet" (does not claim cash received).
States: saving, success ("Kayıt düzeltildi ve onaylandı."), conflict 409 ("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et."), validation, unknown result, unauthorized.

_ADR-002; F7 canonical 409 text._

### Raporlar — wireframe

**Repos:** dolmus-takip

```
35 ABC 123 · Raporlar
[ Bu hafta ] [ Bu ay ] [ Bu yıl ]
<           Eylül 2026            >
1–30 Eylül 2026

Hesaplanan kalan        14.400,00 TL
Teslim alınan (onaylı)    6.000,00 TL
Hesap dökümünü gör

[ Kişiler ] [ Gün gün ]
Ahmet Yılmaz
9 saat 30 dakika · 1 gün · 1 çalışma
Hasılat 10.000 TL · Pay 2.000 TL
[ Ayrıntıyı gör ]

Görkem · Mal sahibi
9 saat 30 dakika · 1 gün · 1 çalışma
Hasılat 10.000 TL · Pay 0 TL
[ Ayrıntıyı gör ]
```

_Desktop may render the same data as a table; no horizontal scroll on phone._

### Raporlar — notes

**Repos:** dolmus-takip

Period navigation identical for week/month/year; server-defined boundaries shown as text; old totals never shown under a new heading while loading.
"Hesaplanan kalan" is explained as remainder after entered costs and driver shares — not profit or cash on hand.
Persons: duration, distinct work days, entry count, gross, share; renamed person stays one row; inactive persons keep history.
Day-by-day: cards with date/person/times/gross/expected/received/status; person + status filters under "Günlük kayıtları filtrele"; "Daha fazla göster" pagination.
States: loading, empty period, report failed, unauthorized.

_M5 scope; F17 defines vehicle work day._

### Şoförlerim — wireframe

**Repos:** dolmus-takip

```
35 ABC 123 · Şoförlerim
[ + Şoför ekle ]

Ahmet Yılmaz              Aktif
[ Düzenle ]
Mehmet Demir              Aktif
[ Düzenle ]

[ Pasif şoförleri göster ]
```

_Conflict between the approved wireframe (value kept unchanged) and the code written for this task. The owner screen /sahip/soforler (DriversManager mode=owner) shows plate header, '← Özet', h1 'Şoförlerim', a '+ Şoför ekle' toggle opening 'Ad soyad' + 'Şoförü kaydet', a similar-name hint ('Benzer adlı kayıtlı kişi var: …') and a 'Kayıtlı kişiyi bağla' candidate list with 'Bu araca bağla'; 'Aktif şoförler' rows carry name, Aktif/Pasif badge, 'Düzenle' (rename with the approved rename note) and 'Bu araçta pasife al' (then the approved F3 shared-password warning); 'Pasif şoförleri göster' reveals rows with 'Yeniden aktifleştir'. These follow 'Şoförlerim — notes' but the per-row deactivate button and the candidate list are not drawn. The staff screen /yonetim/araclar/:id/soforler (mode=staff, reached from a 'Şoförler' link on the vehicle detail page) adds 'Tüm araçlarda pasife al' behind a ConfirmDialog listing affected plates, 'Kişiyi yeniden aktifleştir' and a 'Şifre sıfırla' link to #sifre-sifirlama; the approved 'Yönetim ana ekranı ve destek alanı' wireframe instead places driver management as a 'Şoförler' tab inside the support area (/yonetim/araclar/:id/destek). The support area is now implemented as a list of links whose 'Şoförler' link opens the separate /yonetim/araclar/:id/soforler page, which also shows the pinned SupportTargetHeader; typed-but-unsent names and open row operations count as unsaved changes there. Global person deactivation corresponds to person.set_global_active (support/admin) in the approved permission matrix but is not described in any design note._

### Şoförlerim — notes

**Repos:** dolmus-takip

Add: full-name form; reuse an existing person in scope instead of duplicating; similar-name hint never auto-merges; no national ID or login account.
Edit: rename with note "Bu kişinin eski kayıtları da yeni adıyla görünür."
"Bu araçta pasife al" closes only this vehicle's assignment; can be reactivated with the same person.
F3 warning after deactivation: "Ortak şoför şifresi hâlâ geçerli. Erişimi tamamen kesmek için ekipten şifre sıfırlama isteyin."
States: empty list, saving, validation, conflict, unauthorized.

_T2.4 planned._

### Yönetim ana ekranı ve destek alanı — wireframe

**Repos:** dolmus-takip

```
Yönetim · Doğukan                 Çıkış
[ Plaka veya işletme ara              ]
[ + İşletme aç ]       [ + Araç ekle ]

Görkem işletmesi · 35 ABC 123
Mal sahibi: Görkem · Aktif
[ Destek ekranını aç ] [ Araç bilgisi ]

--- support area ---
Destek: Görkem işletmesi
Araç: 35 ABC 123 · Sahip: Görkem
İşlemi yapan: Doğukan (platform ekibi)

[ Özet ] [ Kayıtlar ] [ Şoförler ]
[ Raporlar ] [ Araç bilgisi ]
[ + Çalışma kaydı gir ]

Sahip adına destek işlemi
Müşteri ekranlarıyla aynı form ve hesap
```

_Conflict between the approved wireframe (value kept unchanged) and the code written for this task. /yonetim (page.tsx + admin-search.tsx) shows the team header, '+ İşletme aç', an 'İşlem geçmişi' link, the 'Plaka veya işletme ara' input and a 'Durum' select (Hepsi / Aktif / Pasif); there is no '+ Araç ekle' on this screen (vehicles are added from /yonetim/isletmeler/:id). An empty query lists business cards (name, 'Sahip: …' or 'Sahipsiz', vehicle count, Aktif/Pasif); a query lists vehicle cards (plate, business, owner, Aktif/Pasif, 'İşletme pasif' when relevant) with 'Destek ekranını aç' and 'Araç bilgisi'; loading, 'Sonuç yok.', 'Henüz işletme yok.', error with 'Tekrar dene' and 'Daha fazla göster' are separate states. /yonetim/araclar/:id/destek renders SupportTargetHeader ('Destek: <business>', 'Araç: <plate> · Sahip: <owner>', 'İşlemi yapan: <username> (<role>)', 'Hedefi değiştir'), h1 'Destek', an inactive-target notice, and three links (Şoförler, Araç bilgisi, 'Bu aracın işlem geçmişi'); the approved tabs Özet / Kayıtlar / Raporlar and '+ Çalışma kaydı gir' are deliberately not offered because those features do not exist yet (M1 honesty rule in the page comment). The same header is shown on /yonetim/araclar/:id and /yonetim/araclar/:id/soforler. 'Yönetim ana ekranı ve destek alanı — notes' (target pinned, switching target leaves the task, 'Değişiklikleri bırakıp çık?' confirm, active filter, inactive target read-only) matches the code and is not in question._

### Yönetim ana ekranı ve destek alanı — notes

**Repos:** dolmus-takip

Header shows username + role label (Yönetici/Destek). Results show plate, business, owner and active state; active filter available; vehicles with history are never deleted.
Support target (business, vehicle, owner) pinned at top; switching target leaves the current task; unsaved form → "Değişiklikleri bırakıp çık?" confirm dialog.
Customer-facing trace: "Sahip adına platform desteği · <ad>"; never implies staff physically received cash.
Mobile: a few text rows as menu; desktop ≥1024 px: side menu/tables.
States: loading, empty search, inactive target (read allowed, write 403), unauthorized, session expired.

_DESIGN §2.9 + T1.5 inactive-target rule._

### İşletme oluşturma / düzenleme — wireframe

**Repos:** dolmus-takip

```
Yönetim · Doğukan                 Çıkış
< İşletmelere dön
İşletme aç

İşletme adı
[ Görkem işletmesi                  ]
Mal sahibinin adı soyadı
[ Görkem Kaya                       ]

[            İşletme aç             ]

--- /yonetim/isletmeler/:id ---
Görkem işletmesi · Aktif
İşletme adı      [ Görkem işletmesi ]
Mal sahibi       [ Görkem Kaya      ]
[      Değişiklikleri kaydet        ]
[ İşletmeyi pasife al ]  (confirm dialog)
```

_Drawn from the implemented forms (new-business-form.tsx labels, business-detail-form.tsx behaviour per DECISIONS T2.1); layout approved by the product owner._

### İşletme oluşturma / düzenleme — notes

**Repos:** dolmus-takip

Create requires name + owner full name; request_id kept for replay (use-stored-draft); 422 shows field errors.
Edit: PATCH with version; same-value PATCH → 422 "Değişiklik yok."; owner assignment only when owner-less (existingPersonRef must be an active person of this business); no transfer (K8).
Deactivate/reactivate behind ConfirmDialog; deactivation revokes the business's sessions immediately.
States: saving, success, validation, conflict 409, unknown result (version frozen), unauthorized.

_Implemented T2.1; E2E tests/e2e/admin-businesses.spec.ts._

### Araç oluşturma / düzenleme — wireframe

**Repos:** dolmus-takip

```
Yönetim · Doğukan                 Çıkış
< Görkem işletmesi
Araç ekle
İşletme / sahip: Görkem işletmesi · Görkem
Plaka
[ 35 ABC 123                        ]
Marka / model        Yıl
[ Ford Transit ]     [ 2019 ]
Hat / durak notu
[                                   ]
Mal sahibi şifresi
[ ••••••••                  Göster  ]
Ortak şoför şifresi
[ ••••••••                  Göster  ]
[             Aracı kaydet          ]
```

_Conflict between the approved wireframe (value kept unchanged) and the code written for this task. new-vehicle-form.tsx labels the password inputs 'Sahip şifresi' / 'Şoför şifresi' instead of the approved 'Mal sahibi şifresi' / 'Ortak şoför şifresi', and adds an optional free-text 'Not' field (vehicles.note) that the wireframe does not show; plate, 'Marka / model', 'Yıl', 'Hat / durak notu' and 'Aracı kaydet' match. The edit screen at /yonetim/araclar/:id (vehicle-detail-form.tsx: 'Araç bilgisi' section with 'Bilgiyi kaydet', 'Aktiflik' section with 'Aracı pasifleştir' / 'Aracı yeniden aktifleştir' behind a confirm dialog; plate not editable) is not drawn in the approved wireframe. Keep the approved wireframe and change the screens, or update the wireframe to the implemented screens? T2.3 added a 'Şifre sıfırlama' section to /yonetim/araclar/:id (password-reset-section.tsx): business name + plate, a radio choice labeled 'Mal sahibi şifresi' / 'Şoför şifresi', 'Yeni şifre' with Göster/Gizle, 'Şifreyi sıfırla', a 'Kaydın sonucu kontrol ediliyor' state with 'Tekrar kontrol et', and a success text naming plate + access and the WhatsApp handover. Its owner label matches the approved 'Mal sahibi şifresi', its driver label does not match 'Ortak şoför şifresi'; the section is not drawn in the approved wireframe either. S2.4 added a 'Şoförler' link under the business/owner line of vehicle-detail-form.tsx pointing to /yonetim/araclar/:id/soforler; it is not in the approved wireframe either. The admin support/audit change added the pinned SupportTargetHeader (business, plate, owner, real staff actor, 'Hedefi değiştir') above VehicleDetailForm on /yonetim/araclar/:id; the info section and the typed-but-unsent new password in 'Şifre sıfırlama' register as unsaved changes, so 'Hedefi değiştir' asks 'Değişiklikleri bırakıp çık?' before clearing the vehicle's drafts. Not in the approved wireframe either._

### Araç oluşturma / düzenleme — notes

**Repos:** dolmus-takip

Business/owner selected or created first; plate uniqueness conflict explained on the form; owner and driver passwords must differ; existing passwords never shown.
Password reset is per role, names the vehicle and access affected, warns old sessions close; no automatic message is sent — staff hand the new password to the customer over WhatsApp themselves.
Active toggle shows affected access; deactivation keeps history. Owner cannot edit vehicle info (K2).
States: saving, validation, plate conflict, confirm dialog for deactivation, unauthorized.

_T2.2/T2.3 planned; WhatsApp handover per the product owner's answer to F14._

### Ekip hesapları ve işlem geçmişi — wireframe

**Repos:** dolmus-takip

```
Yönetim · Doğukan (Yönetici)      Çıkış
Ekip hesapları        [ + Hesap aç ]
destek.ayse   Ayşe K.   Destek   Aktif
[ Düzenle ] [ Şifre sıfırla ]

--- /yonetim/islem-gecmisi ---
İşlem geçmişi
[ İşletme / plaka filtrele          ]
21 Eyl 2026 14:05 · Görkem işletmesi
İşletme adı değişti · Doğukan
Önce: Görkem Dolmuş  Sonra: Görkem işletmesi
[ Daha fazla göster ]
```

_Conflict between the approved wireframe (value kept unchanged) and the code written for this task. /yonetim/islem-gecmisi (page.tsx + audit-history.tsx) shows the team header, '← Yönetim', h1 'İşlem geçmişi', and when ?vehicleId= or ?businessId= is present a 'Filtre: <plate · business>' line with 'Filtreyi kaldır'; there is no free-text 'İşletme / plaka filtrele' input. Each entry shows '<Istanbul time> · <business> · <plate>', the Turkish action label (audit-ui.ts, e.g. 'İşletme bilgisi değişti'), 'İşlemi yapan: <username> (<role>)' or, for owner-made driver actions, the vehicle access + plate without a person name, 'Sahip adına: <name>' for staff acting on behalf, 'Önce: … Sonra: …' rows for changed fields only, and 'Önceki değer yok (yeni kayıt).' on creations; 20 entries per page with 'Daha fazla göster'; loading, empty ('Henüz işlem kaydı yok.') and error with 'Tekrar dene' are separate. Team-account rows (entity_type platform_user, S2.6) add 'Ekip hesabı: <username>' under the actor line. The team-accounts half (S2.6, this task): /yonetim/ekip matches the approved drawing — team header with the role label, '← Yönetim', h1 'Ekip hesapları', '+ Hesap aç', cards with username, '<full name or Ad soyad yok> · <role> · Aktif/Pasif', 'Düzenle' and 'Şifre sıfırla' (→ /yonetim/ekip/:id#sifre-sifirlama), 'Henüz ekip hesabı yok.' when empty. Not drawn: /yonetim/ekip/yeni (NewTeamUserForm: h1 'Ekip hesabı aç', an intro saying the password is handed over by staff and the app sends no message, 'Kullanıcı adı' with help text, 'Ad soyad', 'Yetki' choice, 'Şifre' with Göster/Gizle, 'Hesabı aç'; a result-check state with 'Tekrar kontrol et') and /yonetim/ekip/:id (TeamUserDetailForm: username heading with Aktif/Pasif; 'Hesap bilgisi' with 'Ad soyad', 'Yetki', 'Bilgiyi kaydet' and a conflict banner with 'Güncel halini aç'; 'Aktiflik' with 'Hesabı pasifleştir' behind a ConfirmDialog, a self-deactivation warning and 'Hesabı yeniden aktifleştir'; 'Şifre sıfırlama' with 'Yeni şifre', 'Şifreyi sıfırla', a self-reset warning and a success text naming the account and the manual hand-over). A self-deactivation or self-reset sends the admin to /yonetim/giris?oturum=bitti, which shows 'Oturumun sona erdi. Yeniden giriş yap.' above the login form._

### Ekip hesapları ve işlem geçmişi — notes

**Repos:** dolmus-takip

Team accounts: admin only; fields username, person name, role (admin/support), active, new password/reset; reset and deactivation revoke the user's sessions.
Audit history: time, target, action, real staff user, on-behalf-of, before/after values; secrets never displayed; paginated.
States: loading, empty, validation, conflict, unauthorized (support role sees 403 on team accounts).

_Permission matrix: 'Ekip hesabı/yetkisi yönetme — Yalnız platform yöneticisi'._

## Design System

### Color palette

**Repos:** dolmus-takip

primary #1D4ED8 (on-primary #FFFFFF, 6.70:1)
page #F8FAFC · surface #FFFFFF
text #0F172A (17.85:1 on white) · text-secondary #475569
input-border #64748B · divider #CBD5E1 (never as a form border)
success #166534 on #F0FDF4 · warning #92400E on #FFFBEB · error #B91C1C on #FEF2F2 (status pairs ≥ 5.91:1)
info: not defined (primary blue used for informational text)

_WCAG AA ≥ 4.5:1 verified by src/lib/contrast.ts unit tests; red only for consequential actions, never for balances._

### Typography

**Repos:** dolmus-takip

Font: system-ui, -apple-system, "Segoe UI", sans-serif (no web font download).
Scale: helper 16 px/400 · label 18 px/500 · body/input 18 px/400 · button 18 px/600 · section 24 px/600 · page title 28 px/600 · key amount 28–32 px/600.
Line height 1.5; tabular numerals for amounts; Turkish formatting "6.200,00 TL"; no all-caps headings; long Turkish words wrap (overflow-wrap: break-word).

_Template xs→4xl mapped to the project's px scale._

### Spacing

**Repos:** dolmus-takip

Base unit 4 px (--space-unit 0.25rem); scale 8 / 12 / 16 / 24 / 32 px.
Page side padding 16 px phone, 24 px wide; field groups 24 px apart.
Controls ≥ 48 px (--control-min-height 3rem); primary button ≥ 56 px (--primary-min-height 3.5rem); touch targets 48 × 48 px.

_Above WCAG 24 px minimum by product choice._

### Border radius

**Repos:** dolmus-takip

sm/control 8 px (--radius-control 0.5rem) · md/card 12 px (--radius-card 0.75rem) · lg/xl/full: not used.

_DESIGN §3 'Köşe'._

### Component patterns

**Repos:** dolmus-takip

Buttons: primary filled blue; secondary outlined/text; one dominant action per form; destructive red only for deactivation.
Inputs: label above, placeholder never replaces label, TL unit visible, error text linked via aria-describedby.
Cards/lists: fixed order title → amount → status; explicit "Kaydı aç" action (no invisible row click).
Modal: accessible ConfirmDialog only for short decisions; focus returns to trigger.
Shared components: LoginForm, ConfirmDialog, LogoutButton, TeamPageHeader, VehiclePageHeader.
Focus visible; results announced to screen readers; sticky bars never hide focus.

_Shared components exist in src/app/_components._

### Responsive breakpoints

**Repos:** dolmus-takip

- base 320 px — single column, no horizontal scroll; form max 560 px, login form max 480 px
- sm 640 — minor layout refinements
- md 768 — two-column summary cards
- lg 1024 — staff side menu / tables
- xl 1280 — content capped at ~1120 px

_Breakpoints are visual only; no device-based permissions._

### Animation

**Repos:** dolmus-takip

No decorative animation, carousels or charts in v1. Optional 100–150 ms focus/status transitions respecting prefers-reduced-motion. Main actions remain usable at 200% zoom and enlarged fonts.

_DESIGN §3 'Responsive yerleşim ve hareket'._

## Framework Config

### Framework Config

**Repos:** dolmus-takip

/* src/app/globals.css (Tailwind CSS 4.3.3 via @tailwindcss/postcss) */
@import "tailwindcss";

:root {
  --color-primary: #1d4ed8;
  --color-on-primary: #ffffff;
  --color-page: #f8fafc;
  --color-surface: #ffffff;
  --color-text: #0f172a;
  --color-text-secondary: #475569;
  --color-input-border: #64748b;
  --color-divider: #cbd5e1;
  --color-success: #166534;
  --color-success-surface: #f0fdf4;
  --color-warning: #92400e;
  --color-warning-surface: #fffbeb;
  --color-error: #b91c1c;
  --color-error-surface: #fef2f2;
  --font-body: system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-size-body: 1.125rem;
  --line-height-body: 1.5;
  --space-unit: 0.25rem;
  --radius-control: 0.5rem;
  --radius-card: 0.75rem;
  --control-min-height: 3rem;
  --primary-min-height: 3.5rem;
  --form-max-width: 35rem;
}

body {
  background-color: var(--color-page);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  overflow-wrap: break-word;
}
/* Components consume tokens via arbitrary values, e.g. text-[var(--color-text)]; no @theme block. */

_Tokens are plain CSS variables referenced from Tailwind arbitrary-value classes; no Tailwind @theme mapping exists in src._
