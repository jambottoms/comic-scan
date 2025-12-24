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

    // Check file size - Next.js config allows up to 100MB
    // Vercel has a 4.5MB body size limit for serverless functions (platform limitation)
    // This check is for Vercel deployment - locally, Next.js config should allow up to 100MB
    const nextJsLimit = 100 * 1024 * 1024; // 100MB - Next.js config limit
    const vercelLimit = 4.5 * 1024 * 1024; // 4.5MB - Vercel's hard limit
    
    // Only enforce Vercel limit if we detect we're on Vercel (check via environment)
    // Locally, allow up to Next.js limit to test the config
    const isVercel = process.env.VERCEL === '1';
    const maxSize = isVercel ? vercelLimit : nextJsLimit;
    
    if (file.size > maxSize) {
      const limitMB = isVercel ? '4.5MB (Vercel limit)' : '100MB (Next.js config)';
      throw new Error(`Video file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${limitMB}. Please record a shorter video or compress the file.`);
    }
    
    console.log(`[Server Action] File size check passed: ${(file.size / 1024 / 1024).toFixed(2)}MB (limit: ${isVercel ? '4.5MB (Vercel)' : '100MB (Next.js)'})`);

    console.log(`[Server Action] Processing video: ${(file.size / 1024 / 1024).toFixed(2)}MB, type: ${file.type}`);
    console.log(`[Server Action] File name: ${file.name}`);

    const arrayBuffer = await file.arrayBuffer();
    console.log("Video loaded into memory");
    
    const buffer = Buffer.from(arrayBuffer);
    const base64Video = buffer.toString("base64");
    console.log("Video converted to base64");
    
    const mimeType = file.type || "video/mp4";

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // System instruction
    const systemInstruction = "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning.";

    // Use gemini-pro-vision (supports video/images)
    // Note: Model names may vary by API version - gemini-pro-vision is most widely available
    const model = genAI.getGenerativeModel({ 
      model: "gemini-pro-vision",
      systemInstruction: systemInstruction
    });

    console.log("Sending video to Gemini API...");
    
    // Add timeout wrapper
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 60 seconds. The video may be too long or the API is slow. Please try a shorter video.")), 60000);
    });

    const analysisPromise = model.generateContent([
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

    const result = await Promise.race([analysisPromise, timeoutPromise]) as any;
    console.log("Received response from Gemini API");

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
    console.error("[Server Action] Error analyzing comic:", error);
    console.error("[Server Action] Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("[Server Action] Error message:", error instanceof Error ? error.message : String(error));
    
    // Provide more helpful error messages
    if (error instanceof Error) {
      // Handle Next.js server action serialization errors
      if (error.message.includes("unexpected response") || error.message.includes("Unexpected")) {
        throw new Error("Server action error: The response may be too large or the request timed out. Try a shorter video.");
      }
      
      if (error.message.includes("not found") || error.message.includes("404")) {
        const availableModels = await listAvailableModels(apiKey);
        console.log("Available models to try:", availableModels);
        throw new Error(`Model not found. Tried: gemini-2.5-flash. The SDK is using v1beta API which may not support this model. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try a different model name. Original error: ${error.message}`);
      }
      
      // Re-throw with original message
      throw error;
    }
    
    throw new Error(`Failed to analyze comic: ${String(error)}. Check the terminal for details.`);
  }
}