import { NextRequest, NextResponse } from 'next/server';
import { analyzeComic } from '@/app/actions';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const result = await analyzeComic(formData);
    return NextResponse.json(result);
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze comic' },
      { status: 500 }
    );
  }
}

