import { NextRequest, NextResponse } from 'next/server';
import { dateBasedMapping } from '@/lib/date-mapping';

export async function GET(request: NextRequest, { params }: { params: Promise<{ anilistId: string }> }) {
  const { anilistId } = await params;
  const id = parseInt(anilistId);
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'Invalid AniList ID' }, { status: 400 });
  }

  try {
    const result = await dateBasedMapping(id);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}