'use server';

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Server-side Supabase client
function getServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

// POST /api/saved-scans/check - Check if a scan is already saved
export async function POST(request: NextRequest) {
  try {
    const supabase = getServerClient();
    
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { title, issue, grade } = body;

    const { data, error } = await supabase
      .from('saved_scans')
      .select('id')
      .eq('title', title)
      .eq('issue', issue)
      .eq('grade', grade)
      .limit(1);

    if (error || !data || data.length === 0) {
      return NextResponse.json({ savedId: null });
    }

    return NextResponse.json({ savedId: data[0].id });
  } catch (error) {
    console.error('[API] Error in POST /api/saved-scans/check:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

