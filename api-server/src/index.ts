import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());
app.use(cors());

// --- Multi-key, single-model configuration ---
const API_KEYS: string[] = [];
for (let i = 1; i <= 10; i++) {
const key = i === 1 ? process.env.GEMINI_API_KEY : process.env[`GEMINI_API_KEY_${i}`];
if (key) API_KEYS.push(key);
}
if (API_KEYS.length === 0) throw new Error("No GEMINI_API_KEY configured");

// Cleaned up to only use the working 2026 free-tier model
const MODEL_NAME = "gemini-2.5-flash";

const exhaustedKeys = new Set<number>();
let activeKeyIndex = 0;

function getActiveModel() {
const client = new GoogleGenerativeAI(API_KEYS[activeKeyIndex]);
return client.getGenerativeModel({ model: MODEL_NAME });
}

function findNextAvailableKey(): boolean {
for (let k = 0; k < API_KEYS.length; k++) {
if (!exhaustedKeys.has(k)) {
activeKeyIndex = k;
return true;
}
}
return false;
}

function markCurrentKeyExhausted(status: number): boolean {
exhaustedKeys.add(activeKeyIndex);
console.warn(`⚠️ Key ${activeKeyIndex + 1}/${API_KEYS.length} exhausted (${status}) — rotating...`);

const found = findNextAvailableKey();
if (found) {
console.log(`➡️ Now using key ${activeKeyIndex + 1}/${API_KEYS.length} + ${MODEL_NAME}`);
} else {
console.error("❌ All API keys are completely exhausted. Daily quotas hit.");
}
return found;
}

function resetRotation() {
exhaustedKeys.clear();
activeKeyIndex = 0;
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function escapeMd(text: string): string {
return text.replace(/([_*`\[])/g, "\\$1");
}

async function sendToTelegram(tweet: string, reply: string, link: string) {
if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
console.warn("⚠️ Telegram environmental secrets are missing or incomplete.");
return;
}

const message = `📝 *New Tweet Scraped!*\n\n*Original text:*\n"${escapeMd(tweet)}"\n\n🤖 *Suggested Reply:*\n\`${escapeMd(reply)}\`\n\n🔗 *Post Link:*\n${link || 'No link captured'}`;

const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
chat_id: TELEGRAM_CHAT_ID,
text: message,
parse_mode: 'Markdown'
}),
});

const data = await res.json() as any;
if (!data.ok) {
console.error("Telegram error:", JSON.stringify(data));
} else {
console.log("📲 Notification pushed to Telegram with Link! ✅");
}
}

// --- History log & stats ---
const MAX_HISTORY = 50;
const history: { tweet: string; reply: string; timestamp: string }[] = [];
const stats = { total: 0, success: 0, failed: 0, startedAt: new Date().toISOString() };

function addToHistory(tweet: string, reply: string) {
history.unshift({ tweet, reply, timestamp: new Date().toISOString() });
if (history.length > MAX_HISTORY) history.pop();
stats.total++;
stats.success++;
}

function recordFailure() {
stats.total++;
stats.failed++;
}

// --- Queue system ---
const DELAY_MS = 13000;

type QueueItem = {
text: string;
link: string;
resolve: (reply: string) => void;
reject: (err: Error) => void;
};

const queue: QueueItem[] = [];
let processing = false;
let paused = false;

async function processQueue() {
if (processing || queue.length === 0) return;
processing = true;

while (queue.length > 0) {
while (paused) {
await new Promise((r) => setTimeout(r, 1000));
}
const item = queue.shift()!;
console.log(`Processing queue (${queue.length} remaining): "${item.text.substring(0, 30)}..."`);

let success = false;
let lastErr: any;

// Strictly loops based on how many real keys you have active
for (let attempt = 0; attempt < API_KEYS.length && !success; attempt++) {
const currentKeyNum = activeKeyIndex + 1;
console.log(`Using model: ${MODEL_NAME} | key: ${currentKeyNum}/${API_KEYS.length}`);

try {
const prompt = `Analyze this tweet and write a trendy, engaging, and short reply. Tweet to analyze: "${item.text}"`;
const result = await getActiveModel().generateContent(prompt);
const reply = result.response.text();

console.log(`✅ AI Reply (key ${currentKeyNum}):`, reply);

item.resolve(reply);
addToHistory(item.text, reply);

sendToTelegram(item.text, reply, item.link).catch((e) =>
console.error("Telegram send failed:", e)
);
success = true;
} catch (err: any) {
lastErr = err;
const status = err?.status;
const rotatable = status === 429 || status === 404;

if (rotatable) {
const switched = markCurrentKeyExhausted(status);
if (!switched) break;
} else {
console.warn(`Transient error (${status || 'Unknown'}), retrying in 15s...`);
await new Promise((r) => setTimeout(r, 15000));
break;
}
}
}

if (!success) {
console.error("Failed to process item:", lastErr);
item.reject(lastErr instanceof Error ? lastErr : new Error(String(lastErr)));
recordFailure();
}

if (queue.length > 0) {
await new Promise((r) => setTimeout(r, DELAY_MS));
}
}

processing = false;
}

function enqueue(text: string, link: string): Promise<string> {
return new Promise((resolve, reject) => {
queue.push({ text, link, resolve, reject });
console.log(`Queued tweet. Queue size: ${queue.length}`);
processQueue();
});
}

// --- Routes ---
app.post('/analyze', async (req: any, res: any) => {
console.log("📥 /analyze body received:", JSON.stringify(req.body));
const { text, link, url, tweetUrl, tweet_url } = req.body;
const resolvedLink = link || url || tweetUrl || tweet_url || "";

if (!text) {
return res.status(400).json({ error: "No tweet text provided." });
}

try {
const aiReply = await enqueue(text, resolvedLink);
res.json({ reply: aiReply });
} catch (error: any) {
res.status(500).json({ reply: "Cloud Brain queue encountered an error processing this request." });
}
});

app.get("/queue", (_req: any, res: any) => {
res.json({ waiting: queue.length, processing, paused });
});

app.post("/queue/pause", (_req: any, res: any) => {
paused = true;
res.json({ ok: true, paused });
});

app.post("/queue/resume", (_req: any, res: any) => {
paused = false;
res.json({ ok: true, paused });
});

app.post("/queue/clear", (_req: any, res: any) => {
const dropped = queue.length;
queue.forEach((item) => item.reject(new Error("Queue cleared by operator")));
queue.splice(0);
res.json({ ok: true, dropped });
});

app.get("/history", (_req: any, res: any) => {
res.json({ count: history.length, items: history });
});

app.get("/stats", (_req: any, res: any) => {
const uptimeSeconds = Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000);
const successRate = stats.total === 0 ? 100 : Math.round((stats.success / stats.total) * 100);
res.json({
uptime: `${Math.floor(uptimeSeconds / 60)}m ${uptimeSeconds % 60}s`,
totalAnalyzed: stats.total,
successful: stats.success,
failed: stats.failed,
successRate: `${successRate}%`,
queueNow: queue.length,
activeModel: MODEL_NAME,
activeKey: `${activeKeyIndex + 1}/${API_KEYS.length}`,
totalKeys: API_KEYS.length,
});
});

// Fixed Reset Route - Handles single-model key rotation tracking sets cleanl
app.all("/model/reset", (_req: any, res: any) => {
exhaustedKeys.clear();
activeKeyIndex = 0;
console.log(`🔄 Rotation reset manually — back to API Key 1/${API_KEYS.length} using ${MODEL_NAME}`);
res.json({ ok: true, message: "Rotation tracking fully wiped!", activeKey: `1/${API_KEYS.length}` });
});
app.get("/test-telegram", async (_req: any, res: any) => {
try {
await sendToTelegram("Test tweet 🧪", "Telegram link integration verified! ✅", "https://x.com");
res.json({ ok: true, message: "Test link message sent!" });
} catch (err: any) {
res.status(500).json({ ok: false, error: err.message });
}
});

app.listen(8080, () => {
console.log("🧠 Level 2 & 3 AI Server (Streamlined Multi-Key Edition) is listening on port 8080!");
});