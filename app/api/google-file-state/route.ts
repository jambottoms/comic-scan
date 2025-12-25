import { NextRequest, NextResponse } from 'next/server';

/**
 * TEMPORARILY DISABLED - Google File API state check
 * This route is not working correctly. Reverting to simpler approach.
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'Google File API state check is temporarily disabled.' },
    { status: 501 }
  );
}

