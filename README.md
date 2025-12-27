# GradeVault - Comic Book & Trading Card Grading

A mobile-first web app for grading comic books and trading cards using AI-powered computer vision analysis.

## Features

- 📹 **Video Analysis**: Upload videos of your collectibles for detailed grading
- 🤖 **AI-Powered**: Uses Google Gemini Vision for intelligent analysis
- 🔍 **Deep Scan**: Parallel CV processing for defect detection (3-5x faster)
- 📊 **Detailed Reports**: Golden frames, defect masks, variance heatmaps
- 💾 **Save History**: Track all your scans and compare over time
- 📱 **Mobile-First**: Optimized for scanning with your phone

## Tech Stack

- **Frontend**: Next.js 14, Tailwind CSS, Shadcn UI
- **AI**: Google Gemini AI SDK
- **CV Processing**: Modal.com (parallel Python workers)
- **Storage**: Supabase
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+ (for CV worker)
- Modal account
- Supabase account
- Google AI API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/comic-scan.git
cd comic-scan
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GOOGLE_AI_API_KEY=your_gemini_api_key
MODAL_CV_WEBHOOK_URL=your_modal_webhook_url
```

4. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.


## CV Worker Setup (Deep Scan)

The deep scan uses a parallel CV worker deployed on Modal for 3-5x faster processing.

### Deploy CV Worker

1. Set up Python environment:
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

2. Configure Modal secrets:
```bash
modal secret create supabase-secrets \
  SUPABASE_URL=your_supabase_url \
  SUPABASE_KEY=your_supabase_service_key
```

3. Deploy the worker:
```bash
modal deploy cv_worker.py
```

4. Copy the webhook URL and add to your `.env.local`:
```
MODAL_CV_WEBHOOK_URL=https://your-app.modal.run
```

### Performance

- **Sequential (old)**: 4-9 minutes for 300-600 frame videos
- **Parallel (new)**: 1-3 minutes for same videos
- **Speedup**: 3-5x faster with 100% precision maintained

See `PARALLEL_CV_UPGRADE.md` for full details.

## Project Structure

```
comic-scan/
├── app/                    # Next.js App Router
│   ├── actions/           # Server Actions
│   ├── api/               # API Routes
│   ├── @modal/            # Parallel Routes (modals)
│   ├── results/           # Results pages
│   └── saved/             # Saved scans pages
├── components/            # React Components
│   ├── FabMenu.tsx        # Floating Action Button
│   ├── ResultCard.tsx     # Analysis results
│   └── ...
├── lib/                   # Utilities
│   ├── cv-analysis.ts     # CV analysis client
│   ├── history.ts         # Local history
│   └── supabase/          # Supabase clients
├── cv_worker.py           # Modal CV worker (parallel)
├── glint_analyzer.py      # Defect detection
├── frame_selector.py      # Frame extraction
└── perspect_warp.py       # Perspective correction
```

## Features in Detail

### Video Analysis Pipeline

1. **Upload**: User uploads video via web UI
2. **Storage**: Video stored in Supabase
3. **AI Analysis**: Google Gemini analyzes video
4. **Deep Scan** (parallel):
   - Video split into chunks
   - 2-10 workers process simultaneously
   - Frame quality analysis (sharpness, motion)
   - Golden frame selection
   - Defect detection
   - Variance mapping
5. **Results**: User sees comprehensive grading report

### Deep Scan Features

- **Golden Frame Selection**: Top 5 sharpest, most stable frames
- **Defect Detection**: Variance-based analysis across frames
- **Region Analysis**: Corners, spine, surface inspection
- **Heatmaps**: Visual defect probability maps
- **High Precision**: Laplacian variance + optical flow

## Documentation

- `DEPLOYMENT_SUMMARY.md` - Deployment status and overview
- `PARALLEL_CV_UPGRADE.md` - Parallel processing upgrade details
- `SETUP_PARALLEL_CV.md` - Setup and configuration guide
- `CV_WORKER_CHANGES.md` - Technical implementation details
- `SUPABASE_SETUP.md` - Supabase database setup
- `TESTING_GUIDE.md` - Testing procedures

## Testing

### Run Test Script

```bash
./test_parallel_cv.sh
```

### Manual Testing

1. Upload a test video
2. Watch logs in browser console
3. Check Modal dashboard: https://modal.com/apps
4. Verify results in Supabase

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Make sure to set all environment variables in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GOOGLE_AI_API_KEY`
- `MODAL_CV_WEBHOOK_URL`

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Performance

- **AI Analysis**: ~10-30 seconds (Gemini)
- **Deep Scan**: ~1-3 minutes (parallel CV)
- **Total**: ~2-4 minutes for complete analysis
- **Speedup**: 3-5x faster than sequential processing

## License

MIT

## Acknowledgments

- Google Gemini for AI analysis
- Modal.com for serverless CV processing
- Supabase for storage and database
- Vercel for hosting

