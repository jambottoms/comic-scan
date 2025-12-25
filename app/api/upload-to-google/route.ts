import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300; // 5 minutes for large uploads

/**
 * TEMPORARILY DISABLED - Google File API upload
 * This route is not working correctly. Reverting to simpler approach.
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'Google File API upload is temporarily disabled. Please use the direct analysis method.' },
    { status: 501 }
  );
}

