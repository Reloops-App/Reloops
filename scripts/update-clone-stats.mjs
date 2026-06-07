import { existsSync, readFileSync, writeFileSync } from "node:fs";

const trafficPath = process.env.TRAFFIC_JSON_PATH || "traffic-clones.json";
const statsPath = process.env.STATS_JSON_PATH || "clone-stats.json";
const outputPath = process.env.OUTPUT_JSON_PATH || statsPath;

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function toUtcDay(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid GitHub traffic timestamp: ${timestamp}`);
  }
  return date.toISOString().slice(0, 10);
}

const traffic = readJson(trafficPath);
if (!traffic || !Array.isArray(traffic.clones)) {
  throw new Error(`Expected ${trafficPath} to contain a GitHub traffic "clones" array`);
}

const existing = readJson(statsPath, {});
const daily = { ...(existing.daily || {}) };
const windowDays = [];

for (const entry of traffic.clones) {
  const day = toUtcDay(entry.timestamp);
  windowDays.push(day);
  daily[day] = {
    clones: numberOrZero(entry.count),
    uniqueCloners: numberOrZero(entry.uniques),
  };
}

const sortedDays = Object.keys(daily).sort();
const totalClones = sortedDays.reduce((sum, day) => sum + numberOrZero(daily[day]?.clones), 0);
const firstWindowDay = windowDays[0] || null;
const lastWindowDay = windowDays[windowDays.length - 1] || null;

const nextStats = {
  schemaVersion: 1,
  repository: process.env.GITHUB_REPOSITORY || existing.repository || null,
  trackingStartedAt: existing.trackingStartedAt || sortedDays[0] || null,
  lastRecordedDay: lastWindowDay || existing.lastRecordedDay || null,
  totalClones,
  latestWindowClones: numberOrZero(traffic.count),
  latestWindowUniqueCloners: numberOrZero(traffic.uniques),
  latestWindow: {
    firstDay: firstWindowDay,
    lastDay: lastWindowDay,
    clones: numberOrZero(traffic.count),
    uniqueCloners: numberOrZero(traffic.uniques),
  },
  daily: Object.fromEntries(sortedDays.map((day) => [day, daily[day]])),
};

writeFileSync(outputPath, `${JSON.stringify(nextStats, null, 2)}\n`);
console.log(`Updated ${outputPath}: ${totalClones} tracked clones across ${sortedDays.length} days`);
