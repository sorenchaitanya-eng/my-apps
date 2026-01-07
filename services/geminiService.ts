
import { GoogleGenAI, Type } from "@google/genai";
import { Environment } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const ENVIRONMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: "Name of the biome" },
    primaryColor: { type: Type.STRING, description: "Hex color code for primary theme" },
    secondaryColor: { type: Type.STRING, description: "Hex color code for secondary theme" },
    description: { type: Type.STRING, description: "A short 1-sentence description of the shift" },
    atmosphere: { type: Type.STRING, description: "One word like 'heavy', 'electric', 'cold', 'ethereal'" }
  },
  required: ["name", "primaryColor", "secondaryColor", "description", "atmosphere"]
};

const CHAT_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      username: { type: Type.STRING },
      text: { type: Type.STRING },
      color: { type: Type.STRING, description: "A vibrant hex color" }
    },
    required: ["username", "text", "color"]
  }
};

const FALLBACK_ENVIRONMENTS: Environment[] = [
  { name: "Cobalt Grid", primaryColor: "#22d3ee", secondaryColor: "#818cf8", description: "Standard tactical visualization active.", atmosphere: "cold" },
  { name: "Magma Core", primaryColor: "#f87171", secondaryColor: "#fbbf24", description: "Thermal levels critical. Watch your step.", atmosphere: "heavy" },
  { name: "Static Void", primaryColor: "#ffffff", secondaryColor: "#475569", description: "Data stream unstable. Atmospheric interference high.", atmosphere: "electric" },
  { name: "Jade Nexus", primaryColor: "#34d399", secondaryColor: "#065f46", description: "Ancient protocols found in the deep web.", atmosphere: "ethereal" }
];

const FALLBACK_COMMENTS = [
  { username: "Glitch_Hunter", text: "Is that a local glitch or global?", color: "#00f2ff" },
  { username: "Neon_Ghost", text: "The rift is expanding. Watch out.", color: "#ff00ea" },
  { username: "Zero_Day", text: "Nice movement. Buffs incoming?", color: "#fbbf24" },
  { username: "Bit_Runner", text: "LFG!!! Don't drop the feed.", color: "#4ade80" },
  { username: "Proxy_Soul", text: "Atmosphere looks weird today.", color: "#818cf8" }
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Global throttle and circuit breaker to prevent overlapping rapid requests and handle 429s
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 15000; // 15 seconds between successful API calls
let circuitOpenUntil = 0;
const CIRCUIT_BREAKER_DURATION = 600000; // 10 minute cooldown on any 429 error

/**
 * Checks if an error object represents a 429 Rate Limit
 */
function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  // Check common error formats for 429
  const code = error?.status || error?.error?.code || error?.code;
  if (code === 429) return true;

  const errorStr = JSON.stringify(error).toLowerCase();
  return (
    errorStr.includes("429") || 
    errorStr.includes("resource_exhausted") || 
    errorStr.includes("quota exceeded") ||
    errorStr.includes("too many requests")
  );
}

/**
 * Exponential backoff wrapper for API calls with robust 429 detection and circuit breaker
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1, baseDelay = 5000): Promise<T | null> {
  const now = Date.now();
  if (now < circuitOpenUntil) {
    return null; // Silently fail to fallback
  }

  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - timeSinceLast);
  }
  lastRequestTime = Date.now();

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      if (isRateLimitError(error)) {
        circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_DURATION;
        console.warn(`Gemini API Quota Exhausted. Using local fallbacks for ${CIRCUIT_BREAKER_DURATION/60000} mins.`);
        return null; // Return null to signal immediate fallback without logging error
      }
      
      if (attempt < maxRetries) {
        attempt++;
        await sleep(baseDelay * Math.pow(2, attempt - 1));
        continue;
      }
      throw error;
    }
  }
  return null;
}

export const fetchNewEnvironment = async (
  currentScore: number, 
  previousBiomes: string[]
): Promise<Environment | null> => {
  // Check circuit before even creating prompt
  if (Date.now() < circuitOpenUntil) {
    const availableFallbacks = FALLBACK_ENVIRONMENTS.filter(e => !previousBiomes.includes(e.name));
    return availableFallbacks.length > 0 
      ? availableFallbacks[Math.floor(Math.random() * availableFallbacks.length)]
      : FALLBACK_ENVIRONMENTS[Math.floor(Math.random() * FALLBACK_ENVIRONMENTS.length)];
  }

  try {
    const prompt = `The player is at score ${currentScore} in a high-speed cyberpunk rift runner game. Generate a new visual biome. Previous biomes: ${previousBiomes.join(", ")}. Make it visually distinct and neon-inspired.`;

    const result = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: ENVIRONMENT_SCHEMA,
        }
      });
      return response.text;
    });

    if (!result) throw new Error("FALLBACK_SIGNAL"); // Trigger local fallback logic below
    return JSON.parse(result) as Environment;
  } catch (error: any) {
    // Only log non-rate-limit errors
    if (error?.message !== "FALLBACK_SIGNAL") {
      console.error("Gemini service encountered an issue:", error);
    }
    
    const availableFallbacks = FALLBACK_ENVIRONMENTS.filter(e => !previousBiomes.includes(e.name));
    return availableFallbacks.length > 0 
      ? availableFallbacks[Math.floor(Math.random() * availableFallbacks.length)]
      : FALLBACK_ENVIRONMENTS[Math.floor(Math.random() * FALLBACK_ENVIRONMENTS.length)];
  }
};

export const fetchChatComments = async (biomeName: string, event: string): Promise<{username: string, text: string, color: string}[]> => {
  if (Date.now() < circuitOpenUntil) return [];

  try {
    const prompt = `Generate 5 short, punchy cyberpunk social media "live chat" comments for a rift streamer currently in the "${biomeName}" biome who just triggered a "${event}" event. Usernames should be tech-themed. Reactions range from hype to technical. Return as JSON array.`;

    const result = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: CHAT_SCHEMA,
        }
      });
      return response.text;
    });

    if (!result) return [];
    return JSON.parse(result);
  } catch (error: any) {
    return [];
  }
};
