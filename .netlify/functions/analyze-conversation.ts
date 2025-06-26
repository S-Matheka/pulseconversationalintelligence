import type { Handler } from "@netlify/functions"

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "4ee04704fdba4972a2c98ee62760a4c8"
const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"

interface TranscriptResponse {
  id: string
  status: "queued" | "processing" | "completed" | "error"
  text?: string
  words?: Array<{
    text: string
    start: number
    end: number
    confidence: number
  }>
  utterances?: Array<{
    text: string
    start: number
    end: number
    confidence: number
    speaker: string
    words: Array<{
      text: string
      start: number
      end: number
      confidence: number
    }>
  }>
  sentiment_analysis_results?: Array<{
    text: string
    sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL"
    confidence: number
    start: number
    end: number
  }>
  auto_chapters?: Array<{
    summary: string
    headline: string
    gist: string
    start: number
    end: number
  }>
}

// Business Intelligence Analysis Interface
interface BusinessIntelligence {
  areasOfImprovement: string[]
  processGaps: string[]
  trainingOpportunities: string[]
  preventiveMeasures: string[]
  customerExperienceInsights: string[]
  operationalRecommendations: string[]
  riskFactors: string[]
  qualityScore: {
    overall: number
    categories: {
      responsiveness: number
      empathy: number
      problemSolving: number
      communication: number
      followUp: number
    }
  }
}

// Upload audio file to AssemblyAI
async function uploadAudio(audioBuffer: ArrayBuffer): Promise<string> {
  console.log("Uploading audio to AssemblyAI...")
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
    console.error("Upload failed:", response.status, errorText)
    throw new Error(`Failed to upload audio: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  console.log("Audio uploaded successfully:", data.upload_url)
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
    console.error("Transcription submission failed:", response.status, errorText)
    throw new Error(`Failed to submit transcription: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  console.log("Transcription submitted:", data.id)
  return data.id
}

// Poll for transcription completion
async function pollTranscription(transcriptId: string): Promise<TranscriptResponse> {
  console.log("Polling for transcription completion...")
  let attempts = 0
  const maxAttempts = 60 // 3 minutes max

  while (attempts < maxAttempts) {
    const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${transcriptId}`, {
      headers: {
        Authorization: ASSEMBLYAI_API_KEY,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Polling failed:", response.status, errorText)
      throw new Error(`Failed to get transcription status: ${response.status} ${errorText}`)
    }

    const transcript: TranscriptResponse = await response.json()
    console.log(`Polling attempt ${attempts + 1}: Status = ${transcript.status}`)

    if (transcript.status === "completed") {
      console.log("Transcription completed successfully")
      return transcript
    } else if (transcript.status === "error") {
      console.error("Transcription failed with error status")
      throw new Error("Transcription failed")
    }

    // Wait 3 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 3000))
    attempts++
  }

  throw new Error("Transcription timeout - took too long to complete")
}

// Simple speaker role detection
function detectSpeakerRoles(transcript: TranscriptResponse): Record<string, "agent" | "customer"> {
  const speakerRoles: Record<string, "agent" | "customer"> = {}

  if (!transcript.utterances || transcript.utterances.length === 0) {
    return speakerRoles
  }

  // Simple heuristic: first speaker is often the agent
  const speakers = [...new Set(transcript.utterances.map((u) => u.speaker))]

  if (speakers.length >= 2) {
    speakerRoles[speakers[0]] = "agent"
    speakerRoles[speakers[1]] = "customer"
  }

  return speakerRoles
}

// Format transcription with speaker labels
function formatTranscriptionWithSpeakers(transcript: TranscriptResponse): string {
  if (!transcript.utterances || transcript.utterances.length === 0) {
    return transcript.text || ""
  }

  const speakerRoles = detectSpeakerRoles(transcript)

  return transcript.utterances
    .map((utterance) => {
      const role = speakerRoles[utterance.speaker] || "unknown"
      const roleLabel = role === "agent" ? "🎧 Agent" : "👤 Customer"
      const timestamp = `[${Math.floor(utterance.start / 1000)}:${String(Math.floor((utterance.start % 1000) / 10)).padStart(2, "0")}]`

      return `${timestamp} ${roleLabel}: ${utterance.text}`
    })
    .join("\n\n")
}

// Enhanced conversation summary generation based on actual conversation flow
function generateSummary(transcript: TranscriptResponse): string {
  const utterances = transcript.utterances || []
  const sentimentResults = transcript.sentiment_analysis_results || []

  if (utterances.length === 0) {
    return "No conversation content available for summary."
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const agentUtterances = utterances.filter((u) => speakerRoles[u.speaker] === "agent")
  const customerUtterances = utterances.filter((u) => speakerRoles[u.speaker] === "customer")

  // Analyze the actual conversation flow
  const conversationAnalysis = analyzeActualConversation(agentUtterances, customerUtterances, sentimentResults)

  return generateAccurateSummary(conversationAnalysis)
}

// Analyze the actual conversation between agent and customer
function analyzeActualConversation(agentUtterances: any[], customerUtterances: any[], sentimentResults: any[]) {
  const agentText = agentUtterances.map((u) => u.text.toLowerCase()).join(" ")
  const customerText = customerUtterances.map((u) => u.text.toLowerCase()).join(" ")
  const fullConversation = [...agentUtterances, ...customerUtterances]
    .sort((a, b) => a.start - b.start)
    .map((u) => u.text.toLowerCase())
    .join(" ")

  // Identify customer's reason for calling
  const callReasons = {
    cancel: ["cancel", "cancellation", "terminate", "end my", "stop my", "quit"],
    billing: ["bill", "charge", "payment", "invoice", "refund", "money", "cost", "fee"],
    technical: ["not working", "broken", "error", "problem", "issue", "trouble", "fix"],
    appointment: ["appointment", "booking", "schedule", "reschedule", "change", "move"],
    complaint: ["complain", "unhappy", "dissatisfied", "disappointed", "frustrated", "angry"],
    inquiry: ["information", "question", "ask", "wondering", "curious", "details"],
    support: ["help", "assistance", "support", "guide", "explain"],
  }

  let primaryReason = "general inquiry"
  let maxReasonScore = 0

  Object.entries(callReasons).forEach(([reason, keywords]) => {
    const score =
      keywords.reduce((acc, keyword) => {
        return acc + (customerText.split(keyword).length - 1) * 2 // Weight customer mentions more
      }, 0) +
      keywords.reduce((acc, keyword) => {
        return acc + (agentText.split(keyword).length - 1) // Also check agent responses
      }, 0)

    if (score > maxReasonScore) {
      maxReasonScore = score
      primaryReason = reason
    }
  })

  // Analyze agent's response quality
  const agentQualities = {
    helpful: ["help", "assist", "support", "resolve", "fix", "solve"],
    empathetic: ["understand", "sorry", "apologize", "regret", "appreciate"],
    professional: ["certainly", "absolutely", "of course", "definitely", "glad to"],
    knowledgeable: ["explain", "because", "reason", "policy", "procedure", "system"],
    responsive: ["right away", "immediately", "quickly", "now", "today"],
  }

  const agentPerformance = {}
  Object.entries(agentQualities).forEach(([quality, keywords]) => {
    const score = keywords.reduce((acc, keyword) => acc + (agentText.split(keyword).length - 1), 0)
    agentPerformance[quality] = score > 0
  })

  // Identify specific details mentioned
  const specificDetails = extractSpecificDetails(customerText, agentText)

  // Analyze resolution outcome
  const resolutionIndicators = {
    resolved: ["resolved", "fixed", "solved", "taken care of", "all set", "complete"],
    pending: ["follow up", "callback", "investigate", "look into", "check", "review"],
    escalated: ["supervisor", "manager", "escalate", "transfer", "different department"],
    unresolved: ["still", "not fixed", "problem remains", "issue continues"],
  }

  let resolutionStatus = "discussed"
  Object.entries(resolutionIndicators).forEach(([status, keywords]) => {
    if (keywords.some((keyword) => fullConversation.includes(keyword))) {
      resolutionStatus = status
    }
  })

  // Analyze customer satisfaction progression
  const customerSentiment = analyzeSentimentProgression(sentimentResults)

  return {
    primaryReason,
    specificDetails,
    agentPerformance,
    resolutionStatus,
    customerSentiment,
    conversationLength: agentUtterances.length + customerUtterances.length,
    agentResponseCount: agentUtterances.length,
    customerStatementCount: customerUtterances.length,
  }
}

// Extract specific details mentioned in the conversation
function extractSpecificDetails(customerText: string, agentText: string) {
  const details = {
    membershipType: null,
    timeframe: null,
    amount: null,
    reason: null,
    product: null,
  }

  // Extract membership/subscription types
  const membershipTypes = ["premium", "basic", "pro", "standard", "annual", "monthly", "yearly"]
  membershipTypes.forEach((type) => {
    if (customerText.includes(type) || agentText.includes(type)) {
      details.membershipType = type
    }
  })

  // Extract timeframes
  const timeframes = ["today", "tomorrow", "next week", "next month", "immediately", "asap"]
  timeframes.forEach((time) => {
    if (customerText.includes(time) || agentText.includes(time)) {
      details.timeframe = time
    }
  })

  // Extract amounts (simple pattern matching)
  const amountMatch = (customerText + " " + agentText).match(/\$\d+|\d+\s*dollars?|\d+\.\d+/i)
  if (amountMatch) {
    details.amount = amountMatch[0]
  }

  return details
}

// Analyze sentiment progression throughout the conversation
function analyzeSentimentProgression(sentimentResults: any[]) {
  if (sentimentResults.length === 0) return "neutral"

  const firstHalf = sentimentResults.slice(0, Math.ceil(sentimentResults.length / 2))
  const secondHalf = sentimentResults.slice(Math.ceil(sentimentResults.length / 2))

  const getAverageSentiment = (segments: any[]) => {
    const sentimentScores = { POSITIVE: 1, NEUTRAL: 0, NEGATIVE: -1 }
    const average = segments.reduce((acc, seg) => acc + sentimentScores[seg.sentiment], 0) / segments.length
    return average
  }

  const firstHalfScore = getAverageSentiment(firstHalf)
  const secondHalfScore = getAverageSentiment(secondHalf)

  if (secondHalfScore > firstHalfScore + 0.3) return "improved"
  if (secondHalfScore < firstHalfScore - 0.3) return "deteriorated"
  if (firstHalfScore < -0.3) return "negative"
  if (firstHalfScore > 0.3) return "positive"
  return "neutral"
}

// Generate accurate summary based on actual conversation analysis
function generateAccurateSummary(analysis: any): string {
  const { primaryReason, specificDetails, agentPerformance, resolutionStatus, customerSentiment } = analysis

  let summary = ""

  // Start with customer's reason for calling
  switch (primaryReason) {
    case "cancel":
      summary += `The customer called to cancel their ${specificDetails.membershipType || "membership/subscription"}`
      if (specificDetails.timeframe) {
        summary += ` ${specificDetails.timeframe}`
      }
      summary += ". "
      break
    case "billing":
      summary += `The customer contacted support regarding billing concerns`
      if (specificDetails.amount) {
        summary += ` involving ${specificDetails.amount}`
      }
      summary += ". "
      break
    case "technical":
      summary += `The customer reported technical issues that needed resolution. `
      break
    case "appointment":
      summary += `The customer called to schedule or modify an appointment`
      if (specificDetails.timeframe) {
        summary += ` for ${specificDetails.timeframe}`
      }
      summary += ". "
      break
    case "complaint":
      summary += `The customer called to file a complaint about their experience. `
      break
    case "inquiry":
      summary += `The customer called seeking information and clarification. `
      break
    default:
      summary += `The customer contacted support for assistance. `
  }

  // Describe agent's response
  const agentQualities = []
  if (agentPerformance.responsive) agentQualities.push("responsive")
  if (agentPerformance.helpful) agentQualities.push("helpful")
  if (agentPerformance.empathetic) agentQualities.push("empathetic")
  if (agentPerformance.professional) agentQualities.push("professional")
  if (agentPerformance.knowledgeable) agentQualities.push("knowledgeable")

  if (agentQualities.length > 0) {
    summary += `The agent was ${agentQualities.slice(0, 2).join(" and ")} in addressing the customer's needs. `
  } else {
    summary += `The agent handled the customer's request. `
  }

  // Describe resolution outcome
  switch (resolutionStatus) {
    case "resolved":
      summary += `The issue was successfully resolved during the call. `
      break
    case "pending":
      summary += `The agent promised to investigate further and follow up with the customer. `
      break
    case "escalated":
      summary += `The matter was escalated to a supervisor or different department for specialized handling. `
      break
    case "unresolved":
      summary += `The issue remains unresolved and may require additional follow-up. `
      break
    default:
      summary += `The customer's concerns were addressed and documented. `
  }

  // Add customer satisfaction context
  switch (customerSentiment) {
    case "improved":
      summary += `The customer's satisfaction improved throughout the conversation, ending on a positive note.`
      break
    case "deteriorated":
      summary += `The customer became increasingly frustrated during the call, indicating dissatisfaction with the resolution.`
      break
    case "negative":
      summary += `The customer remained dissatisfied throughout the interaction.`
      break
    case "positive":
      summary += `The customer expressed satisfaction with the service provided.`
      break
    default:
      summary += `The customer maintained a neutral tone throughout the interaction.`
  }

  return summary.trim()
}

// Generate Business Intelligence Analysis based on actual conversation performance
function generateBusinessIntelligence(transcript: TranscriptResponse): BusinessIntelligence {
  const utterances = transcript.utterances || []
  const sentimentResults = transcript.sentiment_analysis_results || []
  const speakerRoles = detectSpeakerRoles(transcript)

  const agentUtterances = utterances.filter((u) => speakerRoles[u.speaker] === "agent")
  const customerUtterances = utterances.filter((u) => speakerRoles[u.speaker] === "customer")

  const analysis = {
    areasOfImprovement: [],
    processGaps: [],
    trainingOpportunities: [],
    preventiveMeasures: [],
    customerExperienceInsights: [],
    operationalRecommendations: [],
    riskFactors: [],
    qualityScore: {
      overall: 0,
      categories: {
        responsiveness: 0,
        empathy: 0,
        problemSolving: 0,
        communication: 0,
        followUp: 0,
      },
    },
  } as BusinessIntelligence

  if (utterances.length === 0) {
    return analysis
  }

  const agentText = agentUtterances.map((u) => u.text.toLowerCase()).join(" ")
  const customerText = customerUtterances.map((u) => u.text.toLowerCase()).join(" ")
  const fullText = (transcript.text || "").toLowerCase()

  // Analyze actual performance issues from the conversation
  const performanceIssues = analyzeActualPerformanceIssues(agentText, customerText, fullText, sentimentResults)

  // Only add recommendations based on actual issues found
  if (performanceIssues.longWaitTime) {
    analysis.areasOfImprovement.push("Reduce customer wait times - customer mentioned waiting")
    analysis.processGaps.push("Queue management needs improvement based on customer feedback")
  }

  if (performanceIssues.multipleTransfers) {
    analysis.areasOfImprovement.push("Improve first-call resolution to avoid transfers")
    analysis.processGaps.push("Agent lacked knowledge to handle the inquiry directly")
  }

  if (performanceIssues.lackOfEmpathy) {
    analysis.trainingOpportunities.push("Train agent on empathetic communication and active listening")
    analysis.qualityScore.categories.empathy = 30
  } else {
    analysis.qualityScore.categories.empathy = 85
  }

  if (performanceIssues.poorProblemSolving) {
    analysis.trainingOpportunities.push("Enhance problem-solving skills and solution-oriented approach")
    analysis.qualityScore.categories.problemSolving = 40
  } else {
    analysis.qualityScore.categories.problemSolving = 80
  }

  if (performanceIssues.communicationIssues) {
    analysis.trainingOpportunities.push("Improve communication clarity and explanation skills")
    analysis.qualityScore.categories.communication = 45
  } else {
    analysis.qualityScore.categories.communication = 75
  }

  if (performanceIssues.noFollowUp) {
    analysis.processGaps.push("Lack of proper follow-up procedures mentioned")
    analysis.qualityScore.categories.followUp = 30
  } else {
    analysis.qualityScore.categories.followUp = 85
  }

  // Responsiveness based on actual conversation flow
  if (performanceIssues.slowResponse) {
    analysis.qualityScore.categories.responsiveness = 50
  } else {
    analysis.qualityScore.categories.responsiveness = 80
  }

  // Identify specific process improvements based on conversation content
  if (fullText.includes("wrong order") || fullText.includes("incorrect")) {
    analysis.preventiveMeasures.push("Always verify orders before dispatch - customer received incorrect items")
    analysis.processGaps.push("Order verification process failed in this case")
  }

  if (fullText.includes("damaged") || fullText.includes("broken")) {
    analysis.preventiveMeasures.push("Improve packaging standards - customer received damaged goods")
    analysis.operationalRecommendations.push("Review shipping and handling procedures")
  }

  if (fullText.includes("billing") && sentimentResults.some((s) => s.sentiment === "NEGATIVE")) {
    analysis.areasOfImprovement.push("Provide clearer billing information - customer was confused about charges")
    analysis.preventiveMeasures.push("Send proactive billing explanations to prevent confusion")
  }

  // Customer experience insights based on actual sentiment
  const negativeCount = sentimentResults.filter((s) => s.sentiment === "NEGATIVE").length
  const totalSentiments = sentimentResults.length

  if (negativeCount / totalSentiments > 0.6) {
    analysis.customerExperienceInsights.push("Customer expressed significant dissatisfaction during this call")
    analysis.riskFactors.push("High risk of customer churn based on negative sentiment")
  } else if (negativeCount / totalSentiments < 0.2) {
    analysis.customerExperienceInsights.push("Customer had a positive experience with good resolution")
  }

  // Calculate overall quality score
  const categoryScores = Object.values(analysis.qualityScore.categories)
  analysis.qualityScore.overall = Math.round(categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length)

  // Only add generic recommendations if no specific issues were found
  if (
    analysis.areasOfImprovement.length === 0 &&
    analysis.processGaps.length === 0 &&
    analysis.trainingOpportunities.length === 0
  ) {
    analysis.customerExperienceInsights.push("Call handled well with no major issues identified")
    analysis.operationalRecommendations.push("Continue current service standards - good performance observed")
  }

  return analysis
}

// Analyze actual performance issues from the conversation
function analyzeActualPerformanceIssues(
  agentText: string,
  customerText: string,
  fullText: string,
  sentimentResults: any[],
) {
  return {
    longWaitTime: customerText.includes("wait") || customerText.includes("hold") || customerText.includes("long time"),
    multipleTransfers: fullText.includes("transfer") || fullText.includes("different department"),
    lackOfEmpathy:
      !agentText.includes("sorry") && !agentText.includes("understand") && !agentText.includes("apologize"),
    poorProblemSolving: !agentText.includes("resolve") && !agentText.includes("fix") && !agentText.includes("help"),
    communicationIssues: customerText.includes("what") && customerText.includes("don't understand"),
    noFollowUp: !agentText.includes("follow") && !agentText.includes("contact") && !agentText.includes("update"),
    slowResponse: agentText.includes("let me check") && agentText.includes("one moment"),
  }
}

function extractActionItems(transcript: TranscriptResponse): string[] {
  const text = transcript.text || ""
  const actionKeywords = [
    "will do",
    "need to",
    "should",
    "must",
    "have to",
    "going to",
    "action item",
    "follow up",
    "next step",
    "todo",
    "task",
  ]

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  const actionItems: string[] = []

  sentences.forEach((sentence) => {
    const lowerSentence = sentence.toLowerCase()
    if (actionKeywords.some((keyword) => lowerSentence.includes(keyword))) {
      actionItems.push(sentence.trim())
    }
  })

  return actionItems.slice(0, 10) // Limit to 10 action items
}

// Create vCon object
function createVcon(
  transcript: TranscriptResponse,
  audioUrl: string,
  fileName: string,
  businessIntelligence: BusinessIntelligence,
) {
  const now = new Date().toISOString()
  const speakerRoles = detectSpeakerRoles(transcript)

  return {
    vcon: "0.0.1",
    uuid: `vcon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    created_at: now,
    updated_at: now,
    subject: `Conversation Analysis - ${fileName}`,
    parties: [
      {
        tel: "+1-000-000-0001",
        name: "Agent",
        mailto: "agent@company.com",
        role: "agent",
      },
      {
        tel: "+1-000-000-0002",
        name: "Customer",
        mailto: "customer@example.com",
        role: "customer",
      },
    ],
    dialog: [
      {
        type: "recording",
        start: now,
        duration: 0,
        parties: [0, 1],
        mimetype: "audio/mpeg",
        filename: fileName,
        url: audioUrl,
      },
    ],
    analysis: [
      {
        type: "transcript",
        dialog: 0,
        body: formatTranscriptionWithSpeakers(transcript),
        vendor: "AssemblyAI",
        product: "Speech-to-Text API",
      },
      {
        type: "summary",
        dialog: 0,
        body: generateSummary(transcript),
        vendor: "AssemblyAI",
        product: "Auto Chapters",
      },
      {
        type: "sentiment",
        dialog: 0,
        body: transcript.sentiment_analysis_results || [],
        vendor: "AssemblyAI",
        product: "Sentiment Analysis",
      },
      {
        type: "business_intelligence",
        dialog: 0,
        body: businessIntelligence,
        vendor: "Custom",
        product: "Business Intelligence Analysis",
      },
    ],
    attachments: [
      {
        type: "audio/mpeg",
        filename: fileName,
        url: audioUrl,
        body: "Original conversation audio file",
      },
    ],
  }
}

// Parse multipart form data for Netlify Functions
async function parseMultipartFormData(event: any) {
  const boundary = event.headers["content-type"]?.split("boundary=")[1]
  if (!boundary) {
    throw new Error("No boundary found in content-type")
  }

  const body = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
  const parts = body.toString().split(`--${boundary}`)

  for (const part of parts) {
    if (part.includes('name="audio"')) {
      const headerEnd = part.indexOf("\r\n\r\n")
      if (headerEnd === -1) continue

      const fileData = part.slice(headerEnd + 4, part.lastIndexOf("\r\n"))
      return Buffer.from(fileData, "binary")
    }
  }

  throw new Error("No audio file found in form data")
}

export const handler: Handler = async (event, context) => {
  console.log("Function started:", event.httpMethod, event.path)

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: "",
    }
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    }
  }

  try {
    console.log("Processing audio file...")

    // Parse the multipart form data
    const audioBuffer = await parseMultipartFormData(event)
    console.log("Audio buffer size:", audioBuffer.length)

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("No audio file provided or file is empty")
    }

    // Upload audio to AssemblyAI
    const audioUrl = await uploadAudio(audioBuffer)

    // Submit transcription request
    const transcriptId = await submitTranscription(audioUrl)

    // Poll for completion
    const transcript = await pollTranscription(transcriptId)

    // Generate analysis
    const summary = generateSummary(transcript)
    const actionItems = extractActionItems(transcript)
    const businessIntelligence = generateBusinessIntelligence(transcript)

    // Process sentiment analysis
    const sentimentResults = transcript.sentiment_analysis_results || []
    const overallSentiment =
      sentimentResults.length > 0
        ? sentimentResults.reduce(
            (acc, curr) => {
              acc[curr.sentiment] = (acc[curr.sentiment] || 0) + curr.confidence
              return acc
            },
            {} as Record<string, number>,
          )
        : { NEUTRAL: 1 }

    const dominantSentiment = Object.entries(overallSentiment).sort(([, a], [, b]) => b - a)[0]

    const sentiment = {
      overall: dominantSentiment[0],
      confidence: dominantSentiment[1] / sentimentResults.length || 0.5,
      segments: sentimentResults.slice(0, 10).map((result) => ({
        text: result.text,
        sentiment: result.sentiment,
        confidence: result.confidence,
      })),
    }

    // Create vCon object
    const vcon = createVcon(transcript, audioUrl, "uploaded-audio.mp3", businessIntelligence)

    // Format transcription with speaker identification
    const formattedTranscription = formatTranscriptionWithSpeakers(transcript)

    console.log("Analysis completed successfully")

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcription: formattedTranscription,
        summary,
        actionItems,
        sentiment,
        businessIntelligence,
        vcon,
      }),
    }
  } catch (error) {
    console.error("Error processing audio:", error)
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Failed to process audio file",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    }
  }
}
