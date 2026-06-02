import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnv() {
  const env = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const env = readEnv();
const url = process.env.SUPABASE_URL || process.env.URL_SUPABASE || env.SUPABASE_URL || env.URL_SUPABASE;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const buckets = [
  { id: "assets", public: false, fileSizeLimit: 2 * 1024 * 1024 * 1024 },
  { id: "thumbnails", public: true, fileSizeLimit: 10 * 1024 * 1024 },
  { id: "avatars", public: true, fileSizeLimit: 10 * 1024 * 1024 },
  { id: "workspaces", public: true, fileSizeLimit: 10 * 1024 * 1024 },
];

const listed = await admin.storage.listBuckets();
if (listed.error) throw listed.error;

const existing = new Set((listed.data ?? []).map((bucket) => bucket.id));

for (const bucket of buckets) {
  const options = {
    public: bucket.public,
    fileSizeLimit: bucket.fileSizeLimit,
  };

  const result = existing.has(bucket.id)
    ? await admin.storage.updateBucket(bucket.id, options)
    : await admin.storage.createBucket(bucket.id, options);

  if (result.error) throw result.error;
  console.log(`${existing.has(bucket.id) ? "updated" : "created"} storage bucket ${bucket.id}`);
}
