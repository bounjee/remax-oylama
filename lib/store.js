const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "oylama.json");
const REDIS_STATE_KEY = "remax-oylama:state";

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 503;
    this.expose = true;
  }
}

function shouldUseRedis() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function isLambdaRuntime() {
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    const { Redis } = require("@upstash/redis");
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
  }
  return redisClient;
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

async function readRedisStore() {
  const redis = getRedis();
  const raw = await redis.get(REDIS_STATE_KEY);
  if (raw == null || raw === "") {
    const fresh = createInitialData();
    await redis.set(REDIS_STATE_KEY, JSON.stringify(fresh));
    return fresh;
  }
  const str = typeof raw === "string" ? raw : JSON.stringify(raw);
  try {
    return normalizeLoaded(JSON.parse(str));
  } catch {
    const fresh = createInitialData();
    await redis.set(REDIS_STATE_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

async function writeRedisStore(data) {
  const redis = getRedis();
  await redis.set(REDIS_STATE_KEY, JSON.stringify(data));
}

function ensureStorageConfigured() {
  if (isLambdaRuntime() && !shouldUseRedis()) {
    throw new ConfigError(
      "Veritabanı ayarı eksik: Netlify → Environment variables içine Upstash Redis bilgilerini ekleyin: UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN. (Ücretsiz: console.upstash.com → Create database → REST API → URL ve TOKEN kopyala.) README’de adımlar var."
    );
  }
}

async function readState() {
  ensureStorageConfigured();
  if (shouldUseRedis()) return readRedisStore();
  return readFileStore();
}

async function writeState(data) {
  ensureStorageConfigured();
  if (shouldUseRedis()) return writeRedisStore(data);
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
  mutate,
  ConfigError
};
