import { NextRequest, NextResponse } from 'next/server';
import { analyzeComic } from '@/app/actions';

// Set max duration for this route (60 seconds)
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // Try to get form data - this might fail with 413 if too large
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (formError: any) {
      // If we can't even parse the form data, it's likely too large
      if (formError.message?.includes('413') || formError.status === 413) {
        return NextResponse.json(
          { error: 'File too large for API route. Falling back to server action...' },
          { status: 413 }
        );
      }
      throw formError;
    }
    
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Check file size (20MB limit for API route - larger files will fallback to server action)
    // This is conservative to avoid Next.js default body size limits on API routes
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      // Return 413 to trigger fallback to server action (which supports up to 100MB)
      return NextResponse.json(
        { error: 'FILE_TOO_LARGE_FOR_API' },
        { status: 413 }
      );
    }

    const result = await analyzeComic(formData);
    return NextResponse.json(result);
  } catch (error) {
    console.error('API route error:', error);
    
    // Handle 413 specifically
    if (error instanceof Error && (error.message.includes('413') || error.message.includes('too large'))) {
      return NextResponse.json(
        { error: 'FILE_TOO_LARGE_FOR_API' },
        { status: 413 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze comic' },
      { status: 500 }
    );
  }
}

