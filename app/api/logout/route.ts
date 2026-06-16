import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  const jar = await cookies()
  jar.delete('auth')
  return NextResponse.redirect(new URL('/login', req.url))
}
