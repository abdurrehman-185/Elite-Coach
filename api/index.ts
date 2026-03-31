import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import { createRequire } from "module";
import "dotenv/config";
import axios from "axios";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const app = express();
const PORT = 3000;

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// API Router
const apiRouter = express.Router();

apiRouter.get("/test", (req, res) => {
  res.json({ message: "API is working", timestamp: new Date().toISOString() });
});

apiRouter.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.3", timestamp: new Date().toISOString() });
});

// API: Parse PDF
apiRouter.post("/parse-pdf", upload.single("file"), async (req, res) => {
  console.log("Received PDF parse request");
  try {
    if (!req.file) {
      console.error("No file in request");
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    console.log("File received:", req.file.originalname, "Size:", req.file.size);
    
    let pdfParser: any = pdf;
    if (typeof pdfParser !== "function" && pdfParser && typeof pdfParser.default === "function") {
      pdfParser = pdfParser.default;
    }

    if (typeof pdfParser !== "function") {
      return res.status(500).json({ error: "PDF parser not correctly loaded." });
    }
    
    const data = await pdfParser(req.file.buffer);
    console.log("PDF Parsed successfully, text length:", data.text?.length);
    
    if (!data.text || data.text.trim().length === 0) {
      return res.status(422).json({ error: "PDF contains no readable text" });
    }

    res.json({ text: data.text });
  } catch (error: any) {
    console.error("PDF Parsing Error:", error);
    let message = "Unknown error";
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    } else {
      try {
        message = JSON.stringify(error);
      } catch (e) {
        message = String(error);
      }
    }
    res.status(500).json({ 
      error: `Failed to parse PDF: ${message}`,
      details: process.env.NODE_ENV !== 'production' ? error : undefined
    });
  }
});

// API: Search Firms (Tavily Proxy)
apiRouter.post("/search-firms", async (req, res) => {
  const { query } = req.body;
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return res.json({
      results: [
        { title: `${query || "The Firm"} - Training Contracts`, url: "https://careers.example.com", content: `${query || "This firm"} is a top-tier firm looking for commercially aware candidates with strong academic backgrounds.` },
        { title: "Magic Circle Graduate Careers", url: "https://careers.example.com", content: "Elite firms offer world-class training and complex cross-border work for future solicitors." },
        { title: "Legal Cheek - Firm Profile", url: "https://www.legalcheek.com", content: "Detailed breakdown of salary, hours, and culture at top UK law firms." }
      ],
      note: "Using mock data because TAVILY_API_KEY is missing."
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
    console.error("Search Error:", error.response?.status, error.response?.data || error.message);
    if (error.response?.status === 401) {
      return res.json({
        results: [
          { title: `${query || "The Firm"} - Training Contracts`, url: "https://careers.example.com", content: `${query || "This firm"} is a top-tier firm looking for commercially aware candidates with strong academic backgrounds.` },
          { title: "Magic Circle Graduate Careers", url: "https://careers.example.com", content: "Elite firms offer world-class training and complex cross-border work for future solicitors." },
          { title: "Legal Cheek - Firm Profile", url: "https://www.legalcheek.com", content: "Detailed breakdown of salary, hours, and culture at top UK law firms." }
        ],
        note: "Using mock data due to invalid API key."
      });
    }
    res.status(500).json({ error: "Search failed: " + (error.response?.data?.detail || error.message) });
  }
});

app.use("/api", apiRouter);

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Error Handler:", err);
  const message = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err));
  res.status(err.status || 500).json({
    error: message || "Internal Server Error"
  });
});

// Export for Vercel
export default app;

// Local server start
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  const startServer = async () => {
    const distPath = path.join(process.cwd(), "dist");
    if (process.env.NODE_ENV !== "production" || !fs.existsSync(distPath)) {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  };

  startServer().catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
