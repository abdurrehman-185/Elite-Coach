import { GoogleGenAI, Type } from "@google/genai";
import { CVAnalysis, FirmIntelligence } from "../types";

const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please add it to AI Studio Secrets.");
  }
  return new GoogleGenAI({ apiKey });
};

const parseJSON = (text: string) => {
  try {
    // Remove markdown code blocks if present
    const cleanText = text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("JSON Parse Error:", e, "Original Text:", text);
    throw new Error("Failed to parse AI response. The model might have returned malformed data.");
  }
};

export const analyzeCV = async (cvText: string, targetFirm: string): Promise<CVAnalysis> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze this CV for a Training Contract at ${targetFirm}. 
    Act as a ruthless but fair Magic Circle recruiting partner.
    CV Content: ${cvText.substring(0, 2000)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          matchProbability: { type: Type.NUMBER },
          feedback: {
            type: Type.OBJECT,
            properties: {
              structure: { type: Type.STRING },
              commercialImpact: { type: Type.STRING },
              legalRelevance: { type: Type.STRING }
            },
            required: ["structure", "commercialImpact", "legalRelevance"]
          },
          rewrittenBullets: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["score", "matchProbability", "feedback", "rewrittenBullets"]
      }
    }
  });

  return parseJSON(response.text || "{}");
};

export const getFirmIntelligence = async (firmName: string, searchData: string): Promise<FirmIntelligence> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on this search data, provide intelligence on ${firmName}.
    Search Data: ${searchData}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          recentDeals: { type: Type.STRING },
          coreValues: { type: Type.STRING },
          interviewStyle: { type: Type.STRING }
        },
        required: ["name", "recentDeals", "coreValues", "interviewStyle"]
      }
    }
  });

  return parseJSON(response.text || "{}");
};
