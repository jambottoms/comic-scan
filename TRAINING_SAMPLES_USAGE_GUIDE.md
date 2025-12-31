# Training Samples Table - Usage Guide

## 📊 Overview

The `training_samples` table stores **all training data** submitted via the Train AI tab. This gives you:

- ✅ **Backup** of all training data outside Nyckel
- ✅ **Analytics** on what labels are being trained
- ✅ **Portability** to migrate to other ML providers
- ✅ **Quality control** to review and audit training data
- ✅ **Debugging** to track Nyckel submission status

---

## 🗄️ Database Setup

### 1. Run the SQL Migration

```bash
# In Supabase SQL Editor, run:
cat SUPABASE_TRAINING_SAMPLES.sql
```

This creates the `training_samples` table with proper indexes and RLS policies.

---

## 📋 Schema

```typescript
interface TrainingSample {
  id: string;                    // UUID primary key
  created_at: string;            // Timestamp
  
  // Image data
  image_url: string;             // Public URL
  image_path: string;            // Storage path in 'training-data' bucket
  
  // Label information
  label: string;                 // e.g., "heavy_wear", "Spine Tick"
  label_type: 'defect' | 'region' | 'grade';
  
  // Nyckel tracking
  nyckel_function_id?: string;   // Which function this was sent to
  nyckel_sample_id?: string;     // ID returned by Nyckel
  nyckel_status: 'submitted' | 'accepted' | 'rejected' | 'error';
  
  // Metadata
  source_scan_id?: string;       // If from a grading result
  region_name?: string;          // spine, corner_tl, etc.
  crop_data?: {                  // Crop coordinates
    x: number;
    y: number;
    width: number;
    height: number;
  };
  
  // Quality metrics (optional)
  image_width?: number;
  image_height?: number;
  file_size_bytes?: number;
}
```

---

## 🔍 Example Queries

### 1. **Count Samples by Label Type**

```sql
SELECT 
  label_type,
  COUNT(*) as sample_count
FROM training_samples
GROUP BY label_type
ORDER BY sample_count DESC;
```

**Expected Output:**
```
label_type | sample_count
-----------+-------------
grade      | 145
defect     | 89
region     | 23
```

---

### 2. **Count Samples by Label (Grade Distribution)**

```sql
SELECT 
  label,
  label_type,
  COUNT(*) as count
FROM training_samples
WHERE label_type = 'grade'
GROUP BY label, label_type
ORDER BY count DESC;
```

**Expected Output:**
```
label          | label_type | count
---------------+------------+-------
pristine       | grade      | 45
near_mint      | grade      | 38
minor_wear     | grade      | 25
moderate_wear  | grade      | 20
heavy_wear     | grade      | 12
damaged        | grade      | 5
```

**💡 Use Case:** Identify which labels need more training samples.

---

### 3. **Find Failed Nyckel Submissions**

```sql
SELECT 
  id,
  created_at,
  label,
  label_type,
  image_url,
  nyckel_status
FROM training_samples
WHERE nyckel_status = 'error'
ORDER BY created_at DESC
LIMIT 20;
```

**💡 Use Case:** Debug Nyckel API issues or resubmit failed samples.

---

### 4. **Training Activity by Day**

```sql
SELECT 
  DATE(created_at) as training_date,
  COUNT(*) as samples_submitted,
  COUNT(DISTINCT label) as unique_labels
FROM training_samples
GROUP BY DATE(created_at)
ORDER BY training_date DESC
LIMIT 30;
```

**💡 Use Case:** Track training activity over time.

---

### 5. **Get All Samples for a Specific Label**

```sql
SELECT 
  id,
  image_url,
  created_at,
  nyckel_status
FROM training_samples
WHERE label = 'heavy_wear'
  AND label_type = 'grade'
ORDER BY created_at DESC;
```

**💡 Use Case:** Download all samples for a specific label to retrain elsewhere.

---

### 6. **Export Training Data for ML Migration**

```sql
SELECT 
  image_url,
  label,
  label_type,
  crop_data,
  created_at
FROM training_samples
WHERE nyckel_status = 'accepted'
ORDER BY label, created_at;
```

**💡 Use Case:** Export to CSV/JSON for training a custom model or migrating to another provider.

---

### 7. **Find Samples from Specific Scans**

```sql
SELECT 
  ts.label,
  ts.region_name,
  ts.image_url,
  aj.golden_frames[1] as scan_frame
FROM training_samples ts
LEFT JOIN analysis_jobs aj ON ts.source_scan_id = aj.id
WHERE ts.source_scan_id IS NOT NULL
ORDER BY ts.created_at DESC;
```

**💡 Use Case:** Link training samples back to specific comic scans.

---

## 📥 Export Training Data

### Export as CSV (Supabase Dashboard)

1. Go to Supabase Dashboard → SQL Editor
2. Run your query
3. Click "Download as CSV"

### Export via API (JavaScript)

```typescript
import { createClient } from '@/lib/supabase/client';

async function exportTrainingData() {
  const supabase = createClient();
  
  const { data, error } = await supabase
    .from('training_samples')
    .select('*')
    .eq('nyckel_status', 'accepted')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // Download as JSON
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `training_data_${new Date().toISOString()}.json`;
  a.click();
}
```

---

## 🔄 Use Cases Outside Nyckel

### 1. **Train a Custom Model**

```python
import pandas as pd
import requests
from PIL import Image
from io import BytesIO

# Load training data from Supabase
df = pd.read_csv('training_samples.csv')

# Download images and prepare for training
for idx, row in df.iterrows():
    response = requests.get(row['image_url'])
    img = Image.open(BytesIO(response.content))
    
    # Save to local dataset
    label = row['label']
    img.save(f'./dataset/{label}/{row["id"]}.jpg')

# Now train your custom PyTorch/TensorFlow model
```

---

### 2. **Export to Roboflow/Label Studio**

```javascript
// Convert Supabase format to Roboflow format
const convertToRoboflow = (samples) => {
  return samples.map(s => ({
    image: s.image_url,
    label: s.label,
    metadata: {
      source: 'comic-scan-app',
      date: s.created_at,
      crop: s.crop_data
    }
  }));
};
```

---

### 3. **Quality Audit Dashboard**

Build a dashboard to review training samples:

```typescript
// Get samples with low confidence or errors
const problematicSamples = await supabase
  .from('training_samples')
  .select('*')
  .or('nyckel_status.eq.error,nyckel_status.eq.rejected')
  .order('created_at', { ascending: false });

// Display images with ability to re-label or delete
```

---

## 🎯 Best Practices

### 1. **Regular Backups**

Set up a cron job to export training data weekly:

```bash
# Export to JSON every Sunday
0 0 * * 0 node scripts/backup-training-data.js
```

### 2. **Monitor Training Balance**

Alert if label distribution becomes too imbalanced:

```sql
-- Find labels with < 10 samples
SELECT label, COUNT(*) as count
FROM training_samples
WHERE label_type = 'grade'
GROUP BY label
HAVING COUNT(*) < 10;
```

### 3. **Track Quality Metrics**

Add image dimensions and file size for quality analysis:

```typescript
// In your upload handler
const img = new Image();
img.onload = () => {
  const metadata = {
    image_width: img.width,
    image_height: img.height,
    file_size_bytes: blob.size
  };
  // Save to training_samples
};
```

---

## 🔐 Security Notes

- ✅ RLS policies allow anyone to insert/read (for anonymous training)
- ✅ Images are in public `training-data` bucket
- ⚠️ If you need private training data, adjust RLS policies

---

## 📊 Analytics Dashboard Ideas

### Supabase Dashboard Widgets

1. **Total Samples by Type** (Pie Chart)
2. **Training Activity Timeline** (Line Chart)
3. **Label Distribution** (Bar Chart)
4. **Success Rate** (accepted vs error) (Gauge)
5. **Recent Submissions** (Table)

### SQL for Analytics

```sql
-- Overall stats
SELECT 
  COUNT(*) as total_samples,
  COUNT(DISTINCT label) as unique_labels,
  COUNT(CASE WHEN nyckel_status = 'accepted' THEN 1 END) as successful,
  COUNT(CASE WHEN nyckel_status = 'error' THEN 1 END) as failed,
  ROUND(COUNT(CASE WHEN nyckel_status = 'accepted' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as success_rate
FROM training_samples;
```

---

## 🚀 Next Steps

1. ✅ Run `SUPABASE_TRAINING_SAMPLES.sql` to create the table
2. ✅ Train some samples via the app
3. ✅ Run the queries above to explore your data
4. ✅ Export data if you want to train elsewhere
5. ✅ Set up backups/monitoring

---

**Questions?** Check the data after submitting a few training samples!

