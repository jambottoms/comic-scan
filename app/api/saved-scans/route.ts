'use server';

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Server-side Supabase client (not blocked by Arc's privacy features)
function getServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

// GET /api/saved-scans - Get all saved scans
export async function GET(request: NextRequest) {
  try {
    const supabase = getServerClient();
    
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit');

    let query = supabase
      .from('saved_scans')
      .select('*')
      .order('created_at', { ascending: false });

    if (limit) {
      query = query.limit(parseInt(limit, 10));
    }

    const { data, error } = await query;

    if (error) {
      console.error('[API] Failed to fetch saved scans:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('[API] Error in GET /api/saved-scans:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/saved-scans - Save a new scan
export async function POST(request: NextRequest) {
  try {
    const supabase = getServerClient();
    
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { title, issue, grade, videoUrl, thumbnail, result } = body;

    const { data, error } = await supabase
      .from('saved_scans')
      .insert({
        title,
        issue: issue || null,
        grade,
        video_url: videoUrl || null,
        thumbnail: thumbnail || null,
        result,
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Failed to save scan:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error in POST /api/saved-scans:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

