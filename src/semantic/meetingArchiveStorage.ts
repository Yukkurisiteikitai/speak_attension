import { MEETING_ARCHIVE_SCHEMA_VERSION, validateMeetingArchive, type MeetingArchive } from "./meetingArchive";

export type MeetingArchiveSummary = {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
};

export type ArchiveStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "unavailable" | "quota" | "invalid" | "unknown" };

export interface MeetingArchiveStorage {
  list(): Promise<ArchiveStorageResult<MeetingArchiveSummary[]>>;
  load(id: string): Promise<ArchiveStorageResult<MeetingArchive | null>>;
  save(archive: MeetingArchive): Promise<ArchiveStorageResult<void>>;
  remove(id: string): Promise<ArchiveStorageResult<void>>;
}

const DATABASE_NAME = "speak-attension-meetings";
const STORE_NAME = "archives";

function storageError(error: unknown): ArchiveStorageResult<never> {
  if (error instanceof DOMException && error.name === "QuotaExceededError") return { ok: false, error: "quota" };
  if (error instanceof DOMException && error.name === "SecurityError") return { ok: false, error: "unavailable" };
  return { ok: false, error: "unknown" };
}

export class IndexedDbMeetingArchiveStorage implements MeetingArchiveStorage {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new DOMException("IndexedDB unavailable", "SecurityError"));
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, MEETING_ARCHIVE_SCHEMA_VERSION);
      request.onupgradeneeded = (event) => {
        if (event.oldVersion > 0 && event.oldVersion < MEETING_ARCHIVE_SCHEMA_VERSION) {
          request.transaction?.abort();
          reject(new DOMException("Unsupported archive schema", "VersionError"));
          return;
        }
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new DOMException("IndexedDB upgrade blocked", "UnknownError"));
    });
    const cached = opening.catch((error) => {
      if (this.database === cached) this.database = null;
      throw error;
    });
    this.database = cached;
    return cached;
  }

  async list(): Promise<ArchiveStorageResult<MeetingArchiveSummary[]>> {
    try {
      const database = await this.open();
      const records = await new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const summaries: MeetingArchiveSummary[] = [];
      for (const record of records) {
        const checked = validateMeetingArchive(record);
        if (!checked.valid) return { ok: false, error: "invalid" };
        summaries.push({
          id: checked.archive.id,
          title: checked.archive.metadata.title,
          startedAt: checked.archive.metadata.startedAt,
          endedAt: checked.archive.metadata.endedAt,
        });
      }
      return { ok: true, value: summaries.sort((a, b) => b.endedAt - a.endedAt) };
    } catch (error) {
      return storageError(error);
    }
  }

  async load(id: string): Promise<ArchiveStorageResult<MeetingArchive | null>> {
    try {
      const database = await this.open();
      const raw = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      if (raw === null) return { ok: true, value: null };
      const checked = validateMeetingArchive(raw);
      return checked.valid ? { ok: true, value: checked.archive } : { ok: false, error: "invalid" };
    } catch (error) {
      return storageError(error);
    }
  }

  async save(archive: MeetingArchive): Promise<ArchiveStorageResult<void>> {
    const checked = validateMeetingArchive(archive);
    if (!checked.valid) return { ok: false, error: "invalid" };
    try {
      const database = await this.open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(archive);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return storageError(error);
    }
  }

  async remove(id: string): Promise<ArchiveStorageResult<void>> {
    try {
      const database = await this.open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return storageError(error);
    }
  }
}

export class MemoryMeetingArchiveStorage implements MeetingArchiveStorage {
  private readonly records = new Map<string, MeetingArchive>();

  async list(): Promise<ArchiveStorageResult<MeetingArchiveSummary[]>> {
    return {
      ok: true,
      value: [...this.records.values()].map(({ id, metadata }) => ({
        id, title: metadata.title, startedAt: metadata.startedAt, endedAt: metadata.endedAt,
      })).sort((a, b) => b.endedAt - a.endedAt),
    };
  }

  async load(id: string): Promise<ArchiveStorageResult<MeetingArchive | null>> {
    const archive = this.records.get(id);
    if (!archive) return { ok: true, value: null };
    const checked = validateMeetingArchive(archive);
    return checked.valid ? { ok: true, value: structuredClone(checked.archive) } : { ok: false, error: "invalid" };
  }

  async save(archive: MeetingArchive): Promise<ArchiveStorageResult<void>> {
    const checked = validateMeetingArchive(archive);
    if (!checked.valid) return { ok: false, error: "invalid" };
    this.records.set(archive.id, structuredClone(archive));
    return { ok: true, value: undefined };
  }

  async remove(id: string): Promise<ArchiveStorageResult<void>> {
    this.records.delete(id);
    return { ok: true, value: undefined };
  }
}

export function archiveStorageErrorLabel(error: ArchiveStorageResult<unknown> extends { ok: false; error: infer T } ? T : never): string {
  switch (error) {
    case "unavailable": return "このブラウザーでは端末内保存を利用できません。";
    case "quota": return "端末の保存容量が不足しています。会議データは保存されていません。";
    case "invalid": return "保存データを検証できませんでした。";
    default: return "端末への保存に失敗しました。会議データは保存されていません。";
  }
}
