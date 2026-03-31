import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { createRequire } from "module";
import "dotenv/config";
import axios from "axios";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const app = express();

// Logging middleware
app.use((req, res, next) => {
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

apiRouter.get("/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV, vercel: !!process.env.VERCEL });
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
    return res.json({
      results: [
        { title: `${query || "The Firm"} - Training Contracts`, url: "https://careers.example.com", content: `${query || "This firm"} is a top-tier firm looking for commercially aware candidates.` }
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
