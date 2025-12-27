# Golden Frames & Condition Analysis Status

## ✅ What's Working (FIXED)

### 1. **5 Golden Frames Extraction**
- ✅ Modal CV worker correctly extracts 5 frames per video
- ✅ Frames are uploaded to Supabase `analysis-images` bucket
- ✅ Frame URLs and timestamps are returned to frontend
- ✅ UI now displays all 5 frames (3 in first row, 2 in second row)
- ✅ Timestamps are now visible on each frame (e.g., "1.45s")

### 2. **Multi-Frame Gemini Analysis**
- ✅ All 5 frames are sent to Gemini for detailed analysis
- ✅ Returns `detailedAnalysis` object with:
  - `confirmedDefects[]` - list of defects verified across multiple frames
  - `possibleArtifacts[]` - false positives to ignore
  - `frameNotes[]` - detailed notes for each frame
  - `gradeAdjustment` - whether grade changed
  - `finalGrade` - final grade after multi-frame review
  - `confidence` - high/medium/low confidence level
- ✅ UI displays this analysis in "Multi-Frame Analysis" section

---

## 🚧 What's Still Missing from Condition Analysis

### 1. **CV-Based Region Crops (Not in Production)**
The `glint_analyzer.py` script generates these files locally but they're NOT uploaded or displayed:

#### Missing Files:
- `crop_corner_tl.png` - Top-left corner closeup
- `crop_corner_tr.png` - Top-right corner closeup
- `crop_corner_bl.png` - Bottom-left corner closeup
- `crop_corner_br.png` - Bottom-right corner closeup
- `crop_spine.png` - Spine region closeup
- `crop_surface.png` - Center surface region

#### Missing Visualizations:
- `overlay_*.png` - Defect masks overlaid on crops (red highlights)
- `mask_*.png` - Binary defect masks per region
- `defect_mask_full.png` - Full-image defect mask
- `variance_heatmap.png` - Heatmap showing pixel variance across frames
- `regions_overlay.png` - Full image with region boundaries drawn

### 2. **CV-Based Defect Scores**
The glint analyzer calculates these but they're NOT in the result:
- `damageScore` - Overall damage percentage (0-100)
- `regionScores` - Per-region damage scores:
  - `spine` - Spine condition
  - `corner_tl`, `corner_tr`, `corner_bl`, `corner_br` - Corner conditions
  - `surface` - Surface condition
- `defectPercentage` - Percentage of pixels flagged as defects

### 3. **Integration Path**
These CV features exist but aren't connected to the production pipeline:

**Current Local-Only Flow:**
```bash
# 1. Extract frames
modal run cv_worker.py --video-url "..." --scan-id "..."

# 2. Manually download frames to temp_analysis/

# 3. Run perspective correction (optional)
python perspect_warp.py temp_analysis temp_analysis

# 4. Run glint analysis
python glint_analyzer.py temp_analysis temp_analysis

# 5. Results saved locally only
```

**What's Needed for Production:**
1. Modal worker uploads CV analysis results to Supabase
2. Server action downloads and includes in result object
3. UI components display region crops and scores

---

## 📊 Current Result Structure

```typescript
interface AnalyzeResult {
  // Basic Info
  itemType: string;
  title: string;
  issue: string;
  year: string;
  variant?: string;
  
  // Grading (from initial Gemini video analysis)
  estimatedGrade: string;
  gradingScale: string;
  reasoning: string;
  
  // ✅ Golden Frames (WORKING)
  goldenFrames: string[];          // 5 frame URLs
  frameTimestamps: number[];       // 5 timestamps in seconds
  
  // ✅ Multi-Frame Analysis (WORKING)
  detailedAnalysis: {
    confirmedDefects: Array<{
      type: string;
      location: string;
      severity: string;
      framesVisible: number;
    }>;
    possibleArtifacts: string[];
    frameNotes: string[];
    gradeAdjustment: string;
    adjustmentReason: string;
    finalGrade: string;
    confidence: 'high' | 'medium' | 'low';
  };
  
  // 🚧 CV Analysis (NOT YET CONNECTED)
  // These fields exist in UI but aren't populated:
  damageScore?: number;
  defectPercentage?: number;
  regionScores?: {
    spine?: number;
    corner_tl?: number;
    corner_tr?: number;
    corner_bl?: number;
    corner_br?: number;
    surface?: number;
  };
  regionCrops?: {
    spine?: string;
    corner_tl?: string;
    corner_tr?: string;
    corner_bl?: string;
    corner_br?: string;
    surface?: string;
  };
  defectMask?: string;
  varianceMap?: string;
}
```

---

## 🎯 Recommendations

### Option A: Keep AI-Only (Current State)
**Pros:**
- ✅ Works end-to-end in production
- ✅ Gemini multi-frame analysis is very accurate
- ✅ No additional CV processing time
- ✅ Simpler architecture

**Cons:**
- ❌ No detailed region crops for user review
- ❌ No quantitative defect scores
- ❌ Can't train custom defect models (Nyckel)

### Option B: Add CV Analysis
**Pros:**
- ✅ Visual region breakdown (spine, corners, surface)
- ✅ Quantitative damage scores per region
- ✅ Can feed crops to Nyckel for custom classification
- ✅ Variance heatmaps show exactly where defects are

**Cons:**
- ❌ Adds 10-20s processing time
- ❌ More complex pipeline
- ❌ Requires additional storage for analysis images
- ❌ Needs Modal worker updates

### Option C: Hybrid (Recommended)
1. Use Gemini multi-frame for primary grading (fast, accurate)
2. Add CV analysis as optional "Deep Scan" feature
3. User taps "Deep Scan" button if they want region breakdown
4. Runs glint analyzer on-demand and shows detailed crops

---

## 🛠️ Next Steps (If Adding CV)

1. **Update Modal Worker** (`cv_worker.py`):
   - Add glint_analyzer import
   - Run analysis after frame extraction
   - Upload all crops/masks to Supabase

2. **Update Server Action** (`analyze-from-url.ts`):
   - Include CV results in response
   - Add `damageScore`, `regionScores`, `regionCrops`

3. **UI Enhancement**:
   - Already prepared! ResultCard shows region crops when present
   - Just needs data populated

---

## 📸 Example Terminal Output

```
[Server Action] Calling Modal for golden frame extraction...
[Server Action] Got 5 golden frames from Modal
[Server Action] Running multi-frame Gemini analysis...
[Server Action] Multi-frame analysis complete: {
  confirmedDefects: [
    {
      type: 'spine stress/color breaks',
      location: 'entire spine',
      severity: 'moderate/severe',
      framesVisible: 5
    },
    {
      type: 'corner blunting/creasing',
      location: 'top right corner',
      severity: 'moderate',
      framesVisible: 5
    },
    ...
  ],
  frameNotes: [
    'Frame 1: Significant spine stresses with white color breaks...',
    'Frame 2: Consistent spine stress observations...',
    ...
  ],
  gradeAdjustment: 'none',
  finalGrade: '4.5',
  confidence: 'high'
}
```

This shows:
- ✅ 5 frames extracted
- ✅ Multi-frame analysis complete
- ✅ Detailed defect tracking
- ✅ High confidence grade

**What's missing:** CV region crops, damage scores, heatmaps

