'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";

// Helper function to list available models (for debugging)
async function listAvailableModels(apiKey: string) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Note: The SDK doesn't have a direct listModels method, so we'll try common models
    const commonModels = [
      "gemini-pro-vision",
      "gemini-pro",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-1.5-pro-latest",
      "gemini-1.5-flash-latest"
    ];
    console.log("Trying to find available models...");
    return commonModels;
  } catch (error) {
    console.error("Error listing models:", error);
    return [];
  }
}

export async function analyzeComic(formData: FormData) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
  }

  try {

    const file = formData.get("file") as File;
    if (!file) {
      throw new Error("No file uploaded");
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Video = buffer.toString("base64");
    const mimeType = file.type || "video/mp4";

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // System instruction
    const systemInstruction = "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning.";

    // Use gemini-2.5-flash (latest fast model with video support)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction
    });

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Video,
          mimeType: mimeType
        }
      },
      {
        text: "Analyze this comic book video. Look at all frames to identify the comic and assess its condition."
      }
    ]);

    // Get the response text
    const response = result.response;
    const text = response.text();
    
    // Clean up markdown code blocks if Gemini sends them
    let cleanText = text.trim();
    
    // Remove markdown code blocks more robustly
    if (cleanText.startsWith("```")) {
      const lines = cleanText.split("\n");
      cleanText = lines.slice(1, -1).join("\n");
    }
    cleanText = cleanText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    
    // Parse JSON with better error handling
    try {
      return JSON.parse(cleanText);
    } catch (parseError) {
      console.error("Failed to parse JSON:", cleanText);
      throw new Error(`Invalid JSON response from AI: ${cleanText.substring(0, 100)}`);
    }

  } catch (error) {
    console.error("Error analyzing comic:", error);
    
    // Provide more helpful error messages
    if (error instanceof Error) {
      if (error.message.includes("not found") || error.message.includes("404")) {
        const availableModels = await listAvailableModels(apiKey);
        console.log("Available models to try:", availableModels);
        throw new Error(`Model not found. Tried: gemini-2.5-flash. The SDK is using v1beta API which may not support this model. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try a different model name. Original error: ${error.message}`);
      }
      throw new Error(error.message);
    }
    
    throw new Error("Failed to analyze comic. Check the terminal for details.");
  }
}