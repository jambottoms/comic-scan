import { NextRequest, NextResponse } from 'next/server';
import { GoogleAIFileManager } from "@google/generative-ai";

/**
 * API route to check Google File API file state
 */
export async function POST(request: NextRequest) {
  try {
    const { fileName } = await request.json();
    
    if (!fileName) {
      return NextResponse.json(
        { error: 'Missing fileName' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GOOGLE_API_KEY is not set' },
        { status: 500 }
      );
    }

    const fileManager = new GoogleAIFileManager(apiKey);
    const file = await fileManager.getFile(fileName);
    
    return NextResponse.json({
      state: file.state,
      error: file.error?.message,
    });

  } catch (error) {
    console.error('[API Route] Get file state error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get file state' },
      { status: 500 }
    );
  }
}

