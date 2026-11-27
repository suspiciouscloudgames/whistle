export const ARCHIVE_PATH = "/whistle/api/archive";
export const ARCHIVE_FILE_LIMIT = 32 * 1024 * 1024;
export const archiveIdPattern = /^[0-9a-f]{64}$/;

export type ArchiveEntry = { id: string; title: string; updatedAt: string };
export type ArchivePage = { items: ArchiveEntry[]; cursor?: string };
