import {useEffect, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {
  AlertCircle,
  BarChart3,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  FileText,
  History,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Shield,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {useDropzone} from 'react-dropzone';
import {cn} from './lib/utils';
import {AppMode, CVAnalysis, FirmIntelligence, InterviewMessage} from './types';
import {
  analyzeCV,
  evaluateMockInterview,
  getFirmIntelligence,
  startMockInterview,
} from './services/ai';

const FIRMS = [
  'Clifford Chance',
  'Linklaters',
  'Freshfields Bruckhaus Deringer',
  'Allen & Overy',
  'Slaughter and May',
  'Latham & Watkins',
  'Kirkland & Ellis',
  'White & Case',
  'Skadden',
  'Herbert Smith Freehills',
];

const LOADING_LINES = [
  'Checking commercial awareness...',
  'Reading between the bullet points...',
  'Calibrating partner-level scrutiny...',
  'Testing the business case...',
];

export default function App() {
  const [mode, setMode] = useState<AppMode>('dashboard');
  const [selectedFirm, setSelectedFirm] = useState(FIRMS[0]);
  const [cvText, setCvText] = useState('');
  const [cvAnalysis, setCvAnalysis] = useState<CVAnalysis | null>(null);
  const [intelligence, setIntelligence] = useState<FirmIntelligence | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [input, setInput] = useState('');
  const [questionCount, setQuestionCount] = useState(0);
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [sentiment, setSentiment] = useState(70);
  const [awareness, setAwareness] = useState(50);
  const [loadingLine, setLoadingLine] = useState(LOADING_LINES[0]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages, isWorking]);

  useEffect(() => {
    if (!isWorking) return;
    const id = window.setInterval(() => {
      setLoadingLine(LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)]);
    }, 3500);
    return () => window.clearInterval(id);
  }, [isWorking]);

  useEffect(() => {
    fetch('/api/health', {
      credentials: 'include',
      headers: {'X-Requested-With': 'XMLHttpRequest'},
    }).catch(() => undefined);
  }, []);

  const formatAIError = (fallback: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err || fallback);
    if (message.includes('429') || message.toLowerCase().includes('quota')) {
      return 'AI quota exceeded. Please wait a moment and try again.';
    }
    return message || fallback;
  };

  const onDrop = async (acceptedFiles: File[], rejectedFiles: any[]) => {
    if (rejectedFiles.length) {
      setError(rejectedFiles[0]?.errors?.[0]?.message || 'Please upload a valid PDF.');
      return;
    }

    const file = acceptedFiles[0];
    if (!file) return;

    setIsWorking(true);
    setLoadingStep('Parsing PDF...');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/parse-pdf', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.text) {
        throw new Error(payload?.error || 'Failed to parse PDF.');
      }

      setCvText(payload.text);
      setLoadingStep('Analyzing with AI partner...');
      const analysis = await analyzeCV(payload.text, selectedFirm);
      setCvAnalysis(analysis);
      setMode('cv-analyzer');
    } catch (err) {
      setError(formatAIError('An error occurred during analysis.', err));
    } finally {
      setIsWorking(false);
      setLoadingStep('');
    }
  };

  const {getRootProps, getInputProps, isDragActive} = useDropzone({
    onDrop,
    accept: {'application/pdf': ['.pdf']},
    multiple: false,
  } as any);

  const handleSearch = async () => {
    setIsWorking(true);
    setLoadingStep('Searching market data...');
    setError(null);

    try {
      const response = await fetch('/api/search-firms', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({query: selectedFirm}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Search failed.');

      setLoadingStep('Synthesizing firm intelligence...');
      const intel = await getFirmIntelligence(selectedFirm, JSON.stringify(data.results || data));
      setIntelligence(intel);
      setMode('intelligence');
    } catch (err) {
      setError(formatAIError('Failed to fetch intelligence.', err));
    } finally {
      setIsWorking(false);
      setLoadingStep('');
    }
  };

  const beginInterview = async () => {
    setMode('mock-interview');
    setMessages([]);
    setQuestionCount(1);
    setInterviewComplete(false);
    setIsWorking(true);
    setError(null);

    try {
      const text = await startMockInterview(selectedFirm, cvText);
      setMessages([{role: 'assistant', content: text.replace(/\[\[.*?\]\]/g, '').trim()}]);
    } catch (err) {
      setError(formatAIError('Failed to start interview.', err));
    } finally {
      setIsWorking(false);
    }
  };

  const sendInterviewAnswer = async () => {
    if (!input.trim() || isWorking || interviewComplete) return;

    const userMessage = input.trim();
    const transcript: InterviewMessage[] = [...messages, {role: 'user', content: userMessage}];
    setInput('');
    setMessages(transcript);
    setIsWorking(true);
    setError(null);

    try {
      const text = await evaluateMockInterview(
        selectedFirm,
        cvText,
        userMessage,
        questionCount,
        transcript,
      );
      const scoreMatch = text.match(/\[\[SENTIMENT: (\d+), AWARENESS: (\d+)\]\]/);
      if (scoreMatch) {
        setSentiment(Number(scoreMatch[1]));
        setAwareness(Number(scoreMatch[2]));
      }
      setMessages(prev => [
        ...prev,
        {role: 'assistant', content: text.replace(/\[\[.*?\]\]/g, '').trim()},
      ]);
      if (questionCount >= 5) {
        setInterviewComplete(true);
      } else {
        setQuestionCount(prev => Math.min(prev + 1, 5));
      }
    } catch (err) {
      setError(formatAIError('Failed to send message.', err));
    } finally {
      setIsWorking(false);
    }
  };

  const resetInterview = () => {
    setMode('dashboard');
    setMessages([]);
    setQuestionCount(0);
    setInterviewComplete(false);
    setInput('');
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-zinc-100 selection:bg-emerald-500/30">
      <aside className="flex w-72 flex-col border-r border-white/5 bg-[#0D0D0D] p-6">
        <div className="mb-12 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white">
            <Shield className="h-6 w-6 text-black" />
          </div>
          <h1 className="font-serif text-xl font-semibold text-white">CLERKED</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => setMode('dashboard')}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition',
              mode === 'dashboard'
                ? 'bg-white/5 text-white'
                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300',
            )}
          >
            <BarChart3 size={20} />
            Dashboard
          </button>
          <div className="px-4 pb-2 pt-6 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
            Active Firm
          </div>
          <select
            value={selectedFirm}
            onChange={event => setSelectedFirm(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#141414] px-4 py-3 text-sm text-zinc-300 outline-none transition focus:border-emerald-500/50"
          >
            {FIRMS.map(firm => (
              <option key={firm} value={firm}>
                {firm}
              </option>
            ))}
          </select>
        </nav>

        <div className="mt-auto space-y-4 border-t border-white/5 pt-6">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                Pro Plan
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
              Get unlimited CV analyses and priority interview slots.
            </p>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="w-full rounded-xl bg-emerald-500 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition hover:bg-emerald-600"
            >
              Upgrade Now - £9.99/mo
            </button>
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Users size={14} className="text-zinc-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Referral Program
              </span>
            </div>
            <p className="mb-3 text-[11px] text-zinc-500">
              Invite 3 friends to get 1 week of Pro for free.
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `Check out Clerked - the AI coach for Magic Circle interviews: ${window.location.origin}`,
                );
                alert('Referral link copied.');
              }}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition hover:bg-white/10"
            >
              Copy Invite Link
            </button>
          </div>

          <div className="flex items-center gap-3 px-4 py-3 text-xs text-zinc-500">
            <History size={18} />
            Session History
          </div>
        </div>
      </aside>

      <main className="relative flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {mode === 'dashboard' && (
            <motion.section
              key="dashboard"
              initial={{opacity: 0, y: 16}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -16}}
              className="mx-auto max-w-4xl px-8 py-20"
            >
              <header className="mb-16">
                <h2 className="mb-4 font-serif text-5xl font-medium leading-tight text-white">
                  Secure your future at <br />
                  <span className="italic text-emerald-500">{selectedFirm}</span>
                </h2>
                <p className="max-w-2xl text-lg leading-relaxed text-zinc-400">
                  <span className="font-serif italic text-white">Clerked</span> - the elite AI
                  coach for Magic Circle training contracts. Upload your CV first for a
                  personalized interview experience built from your actual background.
                </p>
              </header>

              <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-2">
                <button
                  {...getRootProps()}
                  className={cn(
                    'group relative rounded-3xl border-2 border-dashed p-8 text-left transition',
                    isDragActive
                      ? 'border-emerald-500 bg-emerald-500/5'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20',
                  )}
                >
                  <input {...getInputProps()} />
                  <ToolIcon icon={Upload} color="emerald" />
                  <h3 className="mb-2 text-xl font-medium text-white">CV Analyzer</h3>
                  <p className="text-sm leading-relaxed text-zinc-500">
                    Upload your PDF CV for partner-level critique and bullet point optimization.
                  </p>
                </button>

                <button
                  onClick={handleSearch}
                  className="group rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-left transition hover:border-white/20"
                >
                  <ToolIcon icon={Search} color="blue" />
                  <h3 className="mb-2 text-xl font-medium text-white">Firm Intelligence</h3>
                  <p className="text-sm leading-relaxed text-zinc-500">
                    Deep dive into {selectedFirm}'s market position, culture, and interview style.
                  </p>
                </button>
              </div>

              <button
                onClick={beginInterview}
                className="flex w-full items-center justify-between rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-left transition hover:border-white/20"
              >
                <div className="flex items-center gap-6">
                  <ToolIcon icon={MessageSquare} color="purple" compact />
                  <div>
                    <div className="mb-1 flex items-center gap-3">
                      <h3 className="text-xl font-medium text-white">Mock Interview</h3>
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                        Upload CV first
                      </span>
                    </div>
                    <p className="text-sm text-zinc-500">
                      Face a senior partner in a one-question-at-a-time simulation.
                    </p>
                  </div>
                </div>
                <ChevronRight className="text-zinc-600" />
              </button>
            </motion.section>
          )}

          {mode === 'cv-analyzer' && cvAnalysis && (
            <ReportView
              title="CV Analysis"
              subtitle={`${selectedFirm} benchmark`}
              onBack={() => setMode('dashboard')}
            >
              <div className="grid gap-6 md:grid-cols-[220px_1fr]">
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-center">
                  <div className="mb-2 font-serif text-6xl text-white">{cvAnalysis.score}</div>
                  <p className="text-xs uppercase tracking-widest text-zinc-500">Overall score</p>
                  <div className="mt-8 font-serif text-4xl text-emerald-400">
                    {cvAnalysis.matchProbability}%
                  </div>
                  <p className="mt-2 text-xs uppercase tracking-widest text-zinc-500">Firm match</p>
                </div>
                <div className="space-y-4">
                  {Object.entries(cvAnalysis.feedback).map(([label, value]) => (
                    <InfoPanel key={label} title={label.replace(/([A-Z])/g, ' $1')}>
                      {value}
                    </InfoPanel>
                  ))}
                  <InfoPanel title="Rewritten bullets">
                    <ul className="list-inside list-disc space-y-2">
                      {cvAnalysis.rewrittenBullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  </InfoPanel>
                </div>
              </div>
            </ReportView>
          )}

          {mode === 'intelligence' && intelligence && (
            <ReportView
              title={intelligence.name}
              subtitle="Strategic intelligence report"
              onBack={() => setMode('dashboard')}
            >
              <div className="space-y-4">
                <InfoPanel title="Recent deals and market position">{intelligence.recentDeals}</InfoPanel>
                <InfoPanel title="Core values and culture">{intelligence.coreValues}</InfoPanel>
                <InfoPanel title="Interview style and focus">{intelligence.interviewStyle}</InfoPanel>
              </div>
            </ReportView>
          )}

          {mode === 'mock-interview' && (
            <motion.section
              key="interview"
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              className="flex h-full flex-col"
            >
              <div className="flex items-center justify-between border-b border-white/5 bg-[#0D0D0D]/90 p-6">
                <div className="flex items-center gap-4">
                  <button onClick={() => setMode('dashboard')} className="text-zinc-500 hover:text-white">
                    <ChevronRight className="rotate-180" size={20} />
                  </button>
                  <div>
                    <h3 className="font-medium text-white">Senior Partner, {selectedFirm}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      {interviewComplete ? 'Evaluation complete' : `Question ${questionCount} of 5`}
                    </p>
                  </div>
                </div>
                <div className="hidden items-center gap-6 md:flex">
                  <Meter label="Sentiment" value={sentiment} color="emerald" />
                  <Meter label="Awareness" value={awareness} color="blue" />
                  <button onClick={resetInterview} className="text-xs text-zinc-500 hover:text-white">
                    Reset
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto p-8">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={cn(
                      'mx-auto flex max-w-4xl',
                      message.role === 'user' ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-3xl rounded-3xl p-6 text-sm leading-relaxed',
                        message.role === 'user'
                          ? 'rounded-tr-none bg-emerald-600 text-white'
                          : 'w-full rounded-tl-none border border-white/5 bg-[#141414] text-zinc-300',
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      ) : (
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      )}
                    </div>
                  </div>
                ))}

                {isWorking && (
                  <div className="mx-auto flex max-w-4xl items-center gap-3 text-sm italic text-zinc-500">
                    <Loader2 className="animate-spin" size={16} />
                    {loadingLine}
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-white/5 bg-[#0D0D0D]/90 p-8">
                <div className="relative mx-auto max-w-3xl">
                  <textarea
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        sendInterviewAnswer();
                      }
                    }}
                    placeholder={
                      interviewComplete ? 'Interview complete.' : `Answer Question ${questionCount}...`
                    }
                    disabled={interviewComplete}
                    className="h-36 w-full resize-none rounded-2xl border border-white/10 bg-[#141414] px-6 py-4 pr-16 text-sm text-zinc-300 outline-none transition focus:border-emerald-500/50 disabled:opacity-60"
                  />
                  <button
                    onClick={sendInterviewAnswer}
                    disabled={isWorking || !input.trim() || interviewComplete}
                    className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black transition hover:bg-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {error && (
          <div className="fixed bottom-6 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-300 backdrop-blur">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-200 hover:text-white">
              <XCircle size={18} />
            </button>
          </div>
        )}

        {isWorking && mode !== 'mock-interview' && (
          <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#141414] px-6 py-4 text-sm text-zinc-300">
              <Loader2 className="animate-spin text-emerald-500" size={18} />
              {loadingStep || loadingLine}
            </div>
          </div>
        )}

        <AnimatePresence>
          {showUpgradeModal && (
            <motion.div
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6 backdrop-blur-sm"
            >
              <motion.div
                initial={{scale: 0.95, y: 12}}
                animate={{scale: 1, y: 0}}
                exit={{scale: 0.95, y: 12}}
                className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#141414] p-8 text-center"
              >
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="absolute right-4 top-4 text-zinc-500 hover:text-white"
                >
                  <XCircle size={24} />
                </button>
                <Shield className="mx-auto mb-6 text-emerald-500" size={40} />
                <h3 className="mb-2 font-serif text-2xl text-white">Clerked Pro</h3>
                <p className="mb-8 text-sm leading-relaxed text-zinc-400">
                  Stripe payments are being integrated. Join the waitlist to lock in £9.99/mo
                  for your first year.
                </p>
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="w-full rounded-xl bg-emerald-500 py-4 text-xs font-bold uppercase tracking-widest text-white hover:bg-emerald-600"
                >
                  Join the Waitlist
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function ToolIcon({
  icon: Icon,
  color,
  compact = false,
}: {
  icon: typeof Upload;
  color: 'emerald' | 'blue' | 'purple';
  compact?: boolean;
}) {
  const colorClass = {
    emerald: 'group-hover:text-emerald-500 group-hover:bg-emerald-500/10',
    blue: 'group-hover:text-blue-500 group-hover:bg-blue-500/10',
    purple: 'group-hover:text-purple-500 group-hover:bg-purple-500/10',
  }[color];

  return (
    <div
      className={cn(
        'mb-6 flex items-center justify-center rounded-2xl bg-white/5 text-zinc-400 transition',
        compact ? 'mb-0 h-12 w-12' : 'h-12 w-12',
        colorClass,
      )}
    >
      <Icon size={24} />
    </div>
  );
}

function ReportView({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      key={title}
      initial={{opacity: 0, y: 16}}
      animate={{opacity: 1, y: 0}}
      exit={{opacity: 0, y: -16}}
      className="mx-auto max-w-5xl px-8 py-12"
    >
      <button
        onClick={onBack}
        className="mb-8 flex items-center gap-2 text-sm text-zinc-500 hover:text-white"
      >
        <ChevronRight className="rotate-180" size={16} />
        Back to Dashboard
      </button>
      <header className="mb-10">
        <h2 className="mb-2 font-serif text-4xl text-white">{title}</h2>
        <p className="text-sm uppercase tracking-widest text-zinc-500">{subtitle}</p>
      </header>
      {children}
    </motion.section>
  );
}

function InfoPanel({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-emerald-400">
        {title}
      </h3>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

function Meter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'emerald' | 'blue';
}) {
  return (
    <div className="w-32 space-y-1.5">
      <div className="flex justify-between text-[9px] font-bold uppercase tracking-tight">
        <span className="text-zinc-500">{label}</span>
        <span className={color === 'emerald' ? 'text-emerald-500' : 'text-blue-500'}>
          {value}%
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={cn('h-full', color === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500')}
          style={{width: `${value}%`}}
        />
      </div>
    </div>
  );
}
