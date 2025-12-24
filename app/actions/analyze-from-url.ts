'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Analyze a comic book video from a Supabase Storage URL
 * This bypasses Vercel's 4.5MB body size limit by downloading from Supabase
 */
export async function analyzeComicFromUrl(videoUrl: string) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
  }

  try {
    console.log(`[Server Action] Downloading video from Supabase: ${videoUrl}`);
    
    // Download video from Supabase Storage URL
    const fetchResponse = await fetch(videoUrl);
    if (!fetchResponse.ok) {
      throw new Error(`Failed to download video from Supabase: ${fetchResponse.statusText}`);
    }
    
    const arrayBuffer = await fetchResponse.arrayBuffer();
    const fileSizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(2);
    console.log(`[Server Action] Video downloaded: ${fileSizeMB}MB`);
    
    const buffer = Buffer.from(arrayBuffer);
    const base64Video = buffer.toString("base64");
    console.log("[Server Action] Video converted to base64");
    
    // Determine mime type from URL or default to mp4
    const mimeType = videoUrl.toLowerCase().endsWith('.webm') ? 'video/webm' : 
                     videoUrl.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 
                     'video/mp4';

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // System instruction
    const systemInstruction = "You are an expert comic book grader. Analyze the video of this comic book. Identify the comic (Series, Issue, Year, Variant) and look for visible defects across all frames. Return the response as clean JSON with fields: title, issue, estimatedGrade, reasoning.";

    // Use gemini-2.5-flash (latest fast model with video support)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction
    });

    console.log("[Server Action] Sending video to Gemini API...");
    
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
    console.log("[Server Action] Received response from Gemini API");

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
      const parsedResult = JSON.parse(cleanText);
      console.log("[Server Action] Parsed JSON result:", parsedResult);
      return parsedResult;
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
        throw new Error(`Model not found. Tried: gemini-2.5-flash. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try a different model name. Original error: ${error.message}`);
      }
      
      // Re-throw with original message
      throw error;
    }
    
    throw new Error(`Failed to analyze comic: ${String(error)}. Check the terminal for details.`);
  }
}

