// src/frozen-v1-reader-worker.ts
import { createHash as createHash2 } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { Window } from "happy-dom";
import JSZip2 from "jszip";
import { Awareness } from "y-protocols/awareness.js";
import { applyUpdate, Doc as YDoc, encodeStateAsUpdate, Map as YMap } from "yjs";
import { BLANK_DOCX_BASE64, Editor } from "superdoc-final-v1/super-editor";
import { js2xml } from "xml-js";

// src/stabilize-comment-ids.ts
import { createHash } from "crypto";
import JSZip from "jszip";
var PARA_ID_MAX_EXCLUSIVE = 2147483648;
var DURABLE_ID_MAX_EXCLUSIVE = 2147483647;
function generateStableId(seed, maxExclusive, used) {
  let attempt = 0;
  while (true) {
    const id = createHash("sha256").update(`${seed}\0${attempt++}`).digest("hex").slice(0, 8).toUpperCase();
    const value = Number.parseInt(id, 16);
    if (value > 0 && value < maxExclusive && !used.has(id)) {
      used.add(id);
      return id;
    }
  }
}
function visitStartTags(xml, visit) {
  const ancestors = [];
  let position = 0;
  while ((position = xml.indexOf("<", position)) !== -1) {
    if (xml.startsWith("<!--", position) || xml.startsWith("<![CDATA[", position) || xml.startsWith("<?", position)) {
      const marker = xml.startsWith("<!--", position) ? "-->" : xml.startsWith("<![CDATA[", position) ? "]]>" : "?>";
      const end = xml.indexOf(marker, position);
      if (end === -1) throw new Error("exported comment XML has an unterminated declaration");
      position = end + marker.length;
      continue;
    }
    if (xml.startsWith("<!", position)) throw new Error("exported comment XML contains an unsupported declaration");
    let cursor = position + 1;
    const closing = xml[cursor] === "/";
    if (closing) cursor++;
    const nameStart = cursor;
    while (cursor < xml.length && !/[\s/>]/.test(xml[cursor])) cursor++;
    const name = xml.slice(nameStart, cursor);
    if (!name) throw new Error("exported comment XML contains an invalid tag");
    if (closing) {
      while (cursor < xml.length && /\s/.test(xml[cursor])) cursor++;
      if (xml[cursor] !== ">" || ancestors.pop()?.name !== name) {
        throw new Error("exported comment XML contains mismatched tags");
      }
      position = cursor + 1;
      continue;
    }
    const attributes = /* @__PURE__ */ new Map();
    let selfClosing = false;
    while (cursor < xml.length) {
      while (cursor < xml.length && /\s/.test(xml[cursor])) cursor++;
      if (xml[cursor] === ">") break;
      if (xml[cursor] === "/" && xml[cursor + 1] === ">") {
        selfClosing = true;
        cursor++;
        break;
      }
      const attributeStart = cursor;
      while (cursor < xml.length && !/[\s=/>]/.test(xml[cursor])) cursor++;
      const attributeName = xml.slice(attributeStart, cursor);
      while (cursor < xml.length && /\s/.test(xml[cursor])) cursor++;
      if (!attributeName || xml[cursor] !== "=" || attributes.has(attributeName)) {
        throw new Error("exported comment XML contains an invalid attribute");
      }
      cursor++;
      while (cursor < xml.length && /\s/.test(xml[cursor])) cursor++;
      const quote = xml[cursor];
      if (quote !== '"' && quote !== "'") throw new Error("exported comment XML contains an unquoted attribute");
      const valueStart = ++cursor;
      cursor = xml.indexOf(quote, cursor);
      if (cursor === -1) throw new Error("exported comment XML contains an unterminated attribute");
      attributes.set(attributeName, { value: xml.slice(valueStart, cursor), start: valueStart, end: cursor });
      cursor++;
    }
    if (xml[cursor] !== ">") throw new Error("exported comment XML contains an unterminated tag");
    const tag = { name, attributes };
    visit(tag, ancestors);
    if (!selfClosing) ancestors.push(tag);
    position = cursor + 1;
  }
  if (ancestors.length !== 0) throw new Error("exported comment XML contains unclosed tags");
}
function replaceAttribute(replacements, attribute, value) {
  replacements.push({ start: attribute.start, end: attribute.end, value });
}
function applyReplacements(xml, replacements) {
  if (replacements.length === 0) return xml;
  const pieces = [];
  let cursor = 0;
  for (const replacement of replacements.sort((left, right) => left.start - right.start)) {
    if (replacement.start < cursor) throw new Error("exported comment XML contains overlapping ID attributes");
    pieces.push(xml.slice(cursor, replacement.start), replacement.value);
    cursor = replacement.end;
  }
  pieces.push(xml.slice(cursor));
  return pieces.join("");
}
async function generateStableCarrier(zip) {
  for (const entry of Object.values(zip.files)) {
    entry.date = /* @__PURE__ */ new Date("2000-01-01T00:00:00.000Z");
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS" });
}
async function stabilizeCommentIds(carrier) {
  const zip = await JSZip.loadAsync(carrier);
  const commentsPart = zip.file("word/comments.xml");
  if (!commentsPart) return generateStableCarrier(zip);
  const commentsXml = await commentsPart.async("string");
  const commentIds = /* @__PURE__ */ new Set();
  const paragraphCounts = /* @__PURE__ */ new Map();
  const paragraphs = [];
  visitStartTags(commentsXml, (tag, ancestors) => {
    if (tag.name === "w:comment") {
      const commentId2 = tag.attributes.get("w:id")?.value;
      if (commentId2 === void 0) throw new Error("exported comment has no w:id");
      if (commentIds.has(commentId2)) throw new Error("exported comments contain duplicate w:id values");
      commentIds.add(commentId2);
    }
    if (tag.name !== "w:p") return;
    const comment = [...ancestors].reverse().find((ancestor) => ancestor.name === "w:comment");
    const commentId = comment?.attributes.get("w:id")?.value;
    if (commentId === void 0) return;
    const index = paragraphCounts.get(commentId) ?? 0;
    paragraphCounts.set(commentId, index + 1);
    paragraphs.push({ commentId, paragraphId: tag.attributes.get("w14:paraId"), index });
  });
  const reserved = /* @__PURE__ */ new Set();
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("word/") || !name.endsWith(".xml") || name === "word/comments.xml") continue;
    const xml = await zip.file(name)?.async("string");
    for (const match of xml?.matchAll(/\bw14:paraId="([0-9A-Fa-f]{8})"/g) ?? []) reserved.add(match[1].toUpperCase());
  }
  const oldToNew = /* @__PURE__ */ new Map();
  const commentReplacements = [];
  for (const { commentId, paragraphId, index } of paragraphs) {
    const oldId = paragraphId?.value;
    if (!oldId || !paragraphId) continue;
    if (oldToNew.has(oldId.toUpperCase())) throw new Error("exported comments contain duplicate paragraph IDs");
    const newId = generateStableId(`${commentId}\0${index}`, PARA_ID_MAX_EXCLUSIVE, reserved);
    oldToNew.set(oldId.toUpperCase(), newId);
    replaceAttribute(commentReplacements, paragraphId, newId);
  }
  const extendedPart = zip.file("word/commentsExtended.xml");
  const idsPart = zip.file("word/commentsIds.xml");
  const extensiblePart = zip.file("word/commentsExtensible.xml");
  if (oldToNew.size === 0 && !extendedPart && !idsPart && !extensiblePart) return generateStableCarrier(zip);
  if (extendedPart) {
    const extendedXml = await extendedPart.async("string");
    const replacements = [];
    visitStartTags(extendedXml, (tag) => {
      if (tag.name !== "w15:commentEx") return;
      for (const attribute of ["w15:paraId", "w15:paraIdParent"]) {
        const oldId = tag.attributes.get(attribute);
        const newId = oldId && oldToNew.get(oldId.value.toUpperCase());
        if (!newId && (attribute === "w15:paraId" || oldId !== void 0)) {
          throw new Error("exported commentsExtended contains an unmatched paragraph ID");
        }
        if (newId && oldId) replaceAttribute(replacements, oldId, newId);
      }
    });
    zip.file("word/commentsExtended.xml", applyReplacements(extendedXml, replacements));
  }
  if (idsPart) {
    const idsXml = await idsPart.async("string");
    const replacements = [];
    const durableIds = /* @__PURE__ */ new Map();
    const usedDurableIds = /* @__PURE__ */ new Set();
    visitStartTags(idsXml, (tag) => {
      if (tag.name !== "w16cid:commentId") return;
      const oldParaId = tag.attributes.get("w16cid:paraId");
      const oldDurableId = tag.attributes.get("w16cid:durableId");
      const newParaId = oldParaId && oldToNew.get(oldParaId.value.toUpperCase());
      const durableKey = oldDurableId?.value.toUpperCase();
      if (!oldParaId || !oldDurableId || !newParaId || !durableKey || durableIds.has(durableKey)) {
        throw new Error("exported commentsIds contains an unmatched or duplicate comment ID");
      }
      const newDurableId = generateStableId(`durable\0${newParaId}`, DURABLE_ID_MAX_EXCLUSIVE, usedDurableIds);
      durableIds.set(durableKey, newDurableId);
      replaceAttribute(replacements, oldParaId, newParaId);
      replaceAttribute(replacements, oldDurableId, newDurableId);
    });
    zip.file("word/commentsIds.xml", applyReplacements(idsXml, replacements));
    if (extensiblePart) {
      const extensibleXml = await extensiblePart.async("string");
      const extensibleReplacements = [];
      visitStartTags(extensibleXml, (tag) => {
        if (tag.name !== "w16cex:commentExtensible") return;
        const oldId = tag.attributes.get("w16cex:durableId");
        const newId = oldId && durableIds.get(oldId.value.toUpperCase());
        if (!oldId || !newId) throw new Error("exported commentsExtensible has an unmatched durable ID");
        replaceAttribute(extensibleReplacements, oldId, newId);
      });
      zip.file("word/commentsExtensible.xml", applyReplacements(extensibleXml, extensibleReplacements));
    }
  } else if (extensiblePart) {
    const extensibleXml = await extensiblePart.async("string");
    const replacements = [];
    const used = /* @__PURE__ */ new Set();
    let index = 0;
    visitStartTags(extensibleXml, (tag) => {
      if (tag.name !== "w16cex:commentExtensible") return;
      const oldId = tag.attributes.get("w16cex:durableId");
      if (!oldId) throw new Error("exported commentsExtensible has no durable ID");
      const commentIndex = index++;
      const newId = generateStableId(`durable\0${commentIndex}`, DURABLE_ID_MAX_EXCLUSIVE, used);
      replaceAttribute(replacements, oldId, newId);
    });
    zip.file("word/commentsExtensible.xml", applyReplacements(extensibleXml, replacements));
  }
  zip.file("word/comments.xml", applyReplacements(commentsXml, commentReplacements));
  return generateStableCarrier(zip);
}

// src/frozen-v1-reader-worker.ts
var ALLOWED_DOCUMENT_ROOTS = /* @__PURE__ */ new Map([
  ["supereditor", "XmlFragment"],
  ["parts", "Map"],
  ["media", "Map"],
  ["meta", "Map"],
  ["comments", "Array"]
]);
function sha256(bytes) {
  return createHash2("sha256").update(bytes).digest("hex");
}
function sharedTypeName(value) {
  const name = value?.constructor?.name;
  return typeof name === "string" && name.startsWith("Y") ? name.slice(1) : String(name ?? "Unknown");
}
function materializeKnownRoot(doc, name, type) {
  if (type === "XmlFragment") return doc.getXmlFragment(name);
  if (type === "Map") return doc.getMap(name);
  if (type === "Array") return doc.getArray(name);
  throw new Error(`unsupported final-v1 root ${name}:${type}`);
}
function readFinalV1DocxEntries(meta) {
  if (!meta?.has("docx")) return null;
  const value = meta.get("docx");
  let entries;
  if (Array.isArray(value)) entries = value;
  else if (value != null && typeof value === "object" && typeof value.toArray === "function") {
    entries = value.toArray();
  } else if (value != null && typeof value === "object" && Symbol.iterator in value) {
    entries = Array.from(value);
  } else return null;
  return entries.length > 0 ? entries : null;
}
function validateRoots(role, doc) {
  const rootNames = [...doc.share.keys()];
  if (role === "comments") {
    if (rootNames.length > 1 || rootNames.length === 1 && rootNames[0] !== "comments") {
      throw new Error(
        "split comments snapshot must contain only the v1 comments Y.Array"
      );
    }
    const comments = doc.getArray("comments");
    if (sharedTypeName(comments) !== "Array") {
      throw new Error(
        "split comments snapshot must contain a v1 comments Y.Array"
      );
    }
    return ["comments:Array"];
  }
  const entries = rootNames.map((name) => {
    const expectedType = ALLOWED_DOCUMENT_ROOTS.get(name);
    if (!expectedType) throw new Error(`unsupported final-v1 root ${name}`);
    const materialized = materializeKnownRoot(doc, name, expectedType);
    const actualType = sharedTypeName(materialized);
    if (actualType !== expectedType)
      throw new Error(`unsupported final-v1 root ${name}:${actualType}`);
    return [name, actualType];
  });
  for (const [name, type] of entries) {
    if (ALLOWED_DOCUMENT_ROOTS.get(name) !== type)
      throw new Error(`unsupported final-v1 root ${name}:${type}`);
  }
  const fragment = rootNames.includes("supereditor") ? doc.getXmlFragment("supereditor") : null;
  const meta = rootNames.includes("meta") ? doc.getMap("meta") : null;
  if ((fragment?.length ?? 0) === 0 && readFinalV1DocxEntries(meta) === null) {
    throw new Error(
      "document snapshot has no final-v1 body in supereditor or meta.docx"
    );
  }
  return entries.map(([name, type]) => `${name}:${type}`).sort();
}
function provider(ydoc) {
  return {
    synced: true,
    isSynced: true,
    on() {
    },
    off() {
    },
    disconnect() {
    },
    awareness: new Awareness(ydoc)
  };
}
async function waitForHydration(editor) {
  const deadline = Date.now() + 2e4;
  while (Date.now() < deadline) {
    if (editor.state.doc.content.size > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "final-v1 editor did not hydrate the detached collaboration snapshot"
  );
}
async function packageParts(bytes) {
  const zip = await JSZip2.loadAsync(bytes);
  return Object.keys(zip.files).filter((name) => !zip.files[name]?.dir).sort();
}
function safePartName(name) {
  return name.length > 0 && name !== "media" && !name.startsWith("/") && !name.includes("\\") && !name.split("/").includes("..");
}
function storedPartBytes(value) {
  const data = value instanceof YMap ? value.get("data") : value?.data;
  if (typeof data === "string" || data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data === "object") {
    const xmlData = data instanceof YMap ? data.toJSON() : data;
    return js2xml(xmlData, {
      compact: false,
      spaces: 0
    });
  }
  throw new Error(
    "final-v1 parts map contains an unsupported stored part payload"
  );
}
async function restoreMissingStoredParts(carrier, documentDoc) {
  const zip = await JSZip2.loadAsync(carrier);
  const parts = documentDoc.getMap("parts");
  let changed = false;
  for (const [name, value] of parts.entries()) {
    if (zip.file(name) != null || name === "media") continue;
    if (!safePartName(name))
      throw new Error(
        `final-v1 parts map contains an unsafe part name: ${name}`
      );
    zip.file(name, storedPartBytes(value), {
      date: /* @__PURE__ */ new Date("2000-01-01T00:00:00.000Z")
    });
    changed = true;
  }
  if (!changed) return carrier;
  return await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "DOS"
  });
}
function trackedChangeCount(comments) {
  return comments.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const value = item;
    return value.type === "trackedChange" || value.kind === "trackedChange" || value.isTrackedChange === true;
  }).length;
}
async function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof Blob !== "undefined" && value instanceof Blob)
    return new Uint8Array(await value.arrayBuffer());
  throw new Error("final-v1 editor returned a non-binary DOCX export");
}
async function run(input) {
  if (input.schemaVersion !== 1)
    throw new Error("unsupported reader worker input version");
  const sourceHashes = {
    document: null,
    comments: null
  };
  const documents = /* @__PURE__ */ new Map();
  const before = /* @__PURE__ */ new Map();
  const roots = [];
  for (const snapshot of input.snapshots) {
    const update = new Uint8Array(await readFile(snapshot.path));
    if (sha256(update) !== snapshot.sha256)
      throw new Error(`${snapshot.role} snapshot hash mismatch`);
    sourceHashes[snapshot.role] = snapshot.sha256;
    const doc = new YDoc({ gc: false });
    applyUpdate(doc, update);
    roots.push(
      ...validateRoots(snapshot.role, doc).map(
        (root) => `${snapshot.role}:${root}`
      )
    );
    documents.set(snapshot.role, doc);
    before.set(snapshot.role, encodeStateAsUpdate(doc));
  }
  const documentDoc = documents.get("document");
  if (!documentDoc) throw new Error("document snapshot is required");
  const commentsDoc = documents.get("comments") ?? documentDoc;
  const comments = commentsDoc.getArray("comments").toArray();
  const fragment = documentDoc.share.has("supereditor") ? documentDoc.getXmlFragment("supereditor") : null;
  const meta = documentDoc.share.has("meta") ? documentDoc.getMap("meta") : null;
  const metaDocx = readFinalV1DocxEntries(meta) === null ? void 0 : meta?.get("docx");
  const window = new Window();
  const editorSource = (fragment?.length ?? 0) > 0 || metaDocx === void 0 ? Buffer.from(BLANK_DOCX_BASE64, "base64") : void 0;
  const editor = await Editor.open(editorSource, {
    documentId: input.logicalDocumentId,
    document: window.document,
    isHeadless: true,
    telemetry: { enabled: false },
    ydoc: documentDoc,
    collaborationProvider: provider(documentDoc),
    ...fragment && fragment.length > 0 ? { fragment } : {},
    ...(fragment?.length ?? 0) === 0 && metaDocx !== void 0 ? { content: metaDocx } : {},
    isNewFile: false
  });
  try {
    await waitForHydration(editor);
    const exportedCarrier = await toBytes(
      await editor.exportDocx({
        // Migration must preserve pending revisions; final mode accepts them.
        isFinalDoc: false,
        ...comments.length > 0 ? { comments } : {}
      })
    );
    const carrier = await stabilizeCommentIds(await restoreMissingStoredParts(exportedCarrier, documentDoc));
    await writeFile(input.carrierPath, carrier, { mode: 384 });
    const parts = await packageParts(carrier);
    const detachedCloneChanged = [...documents.entries()].some(
      ([role, doc]) => {
        const initial = before.get(role);
        return initial == null || !Buffer.from(initial).equals(Buffer.from(encodeStateAsUpdate(doc)));
      }
    );
    return {
      schemaVersion: "superdoc-final-v1-reader.v1",
      ok: true,
      sourceHashes,
      carrierSha256: sha256(carrier),
      carrierByteLength: carrier.byteLength,
      topLevelRoots: roots.sort().join(","),
      packageParts: parts.join(","),
      packagePartCount: parts.length,
      commentCount: comments.length,
      trackedChangeCount: trackedChangeCount(comments),
      textCharacters: editor.state.doc.textContent.length,
      detachedCloneChanged
    };
  } finally {
    editor.options.ydoc = null;
    editor.options.collaborationProvider = null;
    editor.destroy();
    window.close();
    for (const doc of documents.values()) doc.destroy();
  }
}
async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("reader worker requires an input file");
  const input = JSON.parse(await readFile(configPath, "utf8"));
  try {
    const report = await run(input);
    await writeFile(input.reportPath, `${JSON.stringify(report)}
`, {
      mode: 384
    });
  } catch (error) {
    const report = {
      schemaVersion: "superdoc-final-v1-reader.v1",
      ok: false,
      error: {
        code: "V1_READER_EXPORT_FAILED",
        message: error instanceof Error ? error.message : String(error)
      }
    };
    await writeFile(input.reportPath, `${JSON.stringify(report)}
`, {
      mode: 384
    }).catch(() => void 0);
    throw error;
  }
}
await main();
