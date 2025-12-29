'use server';

/**
 * Phase 1: AI Analysis Only
 * 
 * This server action handles the initial AI analysis of the video:
 * 1. Download video from Supabase
 * 2. Transcode with FFmpeg
 * 3. Upload to Google File API
 * 4. Run Gemini AI analysis
 * 5. Update Supabase job record with AI results
 * 
 * This phase runs in parallel with Phase 2 (CV analysis) for faster results.
 */

// Environment Fix: Use createRequire for ESM compatibility
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { spawnSync } from 'child_process';
import { writeFile, unlink, stat, access } from 'fs/promises';
import path from 'path';
import { createClient } from '@/lib/supabase/client';

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

export type AnalyzePhase1Result = 
  | { success: true; data: any }
  | { success: false; error: string };

export async function analyzePhase1(input: {
  videoUrl: string;
  jobId: string;
  frontPhotoUrl?: string;
  backPhotoUrl?: string;
  spinePhotoUrl?: string;
}): Promise<AnalyzePhase1Result> {
  const { videoUrl, jobId, frontPhotoUrl, backPhotoUrl, spinePhotoUrl } = input;
  
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const errorMsg = "GOOGLE_API_KEY is not set in environment variables.";
    console.error(`[Phase 1] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  const supabase = createClient();
  
  // File paths
  const inputPath = `/tmp/phase1-input-${jobId}.mov`;
  const outputPath = `/tmp/phase1-output-${jobId}.mp4`;

  try {
    console.log(`[Phase 1] Starting AI analysis for job: ${jobId}`);
    
    // Update job status to processing
    await supabase.from('analysis_jobs').update({
      ai_status: 'processing',
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    // Step 1: Download video
    console.log(`[Phase 1] Downloading video...`);
    const response = await fetch(videoUrl, {
      headers: { 'Accept': 'video/*' },
    });

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`[Phase 1] Downloaded ${fileSizeMB}MB`);
    
    await writeFile(inputPath, buffer);
    
    // Step 2: FFmpeg transcode
    console.log(`[Phase 1] Transcoding video...`);
    const ffmpegResult = spawnSync(path.resolve(ffmpegPath), [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-vf', 'scale=-1:1080,fps=1',
      '-an',
      '-f', 'mp4',
      outputPath
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (ffmpegResult.error) {
      throw new Error(`FFmpeg process failed: ${ffmpegResult.error.message}`);
    }

    if (ffmpegResult.status !== 0) {
      const stderr = ffmpegResult.stderr?.toString() || 'Unknown error';
      throw new Error(`FFmpeg process exited with code: ${ffmpegResult.status}. Error: ${stderr.slice(-500)}`);
    }

    const outputStats = await stat(outputPath);
    const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
    console.log(`[Phase 1] Transcoded: ${outputSizeMB}MB`);
    
    // Step 3: Upload to Google File API
    console.log(`[Phase 1] Uploading to Google File API...`);
    const fileManager = new GoogleAIFileManager(apiKey);
    
    const uploadResult = await fileManager.uploadFile(outputPath, {
      mimeType: 'video/mp4',
      displayName: `ComicScan_Phase1_${jobId}`,
    });
    
    console.log(`[Phase 1] File uploaded, polling for ACTIVE state...`);
    
    // Step 4: Poll until file is ACTIVE
    const pollInterval = 500;
    const maxWaitTime = 30000;
    const startTime = Date.now();
    
    let file = uploadResult.file;
    
    while (file.state !== 'ACTIVE') {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`File upload timed out - file did not become ACTIVE within ${maxWaitTime / 1000} seconds.`);
      }
      
      if (file.state === 'FAILED') {
        throw new Error(`File upload failed: ${file.error?.message || 'Unknown error'}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      file = await fileManager.getFile(uploadResult.file.name);
    }
    
    console.log(`[Phase 1] File is ACTIVE, running Gemini analysis...`);
    
    // Step 5: Run Gemini AI analysis
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
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("AI analysis timed out after 280 seconds.")), 280000);
    });

    // Build payload
    const payload: any[] = [];
    
    // Add photos if provided
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
        console.error("[Phase 1] Failed to download front photo:", e);
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
        console.error("[Phase 1] Failed to download back photo:", e);
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
        console.error("[Phase 1] Failed to download spine photo:", e);
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
    
    console.log(`[Phase 1] Sending to Gemini API...`);
    
    // Generate content
    let result: any;
    try {
      const analysisPromise = model.generateContent(payload);
      result = await Promise.race([analysisPromise, timeoutPromise]) as any;
      console.log("[Phase 1] ✅ Received response from Gemini API");
    } catch (geminiError: any) {
      console.error("[Phase 1] ❌ Gemini API error:", geminiError);
      throw new Error(`Gemini API error: ${geminiError?.message || String(geminiError)}`);
    }
    
    // Parse response
    const geminiResponse = result.response;
    const text = await geminiResponse.text();
    
    let cleanText = text.trim();
    
    // Remove markdown code blocks
    if (cleanText.startsWith("```")) {
      const lines = cleanText.split("\n");
      cleanText = lines.slice(1, -1).join("\n");
    }
    cleanText = cleanText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    
    // Parse JSON
    const parsedResult = JSON.parse(cleanText);
    console.log("[Phase 1] Parsed JSON result:", parsedResult);
    
    // Check if AI couldn't identify the item
    if (parsedResult.itemType === 'unknown') {
      await supabase.from('analysis_jobs').update({
        ai_status: 'failed',
        error: 'Could not identify collectible',
        updated_at: new Date().toISOString()
      }).eq('id', jobId);
      
      return {
        success: false,
        error: `Could not identify this collectible. ${parsedResult.reasoning || 'Please try again with better lighting or a clearer video.'}`
      };
    }
    
    // Prepare AI results
    const aiResults = {
      itemType: parsedResult.itemType,
      title: parsedResult.title,
      issue: parsedResult.issue,
      year: parsedResult.year,
      variant: parsedResult.variant,
      estimatedGrade: parsedResult.estimatedGrade,
      gradingScale: parsedResult.gradingScale,
      reasoning: parsedResult.reasoning,
      summary: parsedResult.summary,
      pageQuality: parsedResult.pageQuality || 'Good',
    };
    
    // Update Supabase with AI results
    await supabase.from('analysis_jobs').update({
      ai_status: 'complete',
      ai_results: aiResults,
      ai_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    console.log(`[Phase 1] ✅ AI analysis complete for job ${jobId}`);
    
    return { success: true, data: aiResults };
    
  } catch (error: any) {
    console.error("[Phase 1] Error:", error);
    
    // Update job with error
    await supabase.from('analysis_jobs').update({
      ai_status: 'failed',
      error: error.message || String(error),
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    return { success: false, error: error.message || String(error) };
    
  } finally {
    // Cleanup temp files
    try {
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
      console.log(`[Phase 1] Cleaned up temp files for job ${jobId}`);
    } catch (e) {
      console.warn(`[Phase 1] Failed to cleanup temp files:`, e);
    }
  }
}

