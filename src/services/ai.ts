import { CVAnalysis, FirmIntelligence, InterviewMessage } from "../types";

const postJSON = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.error || "AI request failed";
    throw new Error(message);
  }

  return payload as T;
};

export const analyzeCV = async (cvText: string, targetFirm: string): Promise<CVAnalysis> => {
  return postJSON<CVAnalysis>("/api/analyze-cv", { cvText, targetFirm });
};

export const getFirmIntelligence = async (firmName: string, searchData: string): Promise<FirmIntelligence> => {
  return postJSON<FirmIntelligence>("/api/firm-intelligence", { firmName, searchData });
};

export const startMockInterview = async (firmName: string, cvText: string): Promise<string> => {
  const { text } = await postJSON<{ text: string }>("/api/interview/start", { firmName, cvText });
  return text;
};

export const evaluateMockInterview = async (
  firmName: string,
  cvText: string,
  answers: string,
  questionNumber: number,
  transcript: InterviewMessage[],
): Promise<string> => {
  const { text } = await postJSON<{ text: string }>("/api/interview/evaluate", {
    firmName,
    cvText,
    answers,
    questionNumber,
    transcript,
  });
  return text;
};
