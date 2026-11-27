import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ARCHIVE_FILE_LIMIT, ARCHIVE_PATH, archiveIdPattern, type ArchivePage } from "../lib/archive-protocol.ts";
import { validateWorld } from "../lib/world.ts";
import { MAX_LIBRARY_SIZE } from "../lib/content-limits.ts";
import { authoredMaterialCount, MEETING_MATERIAL_LIMIT } from "../lib/meeting.ts";

const prefix = "worlds/";
const objectKey = (id: string) => prefix + id + ".json";
const archiveId = (writer: string, workshop: string) => createHmac("sha256", writer).update(workshop).digest("hex");
class ArchiveError extends Error {
  status: number;
  constructor(status: number) { super(); this.status = status; }
}

async function readWorldFile(request: IncomingMessage) {
  if (Number(request.headers["content-length"]) > ARCHIVE_FILE_LIMIT) throw new ArchiveError(413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > ARCHIVE_FILE_LIMIT) throw new ArchiveError(413);
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks, size);
  try {
    const world = validateWorld(JSON.parse(body.toString("utf8")), MAX_LIBRARY_SIZE);
    if (world.size !== 12 || !world.workshop || authoredMaterialCount(world, new Set()) > MEETING_MATERIAL_LIMIT)
      throw new Error();
    return { body, workshop: world.workshop.id, title: world.title };
  } catch { throw new ArchiveError(400); }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(value));
}

export function createArchiveApi(env: NodeJS.ProcessEnv = process.env) {
  const { R2_ENDPOINT: endpoint, R2_BUCKET: Bucket, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  const client = endpoint && Bucket && accessKeyId && secretAccessKey ? new S3Client({
    endpoint, region: "auto", credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 2,
  }) : undefined;
  let activeWrites = 0, writes = 0, resetAt = 0;
  const writerCounts = new Map<string, number>();
  let firstPage: { page: ArchivePage; expires: number } | undefined;
  let revision = 0;
  return async function handleArchive(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== ARCHIVE_PATH && !url.pathname.startsWith(ARCHIVE_PATH + "/")) return false;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const root = url.pathname === ARCHIVE_PATH;
      const id = url.pathname.slice(ARCHIVE_PATH.length + 1);
      if (!root && !archiveIdPattern.test(id)) throw new ArchiveError(404);
      if (request.method !== "GET" && !(root && request.method === "POST")) throw new ArchiveError(405);
      if (!client) throw new ArchiveError(503);
      const writer = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.authorization ?? "")?.[1];
      if (request.method === "POST") {
        if (!writer || request.headers["sec-fetch-site"] === "cross-site") throw new ArchiveError(403);
        if (request.headers["content-type"]?.split(";")[0] !== "application/json") throw new ArchiveError(415);
        const now = Date.now();
        if (now >= resetAt) { writerCounts.clear(); writes = 0; resetAt = now + 60000; }
        const count = writerCounts.get(writer) ?? 0;
        if (activeWrites >= 2 || count >= 12 || writes >= 120) throw new ArchiveError(429);
        writerCounts.set(writer, count + 1);
        writes++;
        activeWrites++;
        try {
          const { body, workshop, title } = await readWorldFile(request);
          const id = archiveId(writer, workshop);
          await client.send(new PutObjectCommand({ Bucket, Key: objectKey(id), Body: body,
            ContentType: "application/json", Metadata: { title: Buffer.from(title).toString("base64url"), workshop },
          }), { abortSignal: AbortSignal.timeout(45000) });
          revision++;
          firstPage = undefined;
          json(response, 200, { id });
        } finally { activeWrites--; }
      } else if (root) {
        const cursor = url.searchParams.get("cursor") ?? undefined;
        if (cursor !== undefined && (!cursor.length || cursor.length > 2048)) throw new ArchiveError(400);
        if (!cursor && firstPage && firstPage.expires > Date.now()) {
          json(response, 200, firstPage.page);
          return true;
        }
        const version = revision;
        const options = { abortSignal: AbortSignal.timeout(45000) };
        const list = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, MaxKeys: 20, ContinuationToken: cursor }), options);
        const items = await Promise.all((list.Contents ?? []).flatMap(({ Key, LastModified }) => {
          const id = Key?.slice(prefix.length, -5);
          if (!id || !archiveIdPattern.test(id) || Key !== objectKey(id)) return [];
          return [client.send(new HeadObjectCommand({ Bucket, Key }), options).then(head => ({
            id, title: Buffer.from(head.Metadata?.title ?? "", "base64url").toString("utf8"),
            updatedAt: (head.LastModified ?? LastModified)?.toISOString() ?? "",
          })).catch((error: { $metadata?: { httpStatusCode?: number } }) => {
            if (error?.$metadata?.httpStatusCode === 404) return null;
            throw error;
          })];
        }));
        const page: ArchivePage = { items: items.filter(item => item !== null), cursor: list.NextContinuationToken };
        if (!cursor && version === revision) firstPage = { page, expires: Date.now() + 15000 };
        json(response, 200, page);
      } else {
        const object = await client.send(new GetObjectCommand({ Bucket, Key: objectKey(id) }), { abortSignal: AbortSignal.timeout(45000) });
        if (!(object.Body instanceof Readable)) throw new ArchiveError(502);
        if ((object.ContentLength ?? 0) > ARCHIVE_FILE_LIMIT) { object.Body.destroy(); throw new ArchiveError(502); }
        const workshop = object.Metadata?.workshop;
        const owned = !!(writer && workshop && archiveId(writer, workshop) === id);
        response.writeHead(200, { "Content-Type": "application/json", "X-Whistle-Archive-Owner": owned ? "1" : "0" });
        await pipeline(object.Body, response);
      }
    } catch (error) {
      const storageStatus = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const status = error instanceof ArchiveError ? error.status : storageStatus === 404 ? 404 : 502;
      if (!response.headersSent && !response.destroyed) json(response, status, { error: status });
    }
    return true;
  };
}
