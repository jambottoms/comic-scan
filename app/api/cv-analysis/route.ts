import { NextRequest, NextResponse } from 'next/server';

/**
 * API Route: /api/cv-analysis
 * 
 * Triggers the Python CV analysis worker (Modal.com)
 * Called after the main AI analysis completes.
 * 
 * POST body:
 * {
 *   "videoUrl": "https://supabase.co/.../video.mp4",
 *   "scanId": "video-1234567890-abc",
 *   "itemType": "card" | "comic" | "toy"
 * }
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoUrl, scanId, itemType = 'card' } = body;

    if (!videoUrl || !scanId) {
      return NextResponse.json(
        { error: 'Missing videoUrl or scanId' },
        { status: 400 }
      );
    }

    // Read env var inside the function (not at module level) so it picks up changes
    const modalWebhookUrl = process.env.MODAL_CV_WEBHOOK_URL;

    // If Modal webhook is not configured, return early
    if (!modalWebhookUrl) {
      console.log('[CV Analysis] Modal webhook not configured, skipping CV analysis');
      console.log('[CV Analysis] MODAL_CV_WEBHOOK_URL value:', modalWebhookUrl);
      return NextResponse.json({
        success: false,
        message: 'CV analysis not configured. Set MODAL_CV_WEBHOOK_URL in environment variables.',
        skipped: true
      });
    }

    console.log(`[CV Analysis] Triggering analysis for scan: ${scanId}`);
    console.log(`[CV Analysis] Using webhook: ${modalWebhookUrl}`);

    // Call Modal webhook
    const modalResponse = await fetch(modalWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoUrl,
        scanId,
        itemType,
      }),
    });

    if (!modalResponse.ok) {
      const errorText = await modalResponse.text();
      console.error('[CV Analysis] Modal webhook error:', errorText);
      return NextResponse.json(
        { error: 'CV analysis failed', details: errorText },
        { status: 500 }
      );
    }

    const result = await modalResponse.json();
    console.log('[CV Analysis] Analysis complete:', result);

    return NextResponse.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('[CV Analysis] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

// Also support GET for health checks
export async function GET() {
  const modalWebhookUrl = process.env.MODAL_CV_WEBHOOK_URL;
  return NextResponse.json({
    status: 'ok',
    configured: !!modalWebhookUrl,
    webhookUrl: modalWebhookUrl ? modalWebhookUrl.substring(0, 50) + '...' : null,
    message: modalWebhookUrl 
      ? 'CV analysis ready' 
      : 'Set MODAL_CV_WEBHOOK_URL to enable CV analysis'
  });
}

