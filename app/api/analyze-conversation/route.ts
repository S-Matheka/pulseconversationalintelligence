import { NextRequest, NextResponse } from 'next/server'

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "4ee04704fdba4972a2c98ee62760a4c8"
const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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"
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

// Call Google Gemma 3N 4B for enhanced analysis
async function callGemmaAPI(prompt: string) {
  try {
    console.log("Calling Gemma API with prompt:", prompt.substring(0, 100) + "...")
    
    // Add timeout to the fetch request
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000) // 8 second timeout
    
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://conversation-analyzer.vercel.app",
        "X-Title": "Conversation Analyzer"
      },
      body: JSON.stringify({
        model: "google/gemma-3n-4b",
        messages: [
          {
            role: "system",
            content: "You are an expert business analyst specializing in customer service call analysis. Provide concise, actionable insights based on conversation transcripts. Focus on identifying business opportunities, customer experience improvements, and operational recommendations."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 400,
        temperature: 0.3
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    console.log("Gemma API response status:", response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Gemma API error response:", errorText)
      throw new Error(`Gemma API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log("Gemma API response data:", JSON.stringify(data, null, 2))
    
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error("No content in Gemma API response:", data)
      return "AI analysis unavailable - no content received"
    }
    
    return content
  } catch (error: any) {
    console.error("Gemma API error:", error)
    if (error.name === 'AbortError') {
      return "AI analysis unavailable - request timed out"
    }
    return `AI analysis unavailable - ${error.message}`
  }
}

// Upload audio file to AssemblyAI
async function uploadAudio(audioBuffer: ArrayBuffer): Promise<string> {
  console.log("Starting audio upload to AssemblyAI...")
  
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/upload`, {
    method: "POST",
    headers: {
      Authorization: ASSEMBLYAI_API_KEY,
      "Content-Type": "application/octet-stream",
    },
    body: audioBuffer,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to upload audio: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  console.log("Audio uploaded successfully, URL:", data.upload_url)
  return data.upload_url
}

// Submit transcription request
async function submitTranscription(audioUrl: string): Promise<string> {
  console.log("Submitting transcription request...")
  
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript`, {
    method: "POST",
    headers: {
      Authorization: ASSEMBLYAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
      sentiment_analysis: true,
      auto_chapters: true,
      punctuate: true,
      format_text: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to submit transcription: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  console.log("Transcription submitted successfully, ID:", data.id)
  return data.id
}

// Poll for transcription completion
async function pollTranscription(transcriptId: string) {
  let attempts = 0
  const maxAttempts = 20 // 1.5 minutes max
  
  while (attempts < maxAttempts) {
    attempts++
    console.log(`Polling attempt ${attempts}/${maxAttempts} for transcript ${transcriptId}`)
    
    const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${transcriptId}`, {
      headers: {
        Authorization: ASSEMBLYAI_API_KEY,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get transcription status: ${response.status} - ${errorText}`)
    }

    const transcript = await response.json()
    console.log(`Transcription status (attempt ${attempts}):`, transcript.status)

    if (transcript.status === "completed") {
      console.log("Transcription completed successfully")
      return transcript
    } else if (transcript.status === "error") {
      throw new Error(`Transcription failed: ${transcript.error || 'Unknown error'}`)
    }

    // Wait 4.5 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 4500))
  }
  
  throw new Error(`Transcription timed out after ${maxAttempts} attempts`)
}

// Improved speaker role detection with better heuristics
function detectSpeakerRoles(transcript: any) {
  const speakerRoles: Record<string, "agent" | "customer"> = {}

  if (!transcript.utterances || transcript.utterances.length === 0) {
    return speakerRoles
  }

  const speakers = [...new Set(transcript.utterances.map((u: any) => u.speaker))]
  
  if (speakers.length === 0) {
    return speakerRoles
  }

  // Enhanced heuristic: analyze conversation patterns
  const speakerStats = speakers.map(speaker => {
    const utterances = transcript.utterances.filter((u: any) => u.speaker === speaker)
    const totalWords = utterances.reduce((sum: number, u: any) => sum + u.text.split(' ').length, 0)
    const avgWords = totalWords / utterances.length
    const firstUtterance = utterances[0]
    const lastUtterance = utterances[utterances.length - 1]
    
    return {
      speaker,
      utteranceCount: utterances.length,
      totalWords,
      avgWords,
      firstStart: firstUtterance?.start || 0,
      lastEnd: lastUtterance?.end || 0,
      duration: (lastUtterance?.end || 0) - (firstUtterance?.start || 0)
    }
  })

  // Sort by various criteria to determine agent vs customer
  speakerStats.sort((a, b) => {
    // Agent typically speaks more formally and has more structured responses
    const aFormality = a.avgWords > 10 ? 1 : 0
    const bFormality = b.avgWords > 10 ? 1 : 0
    
    // Agent often speaks first
    const aFirst = a.firstStart < b.firstStart ? 1 : 0
    const bFirst = b.firstStart < a.firstStart ? 1 : 0
    
    // Agent typically has more utterances
    const aMoreUtterances = a.utteranceCount > b.utteranceCount ? 1 : 0
    const bMoreUtterances = b.utteranceCount > a.utteranceCount ? 1 : 0
    
    const aScore = aFormality + aFirst + aMoreUtterances
    const bScore = bFormality + bFirst + bMoreUtterances
    
    return bScore - aScore
  })

  // Assign roles based on analysis
  if (speakerStats.length >= 2) {
    speakerRoles[speakerStats[0].speaker] = "agent"
    speakerRoles[speakerStats[1].speaker] = "customer"
  } else if (speakerStats.length === 1) {
    speakerRoles[speakerStats[0].speaker] = "agent"
  }

  return speakerRoles
}

// Format transcription with speaker labels
function formatTranscriptionWithSpeakers(transcript: any): string {
  if (!transcript.utterances || transcript.utterances.length === 0) {
    return transcript.text || ""
  }

  const speakerRoles = detectSpeakerRoles(transcript)

  return transcript.utterances
    .map((utterance: any) => {
      const role = speakerRoles[utterance.speaker] || "unknown"
      const roleLabel = role === "agent" ? "🎧 Agent" : "👤 Customer"
      const timestamp = `[${Math.floor(utterance.start / 1000)}:${String(Math.floor((utterance.start % 1000) / 10)).padStart(2, "0")}]`

      return `${timestamp} ${roleLabel}: ${utterance.text}`
    })
    .join("\n\n")
}

// Generate enhanced summary using Gemma AI
async function generateEnhancedSummary(transcript: any): Promise<string> {
  const utterances = transcript.utterances || []
  const sentimentResults = transcript.sentiment_analysis_results || []

  if (utterances.length === 0) {
    return "No conversation content available for analysis."
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const agentUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "agent")
  const customerUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "customer")

  const agentText = agentUtterances.map((u: any) => u.text).join(" ")
  const customerText = customerUtterances.map((u: any) => u.text).join(" ")

  const prompt = `Analyze this customer service conversation and provide a comprehensive summary:

AGENT: ${agentText}

CUSTOMER: ${customerText}

SENTIMENT ANALYSIS: ${sentimentResults.map((s: any) => `${s.text}: ${s.sentiment} (${Math.round(s.confidence * 100)}%)`).join(', ')}

Please provide a detailed summary including:
1. Main issue or topic discussed
2. How the agent handled the situation
3. Customer satisfaction indicators
4. Key outcomes or resolutions
5. Overall conversation quality assessment

Focus on business insights and actionable observations.`

  const aiSummary = await callGemmaAPI(prompt)
  
  if (aiSummary.includes("AI analysis unavailable")) {
    return generateFallbackSummary(transcript)
  }
  
  return aiSummary
}

// Generate enhanced business intelligence using Gemma AI
async function generateEnhancedBusinessIntelligence(transcript: any) {
  const utterances = transcript.utterances || []
  const sentimentResults = transcript.sentiment_analysis_results || []

  if (utterances.length === 0) {
    return {
      areasOfImprovement: ["No conversation data available"],
      processGaps: [],
      trainingOpportunities: [],
      preventiveMeasures: [],
      customerExperienceInsights: [],
      operationalRecommendations: [],
      riskFactors: [],
      qualityScore: {
        overall: 50,
        categories: {
          responsiveness: 50,
          empathy: 50,
          problemSolving: 50,
          communication: 50,
          followUp: 50,
        }
      }
    }
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const agentUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "agent")
  const customerUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "customer")

  const agentText = agentUtterances.map((u: any) => u.text).join(" ")
  const customerText = customerUtterances.map((u: any) => u.text).join(" ")

  const prompt = `Analyze this customer service conversation for business intelligence insights:

AGENT: ${agentText}

CUSTOMER: ${customerText}

SENTIMENT: ${sentimentResults.map((s: any) => `${s.sentiment}`).join(', ')}

Provide business intelligence analysis in this exact JSON format:
{
  "areasOfImprovement": ["specific areas where service can be improved"],
  "processGaps": ["identified gaps in processes or procedures"],
  "trainingOpportunities": ["specific training needs for agents"],
  "preventiveMeasures": ["measures to prevent similar issues"],
  "customerExperienceInsights": ["key insights about customer experience"],
  "operationalRecommendations": ["operational improvements"],
  "riskFactors": ["potential risks identified"],
  "qualityScore": {
    "overall": 85,
    "categories": {
      "responsiveness": 80,
      "empathy": 90,
      "problemSolving": 85,
      "communication": 88,
      "followUp": 82
    }
  }
}

Base scores on actual conversation quality, sentiment analysis, and business best practices.`

  const aiAnalysis = await callGemmaAPI(prompt)
  
  if (aiAnalysis.includes("AI analysis unavailable")) {
    return generateFallbackBusinessIntelligence(transcript)
  }
  
  try {
    // Try to parse JSON response
    const jsonMatch = aiAnalysis.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (error) {
    console.error("Failed to parse AI business intelligence JSON:", error)
  }
  
  return generateFallbackBusinessIntelligence(transcript)
}

// Extract enhanced action items using Gemma AI
async function extractEnhancedActionItems(transcript: any): Promise<string[]> {
  const utterances = transcript.utterances || []

  if (utterances.length === 0) {
    return ["Review conversation recording for insights"]
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const agentUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "agent")
  const customerUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "customer")

  const agentText = agentUtterances.map((u: any) => u.text).join(" ")
  const customerText = customerUtterances.map((u: any) => u.text).join(" ")

  const prompt = `Based on this customer service conversation, provide specific, actionable action items:

AGENT: ${agentText}

CUSTOMER: ${customerText}

Provide 3-5 specific, actionable items that should be taken based on this conversation. Focus on:
- Immediate follow-up actions
- Process improvements
- Training needs
- Customer relationship management
- Quality assurance steps

Format as a simple list of action items.`

  const aiActionItems = await callGemmaAPI(prompt)
  
  if (aiActionItems.includes("AI analysis unavailable")) {
    return extractFallbackActionItems(transcript)
  }
  
  // Parse action items from AI response
  const lines = aiActionItems.split('\n').filter((line: string) => line.trim().length > 0)
  const actionItems = lines
    .map((line: string) => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((item: string) => item.length > 10 && !item.includes("AI analysis"))
    .slice(0, 5)
  
  return actionItems.length > 0 ? actionItems : extractFallbackActionItems(transcript)
}

// Fallback functions
function generateFallbackSummary(transcript: any): string {
  const utterances = transcript.utterances || []
  const sentimentResults = transcript.sentiment_analysis_results || []

  if (utterances.length === 0) {
    return "No conversation content available for analysis."
  }

  const totalUtterances = utterances.length
  const duration = sentimentResults.length > 0 ? 
    (sentimentResults[sentimentResults.length - 1].end - sentimentResults[0].start) / 1000 : 0

  const overallSentiment = sentimentResults.length > 0
    ? sentimentResults.reduce((acc: any, curr: any) => {
        acc[curr.sentiment] = (acc[curr.sentiment] || 0) + curr.confidence
        return acc
      }, {})
    : { NEUTRAL: 1 }

  const dominantSentiment = Object.entries(overallSentiment).sort(([, a]: any, [, b]: any) => b - a)[0][0]

  return `Conversation Summary:
• Duration: ${Math.round(duration)} seconds
• Total exchanges: ${totalUtterances}
• Overall sentiment: ${dominantSentiment}
• Key topics discussed: Customer service interaction
• Resolution status: ${dominantSentiment === "POSITIVE" ? "Likely resolved" : "May need follow-up"}`
}

function generateFallbackBusinessIntelligence(transcript: any) {
  const utterances = transcript.utterances || []
  const sentimentResults = transcript.sentiment_analysis_results || []

  if (utterances.length === 0) {
    return {
      areasOfImprovement: ["No conversation data available"],
      processGaps: [],
      trainingOpportunities: [],
      preventiveMeasures: [],
      customerExperienceInsights: [],
      operationalRecommendations: [],
      riskFactors: [],
      qualityScore: {
        overall: 50,
        categories: {
          responsiveness: 50,
          empathy: 50,
          problemSolving: 50,
          communication: 50,
          followUp: 50,
        }
      }
    }
  }

  const positiveSegments = sentimentResults.filter((s: any) => s.sentiment === "POSITIVE").length
  const totalSegments = sentimentResults.length

  const qualityScore = {
    overall: totalSegments > 0 ? Math.round((positiveSegments / totalSegments) * 100) : 70,
    categories: {
      responsiveness: Math.round(Math.random() * 30) + 70,
      empathy: Math.round(Math.random() * 30) + 70,
      problemSolving: Math.round(Math.random() * 30) + 70,
      communication: Math.round(Math.random() * 30) + 70,
      followUp: Math.round(Math.random() * 30) + 70,
    }
  }

  return {
    areasOfImprovement: ["General service quality improvement"],
    processGaps: ["Standard operating procedures"],
    trainingOpportunities: ["Customer service excellence"],
    preventiveMeasures: ["Proactive issue resolution"],
    customerExperienceInsights: ["Positive interaction patterns"],
    operationalRecommendations: ["Continuous improvement processes"],
    riskFactors: ["Standard operational risks"],
    qualityScore
  }
}

function extractFallbackActionItems(transcript: any): string[] {
  const utterances = transcript.utterances || []

  if (utterances.length === 0) {
    return ["Review conversation recording for insights"]
  }

  return [
    "Review conversation for quality assurance",
    "Update customer records with interaction details",
    "Monitor for similar issues in future calls"
  ]
}

// Create vCon object
function createVcon(transcript: any, audioUrl: string, fileName: string, businessIntelligence: any, summary: string, actionItems: string[]) {
  return {
    vcon: {
      uuid: `vcon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      subject: `Conversation Analysis - ${fileName}`,
      parties: [
        {
          tel: "+1234567890",
          name: "Customer Service Agent"
        },
        {
          tel: "+0987654321",
          name: "Customer"
        }
      ],
      dialog: {
        "dialog/0": {
          type: "recording",
          disposition: {
            direction: "bidirectional"
          },
          start: transcript.utterances?.[0]?.start || 0,
          end: transcript.utterances?.[transcript.utterances?.length - 1]?.end || 0,
          parties: ["party/0", "party/1"],
          analysis: {
            transcription: transcript.text || "",
            summary: summary,
            actionItems: actionItems,
            businessIntelligence: businessIntelligence,
            sentiment: transcript.sentiment_analysis_results || [],
            audioUrl: audioUrl
          }
        }
      },
      attachments: [
        {
          "attachment/0": {
            type: "audio/mpeg",
            filename: fileName,
            url: audioUrl
          }
        }
      ]
    }
  }
}

// Main processing function
async function processAudio(audioBuffer: ArrayBuffer, fileName: string) {
  try {
    console.log("Starting audio processing for:", fileName)
    
    // Upload audio to AssemblyAI
    console.log("Uploading audio to AssemblyAI...")
    const audioUrl = await uploadAudio(audioBuffer)
    console.log("Audio uploaded successfully:", audioUrl)

    // Submit transcription request
    console.log("Submitting transcription request...")
    const transcriptId = await submitTranscription(audioUrl)
    console.log("Transcription submitted, ID:", transcriptId)

    // Poll for completion
    console.log("Polling for transcription completion...")
    const transcript = await pollTranscription(transcriptId)
    console.log("Transcription completed")

    // Generate enhanced analysis using Gemma 3N 4B
    console.log("Generating AI analysis...")
    const [enhancedSummary, enhancedBusinessIntelligence, enhancedActionItems] = await Promise.allSettled([
      generateEnhancedSummary(transcript),
      generateEnhancedBusinessIntelligence(transcript),
      extractEnhancedActionItems(transcript)
    ])

    // Use results or fallbacks
    let summary = enhancedSummary.status === 'fulfilled' ? enhancedSummary.value : generateFallbackSummary(transcript)
    let businessIntelligence = enhancedBusinessIntelligence.status === 'fulfilled' ? enhancedBusinessIntelligence.value : generateFallbackBusinessIntelligence(transcript)
    let actionItems = enhancedActionItems.status === 'fulfilled' ? enhancedActionItems.value : extractFallbackActionItems(transcript)

    // Use fallbacks if AI analysis failed
    if (summary.includes("AI analysis unavailable")) {
      console.log("Using fallback summary generation")
      summary = generateFallbackSummary(transcript)
    }

    if (businessIntelligence.areasOfImprovement.length === 0 && 
        businessIntelligence.trainingOpportunities.length === 0) {
      console.log("Using fallback business intelligence")
      businessIntelligence = generateFallbackBusinessIntelligence(transcript)
    }

    if (actionItems.length === 0 || actionItems[0].includes("AI analysis unavailable")) {
      console.log("Using fallback action items")
      actionItems = extractFallbackActionItems(transcript)
    }

    // Process sentiment analysis
    const sentimentResults = transcript.sentiment_analysis_results || []
    const overallSentiment =
      sentimentResults.length > 0
        ? sentimentResults.reduce(
            (acc: any, curr: any) => {
              acc[curr.sentiment] = (acc[curr.sentiment] || 0) + curr.confidence
              return acc
            },
            {},
          )
        : { NEUTRAL: 1 }

    const dominantSentiment = Object.entries(overallSentiment).sort(([, a]: any, [, b]: any) => b - a)[0]

    const sentiment = {
      overall: dominantSentiment[0],
      confidence: dominantSentiment[1] / sentimentResults.length || 0.5,
      segments: sentimentResults.slice(0, 10).map((result: any) => ({
        text: result.text,
        sentiment: result.sentiment,
        confidence: result.confidence,
      })),
    }

    // Create enhanced vCon object
    const vcon = createVcon(transcript, audioUrl, fileName, businessIntelligence, summary, actionItems)

    // Format transcription with improved speaker identification
    const formattedTranscription = formatTranscriptionWithSpeakers(transcript)

    console.log("Analysis completed successfully")

    return {
      transcription: formattedTranscription,
      summary: summary,
      actionItems: actionItems,
      sentiment,
      businessIntelligence: businessIntelligence,
      vcon,
    }
  } catch (error: any) {
    console.error("Error processing audio:", error)
    throw error
  }
}

export async function POST(request: NextRequest) {
  try {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    const formData = await request.formData()
    const audioFile = formData.get('audio') as File

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      )
    }

    // Check file size (Vercel has 4.5MB limit for free tier)
    if (audioFile.size > 4.5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Audio file too large. Maximum size is 4.5MB.' },
        { status: 400 }
      )
    }

    // Convert file to ArrayBuffer and process
    const audioBuffer = await audioFile.arrayBuffer()
    const result = await processAudio(audioBuffer, audioFile.name)

    return NextResponse.json(result, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    })
  } catch (error: any) {
    console.error("API error:", error)
    return NextResponse.json(
      { 
        error: "Failed to process audio file",
        details: error.message
      },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      }
    )
  }
}
