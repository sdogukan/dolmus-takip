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
| 4 | Aydınlatma metni (KVKK information notice; implemented: reads no session and never redirects; title, intro and seven numbered sections from PRIVACY_NOTICE in src/lib/messages.ts; a 'Kişisel verilerin korunması: aydınlatma metni' link at the bottom of both login pages, at least 48 px high) | /aydinlatma-metni |

_All four implemented (src/app/page.tsx, giris, yonetim/giris, aydinlatma-metni). The notice page renders PRIVACY_NOTICE as plain React text; /giris and /yonetim/giris render the shared PrivacyNoticeLink. The notice's data-controller fields are bracketed placeholders to be filled before release._

### Admin pages

**Repos:** dolmus-takip

| # | Page | URL |
| --- | --- | --- |
| 1 | Şoför — günlük kayıt formu (implemented T3.1–T3.4, shared WorkEntryForm in driver mode: fixed plate, date, person picker, start/end time with a 'Bitiş ertesi gün' box and live duration, gross and fuel, one optional other expense + note, live read-only share and hand-over summary, 'Kaydet' saves the entry (T3.4) and replaces the form with 'Kaydedildi', '<name> · <date> · <duration>', 'Teslim edilecek tutar' and 'Henüz doğrulanmadı'; an unknown result locks the fields with 'Kaydı tekrar dene'; the saved result links 'Kaydı aç' to /sofor/kayitlar/:id; a 'Kayıtlarım' link sits below the form; after 'Yenile' a confirmed entry shows 'Teslim doğrulandı' with 'Alınan tutar' and 'Doğrulama zamanı' on separate lines, apart from 'Teslim edilecek tutar' — T4.6) | /sofor |
| 2 | Şoför — Kayıtlarım (implemented T3.6: 'Kimin kayıtları?' picker of selectable drivers, then that person's visible entries newest day first with day, time, duration, hand-over and status ('Henüz doğrulanmadı' / 'Teslim doğrulandı' / 'Onay gerekmiyor'), 'Aç' and 'Daha fazla göster'; loading, error and empty states kept apart) | /sofor/kayitlar |
| 3 | Şoför — kayıt detayı ve düzenleme (implemented T3.6: 'Kayıt detayı' with the server's current values, version and status; the edit form opens only for a pending entry of today, otherwise read-only with the edit-window note; a driver-kind entry may switch to another selectable driver; the kind is shown, never editable; delivery status implemented T4.6: 'Teslim edilecek tutar' and the status once, the pending hint 'Mal sahibi parayı aldığında burada görebileceksin.', for a confirmed entry 'Alınan tutar' and 'Doğrulama zamanı' on separate lines and, after a staff confirmation, 'Sahip adına platform desteği' without a username; a 'Yenile' button re-reads the entry (no polling; on failure the last known state stays, after a 401 'Yeniden giriş yap'); no confirm, correct or history control) | /sofor/kayitlar/:id |
| 4 | Sahip — özet (implemented T5.5: header '<plate> · <owner name>' with 'Çıkış'; a visually hidden 'Özet' heading; the 'Sahip bağlantıları' tabs 'Özet' (current), 'Raporlar' and 'Şoförlerim'; a primary '+ Çalışma kaydı gir' button; a 'Dönem' select (Bu hafta / Bu ay / Bu yıl, 'Bu ay' on open) and '← Önceki' / 'Sonraki →' moving one period using the server's period bounds; the range text (e.g. '1–30 Eylül 2026') as the section heading; 'Hasılat', 'Mazot', 'Diğer masraf', 'Şoför payı' and 'Hesaplanan kalan' rows, then 'Teslim alınan (onaylı)' with 'Yalnız doğruladığın şoför teslimleri'; 'Henüz doğrulanmayan kayıtlar (<range>)' listing the period's pending driver entries as cards (person, date · time range, expected hand-over, status, 'Kaydı aç' to /sahip/kayitlar/:id) with 'Daha fazla göster', or 'Bu dönemde bekleyen kayıt yok.'; separate loading ('Kayıtlar yükleniyor…', no amount), empty period ('Bu dönemde kayıt yok.'), error ('Rapor yüklenemedi. Tekrar dene.' + 'Tekrar dene') and session-ended ('Giriş sayfasına git') states; a pending-list failure keeps the loaded totals; amounts are re-read on every visit, including a return from the back/forward cache) | /sahip |
| 5 | Sahip — çalışma kaydı (implemented T3.3–T3.4: plate header, '← Özet', 'Kayıt türü' choice 'Kendim çalıştım' / 'Şoför adına' with nothing preselected; owner kind shows 'Çalışan: <owner> · Mal sahibi', 'Şoför payı' 0,00 TL, 'Giderlerden sonra kalan' and 'Kendi çalışmanda şoför payı ayrılmaz.'; driver kind shows the active-driver picker 'Şoförü seç' and 'Şoför payı (%20)' / 'Teslim edilecek tutar'; same date, time and amount fields as the driver form; 'Kaydet' saves the entry (T3.4); owner kind ends with 'Giderlerden sonra kalan' and 'Onay gerekmiyor', driver kind with 'Teslim edilecek tutar' and 'Henüz doğrulanmadı'; the saved result links 'Kaydı aç' to /sahip/kayitlar/:id) | /sahip/kayit/yeni |
| 6 | Sahip — kayıt detayı, teslim onayı ve düzenleme (implemented T3.6 for unconfirmed editing, T4.2 for the first cash confirmation and T4.3 for correct-and-confirm: '← Özet', 'Kayıt detayı', then a summary '<person> · <plate>', '<date> · <time range>', status and amount rows ending with 'Beklenen teslim' (driver kind) or 'Giderlerden sonra kalan' (owner kind), no version line; for a pending driver-kind entry 'Aldığım tutar (TL)' prefilled with the expected amount (not a confirmation), 'Beklenenden <amount> az./fazla.' and 'Parayı aldım, tutar doğru'; after confirmation 'Teslim doğrulandı', 'Alınan tutar' and 'Doğrulama zamanı', plus 'Sahip adına platform desteği · <username>' when staff confirmed it, and no edit form; 'Kaydı düzenle' opens the edit form with 'Değişiklikleri kaydet' for unconfirmed entries; for a confirmed driver-kind entry 'Kaydı düzenle' opens 'Onaylanmış kaydı düzelt' (implemented T4.3): the daily fields with the server's values, a live 'Şoför payı (%20)' and 'Yeni beklenen teslim', 'Aldığım tutar (TL)' prefilled with the confirmed received amount and never shifted to the new expected amount, the difference note, 'Düzelt ve onayla' and 'Vazgeç'; success shows 'Kayıt düzeltildi ve onaylandı.'; a 'Geçmişi gör' link at the bottom of the page, in every state, opens /sahip/kayitlar/:id/gecmis) | /sahip/kayitlar/:id |
| 7 | Sahip — raporlar (vehicle period report implemented: plate header, '← Özet', 'Raporlar' heading; 'Bu hafta' / 'Bu ay' / 'Bu yıl' buttons with 'Bu ay' selected on open; '← Önceki' / 'Sonraki →' move one period using the server's period bounds; the range text (e.g. '1–30 Eylül 2026') as the section heading; 'Hesaplanan kalan' and 'Teslim alınan (onaylı)' each with its explanation; a collapsed 'Hesap dökümünü gör' with gross, fuel, other expense, driver share, total duration, work days and entry count; separate loading ('Rapor yükleniyor…', no amount), empty ('Bu dönemde kayıt yok.'), error ('Rapor yüklenemedi. Tekrar dene.' + 'Tekrar dene') and session-ended ('Giriş sayfasına git') states; below the vehicle totals the note 'Bu tutarlar dönemin tamamındaki araç toplamıdır; günlük kayıt süzgeçlerinden etkilenmez.' and a 'Rapor bölümü' tab list 'Kişiler' (selected on open) / 'Gün gün'; the 'Kişiler' tab lists one card per person: name, 'Mal sahibi' next to the owner, '<duration> · N gün · N çalışma', 'Hasılat … · Pay …' and 'Ayrıntıyı gör'; the person detail shows '← Kişilere dön', the name, the period summary, Hasılat, Mazot, Diğer masraf, Pay and Hesaplanan kalan, then 'Kayıtlar' cards (date, time range, duration, gross and share, remainder, delivery status, 'Kaydı aç' → /sahip/kayitlar/:id) with 'Daha fazla göster'; its own loading ('Kişiler yükleniyor…', 'Kişi ayrıntısı yükleniyor…'), empty ('Bu dönemde kişi kaydı yok.'), error and session-ended states; changing the period closes an open person detail; the 'Gün gün' tab (implemented) shows 'Günlük kayıtları filtrele' with 'Kişi' ('Tüm kişiler' + the people of the same period's person report) and 'Teslim durumu' ('Tüm durumlar' + the three delivery status labels), then one card per entry, newest day first: date, person, time range, 'Hasılat', the expected hand-over ('Teslim edilecek tutar', or 'Giderlerden sonra kalan' with 'Onay gerekmiyor' for an owner entry), 'Teslim alınan' only on a confirmed entry, the delivery status and 'Kaydı aç' → /sahip/kayitlar/:id, with 'Daha fazla göster'; its own loading ('Günlük kayıtlar yükleniyor…'), empty ('Bu dönem ve süzgeçler için kayıt yok.', only after a successful empty response), error and session-ended states; a filter change re-reads only the list, a period change resets the filters and paging, and a failed next page keeps the loaded cards with 'Tekrar dene' on the same cursor; a return from the back/forward cache clears the amounts and re-reads the report) | /sahip/raporlar |
| 8 | Sahip — Şoförlerim (implemented S2.4; a person whose name was anonymised shows the anonymisation note and no 'Düzenle') | /sahip/soforler |
| 9 | Ekip — işletme/araç bulma (implemented: 'Plaka veya işletme ara' + 'Durum' filter mirrored in the URL; empty query lists businesses, a query lists vehicle cards with 'Destek ekranını aç' / 'Araç bilgisi'; '+ İşletme aç' and 'İşlem geçmişi' links; 'Ekip hesapları' link for admins only) | /yonetim |
| 10 | Ekip — işletme oluşturma (implemented) | /yonetim/isletmeler/yeni |
| 11 | Ekip — işletme düzenleme (implemented; lists the business's vehicles with links and '+ Araç ekle'; admin only: 'Adı anonimleştir' in the owner section behind a confirm dialog, an anonymised owner shows the anonymous name and the note instead of the rename form) | /yonetim/isletmeler/:id |
| 12 | Ekip — araç oluşturma / düzenleme, pasife alma ve şifre sıfırlama (implemented; detail page shows the pinned support target header and links to 'Şoförler') | /yonetim/isletmeler/:id/araclar/yeni; /yonetim/araclar/:id |
| 13 | Ekip — araç şoförleri (implemented S2.4; same driver screen as Şoförlerim plus global person deactivation and a password-reset link; pinned support target header; admin only: 'Adı anonimleştir' per row behind a confirm dialog; an anonymised row offers neither rename nor anonymisation) | /yonetim/araclar/:id/soforler |
| 14 | Ekip — müşteriye destek alanı (implemented: pinned support target header + links to '+ Çalışma kaydı gir', 'Özet', 'Raporlar', Şoförler, Araç bilgisi and this vehicle's history; no delivery-confirmation link is offered) | /yonetim/araclar/:id/destek |
| 15 | Ekip — sahip adına çalışma kaydı (implemented T3.3–T3.4: team header, pinned support target header, '← Destek'; 'Sahip çalıştı' / 'Şoför adına' with nothing preselected; driver list read with the X-Target-Vehicle header; inactive vehicle or business → notice and a locked form; 'Kaydet' saves on behalf of the owner with the X-Target-Vehicle header (T3.4); the saved result links 'Kaydı aç' to /yonetim/araclar/:id/kayitlar/:entryId) | /yonetim/araclar/:id/kayit/yeni |
| 16 | Ekip — kayıt detayı, sahip adına teslim onayı ve düzeltme (implemented T3.6 for editing and the staff on-behalf confirmation change: team header, pinned support target header, '← Destek' back link; the 'Güncel kayıt' detail list (with version) and the edit form, sent with X-Target-Vehicle; for a pending driver-kind entry the shared confirmation panel with 'Sahip adına alınan tutar' prefilled with the expected amount and 'Sahip adına teslimi onayla' (no 'Aldığım tutar' / 'Parayı aldım' wording); after confirmation 'Teslim doğrulandı', 'Alınan tutar', 'Doğrulama zamanı' and 'Sahip adına platform desteği · <username>' for a staff confirmation; for a confirmed driver-kind entry 'Kaydı düzenle' opens 'Onaylanmış kaydı düzelt' with 'Sahip adına alınan tutar' and 'Düzelt ve onayla'; confirmation and correction requests carry X-Target-Vehicle; inactive vehicle or business → notice, no editing, the received field and the correction form locked; 'Hedefi değiştir' asks for confirmation when a received amount is typed and clears this vehicle's edit, confirmation and correction drafts; an entry of another vehicle under this URL → 404; a 'Geçmişi gör' link opens /yonetim/araclar/:id/kayitlar/:entryId/gecmis) | /yonetim/araclar/:id/kayitlar/:entryId |
| 17 | Ekip — işlem geçmişi (implemented: read-only list, optional vehicle or business filter with 'Filtreyi kaldır', 'Daha fazla göster'; team-account rows add 'Ekip hesabı: <username>') | /yonetim/islem-gecmisi |
| 18 | Yönetici — ekip hesapları (implemented S2.6: list incl. inactive accounts with '+ Hesap aç'; each card username, full name, role, Aktif/Pasif, 'Düzenle' and 'Şifre sıfırla') | /yonetim/ekip |
| 19 | Yönetici — ekip hesabı açma (implemented S2.6: username, full name, role, initial password) | /yonetim/ekip/yeni |
| 20 | Yönetici — ekip hesabı düzenleme (implemented S2.6: 'Hesap bilgisi' full name + role, 'Aktiflik' deactivate behind a confirm dialog / reactivate, 'Şifre sıfırlama') | /yonetim/ekip/:id |
| 21 | Sahip — kayıt geçmişi (implemented: plate header, '← Kayıt detayı', 'Kayıt geçmişi' heading, the shared read-only history: a 'Güncel kayıt' summary and the 'Değişiklikler' list with 'Kayıt oluşturuldu', 'Kayıt düzenlendi' with before → after lines and one 'Teslim doğrulandı' row per confirmation, the current one marked 'Güncel', a staff confirmation row adding 'Sahip adına platform desteği · <username>'; no edit, delete or total) | /sahip/kayitlar/:id/gecmis |
| 22 | Ekip — kayıt geçmişi (implemented: team header, pinned support target header, '← Kayıt detayı', the same read-only history incl. the staff confirmation trace; inactive vehicle or business → notice, reading still allowed) | /yonetim/araclar/:id/kayitlar/:entryId/gecmis |
| 23 | Ekip — araç özeti, destek modu (implemented S5.5: team header, pinned support target header, '← Destek', 'Özet' heading, the inactive-target notice when the vehicle or business is inactive (reading still allowed); the same owner summary component as /sahip — period select, previous/next, totals, 'Teslim alınan (onaylı)' and the pending list — with every request carrying X-Target-Vehicle, 'Kaydı aç' going to /yonetim/araclar/:id/kayitlar/:entryId and the session-ended link going to /yonetim/giris) | /yonetim/araclar/:id/ozet |
| 24 | Ekip — araç raporları, destek modu (implemented S5.5: team header, pinned support target header, '← Destek', 'Raporlar' heading, the inactive-target notice (reading still allowed); the same vehicle period report as /sahip/raporlar — vehicle totals, 'Kişiler' with person detail and 'Gün gün' with filters — with every request carrying X-Target-Vehicle, every 'Kaydı aç' going to /yonetim/araclar/:id/kayitlar/:entryId and the session-ended link going to /yonetim/giris) | /yonetim/araclar/:id/raporlar |

_URLs are DESIGN §1 proposals; implemented routes verified in src/app. Hiding a button never replaces server authorization. '+ Araç ekle' is shown only for an active business with an owner; the server rejects the other cases with 422 anyway. Vehicle sessions opening either vehicle page are redirected to /sahip or /sofor. The vehicle detail page carries a 'Şifre sıfırlama' section (#sifre-sifirlama, T2.3); it is disabled with an explanatory text when the vehicle or its business is inactive. S2.4: /sahip/soforler (owner session only; staff → /yonetim, driver → /sofor, none → /giris) and /yonetim/araclar/:id/soforler (staff only; vehicle sessions → /sahip or /sofor; unknown vehicle → 404) both render the shared DriversManager component; the staff mode adds the X-Target-Vehicle header, 'Tüm araçlarda pasife al' / 'Kişiyi yeniden aktifleştir' and a 'Şifre sıfırla' link to /yonetim/araclar/:id#sifre-sifirlama. /sahip gained a 'Şoförlerim' link; the vehicle detail page gained a 'Şoförler' link. Admin support/audit change: /yonetim renders AdminSearch (client-side reads of GET /api/v1/admin/businesses|vehicles) instead of the server-rendered business list, plus an 'İşlem geçmişi' link. /yonetim/araclar/:id/destek and /yonetim/islem-gecmisi use the same session checks as the vehicle page (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; unknown vehicle or business → 404); the support target is derived server-side from the vehicle id in the URL. SupportTargetHeader ('Destek: <business>', 'Araç: <plate> · Sahip: <owner>', 'İşlemi yapan: <username> (<role>)', 'Hedefi değiştir') is rendered on /destek, /yonetim/araclar/:id and /yonetim/araclar/:id/soforler inside UnsavedChangesProvider. The history page filter comes only from ?vehicleId= / ?businessId= (the support page links with vehicleId). Team accounts (S2.6): /yonetim/ekip, /yonetim/ekip/yeni and /yonetim/ekip/:id share readTeamPageContext (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; the role is read fresh per request); a support user gets the unauthorized text and no account data is read; an unknown account id → 404. The detail page wraps TeamUserDetailForm in UnsavedChangesProvider. When an admin deactivates their own account or resets their own password the screen sends them to /yonetim/giris?oturum=bitti, where the staff login page shows 'Oturumun sona erdi. Yeniden giriş yap.' above the form. T3.1: /sofor now renders WorkEntryForm below the plate header instead of the placeholder text. The server computes today's Europe/Istanbul date once (istanbulToday) and passes it as a prop; the form reads the selectable drivers from GET /api/v1/drivers, re-reads the list on submit to check the chosen person is still selectable, and writes nothing — the success note states the entry is not saved yet. T3.2: WorkEntryForm adds 'Hasılat (TL)' and 'Mazot (TL)' text inputs (inputMode decimal), a '+ Masraf ekle' toggle opening 'Diğer masraf (TL)' + 'Açıklama' (maxLength 200) with 'Masrafı kaldır' — a filled section asks for confirmation through ConfirmDialog — and a read-only #work-summary status region ('Şoför payın (%20)', 'Teslim edilecek tutar', '—' while any amount is missing or invalid, a warning when the hand-over is negative). The summary is computed in the browser with calculateWorkEntryAmounts('driver', …) for display only; it is never sent and never stored. T3.3: WorkEntryForm moved to src/app/_components/work-entry-form.tsx with a mode prop (driver | owner | staff), ownerName, targetVehicleId and disabled. /sahip gained a '+ Çalışma kaydı gir' link above 'Şoförlerim'. /sahip/kayit/yeni uses the same session checks as /sahip (no session → /giris, staff → /yonetim, driver → /sofor) and reads the owner's name server-side through the session's own scope. /yonetim/araclar/:id/kayit/yeni uses the same session checks as the support page (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; unknown vehicle → 404), derives the target only from the vehicle id in the URL, renders SupportTargetHeader inside UnsavedChangesProvider (so 'Hedefi değiştir' asks for confirmation when the form is dirty) and locks the form with the inactive-target notice when the vehicle or its business is inactive. In owner and staff mode the kind choice is explicit ('Kayıt türünü seç.' when missing), the summary appears only after a kind is chosen, switching kind clears the chosen person, the picker is derived from the management view of GET /api/v1/drivers (active assignment + active person only) and the empty-list text points to 'Şoförlerim' (owner) or 'Şoförler' (staff). The support page now links '+ Çalışma kaydı gir' to /yonetim/araclar/:id/kayit/yeni. T3.4: the three pages pass vehicleId, the session's scopeKey and the CSRF token to WorkEntryForm (/sofor now redirects to /giris when the session carries no vehicle). 'Kaydet' sends POST /api/v1/work-entries with X-CSRF-Token (and X-Target-Vehicle for staff); driver kind re-reads GET /api/v1/drivers once before the first send. Fields + requestId are kept through useStoredDraft under 'kayit-<vehicleId>' (24 h; cleared on logout and, for staff, by 'Hedefi değiştir' because vehicleDraftNames now lists four drafts); the request body is frozen into the draft before the fetch. 'Kaydedildi' appears only after a 201 and clears the draft; a network error, unreadable body, 5xx or malformed 201 keeps the fields locked with 'Kaydın gönderilip gönderilmediği bilinmiyor. Alanlar kilitlendi; tekrar dene, aynı kayıt yalnız bir kez oluşur.' and the button 'Kaydı tekrar dene', which re-sends the frozen body byte for byte with the same requestId, also after a page reload, without re-reading the driver list. On a first attempt every definite error releases the form with a new requestId; after an attempt that may have arrived only 422 and 409 REQUEST_ID_REUSED release it, while 401/403/404 keep the frozen body and requestId. 409 shows 'Bu kayıt başka bir denemeyle çakıştı. Bilgileri kontrol edip yeniden kaydet.'; the server's own error message is never shown. 'Başka bir çalışma kaydı gir' returns to an empty form. T3.6: WorkEntryForm's saved result adds 'Kaydı aç' (workEntryDetailHref: /sofor/kayitlar/:id, /sahip/kayitlar/:id or /yonetim/araclar/:id/kayitlar/:entryId); /sofor adds a 'Kayıtlarım' link below the form. /sofor/kayitlar (driver session only; owner → /sahip, staff → /yonetim, none → /giris) renders DriverEntriesList: the person comes from GET /api/v1/drivers, the entries from GET /api/v1/work-entries?workerPersonId=; each request aborts the previous one so a stale response never overwrites the list; nothing is written to browser storage; a network error or 401/403 never shows the empty text. /sofor/kayitlar/:id, /sahip/kayitlar/:id and /yonetim/araclar/:id/kayitlar/:entryId read the entry server-side with readWorkEntryForScope (unknown, other-vehicle and K1-invisible entries → 404) and render WorkEntryEditForm in driver, owner or staff mode; the staff page uses the same session checks and target derivation as the staff work-entry page, wraps it in UnsavedChangesProvider and disables writing for an inactive vehicle or business. WorkEntryEditForm shows the server's values ('Güncel kayıt': kind, person, day, time, duration, gross, fuel, other expense, share, 'Teslim edilecek tutar' or 'Giderlerden sonra kalan', 'Sürüm N', status 'Henüz doğrulanmadı' / 'Onaylandı' / 'Onay gerekmiyor') and, when canEditEntry allows, 'Kaydı düzenle' with the daily fields; the kind is displayed, never editable; for a driver-kind entry the picker lists selectable drivers plus the entry's current person marked '(pasif)' when no longer selectable. The edit draft 'kayit-duzenle-<vehicleId>-<entryId>' is separate from the create draft and carries its baseVersion; PATCH sends the draft's version, not the freshly read one. A draft whose version differs from the entry (saved from another tab or device) locks the fields and shows the canonical conflict text with 'Güncel değerleri yükle' and 'Benim değerlerimle devam et'; 409 VERSION_CONFLICT / ENTRY_CONFIRMED re-reads the entry and keeps the user's values as the comparison draft; a confirmed entry with unsaved values shows 'Kaydedilmemiş değişikliklerin bu cihazda saklı.' and 'Taslağı sil'. An unknown result locks the fields with 'Değişikliğin gönderilip gönderilmediği bilinmiyor. Alanlar kilitlendi; tekrar dene, aynı değişiklik yalnız bir kez uygulanır.' and 'Değişikliği tekrar dene', which re-sends the frozen body with the same requestId and version; success shows 'Değişiklikler kaydedildi'. clearVehicleDrafts ('Hedefi değiştir') now also removes the vehicle's edit drafts by key prefix. T4.2: /sahip/kayitlar/:id passes the plate to WorkEntryEditForm; in owner mode the form renders OwnerEntrySummary instead of the 'Güncel kayıt' list and WorkEntryConfirmPanel below it, and the edit form stays behind a 'Kaydı düzenle' button until opened (a dirty, pending or stale edit draft keeps it open). Driver and staff modes are unchanged. The panel shows the received field only for a pending driver-kind entry; the prefill follows the server entry until the user types; a negative expected hand-over leaves the field empty with the negative-remainder warning. The confirm draft 'kayit-duzenle-<vehicleId>-<entryId>-onay' starts with the edit-draft prefix, so logout and 'Hedefi değiştir' clear it too. POST /api/v1/work-entries/:id/confirm is sent with X-CSRF-Token and the body { requestId, version, receivedCents } frozen into the draft before the fetch; success is shown only from a 200 carrying status confirmed and a confirmation, and the received amount and time come from the server's confirmation. A network error, unreadable body, 5xx or malformed 200 keeps the button locked with 'Kaydın sonucu kontrol ediliyor.' and 'Sonucu şimdi kontrol et', which re-sends the frozen body with the same requestId, also after a reload. A pending confirmation locks the edit form, and a pending or stale edit draft blocks the confirmation; 409 VERSION_CONFLICT / ENTRY_CONFIRMED re-reads the entry. The server's error message is never shown. T4.3: in owner mode WorkEntryEditForm renders WorkEntryCorrectForm below the confirmation panel for a confirmed entry that carries a confirmation (not when writing is disabled); the edit form's read-only ENTRY_CONFIRMED note is then not shown. Driver and staff modes keep a confirmed entry read-only and show no correction control. The correction form starts closed behind 'Kaydı düzenle'; opening it builds a clean draft from the server entry (correctDraftFromEntry: received text = confirmation.receivedCents, not the remainder). The draft 'kayit-duzenle-<vehicleId>-<entryId>-duzelt' starts with the edit-draft prefix, so logout and 'Hedefi değiştir' clear it too, and carries its baseVersion; a pending draft whose version differs from the entry locks the fields with the canonical conflict text, 'Güncel değerleri yükle' and 'Benim değerlerimle devam et'. 'Düzelt ve onayla' with no change shows the no-change text and sends nothing. POST /api/v1/work-entries/:id/correct-and-confirm is sent with X-CSRF-Token and the body (PATCH body + receivedCents) frozen into the draft before the fetch; success is shown only from a 200 carrying status confirmed and a confirmation of the current version. A network error, unreadable body, 5xx or malformed 200 locks the fields with 'Düzeltmenin gönderilip gönderilmediği bilinmiyor. Alanlar kilitlendi; tekrar dene, aynı düzeltme yalnız bir kez uygulanır.' and the retry re-sends the frozen body with the same requestId, also after a reload; 409 VERSION_CONFLICT / ENTRY_NOT_CONFIRMED re-reads the entry and keeps the user's values. 'Vazgeç' sends nothing and, with unsaved values, asks 'Değişiklikler silinsin mi?' ('Sil ve kapat' / 'Düzeltmeye dön'). The server's error message is never shown. Work-entry history pages: /sahip/kayitlar/:id/gecmis runs the owner detail page's session checks before any read (no session → /giris, staff → /yonetim, driver → /sofor); /yonetim/araclar/:id/kayitlar/:entryId/gecmis runs the staff detail page's checks and target derivation (no session → /yonetim/giris, vehicle sessions → /sahip or /sofor, unknown vehicle → 404) inside UnsavedChangesProvider with SupportTargetHeader and shows the inactive-target notice without blocking the read. Both read server-side with readWorkEntryHistoryForScope (unknown or out-of-scope entry → 404) and render the shared WorkEntryHistory component: the 'Güncel kayıt' summary (#history-current: person, day, time range, duration, gross, fuel, other expense only when used, 'Şoför payı' for driver kind, 'Teslim edilecek tutar' or 'Giderlerden sonra kalan', 'Alınan tutar' of the current confirmation only, status, 'Sürüm N') and the 'Değişiklikler' list (#history-list) built by buildHistoryRows in version order — 'Kayıt oluşturuldu', 'Kayıt düzenlendi' with '<label>: <before> → <after>' lines, and 'Teslim doğrulandı' with 'Alınan tutar: <amount>' and a 'Güncel' badge on the current version's confirmation; each row shows 'Sürüm N · <Istanbul time>', the actor ('<username> · Yönetici|Destek' for staff, 'Sahip oturumu · <plate>' / 'Şoför oturumu · <plate>' for vehicle sessions, never a person name) and, for staff only, 'Sahip adına <name>' / 'Şoför adına <name>'. A plain confirmation revision and a correct-and-confirm revision without other changes appear only as their confirmation row; the received amount is never repeated in change lines; nothing is summed. The owner and staff detail pages gained a 'Geçmişi gör' link; the driver detail page has none. Staff on-behalf confirmation change: WorkEntryEditForm now renders WorkEntryConfirmPanel and WorkEntryCorrectForm in staff mode too (canConfirm = owner or staff), which supersedes the earlier statements that the staff mode has neither; only the driver mode keeps a confirmed entry read-only. In staff mode both components get onBehalf (labels WORK_ENTRY_MESSAGES.receivedLabelOnBehalf 'Sahip adına alınan tutar' and confirmButtonOnBehalf 'Sahip adına teslimi onayla') and targetVehicleId from the URL, so POST /confirm, POST /correct-and-confirm and the correction form's driver-list read carry X-Target-Vehicle next to X-CSRF-Token. The staff page keeps the 'Güncel kayıt' list instead of OwnerEntrySummary. With an inactive target the received field is disabled (blocked) and the correction form stays visible but locked (open button, fields and submit disabled). WorkEntryConfirmPanel registers a typed-but-unsent or pending received amount through useUnsavedChanges, so 'Hedefi değiştir' asks 'Değişiklikleri bırakıp çık?' (the registry is a no-op on owner pages, which have no provider). A confirmed entry whose confirmation.actor is platform_user shows WORK_ENTRY_MESSAGES.supportTrace 'Sahip adına platform desteği · <username>' under 'Doğrulama zamanı' on the owner and staff detail pages; the shared WorkEntryHistory adds the same line to a staff confirmation row (formatHistorySupportTrace), so it appears on both history pages. Driver delivery status (T4.6): a new shared WorkEntryDeliveryStatus renders deliveryStatusView (src/lib/work-entry-ui.ts) — expected label and amount, status text, the driver-only pending hint and, only for status confirmed with a confirmation, 'Alınan tutar' and 'Doğrulama zamanı' (Istanbul time) on separate lines plus the support trace (WORK_ENTRY_MESSAGES.supportTraceAnonymous 'Sahip adına platform desteği' in driver mode, supportTrace with the username otherwise). WorkEntryForm's saved result and WorkEntryEditForm's EntryDetail in driver mode use it (the owner summary and the staff 'Güncel kayıt' list are unchanged); SavedWorkEntry now carries confirmation. DriverEntriesList rows use deliveryStatusLabel ('Teslim doğrulandı' instead of 'Onaylandı'). WorkEntryEditForm in driver mode adds 'Yenile' (refreshDriverStatus: one GET /api/v1/work-entries/:id per press, no automatic retry, a read older than the shown version never replaces it; failure shows 'Güncel kayıt okunamadı. Tekrar dene.' or, on 401, 'Oturumun sona erdi. Yeniden giriş yap.' with a 'Yeniden giriş yap' link). WorkEntryConfirmPanel prints the support trace only when a username is present. Vehicle period report: /sahip gained a 'Raporlar' link (REPORT_MESSAGES.link) after 'Şoförlerim'. /sahip/raporlar uses the same session checks as /sahip (no session → /giris, staff → /yonetim, driver → /sofor) and renders the client component VehiclePeriodReport (src/app/_components/vehicle-period-report.tsx) with helpers in src/lib/report-ui.ts: it reads GET /api/v1/reports/vehicles?period=&date= (date omitted on first open, so the server uses today); the range text and the previous/next anchors come only from the server's startDate/nextStartDate (previous = the day before startDate, next = nextStartDate), the browser does no period arithmetic; every request aborts the previous one so a stale response never overwrites a newer period; the previous period's amounts are never shown under a new heading; a malformed body counts as an error and no partial data is shown; cent totals are parsed as unbounded BigInt (parseApiTotalCents in src/lib/money.ts, no Number()); nothing is written to browser storage; the server's error message is never shown. Texts live in REPORT_MESSAGES (src/lib/messages.ts). The person period report change added src/app/_components/people-period-report.tsx, mounted by vehicle-period-report.tsx only after the vehicle report loads and keyed by (period, startDate) so a period change unmounts it with all its state; the detail is keyed by person id and every request carries its own AbortController, so an older person's or period's response never appears under a new heading; a malformed body counts as an error, the server's error message is never shown and nothing is written to browser storage. Parsing and view models (parsePeoplePeriodReport, parsePersonPeriodReport, peoplePeriodReportView, personDetailView, personEntryView, buildPeoplePeriodReportUrl, buildPersonPeriodReportUrl) live in src/lib/report-ui.ts; texts in REPORT_MESSAGES.people. The tablist holds only the 'Kişiler' tab today. Daily-entries change: VehiclePeriodReport now renders the section tab list itself (people | daily) and mounts PeoplePeriodReport or the new DailyEntriesReport (src/app/_components/daily-entries-report.tsx), each keyed by (period, startDate); the filters live inside DailyEntriesReport, so the vehicle summary is neither re-read nor changed by them; person options come from GET /api/v1/reports/people for the same period; every list request carries its own AbortController and a filter or period change also aborts a pending next page; nothing is written to browser storage. The owner summary change replaced the /sahip placeholder: src/app/sahip/page.tsx renders VehiclePageHeader with the new optional ownerName prop (readVehicleOwnerNameForDisplay), the tab nav and the new client component OwnerSummary (src/app/_components/owner-summary.tsx), which reads GET /api/v1/reports/summary and mounts the pending list keyed by (period, server startDate) reading GET /api/v1/work-entries?period&date&status=pending; each request carries its own AbortController and a period change aborts both; a persisted pageshow re-reads; nothing is kept in module state or browser storage and the server's error.message is never shown; texts live in REPORT_MESSAGES.summary and the view model comes from buildOwnerSummaryUrl, parseOwnerSummary and ownerSummaryView in src/lib/report-ui.ts. Staff summary and reports (S5.5): /yonetim/araclar/:id/ozet and /yonetim/araclar/:id/raporlar run the support page's session checks and target derivation (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; unknown vehicle → 404; the target comes only from the vehicle id in the URL, resolved server-side through getVehicleDetail), render TeamPageHeader and SupportTargetHeader inside UnsavedChangesProvider, and mount OwnerSummary / VehiclePeriodReport keyed by the vehicle id with targetVehicleId, so switching vehicle leaves no amount of the previous one. targetVehicleId flows into PendingEntries, PeoplePeriodReport, PersonDetail and DailyEntriesReport: fetchParsed and fetchReport add the X-Target-Vehicle header, personEntryView / personDetailView / dailyEntryCardView in src/lib/report-ui.ts build workEntryDetailHref('staff', …) links, and reportLoginHref sends a 401 to /yonetim/giris instead of /giris. The support page links SUPPORT_MESSAGES.linkSummary 'Özet' and linkReports 'Raporlar' (its page comment now states summary and reports exist; delivery confirmation still has no link there). VehiclePeriodReport now also re-reads on a persisted pageshow, like OwnerSummary. KVKK anonymisation change: /yonetim/isletmeler/:id and /yonetim/araclar/:id/soforler pass canAnonymize = (session role === 'admin'); business-detail-form.tsx (OwnerRenameSection) and DriversManager (staff mode with businessId) render 'Adı anonimleştir', a ConfirmDialog with PERSON_ANONYMIZE_MESSAGES and a stored draft that freezes requestId, person id and version before the fetch, so an unknown result is retried with the same body after a reload ('Tekrar kontrol et'); buildOpRequest kind 'anonymize' posts to the business-scoped admin endpoint and rowNameActions hides rename and anonymise on anonymised rows. Hiding the control never replaces the server check (person.anonymize)._

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

Çalışılan gün
[ 14.09.2026                      ]
14 Eylül 2026
Kim çalıştı?
[ Ahmet Yılmaz                  v ]
Başlangıç saati
[ 08:00                           ]
Bitiş saati
[ 17:30                           ]
[ ] Bitiş ertesi gün
Süre: 9 saat 30 dakika

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

_Upper part updated to the implemented order and labels per the product owner's correction; the amount section and the Kaydet button are unchanged. WorkEntryForm (src/app/_components/work-entry-form.tsx) renders under the plate header and the 'Günlük kayıt' heading: 'Çalışılan gün' (native date input prefilled with the server-computed Istanbul date, the formatted date shown below it), 'Kim çalıştı?' (select starting at 'Adını seç'), 'Başlangıç saati', 'Bitiş saati' stacked, a 'Bitiş ertesi gün' checkbox with a live 'Bitiş: <date> <time>' line when checked, and 'Süre: …'._

### Şoför günlük kayıt — notes

**Repos:** dolmus-takip

Fields: plate fixed; "Çalışılan gün" defaults to today's Istanbul date (editable, formatted date shown below); "Kim çalıştı?" starts at "Adını seç" and lists only the vehicle's active drivers; no free-text name or ID fields.

Time: "Başlangıç saati" and "Bitiş saati"; duration computed live ("Süre: 9 saat 30 dakika"); overnight work needs the explicit "Bitiş ertesi gün" checkbox, which shows "Bitiş: <date> <time>"; 0 < duration ≤ 24 h (K3). An end before the start without the checkbox → "Bitiş saati başlangıçtan önce. Ertesi gün bitiyorsa “Bitiş ertesi gün” kutusunu işaretle."

Money: gross and fuel required (explicit 0 allowed, empty → "Tutarı gir. Yoksa 0 yaz."); amounts are text fields with Turkish parsing (thousands dot, comma for kuruş, max 2 decimals, too-large amounts refused); summary shows "—" while inputs are invalid; single other expense + optional note (K6), note max 200 characters, a note without an amount is an amount error; removing a filled expense asks "Masraf kaldırılsın mı?"; negative remainder shown with a clear warning (K5).

Driver list states: loading ("Şoförler yükleniyor…"); empty ("Bu araçta seçilebilir şoför yok. Araç sahibinden şoför eklemesini iste.", picker disabled); list error with "Tekrar dene"; person no longer selectable on save → "Bu kişi artık bu araçta seçilemiyor. Liste yenilendi; adını yeniden seç."

Save states: saving ("Kaydediliyor…"); success after commit only; a double tap sends one request. Known not-sent (offline) → nothing sent, every field kept, "Bağlantı yok. Henüz kaydedilmedi." Unknown result → fields locked, "Kaydın sonucu kontrol ediliyor." + "Bağlantı gelince kendiliğinden tekrar kontrol edilir. Aynı kayıt yalnız bir kez oluşur."; the same request is re-checked automatically on page open and when the connection returns, and manually with "Sonucu şimdi kontrol et" (pressed offline → "Bağlantı yok. Sonuç bağlantı gelince kontrol edilecek."). Session ended → "Oturumun sona erdi. Yeniden giriş yap." with a "Yeniden giriş yap" link; the pending entry resolves after logging in to the same vehicle. Conflict with another attempt → "Bu kayıt başka bir denemeyle çakıştı. Bilgileri kontrol edip yeniden kaydet."; validation error under the field.

Draft + request_id persisted in localStorage for 24 h (F6); no offline queue (K7).

_Updated to the implemented texts and states per the product owner's correction. Texts from WORK_ENTRY_MESSAGES and COMMON_SCREEN_MESSAGES in src/lib/messages.ts; time rules in evaluateWorkTime (src/lib/work-time.ts); amount parsing in parseTlAmount (src/lib/money.ts); unknown-result handling in WorkEntryForm (readClientState, canResolveUnknown, 'online' event, synchronous in-flight guard; after an attempt that may have arrived, 401/403/404 keep the form locked and only 422 and 409 REQUEST_ID_REUSED release it with a new requestId). Owner and staff forms use their own empty-list texts pointing to Şoförlerim / Şoförler._

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
Kaydı aç
Başka bir çalışma kaydı gir

--- "Kaydı aç" → entry detail and edit page ---
(driver: /sofor/kayitlar/:id — "Kayıt detayı", current values,
 delivery status with its own "Yenile", "Kaydı düzenle" only for
 today's unconfirmed entry)
```

_Per the product owner's correction the 'Kaydı aç' link is added between 'Yenile' and 'Başka bir çalışma kaydı gir' (workEntryDetailHref in WorkEntryForm), and the entry's own page is accepted as the detail + edit page (WorkEntryEditForm: 'Kayıt detayı', 'Güncel kayıt', 'Sürüm N', 'Kaydı düzenle' only for today's pending entry; delivery status through WorkEntryDeliveryStatus with its own 'Yenile'). The rest of the result matches the approved layout: 'Kaydedildi' (focused after save), '<name> · <plate>', '<date> · <HH:MM–HH:MM>' ('(ertesi gün)' when the end falls on the next Istanbul day), 'Teslim edilecek tutar' (owner kind: 'Giderlerden sonra kalan'), status and the driver-only hint._

### Kayıt sonucu — notes

**Repos:** dolmus-takip

Pending: "Henüz doğrulanmadı". Confirmed: "Teslim doğrulandı" + received amount + confirmation time; short delivery shows expected 6.200 TL and verified 6.000 TL together.

Refresh on open and via "Yenile"; no background polling. New entry link hidden while a result is unknown.

Driver history scope: entries of the selected person on the same vehicle; unconfirmed edits only on the work day (K1). No "Kayıtlarım" privacy promise.

Open code change (recorded 2026-09-25): the driver's entry list is still titled "Kayıtlarım" (link on /sofor, page title and heading) and has no "Yenile" control. It must open under a non-personal name (e.g. "Araçtaki kayıtlar") and gain a "Yenile" button.

_Approved notes kept per the product owner's correction; the code must change to match them. Matches the code: the post-save result and the driver detail page have 'Yenile' (one GET per press, no polling); 'Başka bir çalışma kaydı gir' is hidden while a result is unknown; confirmed entries show 'Teslim doğrulandı' with 'Teslim edilecek tutar' and 'Alınan tutar' on separate lines and 'Doğrulama zamanı' through WorkEntryDeliveryStatus. Open gap: WORK_ENTRY_MESSAGES.listTitle and listLink are 'Kayıtlarım' (src/lib/messages.ts) and the /sofor/kayitlar page title is 'Kayıtlarım — Dolmuş Takip'; DriverEntriesList (src/app/_components/driver-entries-list.tsx) loads on open and on person change and has no 'Yenile' control (DESIGN §2.3: 'Kayıtlarım adıyla bireysel gizlilik güvencesi verilmez.')._

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
--- owner: /sahip/kayitlar/:id (pending) ---
35 ABC 123                    Çıkış
← Özet
Kayıt detayı

Ahmet Yılmaz · 35 ABC 123
14 Eylül 2026 · 08:00–17:30
Henüz doğrulanmadı

Hasılat                 10.000,00 TL
Mazot                    1.500,00 TL
Diğer masraf (Otopark)     300,00 TL
Şoför payı               2.000,00 TL
Beklenen teslim          6.200,00 TL

Aldığım tutar (TL)
[ 6.000,00                          ]
Beklenenden 200,00 TL az.

[ Parayı aldım, tutar doğru          ]
Kaydı düzenle

Geçmişi gör

--- after confirmation ---
Teslim doğrulandı
... amounts as above ...
Alınan tutar             6.000,00 TL
Doğrulama zamanı   14 Eylül 2026 · 18:05
Sahip adına platform desteği · destek.ayse   (only if staff confirmed)
Kaydı düzenle

Geçmişi gör

--- "Kaydı düzenle" on a confirmed entry ---
Onaylanmış kaydı düzelt
Günlük form alanları: düzenlenebilir
Yeni beklenen teslim     6.200,00 TL
Aldığım tutar (TL) [ 6.000,00        ]
[         Düzelt ve onayla           ]
Vazgeç

Geçmişi gör

--- staff: /yonetim/araclar/:id/kayitlar/:entryId ---
destek.ayse · Destek               Çıkış
Destek: Görkem işletmesi
Araç: 35 ABC 123 · Sahip: Görkem
İşlemi yapan: destek.ayse (Destek)
[ Hedefi değiştir ]
← Destek
Kayıt detayı

Güncel kayıt · Sürüm 1
Kayıt türü / Çalışan / Çalışılan gün / Saat /
Süre / Hasılat / Mazot / Diğer masraf /
Şoför payı / Teslim edilecek tutar
Henüz doğrulanmadı

Sahip adına alınan tutar (TL)
[ 6.000,00                          ]
Beklenenden 200,00 TL az.
[ Sahip adına teslimi onayla         ]
  after confirmation:
  Teslim doğrulandı · Alınan tutar · Doğrulama zamanı
  Sahip adına platform desteği · destek.ayse
  Kaydı düzenle → correction form with
  "Sahip adına alınan tutar" and [ Düzelt ve onayla ]

Geçmişi gör

--- "Geçmişi gör": /sahip/kayitlar/:id/gecmis (staff: .../gecmis) ---
35 ABC 123                    Çıkış
← Kayıt detayı
Kayıt geçmişi

Güncel kayıt
Çalışan              Ahmet Yılmaz
Çalışılan gün        14 Eylül 2026
Saat                 08:00–17:30
Hasılat / Mazot / Diğer masraf / Şoför payı
Teslim edilecek tutar    6.200,00 TL
Alınan tutar             6.000,00 TL
Onaylandı
Sürüm 2

Değişiklikler
Kayıt oluşturuldu
Sürüm 1 · 14 Eylül 2026 · 17:40
Şoför oturumu · 35 ABC 123
Teslim doğrulandı          Güncel
Sürüm 1 · 14 Eylül 2026 · 18:05
Sahip adına platform desteği · destek.ayse
destek.ayse · Destek · Sahip adına Görkem
Alınan tutar: 6.000,00 TL
```

_Updated to the implemented owner and staff views per the product owner's correction. Owner page (src/app/sahip/kayitlar/[id]/page.tsx): back link WORK_ENTRY_MESSAGES.backToOwner '← Özet', h1 'Kayıt detayı', OwnerEntrySummary, WorkEntryConfirmPanel, WorkEntryCorrectForm ('Onaylanmış kaydı düzelt', no '<person> · <plate>' line of its own) and WORK_ENTRY_MESSAGES.historyLink 'Geçmişi gör' at the bottom of the page in every state. Staff page (src/app/yonetim/araclar/[id]/kayitlar/[entryId]/page.tsx): pinned SupportTargetHeader, '← Destek', 'Kayıt detayı', the 'Güncel kayıt' list with 'Sürüm N', and the confirm/correct components in on-behalf mode (receivedLabelOnBehalf 'Sahip adına alınan tutar', confirmButtonOnBehalf 'Sahip adına teslimi onayla'); requests carry X-Target-Vehicle and an inactive target locks them. WORK_ENTRY_MESSAGES.supportTrace appears under 'Doğrulama zamanı' for a staff confirmation. History page: WorkEntryHistory (current summary + chronological rows; actor via formatHistoryActor, on-behalf via formatHistoryOnBehalf, trace via formatHistorySupportTrace), read-only with no totals._

### Kayıt detayı ve teslim onayı — notes

**Repos:** dolmus-takip

First confirmation: received field may be prefilled with expected (prefill is not confirmation); received ≥ 0 and explicit.

After confirmation: "Teslim doğrulandı", received amount and time. Staff confirmation on behalf of the owner shows "Sahip adına platform desteği · <username>" (the staff member's platform username) to the owner and staff, and "Sahip adına platform desteği" without the username to the driver. An owner's own confirmation shows no separate actor line on the detail page; the kayıt geçmişi shows it as "Sahip oturumu · <plate>". Driver cannot confirm or edit a confirmed entry.

Correct-and-confirm is one operation; received amount is not auto-synced to new expected; person/date change moves the entry to the new period; driver↔owner kind change closed (K4, 422).

Unconfirmed edit: "Değişiklikleri kaydet" (does not claim cash received).

States: saving, success ("Kayıt düzeltildi ve onaylandı."), conflict 409 ("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et."), validation, unknown result, unauthorized.

_Corrected to the implemented trace per the product owner's correction. WorkEntryConfirmationView (src/server/usecases/work-entries/queries.ts) carries actor { kind platform_user, username } for owner and staff sessions and only { kind } for driver sessions; WorkEntryConfirmPanel prints WORK_ENTRY_MESSAGES.supportTrace only when a username is present, WorkEntryDeliveryStatus prints supportTraceAnonymous for the driver; WorkEntryHistory adds the trace to staff confirmation rows next to '<username> · Yönetici|Destek' and 'Sahip adına <owner name>', and shows an owner confirmation as 'Sahip oturumu · <plate>'. The remaining notes match the code (prefill is not confirmation, received ≥ 0 and explicit, canonical F7 conflict text)._

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
--- owner: /sahip/soforler ---
35 ABC 123                    Çıkış
← Özet
Şoförlerim

[ + Şoför ekle ]
  Ad soyad
  [ Ahmet Yilmaz                    ]
  Benzer adlı kayıtlı kişi var: Ahmet Yılmaz.
  Yeni kişi açmak yerine aşağıdan bağlayabilirsin.
  [ Şoförü kaydet ]
  Kayıtlı kişiyi bağla
  Ahmet Yılmaz            [ Bu araca bağla ]

Aktif şoförler
Ahmet Yılmaz              Aktif
[ Düzenle ] [ Bu araçta pasife al ]
Mehmet Demir              Aktif
[ Düzenle ] [ Bu araçta pasife al ]
Anonim kişi 7F3A          Aktif
Ad, kişisel veri silme talebiyle
anonimleştirildi; değiştirilemez.
[ Bu araçta pasife al ]

[ Pasif şoförleri göster ]
  Pasif şoförler
  Ali Kaya                Pasif
  [ Yeniden aktifleştir ]

--- staff: /yonetim/araclar/:id/soforler ---
dogukan · Yönetici               Çıkış
Destek: Görkem işletmesi
Araç: 35 ABC 123 · Sahip: Görkem
İşlemi yapan: dogukan (Yönetici)
[ Hedefi değiştir ]
← Araç
Şoförler
(same add panel and lists as the owner, plus per row:)
Ahmet Yılmaz              Aktif
[ Düzenle ] [ Bu araçta pasife al ]
[ Şifre sıfırla ]  → vehicle detail #sifre-sifirlama
[ Tüm araçlarda pasife al ]  (dialog lists affected plates)
[ Adı anonimleştir ]  (admin only; irreversible, records kept)
inactive person: [ Kişiyi yeniden aktifleştir ]
```

_Updated to the implemented screens per the product owner's correction. DriversManager (src/app/_components/drivers-manager.tsx) in owner mode: '+ Şoför ekle' toggle with 'Ad soyad' and 'Şoförü kaydet', a similar-name hint and a 'Kayıtlı kişiyi bağla' list with 'Bu araca bağla'; 'Aktif şoförler' rows with 'Düzenle' (rename note) and 'Bu araçta pasife al' (then the F3 shared-password warning); 'Pasif şoförleri göster' with 'Yeniden aktifleştir'. Staff mode on /yonetim/araclar/:id/soforler (reached from the support area and the vehicle detail 'Şoförler' link) adds the pinned SupportTargetHeader, 'Şifre sıfırla' (link to #sifre-sifirlama), 'Tüm araçlarda pasife al' behind a ConfirmDialog listing affected plates, 'Kişiyi yeniden aktifleştir', and — for an admin session only (canAnonymize) — 'Adı anonimleştir' behind a ConfirmDialog (PERSON_ANONYMIZE_MESSAGES). An anonymised row shows PERSON_ANONYMIZE_MESSAGES.anonymizedNote and offers neither 'Düzenle' nor anonymisation on both screens; the owner screen never offers anonymisation. Typed-but-unsent names and open row operations count as unsaved changes for 'Hedefi değiştir'._

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
dogukan · Yönetici               Çıkış
Yönetim                  [ + İşletme aç ]
İşlem geçmişi
Ekip hesapları            (admin only)

Plaka veya işletme ara
[ 35abc                             ]
Durum [ Hepsi v ]   (Hepsi / Aktif / Pasif)
1 sonuç listelendi.

35 ABC 123                        Aktif
Görkem işletmesi · Sahip: Görkem
[ Destek ekranını aç ] [ Araç bilgisi ]
[ Daha fazla göster ]

(empty query → business cards:
 Görkem işletmesi · Sahip: Görkem · 1 araç · Aktif)

--- support area: /yonetim/araclar/:id/destek ---
dogukan · Yönetici               Çıkış
Destek: Görkem işletmesi
Araç: 35 ABC 123 · Sahip: Görkem
İşlemi yapan: dogukan (Yönetici)
[ Hedefi değiştir ]

Destek
+ Çalışma kaydı gir
Özet
Raporlar
Şoförler
Araç bilgisi
Bu aracın işlem geçmişi

(Kayıtlar: added in its own phase)
```

_Updated to the implemented screens per the product owner's correction. /yonetim (src/app/yonetim/page.tsx + admin-search.tsx, ADMIN_SEARCH_MESSAGES): team header '<username> · <role>', h1 'Yönetim', '+ İşletme aç', 'İşlem geçmişi', 'Ekip hesapları' (admin only), 'Plaka veya işletme ara' and 'Durum' (Hepsi / Aktif / Pasif); no '+ Araç ekle' here (vehicles are added from /yonetim/isletmeler/:id). An empty query lists business cards (name, 'Sahip: …' or 'Sahipsiz', vehicle count, Aktif/Pasif); a query lists vehicle cards (plate, business, owner, Aktif/Pasif, 'İşletme pasif' when relevant) with 'Destek ekranını aç' and 'Araç bilgisi'; loading, 'Sonuç yok.', 'Henüz işletme yok.', error with 'Tekrar dene' and 'Daha fazla göster' are separate states. /yonetim/araclar/:id/destek: SupportTargetHeader (SUPPORT_MESSAGES) with 'Hedefi değiştir', h1 'Destek', an inactive-target notice and six links; the header is also shown on the vehicle detail, drivers, work-entry, entry detail, summary and reports pages. The approved 'Kayıtlar' element is not offered yet and will be added in its own phase (no screen offers a feature that does not exist)._

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
[ Adı anonimleştir ]      (admin only)
[ İşletmeyi pasife al ]  (confirm dialog)

--- "Adı anonimleştir" dialog ---
Kişinin adını anonimleştir
Görkem Kaya adı kalıcı olarak "Anonim kişi …"
biçiminde değişir. Bu işlem geri alınamaz ve
ad bir daha değiştirilemez.
Çalışma ve para kayıtları, raporlar ve işlem
geçmişi silinmez.
[ Vazgeç ]                [ Anonimleştir ]

--- anonymised owner ---
Mal sahibi
Anonim kişi 7F3A
Ad, kişisel veri silme talebiyle
anonimleştirildi; değiştirilemez.
```

_Per the product owner's correction the anonymisation button, its dialog and the anonymised-owner state are added to the approved drawing; the rest is unchanged. /yonetim/isletmeler/:id (business-detail-form.tsx, OwnerRenameSection) shows, for admins only (canAnonymize from the session role), 'Adı anonimleştir' under the owner rename form and a ConfirmDialog with PERSON_ANONYMIZE_MESSAGES (title, irreversible description, records-kept line, 'Anonimleştir'); an unknown result shows 'Kaydın sonucu kontrol ediliyor.' with 'Tekrar kontrol et'. An anonymised owner is shown read-only under 'Mal sahibi' with the anonymous name and PERSON_ANONYMIZE_MESSAGES.anonymizedNote instead of the rename form. Owner persons are excluded from the driver screens, so this is the only place an owner's name can be anonymised._

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
dogukan · Yönetici               Çıkış
Araç ekle
Görkem işletmesi · Sahip: Görkem

Plaka
[ 35 ABC 123                        ]
Marka / model        Yıl
[ Ford Transit ]     [ 2019 ]
Hat / durak notu
[                                   ]
Not
[                                   ]
Sahip şifresi
[ ••••••••                  Göster  ]
Şoför şifresi
[ ••••••••                  Göster  ]

[             Aracı kaydet          ]

--- edit: /yonetim/araclar/:id ---
dogukan · Yönetici               Çıkış
Destek: Görkem işletmesi
Araç: 35 ABC 123 · Sahip: Görkem
İşlemi yapan: dogukan (Yönetici)
[ Hedefi değiştir ]

35 ABC 123                        Aktif
Görkem işletmesi · Sahip: Görkem
Şoförler

Araç bilgisi
Marka / model [ Ford Transit ]  Yıl [ 2019 ]
Hat / durak notu [                  ]
Not              [                  ]
[           Bilgiyi kaydet          ]

Aktiflik
Aracı pasifleştirmek sahip ve şoför oturum
erişimini keser. Geçmiş kayıtlar silinmez.
[ Aracı pasifleştir ]      (confirm dialog)

Şifre sıfırlama
Görkem işletmesi · 35 ABC 123
( ) Mal sahibi şifresi   ( ) Şoför şifresi
Yeni şifre
[ ••••••••                  Göster  ]
Yalnız seçtiğin erişimin açık oturumları
kapatılır; diğer erişim etkilenmez.
[          Şifreyi sıfırla          ]
```

_Updated to the implemented screens per the product owner's correction (Seçenek 2): the short password labels and the optional 'Not' field (vehicles.note; 'Not' is among the vehicle details in PRD §6) are accepted. Create: new-vehicle-form.tsx ('Araç ekle', '<business> · Sahip: <owner>', Plaka, Marka / model, Yıl, Hat / durak notu, Not, 'Sahip şifresi' / 'Şoför şifresi' with Göster/Gizle, 'Aracı kaydet'; unknown result with 'Tekrar kontrol et'). Edit: /yonetim/araclar/:id renders the pinned SupportTargetHeader above vehicle-detail-form.tsx (plate + Aktif/Pasif, business/owner line, 'Şoförler' link to /yonetim/araclar/:id/soforler, 'Araç bilgisi' with 'Bilgiyi kaydet', plate not editable, 'Aktiflik' with 'Aracı pasifleştir' / 'Aracı yeniden aktifleştir' behind a confirm dialog) and password-reset-section.tsx ('Şifre sıfırlama', radio 'Mal sahibi şifresi' / 'Şoför şifresi', 'Yeni şifre', 'Şifreyi sıfırla', success text naming plate + access and the WhatsApp hand-over; inactive target → 'Araç veya işletme pasif; şifre sıfırlanamaz.'). The info section and a typed-but-unsent new password count as unsaved changes, so 'Hedefi değiştir' asks 'Değişiklikleri bırakıp çık?'._

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
dogukan · Yönetici               Çıkış
← Yönetim
Ekip hesapları           [ + Hesap aç ]

destek.ayse
Ayşe Kaya · Destek · Aktif
[ Düzenle ] [ Şifre sıfırla ]

--- /yonetim/ekip/yeni ---
← Ekip hesapları
Ekip hesabı aç
Kullanıcı adı, ad soyad, yetki ve ilk şifreyi
gir. Şifreyi kişiye kendin ilet; uygulama
mesaj göndermez.
Kullanıcı adı
[ destek.ayse                       ]
3–32 karakter; harf, rakam, nokta, alt çizgi ve tire.
Ad soyad
[ Ayşe Kaya                         ]
Yetki   ( ) Yönetici   (•) Destek
Şifre
[ ••••••••                  Göster  ]
[             Hesabı aç             ]

--- /yonetim/ekip/:id ---
← Ekip hesapları
destek.ayse                       Aktif
Hesap bilgisi
Ad soyad [ Ayşe Kaya                ]
Yetki    ( ) Yönetici   (•) Destek
[          Bilgiyi kaydet           ]
Aktiflik
[ Hesabı pasifleştir ]     (confirm dialog)
Şifre sıfırlama
Yeni şifre [ ••••••••        Göster ]
[          Şifreyi sıfırla          ]

--- /yonetim/islem-gecmisi ---
dogukan · Yönetici               Çıkış
← Yönetim
İşlem geçmişi
Filtre: 35 ABC 123 · Görkem işletmesi
Filtreyi kaldır      (only via "Bu aracın işlem geçmişi")

21 Eyl 2026 14:05 · Görkem işletmesi · 35 ABC 123
İşletme bilgisi değişti
İşlemi yapan: dogukan (Yönetici)
Ekip hesabı: destek.ayse   (team-account rows)
Önce: Görkem Dolmuş  Sonra: Görkem işletmesi
[ Daha fazla göster ]
```

_Updated to the implemented screens per the correction marked Seçenek 1 on this card; the free-text explanation attached to it repeated the Manual Test Checklist answer, so Seçenek 1 of this card's own options (update the wireframe to the implemented screens) was applied. /yonetim/ekip (TEAM_USER_MESSAGES): '← Yönetim', 'Ekip hesapları', '+ Hesap aç', cards with username, '<full name or Ad soyad yok> · <role> · Aktif/Pasif', 'Düzenle' and 'Şifre sıfırla' (→ /yonetim/ekip/:id#sifre-sifirlama), 'Henüz ekip hesabı yok.' when empty. /yonetim/ekip/yeni (NewTeamUserForm) and /yonetim/ekip/:id (TeamUserDetailForm: conflict banner with 'Güncel halini aç', self-deactivation and self-reset warnings, success text naming the account and the manual hand-over; a self-deactivation or self-reset lands on /yonetim/giris?oturum=bitti showing 'Oturumun sona erdi. Yeniden giriş yap.'). /yonetim/islem-gecmisi (audit-history.tsx, AUDIT_MESSAGES): no free-text filter; ?vehicleId= or ?businessId= shows 'Filtre: …' with 'Filtreyi kaldır'; each entry shows '<Istanbul time> · <business> · <plate>', the action label, 'İşlemi yapan: <username> (<role>)' (owner-made driver actions show the vehicle access + plate), 'Ekip hesabı: <username>' on team-account rows, 'Sahip adına: <name>' for on-behalf actions, 'Önce/Sonra' rows or 'Önceki değer yok (yeni kayıt).'; 20 per page with 'Daha fazla göster'; loading, empty and error with 'Tekrar dene' are separate._

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
