import express from "express";
import multer from "multer";
import { createRequire } from "module";
import { config } from "dotenv";
import axios from "axios";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

config({ path: ".env.local" });
config();

const app = express();
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "ai-cache.json");
const CACHE_SIMILARITY_THRESHOLD = Number(process.env.AI_CACHE_SIMILARITY_THRESHOLD || 0.92);
const CACHE_MAX_RECORDS = Number(process.env.AI_CACHE_MAX_RECORDS || 500);
const RATE_LIMIT_PER_MINUTE = Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 5);
const RATE_LIMIT_PER_DAY = Number(process.env.AI_RATE_LIMIT_PER_DAY || 50);

type CacheRecord = {
  scope: string;
  model: string;
  promptHash: string;
  normalizedPrompt: string;
  response: string;
  createdAt: string;
  hits: number;
};

type RateRecord = {
  minuteWindow: number;
  minuteCount: number;
  day: string;
  dayCount: number;
};

let aiCache: CacheRecord[] = [];
const rateLimits = new Map<string, RateRecord>();
let groqKeyIndex = 0;

const FIRM_INTELLIGENCE_SEEDS: Record<string, string> = {
  "Clifford Chance": "Global Magic Circle firm; strengths include finance, capital markets, M&A, private equity, antitrust, disputes, tech, infrastructure, energy transition, and cross-border mandates.",
  "Linklaters": "Global Magic Circle firm; known for finance, corporate/M&A, capital markets, restructuring, antitrust, technology, energy, infrastructure, and heavily international client work.",
  "Freshfields Bruckhaus Deringer": "Magic Circle firm; known for premium corporate transactions, antitrust, disputes, financial institutions, regulatory work, private capital, crisis matters, and global board-level advisory.",
  "Allen & Overy": "Global elite law firm; known for finance, capital markets, corporate, tech, regulatory, energy, infrastructure, and highly international transactions.",
  "Slaughter and May": "Elite UK firm; known for high-end corporate, public M&A, financing, competition, disputes, restructuring, and a distinctive multi-specialist training style.",
  "Latham & Watkins": "Global US firm; known for private equity, leveraged finance, capital markets, M&A, disputes, restructuring, technology, energy, infrastructure, and entrepreneurial training culture.",
  "Kirkland & Ellis": "Global US firm; known for private equity, M&A, restructuring, finance, litigation, investment funds, and a high-performance commercial culture.",
  "White & Case": "Global law firm; known for cross-border disputes, international arbitration, project finance, banking, capital markets, energy, infrastructure, and emerging markets work.",
  "Skadden": "Global US firm; known for public M&A, securities, litigation, white collar, antitrust, capital markets, tax, and high-stakes board-level transactions.",
  "Herbert Smith Freehills": "Global firm; known for disputes, energy, infrastructure, corporate, finance, regulatory work, mining, technology, and Asia-Pacific strength.",
};

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// API Router
const apiRouter = express.Router();

const normalizePrompt = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const promptHash = (scope: string, model: string, normalizedPrompt: string) => {
  return crypto
    .createHash("sha256")
    .update(`${scope}:${model}:${normalizedPrompt}`)
    .digest("hex");
};

const tokenSimilarity = (a: string, b: string) => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }

  return overlap / Math.max(left.size, right.size);
};

const loadCache = () => {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      aiCache = parsed;
    }
  } catch (error) {
    console.warn("AI cache could not be loaded:", error);
    aiCache = [];
  }
};

const saveCache = () => {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(aiCache.slice(-CACHE_MAX_RECORDS), null, 2));
  } catch (error) {
    console.warn("AI cache could not be saved:", error);
  }
};

const getCachedResponse = (scope: string, prompt: string, allowSimilar = false) => {
  const normalized = normalizePrompt(prompt);
  const hash = promptHash(scope, GROQ_MODEL, normalized);
  const exactMatch = aiCache.find(record => record.promptHash === hash);
  if (exactMatch) {
    exactMatch.hits += 1;
    saveCache();
    return exactMatch.response;
  }

  if (!allowSimilar) return null;

  const closeMatch = aiCache.find(record => {
    return (
      record.scope === scope &&
      record.model === GROQ_MODEL &&
      tokenSimilarity(record.normalizedPrompt, normalized) >= CACHE_SIMILARITY_THRESHOLD
    );
  });

  if (closeMatch) {
    closeMatch.hits += 1;
    saveCache();
    return closeMatch.response;
  }

  return null;
};

const setCachedResponse = (scope: string, prompt: string, response: string) => {
  const normalized = normalizePrompt(prompt);
  aiCache.push({
    scope,
    model: GROQ_MODEL,
    promptHash: promptHash(scope, GROQ_MODEL, normalized),
    normalizedPrompt: normalized,
    response,
    createdAt: new Date().toISOString(),
    hits: 0,
  });

  if (aiCache.length > CACHE_MAX_RECORDS) {
    aiCache = aiCache.slice(-CACHE_MAX_RECORDS);
  }

  saveCache();
};

const getGroqKeys = () => {
  const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);

  if (!keys.length) {
    throw new Error("GROQ_API_KEY is missing. Add it to your server environment before using AI features.");
  }

  return keys;
};

const isQuotaError = (error: any) => {
  const status = error.response?.status;
  const message = String(error.response?.data?.error?.message || error.message || "").toLowerCase();
  return status === 429 || message.includes("rate limit") || message.includes("quota") || message.includes("resource_exhausted");
};

const enforceSingleQuestion = (text: string, questionNumber: number) => {
  const nextQuestion = questionNumber + 1;
  const nextQuestionPattern = new RegExp(`\\n\\s*(#{1,6}\\s*)?QUESTION\\s+${nextQuestion}\\b`, "i");
  const match = text.match(nextQuestionPattern);
  if (!match || match.index === undefined) return text.trim();

  return text.slice(0, match.index).trim();
};

const aiRateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const identity = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const minuteWindow = Math.floor(now / 60000);
  const day = new Date(now).toISOString().slice(0, 10);
  const current = rateLimits.get(identity);
  const record: RateRecord = current && current.day === day
    ? current
    : { minuteWindow, minuteCount: 0, day, dayCount: 0 };

  if (record.minuteWindow !== minuteWindow) {
    record.minuteWindow = minuteWindow;
    record.minuteCount = 0;
  }

  if (record.minuteCount >= RATE_LIMIT_PER_MINUTE || record.dayCount >= RATE_LIMIT_PER_DAY) {
    return res.status(429).json({
      error: "Too many requests, please wait before trying again.",
      limits: {
        perMinute: RATE_LIMIT_PER_MINUTE,
        perDay: RATE_LIMIT_PER_DAY,
      },
    });
  }

  record.minuteCount += 1;
  record.dayCount += 1;
  rateLimits.set(identity, record);
  next();
};

const groqChat = async ({
  cacheScope,
  system,
  user,
  json = false,
  temperature = 0.35,
  maxTokens = 2500,
  allowSimilarCache = false,
}: {
  cacheScope: string;
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  allowSimilarCache?: boolean;
}) => {
  const cachePrompt = `${system}\n\n${user}`;
  const cached = getCachedResponse(cacheScope, cachePrompt, allowSimilarCache);
  if (cached) return cached;

  // Keep all keys on the server in environment variables. Never send them in API
  // responses, health payloads, frontend config, logs, or bundled client code.
  const keys = getGroqKeys();
  let lastError: any;

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const keyIndex = (groqKeyIndex + attempt) % keys.length;
    try {
      const response = await axios.post(
        GROQ_API_URL,
        {
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature,
          max_completion_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${keys[keyIndex]}`,
            "Content-Type": "application/json",
          },
          timeout: 60000,
        },
      );

      groqKeyIndex = keyIndex;
      const text = response.data?.choices?.[0]?.message?.content || "";
      setCachedResponse(cacheScope, cachePrompt, text);
      return text;
    } catch (error: any) {
      lastError = error;
      if (!isQuotaError(error) || attempt === keys.length - 1) {
        throw error;
      }
      groqKeyIndex = (keyIndex + 1) % keys.length;
      console.warn(`Groq key ${keyIndex + 1} hit a quota/rate limit; retrying with the next configured key.`);
    }
  }

  throw lastError;
};

const parseJSON = (text: string) => {
  try {
    const cleanText = text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanText);
  } catch (error) {
    console.error("JSON Parse Error:", error, "Original Text:", text);
    throw new Error("Failed to parse AI response. The model returned malformed data.");
  }
};

const sendAIError = (res: express.Response, error: any) => {
  console.error("AI Error:", error);
  const message = error.response?.data?.error?.message || error.message || String(error);
  const status = message.includes("GROQ_API_KEY") ? 503 : error.response?.status || 500;
  res.status(status).json({ error: message });
};

loadCache();

apiRouter.get("/health", (req, res) => {
  const groqKeyCount = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map(key => key.trim())
    .filter(Boolean)
    .length;

  res.json({
    status: "ok",
    env: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
    aiProvider: "groq",
    aiModel: GROQ_MODEL,
    hasAIKey: groqKeyCount > 0,
    hasGroqKey: groqKeyCount > 0,
    groqKeyCount,
    cacheEntries: aiCache.length,
    rateLimits: {
      perMinute: RATE_LIMIT_PER_MINUTE,
      perDay: RATE_LIMIT_PER_DAY,
    },
    hasTavilyKey: Boolean(process.env.TAVILY_API_KEY),
  });
});

apiRouter.post("/analyze-cv", aiRateLimiter, async (req, res) => {
  try {
    const { cvText, targetFirm } = req.body;
    if (!cvText || !targetFirm) {
      return res.status(400).json({ error: "cvText and targetFirm are required" });
    }

    const text = await groqChat({
      cacheScope: "analyze-cv",
      allowSimilarCache: true,
      json: true,
      system: `You are a ruthless but fair Magic Circle recruiting partner. Return only valid JSON with this exact shape:
      {"score":number,"matchProbability":number,"feedback":{"structure":string,"commercialImpact":string,"legalRelevance":string},"rewrittenBullets":string[]}`,
      user: `Analyze this CV for a Training Contract at ${targetFirm}.
      CV Content: ${String(cvText).substring(0, 4000)}`,
    });

    res.json(parseJSON(text || "{}"));
  } catch (error: any) {
    sendAIError(res, error);
  }
});

apiRouter.post("/firm-intelligence", aiRateLimiter, async (req, res) => {
  try {
    const { firmName, searchData } = req.body;
    if (!firmName || !searchData) {
      return res.status(400).json({ error: "firmName and searchData are required" });
    }

    const firmSeed = FIRM_INTELLIGENCE_SEEDS[firmName] || `${firmName} is a commercial law firm. Build a practical candidate briefing from available market knowledge.`;
    const text = await groqChat({
      cacheScope: `firm-intelligence-v3-${String(firmName).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      json: true,
      system: `You are a legal careers research analyst preparing a candidate for a training contract interview.
      Return only valid JSON with this exact shape:
      {"name":string,"recentDeals":string,"coreValues":string,"interviewStyle":string}

      Make every field genuinely useful and specific. Do not say "not specified" or "not available".
      If live search data is thin, use reliable general market knowledge and phrase recent-deals content as market themes and practice strengths.
      Each field should be 2-4 concise paragraphs or bullet-style lines.`,
      user: `Firm: ${firmName}
      Firm baseline context: ${firmSeed}
      Search Data: ${String(searchData).substring(0, 12000)}`,
    });

    res.json(parseJSON(text || "{}"));
  } catch (error: any) {
    sendAIError(res, error);
  }
});

apiRouter.post("/interview/start", aiRateLimiter, async (req, res) => {
  try {
    const { firmName, cvText = "" } = req.body;
    if (!firmName) {
      return res.status(400).json({ error: "firmName is required" });
    }
    if (!String(cvText).trim()) {
      return res.status(400).json({ error: "Upload and analyze a CV before starting the mock interview." });
    }

    const text = await groqChat({
      cacheScope: "interview-start-v3",
      maxTokens: 450,
      system: `You are John, a Senior Partner at ${firmName}. You are conducting a high-stakes final round training contract interview.

        THE INTERVIEW FORMAT:
        1. Ask exactly one question at a time.
        2. This first response must include only a short introduction and "### QUESTION 1".
        3. Make Question 1 specific to the candidate's CV and ${firmName}.
        4. Do not include Questions 2-5 yet.
        5. Keep it under 170 words.
        6. If you include "QUESTION 2" or any later question, the response is invalid.

        The user's CV context: ${String(cvText).substring(0, 2000)}.`,
      user: "Start the interview with only Question 1.",
    });

    res.json({ text: enforceSingleQuestion(text, 1) });
  } catch (error: any) {
    sendAIError(res, error);
  }
});

apiRouter.post("/interview/evaluate", aiRateLimiter, async (req, res) => {
  try {
    const { firmName, cvText = "", answers, questionNumber = 1, transcript = [] } = req.body;
    if (!firmName || !answers) {
      return res.status(400).json({ error: "firmName and answers are required" });
    }
    if (!String(cvText).trim()) {
      return res.status(400).json({ error: "Upload and analyze a CV before continuing the mock interview." });
    }

    const currentQuestion = Math.max(1, Math.min(5, Number(questionNumber) || 1));
    const transcriptText = Array.isArray(transcript)
      ? transcript
          .map((message: any) => `${message.role === "assistant" ? "Partner" : "Candidate"}: ${String(message.content || "").substring(0, 1800)}`)
          .join("\n\n")
          .substring(0, 10000)
      : "";
    const isFinalQuestion = currentQuestion >= 5;

    const text = await groqChat({
      cacheScope: isFinalQuestion ? "interview-final-v3" : `interview-next-q${currentQuestion + 1}-v3`,
      maxTokens: isFinalQuestion ? 3600 : 650,
      system: `You are John, a Senior Partner at ${firmName}. You are running a realistic one-question-at-a-time training contract mock interview.

        If this is not the final answer:
        - Briefly acknowledge the candidate's answer in one sentence.
        - Ask exactly one next question using heading "### QUESTION ${Math.min(currentQuestion + 1, 5)}".
        - Make the question harder, commercially sharper, and connected to the candidate's previous answer, CV, or ${firmName}.
        - Do not score yet. Do not reveal later questions.
        - If you include any question after QUESTION ${Math.min(currentQuestion + 1, 5)}, the response is invalid.

        If this is the final answer:
        - Give the full result and development plan.
        - Include:
          # FINAL VERDICT: [PASS/FAIL]
          ## TRUE SCORE: [X]/100
          ### PERFORMANCE SNAPSHOT
          ### WHAT YOU DID WELL
          ### AREAS TO IMPROVE
          ### ELITE ANSWER HABITS TO BUILD
          ### 7-DAY PRACTICE PLAN
        - Be frank, specific, and actionable.
        - At the VERY END include [[SENTIMENT: X, AWARENESS: Y]] where X and Y are numbers between 0 and 100.

        The user's CV context: ${String(cvText).substring(0, 2000)}.`,
      user: `Current question number: ${currentQuestion} of 5
      Is this the final question? ${isFinalQuestion ? "yes" : "no"}

      Interview transcript so far:
      ${transcriptText}

      Candidate's latest answer:
      ${String(answers).substring(0, 4000)}

      ${isFinalQuestion ? "Now provide the final verdict and improvement plan." : `Now ask only Question ${currentQuestion + 1}.`}`,
    });

    res.json({ text: isFinalQuestion ? text : enforceSingleQuestion(text, currentQuestion + 1) });
  } catch (error: any) {
    sendAIError(res, error);
  }
});

// API: Parse PDF
apiRouter.post("/parse-pdf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    let pdfParser = pdf;
    if (typeof pdfParser !== "function" && pdfParser && typeof pdfParser.default === "function") {
      pdfParser = pdfParser.default;
    }

    if (typeof pdfParser !== "function") {
      throw new Error("PDF parser is not a function");
    }
    
    const data = await pdfParser(req.file.buffer);
    if (!data.text || data.text.trim().length === 0) {
      return res.status(422).json({ error: "PDF contains no readable text" });
    }

    res.json({ text: data.text });
  } catch (error: any) {
    console.error("PDF Parsing Error:", error);
    res.status(500).json({ 
      error: `Failed to parse PDF: ${error.message || String(error)}`
    });
  }
});

apiRouter.post("/search-firms", async (req, res) => {
  const { query } = req.body;
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    const firmContext = FIRM_INTELLIGENCE_SEEDS[query] || FIRM_INTELLIGENCE_SEEDS[String(query || "").trim()] || `${query || "This firm"} is a commercial law firm with training contract candidates expected to show commercial awareness, client focus, and clear motivation.`;
    return res.json({
      results: [
        {
          title: `${query || "The Firm"} candidate intelligence baseline`,
          url: "https://careers.example.com",
          content: `${firmContext} Strong candidates should connect the firm's practice strengths to client demand, regulatory change, AI adoption, financing conditions, energy transition, private capital, and cross-border risk. Interview answers should show why this firm, why commercial law, and why the candidate's CV creates credible evidence of fit.`
        }
      ],
      note: "Mock data (No API Key)"
    });
  }

  try {
    const response = await axios.post("https://api.tavily.com/search", {
      api_key: apiKey,
      query: `UK law firms hiring training contracts 2026 ${query || ""}`,
      search_depth: "advanced",
      max_results: 5
    });
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: "Search failed" });
  }
});

app.use("/api", apiRouter);

// Export for Vercel
export default app;

// Local development server
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const PORT = 3000;
  const startDevServer = async () => {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Dev server running on http://localhost:${PORT}`);
    });
  };
  startDevServer();
}
