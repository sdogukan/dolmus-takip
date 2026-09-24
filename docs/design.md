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
| 1 | Şoför — günlük kayıt formu (implemented T3.1–T3.4, shared WorkEntryForm in driver mode: fixed plate, date, person picker, start/end time with a 'Bitiş ertesi gün' box and live duration, gross and fuel, one optional other expense + note, live read-only share and hand-over summary, 'Kaydet' saves the entry (T3.4) and replaces the form with 'Kaydedildi', '<name> · <date> · <duration>', 'Teslim edilecek tutar' and 'Henüz doğrulanmadı'; an unknown result locks the fields with 'Kaydı tekrar dene'; the saved result links 'Kaydı aç' to /sofor/kayitlar/:id; a 'Kayıtlarım' link sits below the form; after 'Yenile' a confirmed entry shows 'Teslim doğrulandı' with 'Alınan tutar' and 'Doğrulama zamanı' on separate lines, apart from 'Teslim edilecek tutar' — T4.6) | /sofor |
| 2 | Şoför — Kayıtlarım (implemented T3.6: 'Kimin kayıtları?' picker of selectable drivers, then that person's visible entries newest day first with day, time, duration, hand-over and status ('Henüz doğrulanmadı' / 'Teslim doğrulandı' / 'Onay gerekmiyor'), 'Aç' and 'Daha fazla göster'; loading, error and empty states kept apart) | /sofor/kayitlar |
| 3 | Şoför — kayıt detayı ve düzenleme (implemented T3.6: 'Kayıt detayı' with the server's current values, version and status; the edit form opens only for a pending entry of today, otherwise read-only with the edit-window note; a driver-kind entry may switch to another selectable driver; the kind is shown, never editable; delivery status implemented T4.6: 'Teslim edilecek tutar' and the status once, the pending hint 'Mal sahibi parayı aldığında burada görebileceksin.', for a confirmed entry 'Alınan tutar' and 'Doğrulama zamanı' on separate lines and, after a staff confirmation, 'Sahip adına platform desteği' without a username; a 'Yenile' button re-reads the entry (no polling; on failure the last known state stays, after a 401 'Yeniden giriş yap'); no confirm, correct or history control) | /sofor/kayitlar/:id |
| 4 | Sahip — özet (placeholder implemented with '+ Çalışma kaydı gir' and 'Şoförlerim' links; content M5) | /sahip |
| 5 | Sahip — çalışma kaydı (implemented T3.3–T3.4: plate header, '← Özet', 'Kayıt türü' choice 'Kendim çalıştım' / 'Şoför adına' with nothing preselected; owner kind shows 'Çalışan: <owner> · Mal sahibi', 'Şoför payı' 0,00 TL, 'Giderlerden sonra kalan' and 'Kendi çalışmanda şoför payı ayrılmaz.'; driver kind shows the active-driver picker 'Şoförü seç' and 'Şoför payı (%20)' / 'Teslim edilecek tutar'; same date, time and amount fields as the driver form; 'Kaydet' saves the entry (T3.4); owner kind ends with 'Giderlerden sonra kalan' and 'Onay gerekmiyor', driver kind with 'Teslim edilecek tutar' and 'Henüz doğrulanmadı'; the saved result links 'Kaydı aç' to /sahip/kayitlar/:id) | /sahip/kayit/yeni |
| 6 | Sahip — kayıt detayı, teslim onayı ve düzenleme (implemented T3.6 for unconfirmed editing, T4.2 for the first cash confirmation and T4.3 for correct-and-confirm: '← Özet', 'Kayıt detayı', then a summary '<person> · <plate>', '<date> · <time range>', status and amount rows ending with 'Beklenen teslim' (driver kind) or 'Giderlerden sonra kalan' (owner kind), no version line; for a pending driver-kind entry 'Aldığım tutar (TL)' prefilled with the expected amount (not a confirmation), 'Beklenenden <amount> az./fazla.' and 'Parayı aldım, tutar doğru'; after confirmation 'Teslim doğrulandı', 'Alınan tutar' and 'Doğrulama zamanı', plus 'Sahip adına platform desteği · <username>' when staff confirmed it, and no edit form; 'Kaydı düzenle' opens the edit form with 'Değişiklikleri kaydet' for unconfirmed entries; for a confirmed driver-kind entry 'Kaydı düzenle' opens 'Onaylanmış kaydı düzelt' (implemented T4.3): the daily fields with the server's values, a live 'Şoför payı (%20)' and 'Yeni beklenen teslim', 'Aldığım tutar (TL)' prefilled with the confirmed received amount and never shifted to the new expected amount, the difference note, 'Düzelt ve onayla' and 'Vazgeç'; success shows 'Kayıt düzeltildi ve onaylandı.'; a 'Geçmişi gör' link at the bottom of the page, in every state, opens /sahip/kayitlar/:id/gecmis) | /sahip/kayitlar/:id |
| 7 | Sahip — raporlar (planned) | /sahip/raporlar |
| 8 | Sahip — Şoförlerim (implemented S2.4) | /sahip/soforler |
| 9 | Ekip — işletme/araç bulma (implemented: 'Plaka veya işletme ara' + 'Durum' filter mirrored in the URL; empty query lists businesses, a query lists vehicle cards with 'Destek ekranını aç' / 'Araç bilgisi'; '+ İşletme aç' and 'İşlem geçmişi' links; 'Ekip hesapları' link for admins only) | /yonetim |
| 10 | Ekip — işletme oluşturma (implemented) | /yonetim/isletmeler/yeni |
| 11 | Ekip — işletme düzenleme (implemented; lists the business's vehicles with links and '+ Araç ekle') | /yonetim/isletmeler/:id |
| 12 | Ekip — araç oluşturma / düzenleme, pasife alma ve şifre sıfırlama (implemented; detail page shows the pinned support target header and links to 'Şoförler') | /yonetim/isletmeler/:id/araclar/yeni; /yonetim/araclar/:id |
| 13 | Ekip — araç şoförleri (implemented S2.4; same driver screen as Şoförlerim plus global person deactivation and a password-reset link; pinned support target header) | /yonetim/araclar/:id/soforler |
| 14 | Ekip — müşteriye destek alanı (implemented: pinned support target header + links to '+ Çalışma kaydı gir', Şoförler, Araç bilgisi and this vehicle's history; confirmation and report links not offered until they exist) | /yonetim/araclar/:id/destek |
| 15 | Ekip — sahip adına çalışma kaydı (implemented T3.3–T3.4: team header, pinned support target header, '← Destek'; 'Sahip çalıştı' / 'Şoför adına' with nothing preselected; driver list read with the X-Target-Vehicle header; inactive vehicle or business → notice and a locked form; 'Kaydet' saves on behalf of the owner with the X-Target-Vehicle header (T3.4); the saved result links 'Kaydı aç' to /yonetim/araclar/:id/kayitlar/:entryId) | /yonetim/araclar/:id/kayit/yeni |
| 16 | Ekip — kayıt detayı, sahip adına teslim onayı ve düzeltme (implemented T3.6 for editing and the staff on-behalf confirmation change: team header, pinned support target header, '← Destek' back link; the 'Güncel kayıt' detail list (with version) and the edit form, sent with X-Target-Vehicle; for a pending driver-kind entry the shared confirmation panel with 'Sahip adına alınan tutar' prefilled with the expected amount and 'Sahip adına teslimi onayla' (no 'Aldığım tutar' / 'Parayı aldım' wording); after confirmation 'Teslim doğrulandı', 'Alınan tutar', 'Doğrulama zamanı' and 'Sahip adına platform desteği · <username>' for a staff confirmation; for a confirmed driver-kind entry 'Kaydı düzenle' opens 'Onaylanmış kaydı düzelt' with 'Sahip adına alınan tutar' and 'Düzelt ve onayla'; confirmation and correction requests carry X-Target-Vehicle; inactive vehicle or business → notice, no editing, the received field and the correction form locked; 'Hedefi değiştir' asks for confirmation when a received amount is typed and clears this vehicle's edit, confirmation and correction drafts; an entry of another vehicle under this URL → 404; a 'Geçmişi gör' link opens /yonetim/araclar/:id/kayitlar/:entryId/gecmis) | /yonetim/araclar/:id/kayitlar/:entryId |
| 17 | Ekip — işlem geçmişi (implemented: read-only list, optional vehicle or business filter with 'Filtreyi kaldır', 'Daha fazla göster'; team-account rows add 'Ekip hesabı: <username>') | /yonetim/islem-gecmisi |
| 18 | Yönetici — ekip hesapları (implemented S2.6: list incl. inactive accounts with '+ Hesap aç'; each card username, full name, role, Aktif/Pasif, 'Düzenle' and 'Şifre sıfırla') | /yonetim/ekip |
| 19 | Yönetici — ekip hesabı açma (implemented S2.6: username, full name, role, initial password) | /yonetim/ekip/yeni |
| 20 | Yönetici — ekip hesabı düzenleme (implemented S2.6: 'Hesap bilgisi' full name + role, 'Aktiflik' deactivate behind a confirm dialog / reactivate, 'Şifre sıfırlama') | /yonetim/ekip/:id |
| 21 | Sahip — kayıt geçmişi (implemented: plate header, '← Kayıt detayı', 'Kayıt geçmişi' heading, the shared read-only history: a 'Güncel kayıt' summary and the 'Değişiklikler' list with 'Kayıt oluşturuldu', 'Kayıt düzenlendi' with before → after lines and one 'Teslim doğrulandı' row per confirmation, the current one marked 'Güncel', a staff confirmation row adding 'Sahip adına platform desteği · <username>'; no edit, delete or total) | /sahip/kayitlar/:id/gecmis |
| 22 | Ekip — kayıt geçmişi (implemented: team header, pinned support target header, '← Kayıt detayı', the same read-only history incl. the staff confirmation trace; inactive vehicle or business → notice, reading still allowed) | /yonetim/araclar/:id/kayitlar/:entryId/gecmis |

_URLs are DESIGN §1 proposals; implemented routes verified in src/app. Hiding a button never replaces server authorization. '+ Araç ekle' is shown only for an active business with an owner; the server rejects the other cases with 422 anyway. Vehicle sessions opening either vehicle page are redirected to /sahip or /sofor. The vehicle detail page carries a 'Şifre sıfırlama' section (#sifre-sifirlama, T2.3); it is disabled with an explanatory text when the vehicle or its business is inactive. S2.4: /sahip/soforler (owner session only; staff → /yonetim, driver → /sofor, none → /giris) and /yonetim/araclar/:id/soforler (staff only; vehicle sessions → /sahip or /sofor; unknown vehicle → 404) both render the shared DriversManager component; the staff mode adds the X-Target-Vehicle header, 'Tüm araçlarda pasife al' / 'Kişiyi yeniden aktifleştir' and a 'Şifre sıfırla' link to /yonetim/araclar/:id#sifre-sifirlama. /sahip gained a 'Şoförlerim' link; the vehicle detail page gained a 'Şoförler' link. Admin support/audit change: /yonetim renders AdminSearch (client-side reads of GET /api/v1/admin/businesses|vehicles) instead of the server-rendered business list, plus an 'İşlem geçmişi' link. /yonetim/araclar/:id/destek and /yonetim/islem-gecmisi use the same session checks as the vehicle page (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; unknown vehicle or business → 404); the support target is derived server-side from the vehicle id in the URL. SupportTargetHeader ('Destek: <business>', 'Araç: <plate> · Sahip: <owner>', 'İşlemi yapan: <username> (<role>)', 'Hedefi değiştir') is rendered on /destek, /yonetim/araclar/:id and /yonetim/araclar/:id/soforler inside UnsavedChangesProvider. The history page filter comes only from ?vehicleId= / ?businessId= (the support page links with vehicleId). Team accounts (S2.6): /yonetim/ekip, /yonetim/ekip/yeni and /yonetim/ekip/:id share readTeamPageContext (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; the role is read fresh per request); a support user gets the unauthorized text and no account data is read; an unknown account id → 404. The detail page wraps TeamUserDetailForm in UnsavedChangesProvider. When an admin deactivates their own account or resets their own password the screen sends them to /yonetim/giris?oturum=bitti, where the staff login page shows 'Oturumun sona erdi. Yeniden giriş yap.' above the form. T3.1: /sofor now renders WorkEntryForm below the plate header instead of the placeholder text. The server computes today's Europe/Istanbul date once (istanbulToday) and passes it as a prop; the form reads the selectable drivers from GET /api/v1/drivers, re-reads the list on submit to check the chosen person is still selectable, and writes nothing — the success note states the entry is not saved yet. T3.2: WorkEntryForm adds 'Hasılat (TL)' and 'Mazot (TL)' text inputs (inputMode decimal), a '+ Masraf ekle' toggle opening 'Diğer masraf (TL)' + 'Açıklama' (maxLength 200) with 'Masrafı kaldır' — a filled section asks for confirmation through ConfirmDialog — and a read-only #work-summary status region ('Şoför payın (%20)', 'Teslim edilecek tutar', '—' while any amount is missing or invalid, a warning when the hand-over is negative). The summary is computed in the browser with calculateWorkEntryAmounts('driver', …) for display only; it is never sent and never stored. T3.3: WorkEntryForm moved to src/app/_components/work-entry-form.tsx with a mode prop (driver | owner | staff), ownerName, targetVehicleId and disabled. /sahip gained a '+ Çalışma kaydı gir' link above 'Şoförlerim'. /sahip/kayit/yeni uses the same session checks as /sahip (no session → /giris, staff → /yonetim, driver → /sofor) and reads the owner's name server-side through the session's own scope. /yonetim/araclar/:id/kayit/yeni uses the same session checks as the support page (no session → /yonetim/giris; vehicle sessions → /sahip or /sofor; unknown vehicle → 404), derives the target only from the vehicle id in the URL, renders SupportTargetHeader inside UnsavedChangesProvider (so 'Hedefi değiştir' asks for confirmation when the form is dirty) and locks the form with the inactive-target notice when the vehicle or its business is inactive. In owner and staff mode the kind choice is explicit ('Kayıt türünü seç.' when missing), the summary appears only after a kind is chosen, switching kind clears the chosen person, the picker is derived from the management view of GET /api/v1/drivers (active assignment + active person only) and the empty-list text points to 'Şoförlerim' (owner) or 'Şoförler' (staff). The support page now links '+ Çalışma kaydı gir' to /yonetim/araclar/:id/kayit/yeni. T3.4: the three pages pass vehicleId, the session's scopeKey and the CSRF token to WorkEntryForm (/sofor now redirects to /giris when the session carries no vehicle). 'Kaydet' sends POST /api/v1/work-entries with X-CSRF-Token (and X-Target-Vehicle for staff); driver kind re-reads GET /api/v1/drivers once before the first send. Fields + requestId are kept through useStoredDraft under 'kayit-<vehicleId>' (24 h; cleared on logout and, for staff, by 'Hedefi değiştir' because vehicleDraftNames now lists four drafts); the request body is frozen into the draft before the fetch. 'Kaydedildi' appears only after a 201 and clears the draft; a network error, unreadable body, 5xx or malformed 201 keeps the fields locked with 'Kaydın gönderilip gönderilmediği bilinmiyor. Alanlar kilitlendi; tekrar dene, aynı kayıt yalnız bir kez oluşur.' and the button 'Kaydı tekrar dene', which re-sends the frozen body byte for byte with the same requestId, also after a page reload, without re-reading the driver list. On a first attempt every definite error releases the form with a new requestId; after an attempt that may have arrived only 422 and 409 REQUEST_ID_REUSED release it, while 401/403/404 keep the frozen body and requestId. 409 shows 'Bu kayıt başka bir denemeyle çakıştı. Bilgileri kontrol edip yeniden kaydet.'; the server's own error message is never shown. 'Başka bir çalışma kaydı gir' returns to an empty form. T3.6: WorkEntryForm's saved result adds 'Kaydı aç' (workEntryDetailHref: /sofor/kayitlar/:id, /sahip/kayitlar/:id or /yonetim/araclar/:id/kayitlar/:entryId); /sofor adds a 'Kayıtlarım' link below the form. /sofor/kayitlar (driver session only; owner → /sahip, staff → /yonetim, none → /giris) renders DriverEntriesList: the person comes from GET /api/v1/drivers, the entries from GET /api/v1/work-entries?workerPersonId=; each request aborts the previous one so a stale response never overwrites the list; nothing is written to browser storage; a network error or 401/403 never shows the empty text. /sofor/kayitlar/:id, /sahip/kayitlar/:id and /yonetim/araclar/:id/kayitlar/:entryId read the entry server-side with readWorkEntryForScope (unknown, other-vehicle and K1-invisible entries → 404) and render WorkEntryEditForm in driver, owner or staff mode; the staff page uses the same session checks and target derivation as the staff work-entry page, wraps it in UnsavedChangesProvider and disables writing for an inactive vehicle or business. WorkEntryEditForm shows the server's values ('Güncel kayıt': kind, person, day, time, duration, gross, fuel, other expense, share, 'Teslim edilecek tutar' or 'Giderlerden sonra kalan', 'Sürüm N', status 'Henüz doğrulanmadı' / 'Onaylandı' / 'Onay gerekmiyor') and, when canEditEntry allows, 'Kaydı düzenle' with the daily fields; the kind is displayed, never editable; for a driver-kind entry the picker lists selectable drivers plus the entry's current person marked '(pasif)' when no longer selectable. The edit draft 'kayit-duzenle-<vehicleId>-<entryId>' is separate from the create draft and carries its baseVersion; PATCH sends the draft's version, not the freshly read one. A draft whose version differs from the entry (saved from another tab or device) locks the fields and shows the canonical conflict text with 'Güncel değerleri yükle' and 'Benim değerlerimle devam et'; 409 VERSION_CONFLICT / ENTRY_CONFIRMED re-reads the entry and keeps the user's values as the comparison draft; a confirmed entry with unsaved values shows 'Kaydedilmemiş değişikliklerin bu cihazda saklı.' and 'Taslağı sil'. An unknown result locks the fields with 'Değişikliğin gönderilip gönderilmediği bilinmiyor. Alanlar kilitlendi; tekrar dene, aynı değişiklik yalnız bir kez uygulanır.' and 'Değişikliği tekrar dene', which re-sends the frozen body with the same requestId and version; success shows 'Değişiklikler kaydedildi'. clearVehicleDrafts ('Hedefi değiştir') now also removes the vehicle's edit drafts by key prefix. T4.2: /sahip/kayitlar/:id passes the plate to WorkEntryEditForm; in owner mode the form renders OwnerEntrySummary instead of the 'Güncel kayıt' list and WorkEntryConfirmPanel below it, and the edit form stays behind a 'Kaydı düzenle' button until opened (a dirty, pending or stale edit draft keeps it open). Driver and staff modes are unchanged. The panel shows the received field only for a pending driver-kind entry; the prefill follows the server entry until the user types; a negative expected hand-over leaves the field empty with the negative-remainder warning. The confirm draft 'kayit-duzenle-<vehicleId>-<entryId>-onay' starts with the edit-draft prefix, so logout and 'Hedefi değiştir' clear it too. POST /api/v1/work-entries/:id/confirm is sent with X-CSRF-Token and the body { requestId, version, receivedCents } frozen into the draft before the fetch; success is shown only from a 200 carrying status confirmed and a confirmation, and the received amount and time come from the server's confirmation. A network error, unreadable body, 5xx or malformed 200 keeps the button locked with 'Kaydın sonucu kontrol ediliyor.' and 'Sonucu şimdi kontrol et', which re-sends the frozen body with the same requestId, also after a reload. A pending confirmation locks the edit form, and a pending or stale edit draft blocks the confirmation; 409 VERSION_CONFLICT / ENTRY_CONFIRMED re-reads the entry. The server's error message is never shown. T4.3: in owner mode WorkEntryEditForm renders WorkEntryCorrectForm below the confirmation panel for a confirmed entry that carries a confirmation (not when writing is disabled); the edit form's read-only ENTRY_CONFIRMED note is then not shown. Driver and staff modes keep a confirmed entry read-only and show no correction control. The correction form starts closed behind 'Kaydı düzenle'; opening it builds a clean draft from the server entry (correctDraftFromEntry: received text = confirmation.receivedCents, not the remainder). The draft 'kayit-duzenle-<vehicleId>-<entryId>-duzelt' starts with the edit-draft prefix, so logout and 'Hedefi değiştir' clear it too, and carries its baseVersion; a pending draft whose version differs from the entry locks the fields with the canonical conflict text, 'Güncel değerleri yükle' and 'Benim değerlerimle devam et'. 'Düzelt ve onayla' with no change shows the no-change text and sends nothing. POST /api/v1/work-entries/:id/correct-and-confirm is sent with X-CSRF-Token and the body (PATCH body + receivedCents) frozen into the draft before the fetch; success is shown only from a 200 carrying status confirmed and a confirmation of the current version. A network error, unreadable body, 5xx or malformed 200 locks the fields with 'Düzeltmenin gönderilip gönderilmediği bilinmiyor. Alanlar kilitlendi; tekrar dene, aynı düzeltme yalnız bir kez uygulanır.' and the retry re-sends the frozen body with the same requestId, also after a reload; 409 VERSION_CONFLICT / ENTRY_NOT_CONFIRMED re-reads the entry and keeps the user's values. 'Vazgeç' sends nothing and, with unsaved values, asks 'Değişiklikler silinsin mi?' ('Sil ve kapat' / 'Düzeltmeye dön'). The server's error message is never shown. Work-entry history pages: /sahip/kayitlar/:id/gecmis runs the owner detail page's session checks before any read (no session → /giris, staff → /yonetim, driver → /sofor); /yonetim/araclar/:id/kayitlar/:entryId/gecmis runs the staff detail page's checks and target derivation (no session → /yonetim/giris, vehicle sessions → /sahip or /sofor, unknown vehicle → 404) inside UnsavedChangesProvider with SupportTargetHeader and shows the inactive-target notice without blocking the read. Both read server-side with readWorkEntryHistoryForScope (unknown or out-of-scope entry → 404) and render the shared WorkEntryHistory component: the 'Güncel kayıt' summary (#history-current: person, day, time range, duration, gross, fuel, other expense only when used, 'Şoför payı' for driver kind, 'Teslim edilecek tutar' or 'Giderlerden sonra kalan', 'Alınan tutar' of the current confirmation only, status, 'Sürüm N') and the 'Değişiklikler' list (#history-list) built by buildHistoryRows in version order — 'Kayıt oluşturuldu', 'Kayıt düzenlendi' with '<label>: <before> → <after>' lines, and 'Teslim doğrulandı' with 'Alınan tutar: <amount>' and a 'Güncel' badge on the current version's confirmation; each row shows 'Sürüm N · <Istanbul time>', the actor ('<username> · Yönetici|Destek' for staff, 'Sahip oturumu · <plate>' / 'Şoför oturumu · <plate>' for vehicle sessions, never a person name) and, for staff only, 'Sahip adına <name>' / 'Şoför adına <name>'. A plain confirmation revision and a correct-and-confirm revision without other changes appear only as their confirmation row; the received amount is never repeated in change lines; nothing is summed. The owner and staff detail pages gained a 'Geçmişi gör' link; the driver detail page has none. Staff on-behalf confirmation change: WorkEntryEditForm now renders WorkEntryConfirmPanel and WorkEntryCorrectForm in staff mode too (canConfirm = owner or staff), which supersedes the earlier statements that the staff mode has neither; only the driver mode keeps a confirmed entry read-only. In staff mode both components get onBehalf (labels WORK_ENTRY_MESSAGES.receivedLabelOnBehalf 'Sahip adına alınan tutar' and confirmButtonOnBehalf 'Sahip adına teslimi onayla') and targetVehicleId from the URL, so POST /confirm, POST /correct-and-confirm and the correction form's driver-list read carry X-Target-Vehicle next to X-CSRF-Token. The staff page keeps the 'Güncel kayıt' list instead of OwnerEntrySummary. With an inactive target the received field is disabled (blocked) and the correction form stays visible but locked (open button, fields and submit disabled). WorkEntryConfirmPanel registers a typed-but-unsent or pending received amount through useUnsavedChanges, so 'Hedefi değiştir' asks 'Değişiklikleri bırakıp çık?' (the registry is a no-op on owner pages, which have no provider). A confirmed entry whose confirmation.actor is platform_user shows WORK_ENTRY_MESSAGES.supportTrace 'Sahip adına platform desteği · <username>' under 'Doğrulama zamanı' on the owner and staff detail pages; the shared WorkEntryHistory adds the same line to a staff confirmation row (formatHistorySupportTrace), so it appears on both history pages. Driver delivery status (T4.6): a new shared WorkEntryDeliveryStatus renders deliveryStatusView (src/lib/work-entry-ui.ts) — expected label and amount, status text, the driver-only pending hint and, only for status confirmed with a confirmation, 'Alınan tutar' and 'Doğrulama zamanı' (Istanbul time) on separate lines plus the support trace (WORK_ENTRY_MESSAGES.supportTraceAnonymous 'Sahip adına platform desteği' in driver mode, supportTrace with the username otherwise). WorkEntryForm's saved result and WorkEntryEditForm's EntryDetail in driver mode use it (the owner summary and the staff 'Güncel kayıt' list are unchanged); SavedWorkEntry now carries confirmation. DriverEntriesList rows use deliveryStatusLabel ('Teslim doğrulandı' instead of 'Onaylandı'). WorkEntryEditForm in driver mode adds 'Yenile' (refreshDriverStatus: one GET /api/v1/work-entries/:id per press, no automatic retry, a read older than the shown version never replaces it; failure shows 'Güncel kayıt okunamadı. Tekrar dene.' or, on 401, 'Oturumun sona erdi. Yeniden giriş yap.' with a 'Yeniden giriş yap' link). WorkEntryConfirmPanel prints the support trace only when a username is present._

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

_Conflict between the approved wireframe (value kept unchanged) and the code written for T3.1, still open after T3.4. T3.4 (this task) renamed the single button from 'Kontrol et' to 'Kaydet' (WORK_ENTRY_MESSAGES.submit; 'Kaydediliyor…' while sending) and made it save, so the button now matches the approved wireframe. The amount section (T3.2) already matches the approved order and labels. Remaining T3.1 differences: the approved layout orders 'Adın' (person) before 'Çalışma tarihi' (date) and shows no overnight control. WorkEntryForm renders, under the plate header and 'Günlük kayıt' heading: 'Çalışılan gün' (native date input prefilled with the server-computed Istanbul date, the formatted date '14 Eylül 2026' shown below it), 'Kim çalıştı?' (select starting at 'Adını seç'), 'Başlangıç saati', 'Bitiş saati' with a 'Bitiş ertesi gün' checkbox, live 'Bitiş: <date> <time>' when overnight and 'Süre: 9 saat 30 dakika'. Start and end times are stacked, not side by side. Update the upper part of the wireframe to the implemented order and labels, or keep it and change the code later?_

### Şoför günlük kayıt — notes

**Repos:** dolmus-takip

Fields: plate fixed; date defaults to today (editable); name starts as "Adını seç" from active drivers of the vehicle; no free-text name or ID fields.
Time: labelled start/end pickers, duration auto-computed; overnight shows explicit end date ("Ertesi gün bitti"), 0 < duration ≤ 24 h (K3).
Money: gross and fuel required (explicit 0 allowed); decimal keyboard; summary shows "—" while inputs invalid; single other expense + optional note (K6); negative remainder shown with a clear warning (K5).
States: empty driver list ("Bu araç için şoför eklenmemiş. Mal sahibinden adını eklemesini iste."); saving ("Kaydediliyor…"); success after commit only; unknown result ("Kaydın sonucu kontrol ediliyor." — same request re-checked, form frozen); known not-sent ("Bağlantı yok. Henüz kaydedilmedi."); validation error under field; session expired.
Draft + request_id persisted in localStorage for 24 h (F6); no offline queue (K7).

_Conflict between the approved notes (value kept unchanged) and the code written for T3.1–T3.4 and this task (S3.6, labelled T3.7 in code comments and tests). Closed by this task: (a) Unknown result — WorkEntryForm now shows WORK_ENTRY_MESSAGES.checking (= COMMON_SCREEN_MESSAGES.checkingResultAfterDisconnect 'Kaydın sonucu kontrol ediliyor.') with the fields locked and re-sends the frozen body with the same requestId automatically once on page open (readClientState + canResolveUnknown) and on the browser 'online' event, as the approved notes require; the old unknownResult text and the 'Kaydı tekrar dene' button are gone. (b) Known not-sent — with navigator.onLine === false 'Kaydet' sends nothing, freezes nothing, keeps every field and shows connectionFailed 'Bağlantı yok. Henüz kaydedilmedi.'. Not in the approved notes: the manual button checkNow 'Sonucu şimdi kontrol et' ('Kontrol ediliyor…' while checking) with checkHint 'Bağlantı gelince kendiliğinden tekrar kontrol edilir. Aynı kayıt yalnız bir kez oluşur.'; stillOffline 'Bağlantı yok. Sonuç bağlantı gelince kontrol edilecek.' when that button is pressed offline (never 'Henüz kaydedilmedi', since the request may already have arrived); a 401 shows COMMON_SCREEN_MESSAGES.sessionEnded plus a 'Yeniden giriş yap' link to a fixed internal path (workEntryLoginHref: /giris, staff /yonetim/giris) and the pending draft resolves after logging in to the same vehicle; a synchronous in-flight guard turns a double tap into one POST; a draft is cleared or released only while it still belongs to the resolved requestId (draftAfterCreated / draftAfterRelease, stale-tab protection); 409 → 'Bu kayıt başka bir denemeyle çakıştı. Bilgileri kontrol edip yeniden kaydet.'; after an attempt that may have arrived, 401/403/404 keep the form locked and only 422 and 409 REQUEST_ID_REUSED release it with a new requestId. Earlier differences still open: (1) empty driver list text — approved 'Bu araç için şoför eklenmemiş. Mal sahibinden adını eklemesini iste.', code WORK_ENTRY_MESSAGES.personEmpty 'Bu araçta seçilebilir şoför yok. Araç sahibinden şoför eklemesini iste.'; (2) overnight — approved 'Ertesi gün bitti' end date, code an explicit 'Bitiş ertesi gün' checkbox with 'Bitiş: <date> <time>' (evaluateWorkTime in src/lib/work-time.ts); (3) list loading, list error with 'Tekrar dene' and 'Bu kişi artık bu araçta seçilemiyor. Liste yenilendi; adını yeniden seç.' states; (4) T3.2 additions — removing a filled expense asks 'Masraf kaldırılsın mı?', a note with an empty amount is an amount error, the note is limited to 200 characters, Turkish amount parsing rules and too-large texts (parseTlAmount in src/lib/money.ts). Update the notes to the implemented texts and states, or keep them and change the code later?_

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

_Conflict between the approved wireframe (value kept unchanged) and the code. This task (S3.6, T3.7 in code) rebuilt the post-save result in WorkEntryForm to the approved layout: 'Kaydedildi' (focused after save), savedWho '<name> · <plate>' (new plate prop passed by /sofor, /sahip/kayit/yeni and /yonetim/araclar/:id/kayit/yeni), savedWhen '<date> · <HH:MM–HH:MM>' (formatWorkTimeRange, '(ertesi gün)' when the end falls on the next Istanbul day), 'Teslim edilecek tutar' (owner kind: 'Giderlerden sonra kalan'), 'Henüz doğrulanmadı' / 'Teslim doğrulandı' / 'Onay gerekmiyor' (since the driver delivery-status change T4.6 through the shared WorkEntryDeliveryStatus, which for a confirmed entry read by 'Yenile' also shows 'Alınan tutar' and 'Doğrulama zamanı' on separate lines), the resultHint 'Mal sahibi parayı aldığında burada görebileceksin.' (driver mode, pending only), a 'Yenile' button that re-reads GET /api/v1/work-entries/:id ('Güncel kayıt okunuyor…'; on failure 'Güncel kayıt okunamadı. Tekrar dene.', never claiming deletion) and 'Başka bir çalışma kaydı gir'. Remaining differences: (1) a 'Kaydı aç' link (workEntryDetailHref, added by the previous task) sits between 'Yenile' and 'Başka bir çalışma kaydı gir' and is not in the wireframe; (2) /sofor/kayitlar/:id — the planned result/delivery page — is implemented as a detail + edit page (WorkEntryEditForm: 'Kayıt detayı', 'Güncel kayıt', 'Sürüm N', 'Kaydı düzenle' only for today's pending entry; since T4.6 it also shows the delivery status with the same component and its own 'Yenile' button). Add the link and accept the detail page, or keep the wireframe and change the code later?_

### Kayıt sonucu — notes

**Repos:** dolmus-takip

Pending: "Henüz doğrulanmadı". Confirmed: "Teslim doğrulandı" + received amount + confirmation time; short delivery shows expected 6.200 TL and verified 6.000 TL together.
Refresh on open and via "Yenile"; no background polling. New entry link hidden while a result is unknown.
Driver history scope: entries of the selected person on the same vehicle; unconfirmed edits only on the work day (K1). No "Kayıtlarım" privacy promise.

_Conflict between the approved notes (value kept unchanged) and the code. Consistent since S3.6 (T3.7 in code): the post-save result in WorkEntryForm has a 'Yenile' button that re-reads the entry through GET /api/v1/work-entries/:id, with no background polling; while a result is unknown the form stays in place, so 'Başka bir çalışma kaydı gir' is not shown (asserted in driver-daily-form.spec.ts and owner-staff-work-entry.spec.ts); pending shows 'Henüz doğrulanmadı'; no 'teslim ettim' action is offered. Consistent since the driver delivery-status change (T4.6): the shared WorkEntryDeliveryStatus (deliveryStatusView in src/lib/work-entry-ui.ts) on the post-save result and on the driver's /sofor/kayitlar/:id shows a confirmed entry as WORK_ENTRY_MESSAGES.deliveryConfirmed 'Teslim doğrulandı' with 'Teslim edilecek tutar' and 'Alınan tutar' on separate lines (a short delivery shows 6.200,00 TL expected and 6.000,00 TL received together, asserted in driver-daily-form.spec.ts and work-entry-edit.spec.ts) and 'Doğrulama zamanı'; DriverEntriesList rows use deliveryStatusLabel ('Teslim doğrulandı'); the driver detail page gained a 'Yenile' button (one GET per press, no automatic retry, the last known state kept on failure). Still open: (1) naming — approved 'No "Kayıtlarım" privacy promise' (DESIGN §2.3: 'Kayıtlarım adıyla bireysel gizlilik güvencesi verilmez.'), code WORK_ENTRY_MESSAGES.listTitle and listLink 'Kayıtlarım' and the /sofor/kayitlar page title 'Kayıtlarım — Dolmuş Takip', followed by the 'Kimin kayıtları?' person picker; (2) 'Yenile' on the driver list — DriverEntriesList loads on open and on person change and has no 'Yenile' control. Rename the list and add 'Yenile' to it, or accept the implemented name and drop the rule from the notes?_

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

_Conflict between the approved wireframe (value kept unchanged) and the code written for T4.1/T4.2, T4.3, the work-entry history change and this task (staff on-behalf confirmation). This task: the staff detail page /yonetim/araclar/:id/kayitlar/:entryId now renders WorkEntryConfirmPanel and WorkEntryCorrectForm in staff mode (onBehalf: WORK_ENTRY_MESSAGES.receivedLabelOnBehalf 'Sahip adına alınan tutar', confirmButtonOnBehalf 'Sahip adına teslimi onayla', the correction form with the same received label and 'Düzelt ve onayla') below the T3.6 'Güncel kayıt' list with 'Sürüm N' (not OwnerEntrySummary); requests carry X-Target-Vehicle and an inactive target locks them. A staff confirmation shows WORK_ENTRY_MESSAGES.supportTrace 'Sahip adına platform desteği · <username>' under 'Doğrulama zamanı' on the owner and staff detail pages. The approved wireframe draws only the owner view and has no staff variant, on-behalf labels or trace line. Earlier differences remain: 'Geçmişi gör' (WORK_ENTRY_MESSAGES.historyLink) sits at the bottom of the detail page in every state instead of next to 'Vazgeç' and opens /sahip/kayitlar/:id/gecmis (or the staff equivalent), which has no approved wireframe; the correction form 'Onaylanmış kaydı düzelt' has no '<person> · <plate>' line of its own; the back link is WORK_ENTRY_MESSAGES.backToOwner '← Özet' instead of '< Özete dön' and the page has an h1 'Kayıt detayı'. Update the wireframe to the implemented owner and staff views and add a history-page wireframe, or keep it and change the code?_

### Kayıt detayı ve teslim onayı — notes

**Repos:** dolmus-takip

First confirmation: received field may be prefilled with expected (prefill is not confirmation); received ≥ 0 and explicit.
After confirmation: "Teslim doğrulandı", received amount, time and actor (staff shown as "Sahip adına platform desteği · <ad>"). Driver cannot edit.
Correct-and-confirm is one operation; received amount is not auto-synced to new expected; person/date change moves the entry to the new period; driver↔owner kind change closed (K4, 422).
Unconfirmed edit: "Değişiklikleri kaydet" (does not claim cash received).
States: saving, success ("Kayıt düzeltildi ve onaylandı."), conflict 409 ("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et."), validation, unknown result, unauthorized.

_Conflict between the approved notes (value kept unchanged) and the code written for T4.1/T4.2, the work-entry history change and this task (staff on-behalf confirmation). Approved: 'After confirmation: "Teslim doğrulandı", received amount, time and actor (staff shown as "Sahip adına platform desteği · <ad>")'. Now: WorkEntryConfirmationView in src/server/usecases/work-entries/queries.ts carries actor { kind vehicle_credential } | { kind platform_user, username } for owner and staff sessions and only { kind } (no username key) for driver sessions; WorkEntryConfirmPanel shows 'Teslim doğrulandı', 'Alınan tutar', 'Doğrulama zamanı' and, only when actor.kind is platform_user, WORK_ENTRY_MESSAGES.supportTrace 'Sahip adına platform desteği · <username>' on /sahip/kayitlar/:id and /yonetim/araclar/:id/kayitlar/:entryId; WorkEntryHistory adds the same line to staff confirmation rows (formatHistorySupportTrace) next to formatHistoryActor '<username> · Yönetici|Destek' and 'Sahip adına <owner name>'. Remaining differences: the trace uses the platform username, not the staff member's name (<ad>); an owner confirmation shows no actor line on the detail page (only 'Sahip oturumu · <plate>' in the history). The other approved notes match the code: the prefill is not a confirmation; received ≥ 0 and explicit; the driver cannot confirm or edit a confirmed entry; the 409 conflict text is the canonical F7 text. The driver delivery-status change (T4.6) shows the confirmation on the driver's /sofor/kayitlar/:id through WorkEntryDeliveryStatus: 'Teslim doğrulandı', 'Alınan tutar', 'Doğrulama zamanı' and, only for a platform_user actor, WORK_ENTRY_MESSAGES.supportTraceAnonymous 'Sahip adına platform desteği' without a username (asserted in work-entry-edit.spec.ts); an owner confirmation shows no actor line to the driver either, and WorkEntryConfirmPanel now prints the trace only when a username is present. The approved notes do not state what the driver sees about the confirmer. Correct the notes to the implemented trace, or keep them and change the code?_

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

_Conflict between the approved wireframe (value kept unchanged) and the code written for this and earlier tasks. This task (T3.3) added the '+ Çalışma kaydı gir' link on /yonetim/araclar/:id/destek, pointing to /yonetim/araclar/:id/kayit/yeni (WorkEntryForm in staff mode: 'Sahip çalıştı' / 'Şoför adına', the support target header pinned, no saving yet), so that element of the approved wireframe now exists. Remaining differences: /yonetim (page.tsx + admin-search.tsx) shows the team header, '+ İşletme aç', an 'İşlem geçmişi' link, the 'Plaka veya işletme ara' input and a 'Durum' select (Hepsi / Aktif / Pasif); there is no '+ Araç ekle' on this screen (vehicles are added from /yonetim/isletmeler/:id). An empty query lists business cards (name, 'Sahip: …' or 'Sahipsiz', vehicle count, Aktif/Pasif); a query lists vehicle cards (plate, business, owner, Aktif/Pasif, 'İşletme pasif' when relevant) with 'Destek ekranını aç' and 'Araç bilgisi'; loading, 'Sonuç yok.', 'Henüz işletme yok.', error with 'Tekrar dene' and 'Daha fazla göster' are separate states. /yonetim/araclar/:id/destek renders SupportTargetHeader ('Destek: <business>', 'Araç: <plate> · Sahip: <owner>', 'İşlemi yapan: <username> (<role>)', 'Hedefi değiştir'), h1 'Destek', an inactive-target notice, and four links ('+ Çalışma kaydı gir', Şoförler, Araç bilgisi, 'Bu aracın işlem geçmişi'); the approved tabs Özet / Kayıtlar / Raporlar are still not offered because those features do not exist yet (M1 honesty rule in the page comment). The same header is shown on /yonetim/araclar/:id, /yonetim/araclar/:id/soforler and /yonetim/araclar/:id/kayit/yeni. 'Yönetim ana ekranı ve destek alanı — notes' matches the code and is not in question. Update the wireframe to the implemented screens, or keep it and change the code later?_

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
