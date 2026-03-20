export interface CVAnalysis {
  score: number;
  matchProbability: number;
  feedback: {
    structure: string;
    commercialImpact: string;
    legalRelevance: string;
  };
  rewrittenBullets: string[];
}

export interface FirmIntelligence {
  name: string;
  recentDeals: string;
  coreValues: string;
  interviewStyle: string;
}

export interface InterviewMessage {
  role: 'assistant' | 'user';
  content: string;
  score?: number;
  feedback?: string;
  modelAnswer?: string;
}

export type AppMode = 'dashboard' | 'cv-analyzer' | 'intelligence' | 'mock-interview';
