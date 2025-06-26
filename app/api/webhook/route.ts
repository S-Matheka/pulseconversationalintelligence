import { NextRequest, NextResponse } from 'next/server'

// In-memory storage for results (in production, use a database)
const processingResults = new Map()

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    
    // Store the result with a unique ID
    const resultId = `result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    processingResults.set(resultId, {
      ...data,
      id: resultId,
      receivedAt: new Date().toISOString()
    })
    
    console.log('Webhook received:', data.status, 'for file:', data.fileName)
    
    return NextResponse.json({ 
      status: 'received', 
      resultId,
      message: 'Result stored successfully' 
    })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const resultId = searchParams.get('id')
    
    if (resultId) {
      // Get specific result
      const result = processingResults.get(resultId)
      if (result) {
        return NextResponse.json(result)
      } else {
        return NextResponse.json(
          { error: 'Result not found' },
          { status: 404 }
        )
      }
    } else {
      // Get all results
      const results = Array.from(processingResults.values())
      return NextResponse.json({ results })
    }
  } catch (error) {
    console.error('Get results error:', error)
    return NextResponse.json(
      { error: 'Failed to get results' },
      { status: 500 }
    )
  }
} 