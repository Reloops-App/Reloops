import { readFileSync } from "node:fs";

const checks = [];

function check(name, condition) {
  checks.push({ name, passed: Boolean(condition) });
}

function file(path) {
  return readFileSync(path, "utf8");
}

const detailPage = file("apps/web/src/pages/Collections/CollectionDetailPage.tsx");
const collectionsFunction = file("supabase/functions/collections/index.ts");
const collectionsLib = file("apps/web/src/lib/collections.ts");

check(
  "collection UI sends the full merged definition on every save",
  detailPage.includes("definition: nextDefinition"),
);

check(
  "collection UI ignores stale save failures instead of rolling back newer edits",
  detailPage.includes("if (latestSaveId.current === saveId) {\n        setCollection(previous);"),
);

check(
  "collection source assets do not reload for every collection setting change",
  detailPage.includes("collectionSourceType")
    && detailPage.includes("collectionSourceProjectId")
    && detailPage.includes("collectionSourceFolderId")
    && detailPage.includes("}, [collectionSourceFolderId, collectionSourceProjectId, collectionSourceType, workspaceId]);"),
);

check(
  "collections backend merges partial definition updates",
  collectionsFunction.includes("function mergeCollectionDefinition")
    && collectionsFunction.includes("patch.definition = mergeCollectionDefinition"),
);

check(
  "collections backend supports visible field patches",
  collectionsFunction.includes('...("visible_fields" in body ? { visible: body.visible_fields } : {})'),
);

check(
  "collections backend preserves source fields while merging patches",
  collectionsFunction.includes('...("source_type" in body ? { type: body.source_type } : {})')
    && collectionsFunction.includes('...("source_project_id" in body ? { project_id: body.source_project_id } : {})')
    && collectionsFunction.includes('...("source_folder_id" in body ? { folder_id: body.source_folder_id } : {})'),
);

check(
  "collection visible field options omit removed AI/smart metadata fields",
  !collectionsLib.includes('{ value: "smart_description"')
    && !collectionsLib.includes('{ value: "ai_description"'),
);

const failed = checks.filter((item) => !item.passed);
for (const item of checks) {
  console.log(`${item.passed ? "ok" : "FAIL"} ${item.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} collection UI regression checks failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} collection UI regression checks passed.`);
