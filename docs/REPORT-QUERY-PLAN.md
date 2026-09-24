# Rapor sorgu planı ve ölçüm raporu

`npm run perf:reports` tarafından üretilir (S5.5, F12). Elle düzenlenmez; komut yeniden koşulunca üzerine yazılır. Süreler makineye bağlıdır; planlar ve satır sayıları sabit fixture'dan gelir.

## Ortam

- Node v24.21.0, SQLite 3.53.4, linux x64, 4 çekirdek
- Her ölçüm: 2 ısınma + 15 koşu; tablo medyan ve en yüksek değeri gösterir (ms)
- Fixture sonrası `ANALYZE` çalıştırılır (üretimdeki `PRAGMA optimize` benzeri istatistik durumu).

## Veri hacmi

| Kalem | Değer |
| --- | ---: |
| Dönem | 2021-10-01 … 2026-09-30 (1826 gün, 5 yıl) |
| İşletme | 2 |
| Araç | 40 |
| Kişi (sahip + şoför) | 162 |
| work_entries | 105960 |
| work_entry_revisions | 116920 |
| cash_confirmations | 76720 |
| Düzeltilmiş (sürüm 2) kayıt | 10960 |
| Fixture kurulum süresi | 2.78 sn |

Ölçümler ilk araçta (bir araç ≈ 5 yıllık kayıtları) ve onun şoförlerinde koşar; diğer araçların kayıtları kapsam süzgecinin dışarıda bırakması gereken gürültüdür.

## Zamanlamalar

| Sorgu | Dönem | Medyan (ms) | En yüksek (ms) |
| --- | --- | ---: | ---: |
| Sahip özeti (yıl 2026) | 2026-01-01 … 2027-01-01 | 0.94 | 1.41 |
| Kişi toplamları (yıl 2026) | 2026-01-01 … 2027-01-01 | 0.80 | 1.09 |
| Kişi detayı (yıl 2026) | 2026-01-01 … 2027-01-01 | 0.84 | 1.33 |
| Doğrulanmamış kayıt listesi, status=pending (yıl 2026) | 2026-01-01 … 2027-01-01 | 1.17 | 2.50 |
| Sahip özeti (en eski tam yıl 2022) | 2022-01-01 … 2023-01-01 | 0.88 | 1.15 |
| Kişi toplamları (en eski tam yıl 2022) | 2022-01-01 … 2023-01-01 | 0.87 | 1.19 |
| Kişi detayı (en eski tam yıl 2022) | 2022-01-01 … 2023-01-01 | 0.72 | 1.07 |
| Doğrulanmamış kayıt listesi, status=pending (en eski tam yıl 2022) | 2022-01-01 … 2023-01-01 | 0.85 | 1.13 |
| Gün gün liste, tüm durumlar (ay 2026-09) | 2026-09-01 … 2026-10-01 | 0.83 | 1.13 |
| Araç dönem raporu (yıl 2026) | 2026-01-01 … 2027-01-01 | 0.59 | 1.06 |

## Sorgu planları (EXPLAIN QUERY PLAN)

Plan, use case'in çalıştırdığı Drizzle kurucusunun `.toSQL()` çıktısından alınır. `SCAN work_entries` (kısıtsız) satırı olmamalıdır; entegrasyon testi (`report-query-plan.test.ts`) bunu küçük veriyle de kilitler.

### Sahip özeti (yıl 2026)

readOwnerSummaryForScope — başlık + toplamlar tek okuma işleminde

**toplamlar**

```
USE TEMP B-TREE FOR count(DISTINCT)
SEARCH work_entries USING INDEX idx_work_entries_vehicle_period (business_id=? AND vehicle_id=? AND work_date>? AND work_date<?)
SEARCH cash_confirmations USING INDEX cash_confirmations_business_entry_version_uk (business_id=? AND entry_id=? AND entry_version=?) LEFT-JOIN
```


### Kişi toplamları (yıl 2026)

readPeoplePeriodReportForScope — kişi başına tek GROUP BY

**kişi toplamları**

```
SEARCH work_entries USING INDEX idx_work_entries_vehicle_period (business_id=? AND vehicle_id=? AND work_date>? AND work_date<?)
SEARCH people USING INDEX people_business_id_id_uk (business_id=? AND id=?)
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR count(DISTINCT)
USE TEMP B-TREE FOR ORDER BY
```


### Kişi detayı (yıl 2026)

readPersonPeriodReportForScope — kişi toplamı + ilk 50 kayıt tek okuma işleminde

**kişi toplamı**

```
SEARCH people USING INDEX people_business_id_id_uk (business_id=? AND id=?)
SEARCH work_entries USING INDEX idx_work_entries_person_period (business_id=? AND person_id=? AND work_date>? AND work_date<?)
USE TEMP B-TREE FOR count(DISTINCT)
```


**kayıt sayfası**

```
SEARCH work_entries USING INDEX idx_work_entries_person_period (business_id=? AND person_id=? AND work_date>? AND work_date<?)
```


### Doğrulanmamış kayıt listesi, status=pending (yıl 2026)

listWorkEntriesForScope — durum süzgeçli, en yeni gün önce, ilk 50

**liste**

```
SEARCH work_entries USING INDEX idx_work_entries_vehicle_status_period (business_id=? AND vehicle_id=? AND status=? AND work_date>? AND work_date<?)
SEARCH people USING INDEX people_business_id_id_uk (business_id=? AND id=?)
SEARCH cash_confirmations USING INDEX cash_confirmations_business_entry_version_uk (business_id=? AND entry_id=? AND entry_version=?) LEFT-JOIN
SEARCH platform_users USING INDEX sqlite_autoindex_platform_users_1 (id=?) LEFT-JOIN
```


### Sahip özeti (en eski tam yıl 2022)

readOwnerSummaryForScope — başlık + toplamlar tek okuma işleminde

**toplamlar**

```
USE TEMP B-TREE FOR count(DISTINCT)
SEARCH work_entries USING INDEX idx_work_entries_vehicle_period (business_id=? AND vehicle_id=? AND work_date>? AND work_date<?)
SEARCH cash_confirmations USING INDEX cash_confirmations_business_entry_version_uk (business_id=? AND entry_id=? AND entry_version=?) LEFT-JOIN
```


### Kişi toplamları (en eski tam yıl 2022)

readPeoplePeriodReportForScope — kişi başına tek GROUP BY

**kişi toplamları**

```
SEARCH work_entries USING INDEX idx_work_entries_vehicle_period (business_id=? AND vehicle_id=? AND work_date>? AND work_date<?)
SEARCH people USING INDEX people_business_id_id_uk (business_id=? AND id=?)
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR count(DISTINCT)
USE TEMP B-TREE FOR ORDER BY
```


### Kişi detayı (en eski tam yıl 2022)

readPersonPeriodReportForScope — kişi toplamı + ilk 50 kayıt tek okuma işleminde

**kişi toplamı**

```
SEARCH people USING INDEX people_business_id_id_uk (business_id=? AND id=?)
SEARCH work_entries USING INDEX idx_work_entries_person_period (business_id=? AND person_id=? AND work_date>? AND work_date<?)
USE TEMP B-TREE FOR count(DISTINCT)
```


**kayıt sayfası**

```
SEARCH work_entries USING INDEX idx_work_entries_person_period (business_id=? AND person_id=? AND work_date>? AND work_date<?)
```


### Doğrulanmamış kayıt listesi, status=pending (en eski tam yıl 2022)

listWorkEntriesForScope — durum süzgeçli, en yeni gün önce, ilk 50

**liste**

```
SEARCH work_entries USING INDEX idx_work_entries_vehicle_status_period (business_id=? AND vehicle_id=? AND status=? AND work_date>? AND work_date<?)
SEARCH people USING INDEX people_business_id_id_uk (business_id=? AND id=?)
SEARCH cash_confirmations USING INDEX cash_confirmations_business_entry_version_uk (business_id=? AND entry_id=? AND entry_version=?) LEFT-JOIN
SEARCH platform_users USING INDEX sqlite_autoindex_platform_users_1 (id=?) LEFT-JOIN
```


### Gün gün liste, tüm durumlar (ay 2026-09)

listWorkEntriesForScope — süzgeçsiz aylık liste

**liste**

```
SEARCH work_entries USING INDEX idx_work_entries_vehicle_period (business_id=? AND vehicle_id=? AND work_date>? AND work_date<?)
SEARCH people USING INDEX people_business_id_id_uk (business_id=? AND id=?)
SEARCH cash_confirmations USING INDEX cash_confirmations_business_entry_version_uk (business_id=? AND entry_id=? AND entry_version=?) LEFT-JOIN
SEARCH platform_users USING INDEX sqlite_autoindex_platform_users_1 (id=?) LEFT-JOIN
```


### Araç dönem raporu (yıl 2026)

readVehiclePeriodReportForScope — tek SELECT

**toplamlar**

```
USE TEMP B-TREE FOR count(DISTINCT)
SEARCH work_entries USING INDEX idx_work_entries_vehicle_period (business_id=? AND vehicle_id=? AND work_date>? AND work_date<?)
SEARCH cash_confirmations USING INDEX cash_confirmations_business_entry_version_uk (business_id=? AND entry_id=? AND entry_version=?) LEFT-JOIN
```


## Sonuç: indeks / sorgu kararı

Ölçülen her sorgu `idx_work_entries_*` indekslerinden birini kısıtlı `SEARCH` ile kullanır, hiçbirinde `work_entries` tam taraması yoktur ve en yavaş tek koşu 2.50 ms'dir. Darboğaz bulunmadığından indeks eklenmedi ve sorgu yeniden yazılmadı (mimari kural: EXPLAIN kanıtı olmadan indeks eklenmez). Kalan `USE TEMP B-TREE` satırları dönem içindeki tek aracın satırları üzerindedir (`COUNT(DISTINCT work_date)`, kişi `GROUP BY` ve `ORDER BY`); tam tablo değildir.

## F12 — ağır rapor + eşzamanlı health (aynı süreç)

Gerçek `GET /api/v1/health/live` route'u süreç içi HTTP sunucusundan sunulur; 6 sn boyunca en eski yılın ağır rapor sorguları art arda koşarken health her ~5 ms'de bir istenir. better-sqlite3 senkron olduğundan health gecikmesi en uzun tek rapor sorgusuna eşit veya biraz üstündedir.

| Ölçüt | Değer |
| --- | ---: |
| Rapor sorgusu koşusu | 6324 |
| En uzun tek rapor sorgusu (ms) | 2.76 |
| Health isteği (yük altında) | 839 |
| Health p50 (ms) | 2.10 |
| Health p95 (ms) | 2.99 |
| Health en yüksek (ms) | 7.89 |
| Health en yüksek, rapor yokken (ms) | 1.95 |
| Health timeout (OPS) | 3000 ms |

Sonuç: en yüksek health gecikmesi 7.89 ms, 3000 ms timeout'unun altında.
