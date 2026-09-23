"use client";

/**
 * Şoförün kayıt listesi (K1): şoför oturumu kimliğini taşımaz; önce KİŞİ seçilir
 * (`GET /api/v1/drivers` seçilebilir şoförler), sonra `GET /api/v1/work-entries?
 * workerPersonId=` o kişinin GÖRÜNÜR kayıtlarını (yalnız şoför türü, kişisi hâlâ
 * seçilebilir) en yeni gün önce döndürür. İstemcideki liste yetki VERMEZ; hiçbir
 * şey tarayıcı depolamasına yazılmaz. Her istek bir sıra numarası taşır ve
 * öncekini keser; eski yanıt yeni listeyi EZEMEZ. Yükleniyor / hata / boş
 * durumları AYRIDIR: ağ hatası veya 401/403 "kayıt yok" metnini ASLA göstermez.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { adminReadErrorMessage } from "../../lib/admin-search";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../lib/messages";
import { formatTlAmount, parseApiCents } from "../../lib/money";
import {
  buildWorkEntriesUrl,
  parseWorkEntryList,
  type SelectableDriver,
  type WorkEntryDetail,
} from "../../lib/work-entry-ui";
import { formatDuration, formatWorkDate, istanbulWallClock } from "../../lib/work-time";
import { controlClass, errorTextClass, fetchDrivers, labelClass, secondaryButtonClass } from "./work-entry-form";

type DriversState =
  | { status: "loading" }
  | { status: "loaded"; drivers: SelectableDriver[] }
  | { status: "error"; message: string };

type EntriesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; entries: WorkEntryDetail[]; nextCursor: string | null; loadingMore: boolean }
  | { status: "error"; message: string };

type EntriesResult =
  | { ok: true; entries: WorkEntryDetail[]; nextCursor: string | null }
  | { ok: false; message: string };

async function fetchEntries(personId: string, cursor: string | undefined, signal: AbortSignal): Promise<EntriesResult> {
  let response: Response;
  try {
    response = await fetch(buildWorkEntriesUrl(personId, cursor), { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, message: adminReadErrorMessage(null) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { ok: false, message: adminReadErrorMessage(response.ok ? null : response.status) };
  }
  if (!response.ok) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    return { ok: false, message: adminReadErrorMessage(response.status, code) };
  }
  const page = parseWorkEntryList(body);
  if (!page) return { ok: false, message: adminReadErrorMessage(null) };
  return { ok: true, entries: page.entries, nextCursor: page.nextCursor };
}

function EntryRow({ entry }: { entry: WorkEntryDetail }) {
  const start = istanbulWallClock(entry.startsAt);
  const end = istanbulWallClock(entry.endsAt);
  const remainder = parseApiCents(entry.remainderCents);
  return (
    <li>
      <Link
        href={`/sofor/kayitlar/${entry.id}`}
        className="flex min-h-[var(--control-min-height)] flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4 text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <span className="text-lg font-semibold">{formatWorkDate(entry.workDate)}</span>
        <span className="text-base">
          {start.time} – {end.time} · {formatDuration(entry.durationMinutes)}
        </span>
        <span className="text-base tabular-nums">
          {TEXT.detailRemainder}: {remainder === null ? "—" : formatTlAmount(remainder)}
        </span>
        <span className="text-base text-[var(--color-text-secondary)]">
          {entry.status === "pending" ? TEXT.statusPending : entry.status === "confirmed" ? TEXT.statusConfirmed : TEXT.statusNotRequired}
        </span>
      </Link>
    </li>
  );
}

export function DriverEntriesList() {
  const [drivers, setDrivers] = useState<DriversState>({ status: "loading" });
  const [personId, setPersonId] = useState("");
  const [entries, setEntries] = useState<EntriesState>({ status: "idle" });
  const driversSequenceRef = useRef(0);
  const driversControllerRef = useRef<AbortController | null>(null);
  const entriesSequenceRef = useRef(0);
  const entriesControllerRef = useRef<AbortController | null>(null);

  async function loadDrivers(): Promise<void> {
    const sequence = ++driversSequenceRef.current;
    driversControllerRef.current?.abort();
    const controller = new AbortController();
    driversControllerRef.current = controller;
    let result;
    try {
      result = await fetchDrivers(controller.signal, undefined);
    } catch {
      return;
    }
    if (sequence !== driversSequenceRef.current) return;
    setDrivers(
      result.ok ? { status: "loaded", drivers: result.drivers } : { status: "error", message: result.message },
    );
  }

  useEffect(() => {
    // İlk yükleme: durum zaten "loading" (senkron setState yok).
    void loadDrivers();
    return () => {
      driversSequenceRef.current += 1;
      driversControllerRef.current?.abort();
      entriesSequenceRef.current += 1;
      entriesControllerRef.current?.abort();
    };
    // Yalnız mount'ta bir kez; loadDrivers ref/set fonksiyonlarını kullanır.
  }, []);

  /** İlk sayfa (`cursor` yok) listeyi değiştirir; sonraki sayfa sona eklenir. Kesilen/eski yanıt yok sayılır. */
  async function loadEntries(person: string, cursor?: string): Promise<void> {
    const sequence = ++entriesSequenceRef.current;
    entriesControllerRef.current?.abort();
    const controller = new AbortController();
    entriesControllerRef.current = controller;
    let result: EntriesResult;
    try {
      result = await fetchEntries(person, cursor, controller.signal);
    } catch {
      return;
    }
    if (sequence !== entriesSequenceRef.current) return;
    if (!result.ok) {
      setEntries({ status: "error", message: result.message });
      return;
    }
    setEntries((prev) => ({
      status: "loaded",
      entries: cursor && prev.status === "loaded" ? [...prev.entries, ...result.entries] : result.entries,
      nextCursor: result.nextCursor,
      loadingMore: false,
    }));
  }

  function choosePerson(next: string): void {
    setPersonId(next);
    if (next === "") {
      entriesSequenceRef.current += 1;
      entriesControllerRef.current?.abort();
      setEntries({ status: "idle" });
      return;
    }
    setEntries({ status: "loading" });
    void loadEntries(next);
  }

  function loadMore(cursor: string): void {
    setEntries((prev) => (prev.status === "loaded" ? { ...prev, loadingMore: true } : prev));
    void loadEntries(personId, cursor);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <label htmlFor="list-person" className={labelClass}>
          {TEXT.listPersonLabel}
        </label>
        <select
          id="list-person"
          value={personId}
          disabled={drivers.status !== "loaded" || drivers.drivers.length === 0}
          onChange={(event) => choosePerson(event.target.value)}
          className={controlClass}
        >
          <option value="">{drivers.status === "loading" ? TEXT.personLoading : TEXT.personPlaceholder}</option>
          {drivers.status === "loaded" &&
            drivers.drivers.map((driver) => (
              <option key={driver.personId} value={driver.personId}>
                {driver.fullName}
              </option>
            ))}
        </select>
        {drivers.status === "loaded" && drivers.drivers.length === 0 && (
          <p role="status" className="mt-1 text-base text-[var(--color-text-secondary)]">
            {TEXT.personEmpty}
          </p>
        )}
        {drivers.status === "error" && (
          <div className="mt-2 flex flex-col gap-2">
            <p role="alert" className="text-base text-[var(--color-error)]">
              {drivers.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setDrivers({ status: "loading" });
                void loadDrivers();
              }}
              className={secondaryButtonClass}
            >
              {TEXT.retry}
            </button>
          </div>
        )}
      </div>

      {entries.status === "loading" && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {TEXT.listLoading}
        </p>
      )}
      {entries.status === "error" && (
        <div className="flex flex-col gap-2">
          <p role="alert" className={errorTextClass}>
            {entries.message}
          </p>
          <button type="button" onClick={() => choosePerson(personId)} className={secondaryButtonClass}>
            {TEXT.retry}
          </button>
        </div>
      )}
      {entries.status === "loaded" && entries.entries.length === 0 && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {TEXT.listEmpty}
        </p>
      )}
      {entries.status === "loaded" && entries.entries.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {entries.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {entries.status === "loaded" && entries.nextCursor !== null && (
        <button
          type="button"
          disabled={entries.loadingMore}
          onClick={() => loadMore(entries.nextCursor as string)}
          className={secondaryButtonClass}
        >
          {TEXT.listMore}
        </button>
      )}
    </div>
  );
}
