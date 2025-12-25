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

// GET /api/saved-scans/[id] - Get a specific saved scan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getServerClient();
    
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const { id } = await params;

    const { data, error } = await supabase
      .from('saved_scans')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[API] Failed to fetch saved scan:', error);
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error in GET /api/saved-scans/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/saved-scans/[id] - Delete a saved scan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getServerClient();
    
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const { id } = await params;

    const { error } = await supabase
      .from('saved_scans')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[API] Failed to delete saved scan:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in DELETE /api/saved-scans/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

