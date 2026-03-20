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

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

interface MulterRequest extends express.Request {
  file?: any;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Logging middleware - MOVE TO TOP
  app.use((req, res, next) => {
    const start = Date.now();
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log("Headers:", JSON.stringify(req.headers));
    
    // Log response
    const oldJson = res.json;
    res.json = function(data) {
      console.log(`[${new Date().toISOString()}] Response for ${req.url}: ${res.statusCode} (JSON)`);
      return oldJson.call(this, data);
    };
    
    const oldSend = res.send;
    res.send = function(data) {
      console.log(`[${new Date().toISOString()}] Response for ${req.url}: ${res.statusCode} (Send)`);
      return oldSend.call(this, data);
    };

    next();
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API Router
  const apiRouter = express.Router();

  apiRouter.get("/test", (req, res) => {
    res.json({ message: "API is working", timestamp: new Date().toISOString() });
  });

  apiRouter.get("/health", (req, res) => {
    res.cookie('session_check', 'true', { sameSite: 'none', secure: true, maxAge: 24 * 60 * 60 * 1000 });
    res.json({ status: "ok", version: "1.0.2", timestamp: new Date().toISOString() });
  });

  // API: Debug PDF Parser
  apiRouter.get("/debug-pdf", async (req, res) => {
    try {
      let pdfParser: any = pdf;
      if (typeof pdfParser !== "function" && pdfParser && typeof pdfParser.default === "function") {
        pdfParser = pdfParser.default;
      }
      
      if (typeof pdfParser !== "function") {
        return res.status(500).json({ error: "PDF parser not correctly loaded.", type: typeof pdfParser });
      }
      
      // Create a dummy PDF buffer (minimal PDF)
      const dummyPdf = Buffer.from("%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Hello World) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000111 00000 n\n0000000212 00000 n\n0000000289 00000 n\ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n383\n%%EOF");
      
      const data = await pdfParser(dummyPdf);
      res.json({ message: "PDF Parser is working", text: data.text });
    } catch (error) {
      res.status(500).json({ error: "PDF Parser Debug Failed: " + (error instanceof Error ? error.message : String(error)) });
    }
  });

  // API: Parse PDF
  apiRouter.post("/parse-pdf", upload.single("file"), async (req, res) => {
    console.log("Received PDF parse request - Main Handler");
    try {
      const multerReq = req as MulterRequest;
      if (!multerReq.file) {
        console.error("No file in request");
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      console.log("File received:", multerReq.file.originalname, "Size:", multerReq.file.size);
      
      let pdfParser: any = pdf;
      if (typeof pdfParser !== "function" && pdfParser && typeof pdfParser.default === "function") {
        pdfParser = pdfParser.default;
      }

      if (typeof pdfParser !== "function") {
        return res.status(500).json({ error: "PDF parser not correctly loaded." });
      }
      
      const data = await pdfParser(multerReq.file.buffer);
      console.log("PDF Parsed successfully, text length:", data.text?.length);
      
      if (!data.text || data.text.trim().length === 0) {
        return res.status(422).json({ error: "PDF contains no readable text" });
      }

      res.json({ text: data.text });
    } catch (error) {
      console.error("PDF Parsing Error:", error);
      res.status(500).json({ error: "Failed to parse PDF: " + (error instanceof Error ? error.message : String(error)) });
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
      
      // If 401 (Unauthorized), fallback to mock data so the app doesn't break
      if (error.response?.status === 401) {
        console.warn("Tavily API Key invalid or expired. Falling back to mock data.");
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

  // Mount API Router
  app.use("/api", apiRouter);

  // Catch-all for API routes to prevent falling through to SPA fallback
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error Handler:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error"
    });
  });

  // Vite middleware for development
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
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
