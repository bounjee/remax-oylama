const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "oylama.json");
const BLOB_KEY = "oylama-state-v1";

function useBlobStore() {
  return (
    process.env.NETLIFY === "true" ||
    process.env.NETLIFY_DEV === "true"
  );
}

const seedConsultants = [
  ["İBRAHİM HALİL ÖCAL", "ERKEK"],
  ["MEHMET YILMAZ", "ERKEK"],
  ["AHMET KAYA", "ERKEK"],
  ["AYŞE DEMİR", "KADIN"],
  ["ZEYNEP ARSLAN", "KADIN"],
  ["ELİF YILDIZ", "KADIN"]
];

function normalizeSeedName(text) {
  return String(text).trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

function createInitialData() {
  const data = {
    nextIds: { consultant: 1, vote: 1 },
    settings: { voting_open: 1 },
    consultants: [],
    votes: []
  };

  for (const [fullName, gender] of seedConsultants) {
    data.consultants.push({
      id: data.nextIds.consultant++,
      full_name: normalizeSeedName(fullName),
      gender,
      is_active: 1,
      created_at: new Date().toISOString()
    });
  }

  return data;
}

function repairNextIds(data) {
  const maxC = data.consultants.length
    ? Math.max(...data.consultants.map(c => Number(c.id) || 0))
    : 0;
  const maxV = data.votes.length
    ? Math.max(...data.votes.map(v => Number(v.id) || 0))
    : 0;
  data.nextIds = data.nextIds || { consultant: 1, vote: 1 };
  data.nextIds.consultant = Math.max(Number(data.nextIds.consultant) || 1, maxC + 1);
  data.nextIds.vote = Math.max(Number(data.nextIds.vote) || 1, maxV + 1);
}

function normalizeLoaded(data) {
  if (!data || typeof data !== "object") return createInitialData();

  data.nextIds = data.nextIds || { consultant: 1, vote: 1 };
  data.settings = data.settings || { voting_open: 1 };
  if (data.settings.voting_open == null || data.settings.voting_open === "") {
    data.settings.voting_open = 1;
  }
  data.consultants = Array.isArray(data.consultants) ? data.consultants : [];
  data.votes = Array.isArray(data.votes) ? data.votes : [];

  if (!data.consultants.length) {
    return createInitialData();
  }

  repairNextIds(data);
  return data;
}

function atomicWriteFile(data) {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function readFileStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return normalizeLoaded(JSON.parse(raw));
  } catch {
    const fresh = createInitialData();
    atomicWriteFile(fresh);
    return fresh;
  }
}

function getBlobStore() {
  const { getStore } = require("@netlify/blobs");
  const siteID = process.env.SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) {
    return getStore({ name: "remax-oylama", siteID, token });
  }
  return getStore("remax-oylama");
}

async function readBlobStore() {
  const store = getBlobStore();
  const raw = await store.get(BLOB_KEY);
  if (!raw) {
    const fresh = createInitialData();
    await store.set(BLOB_KEY, JSON.stringify(fresh));
    return fresh;
  }
  try {
    return normalizeLoaded(JSON.parse(String(raw)));
  } catch {
    const fresh = createInitialData();
    await store.set(BLOB_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

async function writeBlobStore(data) {
  const store = getBlobStore();
  await store.set(BLOB_KEY, JSON.stringify(data));
}

async function readState() {
  if (useBlobStore()) return readBlobStore();
  return readFileStore();
}

async function writeState(data) {
  if (useBlobStore()) return writeBlobStore(data);
  atomicWriteFile(data);
}

let queue = Promise.resolve();

function enqueue(fn) {
  const next = queue.then(() => fn(), () => fn());
  queue = next.catch(() => {});
  return next;
}

async function query(handler) {
  return enqueue(async () => {
    const state = await readState();
    const snapshot = JSON.parse(JSON.stringify(state));
    return handler(snapshot);
  });
}

async function mutate(handler) {
  return enqueue(async () => {
    const state = await readState();
    const result = await handler(state);
    await writeState(state);
    return result;
  });
}

module.exports = {
  query,
  mutate
};
