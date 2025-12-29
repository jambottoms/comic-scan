'use server';

/**
 * Phase 2: CV Analysis & Grade Fusion
 * 
 * This server action handles the detailed CV analysis:
 * 1. Call Modal worker for golden frames + CV analysis
 * 2. Run multi-frame Gemini verification
 * 3. Fuse AI + CV + Nyckel grades
 * 4. Update Supabase job record with final results
 * 
 * This phase runs in parallel with Phase 1 (AI analysis) for faster results.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServerClient } from '@/lib/supabase/server';

export type AnalyzePhase2Result = 
  | { success: true; data: any }
  | { success: false; error: string };

export async function analyzePhase2(input: {
  videoUrl: string;
  jobId: string;
  aiGrade: string;
  itemType?: string;
}): Promise<AnalyzePhase2Result> {
  const { videoUrl, jobId, aiGrade, itemType = 'comic' } = input;
  
  const supabase = createServerClient();
  const apiKey = process.env.GOOGLE_API_KEY;

  try {
    console.log(`[Phase 2] Starting CV analysis for job: ${jobId}`);
    
    // Update frames status to processing
    await supabase.from('analysis_jobs').update({
      frames_status: 'processing',
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    // Step 1: Call Modal worker for golden frames + CV analysis
    const modalWebhookUrl = process.env.MODAL_CV_WEBHOOK_URL;
    if (!modalWebhookUrl) {
      console.warn("[Phase 2] Modal webhook not configured, skipping CV analysis");
      return { 
        success: false, 
        error: "Modal CV webhook not configured" 
      };
    }
    
    console.log("[Phase 2] Calling Modal for golden frame extraction and CV analysis...");
    
    const modalResponse = await fetch(modalWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl,
        scanId: jobId,
        itemType,
      }),
    });
    
    if (!modalResponse.ok) {
      const errorText = await modalResponse.text();
      throw new Error(`Modal worker failed: ${modalResponse.status} - ${errorText}`);
    }
    
    const modalResult = await modalResponse.json();
    
    console.log(`[Phase 2] Got ${modalResult.goldenFrames?.length || 0} golden frames from Modal`);
    
    const goldenFrames: string[] = modalResult.goldenFrames || [];
    const frameTimestamps: number[] = modalResult.frameTimestamps || [];
    const cvAnalysis: any = modalResult.cvAnalysis || modalResult.nyckelAnalysis || null;
    const nyckelAnalysis: any = modalResult.nyckelAnalysis || null;
    
    if (cvAnalysis) {
      console.log(`[Phase 2] CV Analysis: ${cvAnalysis.damageScore?.toFixed(1)}% damage detected`);
    }
    
    // Update frames status to complete
    await supabase.from('analysis_jobs').update({
      frames_status: 'complete',
      golden_frames: goldenFrames,
      frames_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    // Update CV status to processing
    await supabase.from('analysis_jobs').update({
      cv_status: 'processing',
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    // Step 2: Run multi-frame Gemini analysis if we have enough frames
    let detailedAnalysis: any = null;
    
    if (goldenFrames.length >= 2 && apiKey) {
      console.log("[Phase 2] Running multi-frame Gemini analysis...");
      
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
        });
        
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
            console.warn(`[Phase 2] Failed to download golden frame ${i}:`, e);
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
          console.log("[Phase 2] Multi-frame analysis complete:", detailedAnalysis);
        }
      } catch (detailError: any) {
        console.warn("[Phase 2] Multi-frame analysis failed:", detailError.message);
        // Don't fail the whole phase if this fails
      }
    }
    
    // Step 3: Create hybrid grade summary (simplified for now)
    let hybridGrade: any = null;
    
    if (detailedAnalysis && cvAnalysis) {
      try {
        const aiGradeNum = parseFloat(aiGrade);
        const aiConfidence = detailedAnalysis.confidence || 'medium';
        
        // Check if we have Nyckel ML analysis
        const hasNyckelAnalysis = cvAnalysis?.analysisType === 'nyckel-ml' && cvAnalysis?.regionGrades;
        
        if (hasNyckelAnalysis) {
          // Use Nyckel ML data directly
          console.log("[Phase 2] Using Nyckel ML analysis...");
          const nyckelAvg = cvAnalysis.averageGrade || aiGradeNum;
          
          hybridGrade = {
            finalGrade: nyckelAvg.toFixed(1),
            displayGrade: nyckelAvg.toFixed(1),
            aiGrade: aiGradeNum.toFixed(1),
            cvGrade: nyckelAvg.toFixed(1),
            nyckelGrade: nyckelAvg.toFixed(1),
            agreement: Math.abs(aiGradeNum - nyckelAvg) < 1.0 ? 'strong' : 'moderate',
            gradeDifference: Math.abs(aiGradeNum - nyckelAvg),
            overallConfidence: 'high',
            aiConfidence,
            cvConfidence: 'high',
            reasoning: `AI grade: ${aiGradeNum.toFixed(1)}, Nyckel ML grade: ${nyckelAvg.toFixed(1)}`,
            nyckelRegions: cvAnalysis.regionGrades,
            lowestRegion: cvAnalysis.lowestRegion,
            detailedAnalysis,
            cvAnalysis: {
              damageScore: cvAnalysis.damageScore,
              regionScores: cvAnalysis.regionScores,
              regionGrades: cvAnalysis.regionGrades,
              ...cvAnalysis.images
            }
          };
          
          console.log(`[Phase 2] Hybrid Grade: ${hybridGrade.displayGrade} (AI: ${aiGradeNum.toFixed(1)}, Nyckel: ${nyckelAvg.toFixed(1)})`);
        } else if (cvAnalysis.damageScore !== undefined) {
          // Simple adjustment based on damage score
          console.log("[Phase 2] Using CV damage score for grade adjustment...");
          
          // Simple heuristic: reduce grade based on damage score
          const adjustment = (cvAnalysis.damageScore / 100) * 2; // Max 2 point reduction
          const adjustedGrade = Math.max(0.5, aiGradeNum - adjustment);
          
          hybridGrade = {
            finalGrade: adjustedGrade.toFixed(1),
            displayGrade: adjustedGrade.toFixed(1),
            aiGrade: aiGradeNum.toFixed(1),
            cvGrade: adjustedGrade.toFixed(1),
            agreement: adjustment < 0.5 ? 'strong' : 'moderate',
            gradeDifference: adjustment,
            overallConfidence: 'medium',
            aiConfidence,
            cvConfidence: 'medium',
            reasoning: `Grade adjusted by -${adjustment.toFixed(1)} based on ${cvAnalysis.damageScore.toFixed(1)}% damage detected`,
            detailedAnalysis,
            cvAnalysis: {
              damageScore: cvAnalysis.damageScore,
              regionScores: cvAnalysis.regionScores,
              ...cvAnalysis.images
            }
          };
          
          console.log(`[Phase 2] Adjusted Grade: ${hybridGrade.displayGrade} (${adjustment.toFixed(1)} point reduction)`);
        }
      } catch (fusionError: any) {
        console.warn("[Phase 2] Grade calculation failed:", fusionError.message);
      }
    }
    
    // Step 4: Update job with final results
    const finalGrade = hybridGrade?.finalGrade || aiGrade;
    
    await supabase.from('analysis_jobs').update({
      cv_status: 'complete',
      cv_results: cvAnalysis,
      hybrid_grade: hybridGrade,
      final_grade: finalGrade,
      status: 'complete',
      cv_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    console.log(`[Phase 2] ✅ CV analysis complete for job ${jobId}`);
    
    return {
      success: true,
      data: {
        goldenFrames,
        frameTimestamps,
        cvAnalysis,
        nyckelAnalysis,
        detailedAnalysis,
        hybridGrade,
        finalGrade,
      }
    };
    
  } catch (error: any) {
    console.error("[Phase 2] Error:", error);
    
    // Update job with error
    await supabase.from('analysis_jobs').update({
      cv_status: 'failed',
      status: 'failed',
      error: error.message || String(error),
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    
    return { success: false, error: error.message || String(error) };
  }
}

