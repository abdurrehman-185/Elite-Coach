# Clerked

Clerked is an AI training-contract coach for aspiring commercial lawyers. It combines PDF CV analysis, firm intelligence, and a five-question adaptive mock interview flow tailored to the user's CV and target firm.

## Features

- PDF CV parsing and partner-style CV feedback
- Firm intelligence reports for major law firms
- CV-gated mock interview flow
- One-question-at-a-time interview simulation
- Final verdict, score, improvement areas, and practice plan
- Server-side Groq API integration
- AI response caching, per-IP rate limits, and Groq key rotation

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from `.env.example` and add server-side keys:

   ```bash
   GROQ_API_KEY=your_groq_key
   GROQ_API_KEYS=optional_key_1,optional_key_2
   GROQ_MODEL=llama-3.3-70b-versatile
   TAVILY_API_KEY=optional_tavily_key
   ```

3. Run the app:

   ```bash
   npm run dev
   ```

4. Open:

   ```text
   http://localhost:3000
   ```

## Deployment Notes

Keep all API keys server-side. Do not expose Groq or Tavily keys through Vite client environment variables. On Vercel, set `GROQ_API_KEY` or `GROQ_API_KEYS` in the project environment variables.

The local file cache in `.cache/` is useful for development. For production, replace it with durable storage such as Redis, Upstash, Supabase, or Postgres.
