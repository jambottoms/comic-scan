'use server';

// Environment Fix: Use createRequire for ESM compatibility
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { spawnSync } from 'child_process';
import { writeFile, unlink, stat, access } from 'fs/promises';
import path from 'path';

// Load ffmpeg-static at module level
const ffmpegStatic = require('ffmpeg-static');
let ffmpegPath: string;
if (typeof ffmpegStatic === 'string') {
  ffmpegPath = ffmpegStatic;
} else if (ffmpegStatic?.default && typeof ffmpegStatic.default === 'string') {
  ffmpegPath = ffmpegStatic.default;
} else if (ffmpegStatic?.path && typeof ffmpegStatic.path === 'string') {
  ffmpegPath = ffmpegStatic.path;
} else {
  throw new Error('ffmpeg-static returned invalid path format');
}
// Resolve to absolute path for Vercel compatibility
ffmpegPath = path.resolve(ffmpegPath);

/**
 * Result type for server action - returns success/error instead of throwing
 */
export type AnalyzeResult = 
  | { success: true; data: any }
  | { success: false; error: string };

/**
 * Analyze a comic book video from a Supabase Storage URL
 * Final version with exact specifications
 * 
 * Process:
 * 1. Download video to /tmp/input.mov (and photos if provided)
 * 2. Use spawnSync to convert to /tmp/output.mp4
 * 3. Upload to Google File API
 * 4. Poll until ACTIVE state
 * 5. Call gemini-2.5-flash with file data
 * 6. Cleanup both temp files
 */
export async function analyzeComicFromUrl(input: string | { videoUrl: string, frontPhotoUrl?: string, backPhotoUrl?: string, spinePhotoUrl?: string }, mimeType?: string): Promise<AnalyzeResult> {
  const videoUrl = typeof input === 'string' ? input : input.videoUrl;
  const frontPhotoUrl = typeof input === 'object' ? input.frontPhotoUrl : undefined;
  const backPhotoUrl = typeof input === 'object' ? input.backPhotoUrl : undefined;
  const spinePhotoUrl = typeof input === 'object' ? input.spinePhotoUrl : undefined;

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const errorMsg = "GOOGLE_API_KEY is not set in environment variables. Please add it to Vercel environment variables.";
    console.error(`[Server Action] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  console.log(`[Server Action] API key present: ${apiKey ? 'Yes' : 'No'} (length: ${apiKey?.length || 0})`);

  // File paths
  const inputPath = '/tmp/input.mov';
  const outputPath = '/tmp/output.mp4';

  try {
    console.log(`[Server Action] Starting video analysis pipeline for: ${videoUrl}`);
    if (frontPhotoUrl) console.log(`[Server Action] Including front photo: ${frontPhotoUrl}`);
    if (backPhotoUrl) console.log(`[Server Action] Including back photo: ${backPhotoUrl}`);
    if (spinePhotoUrl) console.log(`[Server Action] Including spine photo: ${spinePhotoUrl}`);
    
    // Step 1: Download the Supabase video to /tmp/input.mov
    console.log(`[Server Action] Downloading video from Supabase...`);
    const response = await fetch(videoUrl, {
      headers: {
        'Accept': 'video/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Read entire response into buffer and write to file
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`[Server Action] Downloaded ${fileSizeMB}MB, writing to ${inputPath}`);
    
    await writeFile(inputPath, buffer);
    console.log(`[Server Action] ✅ Video saved to ${inputPath}`);
    
    // Step 2: FFmpeg Fix - Use ffmpeg-static via spawnSync to convert it to /tmp/output.mp4
    console.log(`[Server Action] Starting FFmpeg transcoding with spawnSync...`);
    console.log(`[FFmpeg] Binary: ${ffmpegPath}`);
    console.log(`[FFmpeg] Input: ${inputPath}, Output: ${outputPath}`);
    
    // Use spawnSync with exact flags
    const ffmpegResult = spawnSync(path.resolve(ffmpegPath), [
      '-y',
      '-i', '/tmp/input.mov',
      '-c:v', 'libx264',
      '-vf', 'scale=-1:1080,fps=1',
      '-an',
      '-f', 'mp4',
      '/tmp/output.mp4'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'] // stdin ignored, stdout/stderr piped
    });

    // Check FFmpeg result
    if (ffmpegResult.error) {
      throw new Error(`FFmpeg process failed: ${ffmpegResult.error.message}`);
    }

    if (ffmpegResult.status !== 0) {
      const stderr = ffmpegResult.stderr?.toString() || 'Unknown error';
      console.error(`[FFmpeg] stderr:`, stderr);
      throw new Error(`FFmpeg process exited with code: ${ffmpegResult.status}. Error: ${stderr.slice(-500)}`);
    }

    console.log(`[Server Action] ✅ FFmpeg transcoding complete`);
    
    // Verify output file exists and has data
    const outputStats = await stat(outputPath);
    if (outputStats.size === 0) {
      throw new Error('Transcoded file is empty on disk');
    }
    const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
    console.log(`[Server Action] Transcoded file verified: ${outputSizeMB}MB`);
    
    // Step 3: Upload to Google File API
    console.log(`[Server Action] Uploading to Google File API...`);
    const fileManager = new GoogleAIFileManager(apiKey);
    
    // Upload the file
    const uploadResult = await fileManager.uploadFile(outputPath, {
      mimeType: 'video/mp4',
      displayName: 'ComicScan_Video',
    });
    
    console.log(`[Server Action] File uploaded, URI: ${uploadResult.file.uri}`);
    console.log(`[Server Action] File state: ${uploadResult.file.state}`);
    console.log(`[Server Action] File name: ${uploadResult.file.name}`);
    
    // Step 4: The Polling Loop (To prevent 404)
    // After fileManager.uploadFile(), write a while loop that calls fileManager.getFile()
    // Await until file.state === 'ACTIVE'. (If you call the model before this, it will 404)
    console.log(`[Server Action] Polling for ACTIVE state...`);
    const pollInterval = 500; // 500ms between polls
    const maxWaitTime = 30000; // 30 seconds max
    const startTime = Date.now();
    
    let file = uploadResult.file;
    
    // Write a while loop that calls fileManager.getFile()
    while (file.state !== 'ACTIVE') {
      // Check timeout
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`File upload timed out - file did not become ACTIVE within ${maxWaitTime / 1000} seconds. Current state: ${file.state}`);
      }
      
      if (file.state === 'FAILED') {
        const errorMsg = file.error?.message || 'Unknown error';
        throw new Error(`File upload failed: ${errorMsg}`);
      }
      
      // Log state periodically
      console.log(`[Server Action] File state: ${file.state}, waiting for ACTIVE...`);
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Call fileManager.getFile()
      file = await fileManager.getFile(uploadResult.file.name);
    }
    
    console.log(`[Server Action] ✅ File is ACTIVE`);
    
    // Step 5: Model ID - Use gemini-2.5-flash. (This is the verified stable ID for Dec 2025)
    console.log(`[Server Action] Using model: gemini-2.5-flash (verified stable ID for Dec 2025)`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: `You are a professional collectibles grading service. You can grade comic books, trading cards (Magic: The Gathering, Pokémon, sports cards, etc.), and other collectibles.

CRITICAL: You MUST ALWAYS respond with valid JSON, no matter what. Never respond with plain text.

First, identify what TYPE of collectible is being shown:
- "comic" for comic books
- "card" for trading cards (MTG, Pokemon, sports, TCG, etc.)
- "toy" for action figures, figurines, etc.
- "other" for other collectibles
- "unknown" if you cannot identify the item

RESPONSE FORMAT (always use this JSON structure):
{
  "itemType": "comic" | "card" | "toy" | "other" | "unknown",
  "title": "Name of item (card name, comic title, toy name)",
  "issue": "Issue #, Set name, or Series (use 'N/A' if not applicable)",
  "year": "Year if identifiable",
  "variant": "Variant info if applicable (foil, first edition, chase, etc.)",
  "estimatedGrade": "X.X on appropriate scale (see below)",
  "gradingScale": "CGC" | "PSA" | "BGS" | "Custom",
  "reasoning": [
    {
      "defect": "Name of Defect (e.g. Spine Stress, Color Break)",
      "timestamp": "MM:SS",
      "note": "Specific details about this instance"
    }
  ],
  "summary": "A concise executive summary of the item's overall condition and eye appeal."
}

GRADING SCALES BY TYPE:
- Comics: CGC 0.5-10.0 scale. Terms: spine stress, corner blunting, color break, staple rust, page tanning
- Trading Cards: PSA 1-10 or BGS 1-10 scale. Terms: centering, corners, edges, surface, print lines, whitening
- Toys: Custom 1-10 scale. Terms: paint wear, joint looseness, accessory completeness, package condition

Be objective, clinical, and precise. Use industry standard terminology.`
    });
    
    // Add timeout wrapper - Vercel has 300s timeout, so use 280s to be safe
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Video analysis timed out after 280 seconds. The video transcoding or API call took too long. Please try a shorter video.")), 280000);
    });

    // Step 6: The Final Call - Pass the file to model.generateContent
    const payload: any[] = [];
    
    // Add photos if provided (download and convert to base64)
    if (frontPhotoUrl) {
      try {
        const frontRes = await fetch(frontPhotoUrl);
        const frontBuffer = await frontRes.arrayBuffer();
        payload.push({ text: "High-resolution Front Cover Photo:" });
        payload.push({ 
          inlineData: { 
            mimeType: "image/jpeg", 
            data: Buffer.from(frontBuffer).toString('base64') 
          } 
        });
      } catch (e) {
        console.error("Failed to download front photo:", e);
      }
    }
    
    if (backPhotoUrl) {
      try {
        const backRes = await fetch(backPhotoUrl);
        const backBuffer = await backRes.arrayBuffer();
        payload.push({ text: "High-resolution Back Cover Photo:" });
        payload.push({ 
          inlineData: { 
            mimeType: "image/jpeg", 
            data: Buffer.from(backBuffer).toString('base64') 
          } 
        });
      } catch (e) {
        console.error("Failed to download back photo:", e);
      }
    }

    if (spinePhotoUrl) {
      try {
        const spineRes = await fetch(spinePhotoUrl);
        const spineBuffer = await spineRes.arrayBuffer();
        payload.push({ text: "High-resolution Spine Photo:" });
        payload.push({ 
          inlineData: { 
            mimeType: "image/jpeg", 
            data: Buffer.from(spineBuffer).toString('base64') 
          } 
        });
      } catch (e) {
        console.error("Failed to download spine photo:", e);
      }
    }

    // Add video
    payload.push({ text: "Full 360° video showing all angles:" });
    payload.push({ 
      fileData: { 
        mimeType: 'video/mp4', 
        fileUri: file.uri 
      } 
    });
    
    payload.push({ 
      text: `Analyze this collectible. RESPOND ONLY WITH VALID JSON.

Identify the item type (comic, card, toy, other) and grade it appropriately.

JSON format:
{
  "itemType": "comic|card|toy|other|unknown",
  "title": "Item name",
  "issue": "Issue/Set/Series or N/A",
  "year": "Year if known",
  "variant": "Variant info or null",
  "estimatedGrade": "X.X",
  "gradingScale": "CGC|PSA|BGS|Custom",
  "reasoning": [
    {
      "defect": "Name of Defect",
      "timestamp": "MM:SS",
      "note": "Concise description of the defect"
    }
  ],
  "summary": "Brief, 2-3 sentence overview of condition."
}

Use appropriate grading scale: CGC for comics, PSA/BGS for cards. Be concise, objective, and follow industry standard grading terms.` 
    });
    
    console.log(`[Server Action] Sending to Gemini API...`);
    console.log(`[Server Action] File URI: ${file.uri}`);
    console.log(`[Server Action] MIME Type: video/mp4`);
    console.log(`[Server Action] Payload parts: ${payload.length}`);
    
    // Generate content with the model
    let result: any;
    try {
      const analysisPromise = model.generateContent(payload);
      result = await Promise.race([analysisPromise, timeoutPromise]) as any;
      console.log("[Server Action] ✅ Received response from Gemini API");
    } catch (geminiError: any) {
      // Log the full error from Gemini API
      console.error("[Server Action] ❌ Gemini API error:", {
        name: geminiError?.name,
        message: geminiError?.message,
        stack: geminiError?.stack,
        response: geminiError?.response,
        status: geminiError?.status,
        statusText: geminiError?.statusText,
        fullError: JSON.stringify(geminiError, Object.getOwnPropertyNames(geminiError))
      });
      
      // Try to extract more details from the error
      let errorMessage = geminiError?.message || String(geminiError);
      if (geminiError?.response) {
        try {
          const errorText = await geminiError.response.text();
          console.error("[Server Action] Gemini API error response body:", errorText);
          errorMessage += ` | Response: ${errorText}`;
        } catch (e) {
          // Ignore if we can't read the response
        }
      }
      
      throw new Error(`Gemini API error: ${errorMessage}`);
    }
    
    // Get the response text (text() is async and must be awaited)
    const geminiResponse = result.response;
    const text = await geminiResponse.text();
    
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
      
      // Check if the AI couldn't identify the item
      if (parsedResult.itemType === 'unknown') {
        return {
          success: false,
          error: `Could not identify this collectible. ${parsedResult.reasoning || 'Please try again with better lighting or a clearer video.'}`
        };
      }
      
      // Step 7: Get golden frames from Modal worker and do detailed analysis
      let detailedAnalysis = null;
      let goldenFrames: string[] = [];
      let frameTimestamps: number[] = [];
      let cvAnalysis: any = null;
      let defectLabels: Record<string, string[]> = {};
      
      try {
        const modalWebhookUrl = process.env.MODAL_CV_WEBHOOK_URL;
        if (modalWebhookUrl) {
          console.log("[Server Action] Calling Modal for golden frame extraction...");
          
          // Generate a scan ID for this analysis
          const scanId = `scan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          
          const modalResponse = await fetch(modalWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoUrl,
              scanId,
              itemType: parsedResult.itemType || 'comic',
            }),
          });
          
          if (modalResponse.ok) {
            const modalResult = await modalResponse.json();
            
            // DEBUG: Log full Modal response
            console.log("[Server Action] Modal response:", JSON.stringify(modalResult, null, 2).substring(0, 2000));
            console.log("[Server Action] Modal CV Analysis defectLabels:", JSON.stringify(modalResult.cvAnalysis?.defectLabels, null, 2));
            console.log("[Server Action] Modal CV Analysis regionScores:", JSON.stringify(modalResult.cvAnalysis?.regionScores, null, 2));
            
            goldenFrames = modalResult.goldenFrames || [];
            cvAnalysis = modalResult.cvAnalysis || null;
            frameTimestamps = modalResult.frameTimestamps || [];
            defectLabels = modalResult.cvAnalysis?.defectLabels || {};
            
            console.log(`[Server Action] Got ${goldenFrames.length} golden frames from Modal`);
            
            // DEBUG: Log if Modal returned an error
            if (modalResult.error) {
              console.error(`[Server Action] Modal returned error: ${modalResult.error}`);
            }
            if (cvAnalysis) {
              console.log(`[Server Action] CV Analysis: ${cvAnalysis.damageScore?.toFixed(1)}% damage detected`);
            }
            
            // Step 8: Do multi-frame Gemini analysis if we have frames
            if (goldenFrames.length >= 2) {
              console.log("[Server Action] Running multi-frame Gemini analysis...");
              
              const framePayload: any[] = [];
              
              // Download and add each golden frame
              for (let i = 0; i < Math.min(goldenFrames.length, 5); i++) {
                try {
                  const frameRes = await fetch(goldenFrames[i]);
                  const frameBuffer = await frameRes.arrayBuffer();
                  framePayload.push({ text: `Frame ${i + 1} of ${goldenFrames.length}:` });
                  framePayload.push({
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from(frameBuffer).toString('base64')
                    }
                  });
                } catch (e) {
                  console.warn(`[Server Action] Failed to download golden frame ${i}:`, e);
                }
              }
              
              if (framePayload.length >= 2) {
                framePayload.push({
                  text: `You are analyzing ${goldenFrames.length} still frames from different angles of the same collectible.
                  
TASK: Compare all frames and identify defects with high confidence.

1. CONSISTENT DEFECTS: List defects that appear in multiple frames (these are real damage):
   - For each: Type, Location, Severity (minor/moderate/severe)
   
2. GLARE/ARTIFACTS: Note anything that appears in only 1-2 frames (likely reflection, not damage)

3. DETAILED CONDITION NOTES: Provide frame-by-frame observations

4. CONFIDENCE ADJUSTMENT: Based on multi-frame analysis, should the grade be adjusted?

RESPOND IN JSON:
{
  "confirmedDefects": [{"type": "string", "location": "string", "severity": "minor|moderate|severe", "framesVisible": number}],
  "possibleArtifacts": ["description of things that might be glare, not damage"],
  "frameNotes": ["note for each frame"],
  "gradeAdjustment": "none|up|down",
  "adjustmentReason": "why adjust or not",
  "finalGrade": "X.X",
  "confidence": "low|medium|high"
}`
                });
                
                try {
                  const detailedResult = await model.generateContent(framePayload);
                  const detailedText = await detailedResult.response.text();
                  
                  // Parse the detailed analysis
                  let cleanDetailedText = detailedText.trim();
                  cleanDetailedText = cleanDetailedText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
                  if (cleanDetailedText.startsWith("```")) {
                    const lines = cleanDetailedText.split("\n");
                    cleanDetailedText = lines.slice(1, -1).join("\n");
                  }
                  
                  detailedAnalysis = JSON.parse(cleanDetailedText);
                  console.log("[Server Action] Multi-frame analysis complete:", detailedAnalysis);
                  
                  // If detailed analysis suggests grade adjustment, update the grade
                  if (detailedAnalysis.finalGrade && detailedAnalysis.gradeAdjustment !== 'none') {
                    parsedResult.estimatedGrade = detailedAnalysis.finalGrade;
                    parsedResult.reasoning += `\n\n[Multi-Frame Analysis]: ${detailedAnalysis.adjustmentReason}`;
                  }
                } catch (detailError) {
                  console.warn("[Server Action] Multi-frame analysis failed:", detailError);
                }
              }
            }
          } else {
            console.warn("[Server Action] Modal webhook failed:", await modalResponse.text());
          }
        } else {
          console.log("[Server Action] Modal webhook not configured, skipping golden frame extraction");
        }
      } catch (modalError) {
        console.warn("[Server Action] Modal/golden frame extraction failed:", modalError);
        // Don't fail the whole analysis if Modal fails
      }
      
      // Step 9: Fuse AI, CV, and Nyckel grades if available
      let hybridGrade = null;
      let nyckelAnalysis = null;
      
      // Check if we have Nyckel ML analysis (new format)
      const hasNyckelAnalysis = cvAnalysis?.analysisType === 'nyckel-ml' && cvAnalysis?.regionGrades;
      
      if (detailedAnalysis && cvAnalysis) {
        try {
          const aiGrade = parseFloat(parsedResult.estimatedGrade);
          const aiConfidence = detailedAnalysis.confidence || 'medium';
          
          if (hasNyckelAnalysis) {
            // Use new three-way fusion with Nyckel ML
            console.log("[Server Action] Using Nyckel ML three-way grade fusion...");
            const { fuseThreeWayGrades } = await import('@/lib/grade-adjustment');
            
            nyckelAnalysis = cvAnalysis;  // Store Nyckel analysis separately
            
            const threeWayResult = fuseThreeWayGrades(
              aiGrade,
              aiConfidence,
              nyckelAnalysis,
              detailedAnalysis
            );
            
            console.log(`[Server Action] Three-Way Grade: ${threeWayResult.displayGrade} (confidence: ${threeWayResult.overallConfidence})`);
            console.log(`[Server Action] Agreement: ${threeWayResult.agreement}, AI: ${threeWayResult.aiGrade.toFixed(1)}, Nyckel: ${threeWayResult.nyckelGrade.toFixed(1)}`);
            
            // Log per-region grades
            for (const [region, data] of Object.entries(threeWayResult.nyckelRegions)) {
              console.log(`[Server Action]   ${region}: ${data.label} (${data.grade}) - ${(data.confidence * 100).toFixed(0)}%`);
            }
            
            if (threeWayResult.lowestRegion) {
              console.log(`[Server Action] Lowest Region: ${threeWayResult.lowestRegion.region} (${threeWayResult.lowestRegion.grade})`);
            }
            
            // Convert to hybridGrade format for backward compatibility
            hybridGrade = {
              finalGrade: threeWayResult.finalGrade,
              displayGrade: threeWayResult.displayGrade,
              aiGrade: threeWayResult.aiGrade.toFixed(1),
              cvGrade: threeWayResult.nyckelGrade.toFixed(1),  // Use nyckelGrade as cvGrade for compat
              nyckelGrade: threeWayResult.nyckelGrade.toFixed(1),
              agreement: threeWayResult.agreement,
              gradeDifference: threeWayResult.gradeDifference,
              overallConfidence: threeWayResult.overallConfidence,
              aiConfidence,
              cvConfidence: 'high',  // Nyckel is generally high confidence when available
              reasoning: threeWayResult.reasoning,
              nyckelRegions: threeWayResult.nyckelRegions,
              lowestRegion: threeWayResult.lowestRegion,
              criticalIssues: threeWayResult.criticalIssues,
              detailedAnalysis,
              cvAnalysis: {
                damageScore: cvAnalysis.damageScore,
                regionScores: cvAnalysis.regionScores,
                regionGrades: cvAnalysis.regionGrades,
                ...cvAnalysis.images
              }
            };
            
            // Update result with hybrid grade
            parsedResult.estimatedGrade = threeWayResult.finalGrade;
            
          } else if (cvAnalysis.damageScore !== undefined) {
            // Fallback to legacy two-way fusion (AI + CV variance)
            console.log("[Server Action] Using legacy two-way grade fusion (CV variance)...");
            const { fuseGrades } = await import('@/lib/grade-adjustment');
            
            hybridGrade = fuseGrades(
              aiGrade,
              aiConfidence,
              cvAnalysis.damageScore,
              cvAnalysis.regionScores || {},
              detailedAnalysis,
              defectLabels
            );
            
            console.log(`[Server Action] Hybrid Grade: ${hybridGrade.displayGrade} (confidence: ${hybridGrade.overallConfidence})`);
            console.log(`[Server Action] Agreement: ${hybridGrade.agreement}, AI: ${hybridGrade.aiGrade}, CV: ${hybridGrade.cvGrade}`);
            
            // Update result with hybrid grade
            parsedResult.estimatedGrade = hybridGrade.finalGrade;
            
            // Add CV images to hybridGrade
            if (cvAnalysis.images) {
              hybridGrade.cvAnalysis = {
                ...hybridGrade.cvAnalysis,
                ...cvAnalysis.images
              };
            }
          }
        } catch (fusionError) {
          console.warn("[Server Action] Grade fusion failed:", fusionError);
        }
      }
      
      // Add golden frames, detailed analysis, CV analysis, Nyckel analysis, and hybrid grade to result
      const enrichedResult = {
        ...parsedResult,
        goldenFrames,
        frameTimestamps,
        detailedAnalysis,
        cvAnalysis,
        nyckelAnalysis,  // NEW: Include Nyckel analysis separately
        hybridGrade,
      };
      
      return { success: true, data: enrichedResult };
    } catch (parseError) {
      console.error("Failed to parse JSON:", cleanText);
      
      // Check if the text indicates an identification issue
      const lowerText = cleanText.toLowerCase();
      if (lowerText.includes('cannot identify') || lowerText.includes('unable to') || 
          lowerText.includes('not clear') || lowerText.includes('cannot determine')) {
        return { 
          success: false, 
          error: `Could not identify this item. The AI reported: "${cleanText.substring(0, 150)}..."` 
        };
      }
      
      return { 
        success: false, 
        error: `Invalid JSON response from AI: ${cleanText.substring(0, 200)}` 
      };
    }

  } catch (error) {
    // Enhanced error logging for production debugging
    const errorDetails = {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.constructor.name : typeof error,
    };
    
    // Check if it's a Gemini API error with more details
    let geminiErrorDetails = null;
    if (error && typeof error === 'object' && 'response' in error) {
      try {
        geminiErrorDetails = JSON.stringify(error);
      } catch (e) {
        geminiErrorDetails = String(error);
      }
    }
    
    console.error("[Server Action] ========== ERROR DETAILS ==========");
    console.error("[Server Action] Error analyzing comic:", errorDetails);
    if (geminiErrorDetails) {
      console.error("[Server Action] Gemini API error details:", geminiErrorDetails);
    }
    console.error("[Server Action] Video URL:", videoUrl);
    console.error("[Server Action] API Key set:", !!process.env.GOOGLE_API_KEY);
    console.error("[Server Action] ==================================");
    
    // Provide more helpful error messages
    let errorMessage = "Failed to analyze comic. Check Vercel logs for details.";
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Handle specific error cases
      if (error.message.includes("GOOGLE_API_KEY")) {
        errorMessage = "Google API key is missing. Please add GOOGLE_API_KEY to Vercel environment variables.";
      } else if (error.message.includes("unexpected response") || error.message.includes("Unexpected")) {
        errorMessage = "Server action error: The response may be too large or the request timed out. Try a shorter video.";
      } else if (error.message.includes("not found") || error.message.includes("404") || error.message.includes("500")) {
        if (error.message.includes("500")) {
          errorMessage = `500 Internal Server Error from Gemini API. Possible causes: 1) Token overflow (video too large - try smaller/shorter video) 2) Malformed payload (invalid base64 or mimeType) 3) API quota/permission issue 4) Temporary API outage. Check Vercel logs for token estimates. Original error: ${error.message}`;
        } else {
          errorMessage = `API error (${error.message.includes("404") ? "Model not found" : "Unknown"}). Using gemini-2.5-flash. Possible solutions: 1) Update your API key from https://aistudio.google.com/apikey 2) Ensure billing is enabled (even for free tier) 3) Try again in a few moments (API may be temporarily unavailable). Original error: ${error.message}`;
        }
      } else if (error.message.includes("invalid") || error.message.includes("malformed") || error.message.includes("format")) {
        errorMessage = `Invalid payload format. The video may be corrupted or in an unsupported format. Error: ${error.message}`;
      } else if (error.message.includes("timeout") || error.message.includes("timed out")) {
        errorMessage = error.message; // Keep timeout messages as-is
      } else if (error.message.includes("Failed to download")) {
        errorMessage = error.message; // Keep download error messages as-is
      }
    } else {
      errorMessage = `Failed to analyze comic: ${String(error)}. Check Vercel logs for details.`;
    }
    
    // Return error as result object instead of throwing
    // This prevents Next.js from hiding the error in production
    return { success: false, error: errorMessage };
  } finally {
    // Step 7: Cleanup - Delete both files in /tmp in a finally block
    // Use Promise.allSettled so that if one file is missing, the other still gets deleted
    const cleanupPromises = [
      unlink(inputPath).catch(err => {
        console.warn(`[Server Action] Failed to cleanup ${inputPath}:`, err);
      }),
      unlink(outputPath).catch(err => {
        console.warn(`[Server Action] Failed to cleanup ${outputPath}:`, err);
      }),
    ];
    
    const results = await Promise.allSettled(cleanupPromises);
    const cleaned = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[Server Action] Cleaned up ${cleaned}/${cleanupPromises.length} temp files`);
    
    // Safety check: After unlinking, use fs.promises.access to check if files still exist
    // If they do, log an error
    try {
      await access(inputPath);
      console.error(`[Server Action] ⚠️ SAFETY CHECK FAILED: ${inputPath} still exists after unlink!`);
    } catch (err) {
      // File doesn't exist (expected) - this is fine
    }
    
    try {
      await access(outputPath);
      console.error(`[Server Action] ⚠️ SAFETY CHECK FAILED: ${outputPath} still exists after unlink!`);
    } catch (err) {
      // File doesn't exist (expected) - this is fine
    }
  }
}
