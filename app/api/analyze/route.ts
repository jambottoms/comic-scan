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
          { error: 'File too large. The server rejected the upload. Please use a video under 50MB or record a shorter video (5-10 seconds recommended).' },
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

    // Check file size (50MB limit - more conservative to avoid 413)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size is 50MB. Please record a shorter video (5-10 seconds recommended).` },
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
        { error: 'File too large. Please use a video under 50MB or record a shorter video (5-10 seconds recommended).' },
        { status: 413 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze comic' },
      { status: 500 }
    );
  }
}

