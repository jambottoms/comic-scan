import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";

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

    // Use Google's File API REST endpoint to get file state
    const fileResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files/${fileName}?key=${apiKey}`,
      {
        method: 'GET',
      }
    );

    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: `Failed to get file state: ${fileResponse.statusText}` },
        { status: fileResponse.status }
      );
    }

    const file = await fileResponse.json();
    
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

