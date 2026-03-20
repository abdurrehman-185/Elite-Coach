import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  Search, 
  MessageSquare, 
  Upload, 
  ChevronRight, 
  BarChart3, 
  History, 
  Shield, 
  Briefcase,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { cn } from './lib/utils';
import { AppMode, CVAnalysis, FirmIntelligence, InterviewMessage } from './types';
import { analyzeCV, getFirmIntelligence } from './services/ai';
import { GoogleGenAI } from '@google/genai';

const FIRMS = [
  "Clifford Chance",
  "Linklaters",
  "Freshfields Bruckhaus Deringer",
  "Allen & Overy",
  "Slaughter and May",
  "Latham & Watkins",
  "Kirkland & Ellis",
  "White & Case",
  "Skadden",
  "Herbert Smith Freehills"
];

const API_KEY_MISSING = !process.env.GEMINI_API_KEY;

export default function App() {
  const [mode, setMode] = useState<AppMode>('dashboard');
  const [selectedFirm, setSelectedFirm] = useState<string>(FIRMS[0]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);
  const [cvAnalysis, setCvAnalysis] = useState<CVAnalysis | null>(null);
  const [intelligence, setIntelligence] = useState<FirmIntelligence | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [cvText, setCvText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chatSessionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const initSession = async () => {
      try {
        // Pre-flight to establish session/cookies
        await fetch('/api/health', { 
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
      } catch (e) {
        console.warn("Session init pre-flight:", e);
      }
    };
    
    initSession();

    const headers = { 
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json'
    };

    fetch('/api/test', { credentials: 'include', headers })
      .then(async res => {
        const contentType = res.headers.get("content-type");
        if (res.ok && contentType && contentType.includes("application/json")) {
          return res.json();
        }
        throw new Error(`Status ${res.status}: ${await res.text().then(t => t.substring(0, 50))}`);
      })
      .then(data => console.log("API Test Success:", data))
      .catch(err => console.warn("API Test (Expected during restart):", err.message));

    fetch('/api/debug-pdf', { credentials: 'include', headers })
      .then(async res => {
        const contentType = res.headers.get("content-type");
        if (res.ok && contentType && contentType.includes("application/json")) {
          return res.json();
        }
        throw new Error(`Status ${res.status}: ${await res.text().then(t => t.substring(0, 50))}`);
      })
      .then(data => console.log("PDF Parser Debug Success:", data))
      .catch(err => console.warn("PDF Parser Debug Failed:", err.message));
  }, []);

  const onDrop = async (acceptedFiles: File[], rejectedFiles: any[]) => {
    console.log("onDrop called with files:", acceptedFiles, "Rejected:", rejectedFiles);
    
    if (rejectedFiles.length > 0) {
      setError(`File rejected: ${rejectedFiles[0].errors[0].message}. Please upload a valid PDF.`);
      return;
    }

    const file = acceptedFiles[0];
    if (!file) {
      console.warn("No file accepted");
      return;
    }

    setIsAnalyzing(true);
    setLoadingStep("Parsing PDF...");
    setError(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      console.log("Starting PDF parse for file:", file.name);
      const res = await fetch('/api/parse-pdf', { 
        method: 'POST', 
        body: formData,
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        }
      });
      
      const contentType = res.headers.get("content-type");
      const isJson = contentType && contentType.includes("application/json");
      
      if (!res.ok || !isJson) {
        const text = await res.text();
        let errorMessage = 'Failed to parse PDF';
        
        if (isJson) {
          try {
            const errData = JSON.parse(text);
            errorMessage = errData.error || errorMessage;
          } catch (e) {}
        } else {
          const isHtml = text.toLowerCase().includes('<!doctype html>') || text.toLowerCase().includes('<html>');
          if (isHtml) {
            if (res.url.includes('__cookie_check.html')) {
              errorMessage = "Browser security is blocking the session in the preview. This is common in Safari or when 'Block Third-Party Cookies' is enabled. Please click 'Fix Session' below to authorize, then try again.";
            } else {
              errorMessage = `Server returned HTML instead of JSON (Status ${res.status}). Path: ${res.url}`;
            }
          } else {
            errorMessage = `Server error (${res.status}): ${text.substring(0, 100)}...`;
          }
        }
        throw new Error(errorMessage);
      }
      
      const { text } = await res.json();
      console.log("PDF parsed successfully, text length:", text?.length);
      if (!text || text.trim().length < 10) throw new Error('PDF seems empty or unreadable');
      
      setCvText(text);
      setLoadingStep("Analyzing with AI Partner...");
      console.log("Starting CV analysis for firm:", selectedFirm);
      const analysis = await analyzeCV(text, selectedFirm);
      setCvAnalysis(analysis);
      setMode('cv-analyzer');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during analysis');
    } finally {
      setIsAnalyzing(false);
      setLoadingStep(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false 
  } as any);

  const [questionCount, setQuestionCount] = useState(0);

  const handleSearch = async () => {
    setIsAnalyzing(true);
    setLoadingStep("Searching Market Data...");
    setError(null);
    try {
      const res = await fetch('/api/search-firms', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ query: selectedFirm }),
        credentials: 'include'
      });
      
      const contentType = res.headers.get("content-type");
      const isJson = contentType && contentType.includes("application/json");

      if (!res.ok || !isJson) {
        const text = await res.text();
        if (res.url.includes('__cookie_check.html')) {
          throw new Error("Browser security is blocking the session in the preview. Please click 'Fix Session' below to authorize, then try again.");
        }
        throw new Error(isJson ? (JSON.parse(text).error || 'Search failed') : `Server error (${res.status})`);
      }
      
      const data = await res.json();
      const results = data.results || data; // Handle different API response structures
      
      setLoadingStep("Synthesizing Intelligence...");
      const intel = await getFirmIntelligence(selectedFirm, JSON.stringify(results));
      setIntelligence(intel);
      setMode('intelligence');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to fetch intelligence');
    } finally {
      setIsAnalyzing(false);
      setLoadingStep(null);
    }
  };

  const startInterview = async () => {
    setMode('mock-interview');
    setMessages([]);
    setQuestionCount(1);
    setIsTyping(true);
    setError(null);
    
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Please add it to AI Studio Secrets.");
      
      const ai = new GoogleGenAI({ apiKey });
      const chat = ai.chats.create({
        model: "gemini-3.1-pro-preview",
        config: {
          systemInstruction: `You are a Senior Partner at ${selectedFirm}. You are conducting a final round training contract interview. 
          You are strict, highly professional, and do not accept generic answers. 
          The user's CV context: ${cvText.substring(0, 2000)}.
          Ask one firm-specific question at a time. Total 5 questions.
          For each user response, evaluate it briefly (score 0-100, feedback, model answer) and then ask the next question.
          After the 5th question, provide a final "Hire" or "No-Hire" verdict with a detailed summary of their performance.`
        }
      });
      chatSessionRef.current = chat;

      const response = await chat.sendMessage({ message: "Start the interview. Introduce yourself briefly and ask the first question." });
      if (!response.text) throw new Error("No response from AI");
      setMessages([{ role: 'assistant', content: response.text }]);
    } catch (err: any) {
      console.error(err);
      setError('Failed to start interview');
    } finally {
      setIsTyping(false);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isTyping || !chatSessionRef.current) return;

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsTyping(true);
    setError(null);

    try {
      console.log("Sending message to AI, question count:", questionCount);
      const response = await chatSessionRef.current.sendMessage({ 
        message: questionCount >= 5 
          ? `${userMsg}. This was my final answer. Please provide the final evaluation and verdict.` 
          : userMsg 
      });
      if (!response.text) throw new Error("No response from AI");
      setMessages(prev => [...prev, { role: 'assistant', content: response.text }]);
      setQuestionCount(prev => prev + 1);
    } catch (err: any) {
      console.error("Chat Error:", err);
      setError('Failed to send message: ' + (err.message || 'Unknown error'));
    } finally {
      setIsTyping(false);
    }
  };

  const resetInterview = () => {
    setMode('dashboard');
    setMessages([]);
    setQuestionCount(0);
    chatSessionRef.current = null;
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#E5E5E5] font-sans selection:bg-emerald-500/30">
      {/* Sidebar */}
      <aside className="w-72 border-r border-white/5 bg-[#0D0D0D] flex flex-col p-6">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
            <Shield className="text-black w-6 h-6" />
          </div>
          <h1 className="text-xl font-serif font-semibold tracking-tight text-white">ELITE COACH</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <button 
            onClick={() => setMode('dashboard')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
              mode === 'dashboard' ? "bg-white/5 text-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            )}
          >
            <BarChart3 size={20} />
            <span className="text-sm font-medium">Dashboard</span>
          </button>
          <div className="pt-6 pb-2 px-4">
            <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Active Firm</span>
          </div>
          <select 
            value={selectedFirm}
            onChange={(e) => setSelectedFirm(e.target.value)}
            className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-colors"
          >
            {FIRMS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5">
          <div className="flex items-center gap-3 px-4 py-3 text-zinc-500">
            <History size={18} />
            <span className="text-xs">Session History</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        <AnimatePresence mode="wait">
          {mode === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto py-20 px-8"
            >
              <header className="mb-16">
                <h2 className="text-5xl font-serif font-medium text-white mb-4 leading-tight">
                  Secure your future at <br />
                  <span className="text-emerald-500 italic">{selectedFirm}</span>
                </h2>
                <p className="text-zinc-400 text-lg max-w-2xl">
                  The elite AI coach for Magic Circle training contracts. Upload your CV to begin the analysis or jump straight into intelligence gathering.
                </p>
                {API_KEY_MISSING && (
                  <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3 text-amber-400 text-sm">
                    <AlertCircle size={18} />
                    <span>GEMINI_API_KEY is missing. AI features will not work. Please add it to AI Studio Secrets.</span>
                  </div>
                )}
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "group relative p-8 rounded-3xl border-2 border-dashed transition-all duration-300 cursor-pointer",
                    isDragActive ? "border-emerald-500 bg-emerald-500/5" : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="mb-6 w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-emerald-500/10 transition-colors">
                    <Upload className="text-zinc-400 group-hover:text-emerald-500 transition-colors" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-2">CV Analyzer</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed">
                    Upload your PDF CV for a ruthless partner-level critique and bullet point optimization.
                  </p>
                  {isAnalyzing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center gap-3">
                      <Loader2 className="animate-spin text-emerald-500" />
                      <span className="text-xs text-emerald-500 font-medium">{loadingStep || "Analyzing..."}</span>
                    </div>
                  )}
                </div>

                <div 
                  onClick={() => handleSearch()}
                  className="group p-8 rounded-3xl border border-white/10 bg-white/[0.02] hover:border-white/20 transition-all duration-300 cursor-pointer relative overflow-hidden"
                >
                  <div className="mb-6 w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-blue-500/10 transition-colors">
                    <Search className="text-zinc-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-2">Firm Intelligence</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed">
                    Deep dive into {selectedFirm}'s recent deals, core values, and interview styles.
                  </p>
                  {isAnalyzing && mode === 'dashboard' && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                      <Loader2 className="animate-spin text-blue-500" />
                      <span className="text-xs text-blue-500 font-medium">{loadingStep || "Searching..."}</span>
                    </div>
                  )}
                </div>
              </div>

              <div 
                onClick={startInterview}
                className="group p-8 rounded-3xl border border-white/10 bg-white/[0.02] hover:border-white/20 transition-all duration-300 cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-purple-500/10 transition-colors">
                    <MessageSquare className="text-zinc-400 group-hover:text-purple-500 transition-colors" />
                  </div>
                  <div>
                    <h3 className="text-xl font-medium text-white mb-1">Mock Interview</h3>
                    <p className="text-zinc-500 text-sm">Face a Senior Partner in a high-stakes simulation.</p>
                  </div>
                </div>
                <ChevronRight className="text-zinc-600 group-hover:text-white transition-colors" />
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col gap-3 text-red-400 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AlertCircle size={18} />
                      {error}
                    </div>
                    <button onClick={() => setError(null)} className="text-xs hover:text-white transition-colors">Dismiss</button>
                  </div>
                  {error.includes('blocking cookies') && (
                    <button 
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
                    >
                      Fix Session (Open in New Tab)
                    </button>
                  )}
                </motion.div>
              )}
            </motion.div>
          )}

          {mode === 'cv-analyzer' && cvAnalysis && (
            <motion.div 
              key="cv-analyzer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-5xl mx-auto py-12 px-8"
            >
              <button onClick={() => setMode('dashboard')} className="text-zinc-500 hover:text-white mb-8 flex items-center gap-2 text-sm">
                <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
              </button>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  <section className="p-8 rounded-3xl bg-white/[0.02] border border-white/10">
                    <h3 className="text-2xl font-serif text-white mb-6">Partner Feedback</h3>
                    <div className="space-y-6">
                      <div>
                        <h4 className="text-xs uppercase tracking-widest text-emerald-500 font-bold mb-2">Structure</h4>
                        <p className="text-zinc-300 leading-relaxed">{cvAnalysis.feedback.structure}</p>
                      </div>
                      <div>
                        <h4 className="text-xs uppercase tracking-widest text-emerald-500 font-bold mb-2">Commercial Impact</h4>
                        <p className="text-zinc-300 leading-relaxed">{cvAnalysis.feedback.commercialImpact}</p>
                      </div>
                      <div>
                        <h4 className="text-xs uppercase tracking-widest text-emerald-500 font-bold mb-2">Legal Relevance</h4>
                        <p className="text-zinc-300 leading-relaxed">{cvAnalysis.feedback.legalRelevance}</p>
                      </div>
                    </div>
                  </section>

                  <section className="p-8 rounded-3xl bg-white/[0.02] border border-white/10">
                    <h3 className="text-2xl font-serif text-white mb-6">Elite Rewrites</h3>
                    <div className="space-y-4">
                      {cvAnalysis.rewrittenBullets.map((bullet, i) => (
                        <div key={i} className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
                          <CheckCircle2 className="text-emerald-500 shrink-0" size={20} />
                          <p className="text-sm text-zinc-300 italic">"{bullet}"</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="space-y-8">
                  <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/10 text-center">
                    <h4 className="text-zinc-500 text-sm mb-4">Overall Score</h4>
                    <div className="relative w-32 h-32 mx-auto mb-4">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                        <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={364} strokeDashoffset={364 - (364 * cvAnalysis.score) / 100} className="text-emerald-500" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center text-3xl font-serif text-white">
                        {cvAnalysis.score}
                      </div>
                    </div>
                    <p className="text-xs text-zinc-500">Magic Circle Benchmark</p>
                  </div>

                  <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/10 text-center">
                    <h4 className="text-zinc-500 text-sm mb-4">Firm Match Probability</h4>
                    <div className="text-5xl font-serif text-white mb-2">{cvAnalysis.matchProbability}%</div>
                    <p className="text-xs text-zinc-500">Based on {selectedFirm} values</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {mode === 'intelligence' && intelligence && (
            <motion.div 
              key="intelligence"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-4xl mx-auto py-12 px-8"
            >
              <button onClick={() => setMode('dashboard')} className="text-zinc-500 hover:text-white mb-8 flex items-center gap-2 text-sm">
                <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
              </button>

              <header className="mb-12">
                <h2 className="text-4xl font-serif text-white mb-2">{intelligence.name}</h2>
                <p className="text-zinc-500">Strategic Intelligence Report</p>
              </header>

              <div className="grid grid-cols-1 gap-6">
                {[
                  { title: "Recent Deals & Market Position", content: intelligence.recentDeals, icon: Briefcase, color: "text-blue-500" },
                  { title: "Core Values & Culture", content: intelligence.coreValues, icon: Shield, color: "text-emerald-500" },
                  { title: "Interview Style & Focus", content: intelligence.interviewStyle, icon: Search, color: "text-purple-500" }
                ].map((item, i) => (
                  <div key={i} className="p-8 rounded-3xl bg-white/[0.02] border border-white/10">
                    <div className="flex items-center gap-3 mb-6">
                      <item.icon className={item.color} size={24} />
                      <h3 className="text-xl font-medium text-white">{item.title}</h3>
                    </div>
                    <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap">{item.content}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {mode === 'mock-interview' && (
            <motion.div 
              key="mock-interview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex flex-col"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-[#0D0D0D]">
                <div className="flex items-center gap-4">
                  <button onClick={() => setMode('dashboard')} className="text-zinc-500 hover:text-white">
                    <ChevronRight className="rotate-180" size={20} />
                  </button>
                  <div>
                    <h3 className="text-white font-medium">{selectedFirm} Interview</h3>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Question {questionCount} of 5</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={resetInterview}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Reset Interview
                  </button>
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Live Session</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {messages.map((msg, i) => (
                  <div key={i} className={cn(
                    "flex flex-col max-w-3xl",
                    msg.role === 'user' ? "ml-auto items-end" : "items-start"
                  )}>
                    <div className={cn(
                      "p-6 rounded-2xl text-sm leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-emerald-600 text-white rounded-tr-none" 
                        : "bg-white/5 text-zinc-300 border border-white/5 rounded-tl-none"
                    )}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-center gap-2 text-zinc-500 text-xs italic">
                    <Loader2 className="animate-spin" size={14} />
                    Partner is typing...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-8 border-t border-white/5 bg-[#0D0D0D]">
                <div className="max-w-3xl mx-auto relative">
                  <textarea 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Type your response..."
                    className="w-full bg-[#141414] border border-white/10 rounded-2xl px-6 py-4 pr-16 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-colors resize-none h-24"
                  />
                  <button 
                    onClick={handleSendMessage}
                    disabled={isTyping || !input.trim()}
                    className="absolute right-4 bottom-4 w-10 h-10 bg-white rounded-xl flex items-center justify-center text-black hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send size={18} />
                  </button>
                </div>
                <p className="text-center text-[10px] text-zinc-600 mt-4 uppercase tracking-widest">
                  Professionalism is expected. Be concise and commercially focused.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
