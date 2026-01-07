
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
const MIN_REQUEST_INTERVAL = 10000; // Increased to 10 seconds between API calls
let circuitOpenUntil = 0;
const CIRCUIT_BREAKER_DURATION = 300000; // Increased to 5 minutes cooldown on 429

/**
 * Exponential backoff wrapper for API calls with robust 429 detection and circuit breaker
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, baseDelay = 5000): Promise<T> {
  const now = Date.now();
  if (now < circuitOpenUntil) {
    throw new Error("RATE_LIMIT_COOLDOWN");
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
      const errorStr = JSON.stringify(error).toLowerCase();
      const isRateLimit = 
        error?.status === 429 || 
        error?.error?.code === 429 || 
        error?.message?.includes("429") ||
        errorStr.includes("429") ||
        errorStr.includes("resource_exhausted") ||
        errorStr.includes("quota exceeded");

      if (isRateLimit) {
        circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_DURATION;
        console.warn(`Gemini API rate limited (429). Circuit breaker engaged for ${CIRCUIT_BREAKER_DURATION/1000}s.`);
        throw new Error("RATE_LIMIT_COOLDOWN");
      }
      
      if (attempt < maxRetries) {
        attempt++;
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

export const fetchNewEnvironment = async (
  currentScore: number, 
  previousBiomes: string[]
): Promise<Environment | null> => {
  // Quick exit if circuit is open to avoid any logs
  if (Date.now() < circuitOpenUntil) {
    return FALLBACK_ENVIRONMENTS[Math.floor(Math.random() * FALLBACK_ENVIRONMENTS.length)];
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

    if (!result) return FALLBACK_ENVIRONMENTS[Math.floor(Math.random() * FALLBACK_ENVIRONMENTS.length)];
    return JSON.parse(result) as Environment;
  } catch (error: any) {
    if (error?.message !== "RATE_LIMIT_COOLDOWN") {
      console.error("Gemini Environment Fetch Failed (falling back):", error);
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

    return JSON.parse(result || "[]");
  } catch (error: any) {
    if (error?.message !== "RATE_LIMIT_COOLDOWN") {
      console.error("Gemini Chat Fetch Failed (falling back):", error);
    }
    return FALLBACK_COMMENTS.sort(() => Math.random() - 0.5).slice(0, 3).map(c => ({
      ...c,
      text: Math.random() > 0.5 ? `${c.text} [SIGNAL LOSS]` : c.text
    }));
  }
};
