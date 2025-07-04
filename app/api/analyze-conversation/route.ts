import { NextRequest, NextResponse } from 'next/server'

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "4ee04704fdba4972a2c98ee62760a4c8"
const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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"
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

// Call Meta Llama 4 Maverick for enhanced analysis
async function callGemmaAPI(prompt: string) {
  try {
    console.log("Calling Llama API with prompt:", prompt.substring(0, 100) + "...")
    
    // Add timeout to the fetch request
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
    
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://conversation-analyzer.vercel.app",
        "X-Title": "Conversation Analyzer"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-maverick",
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
    console.log("Llama API response status:", response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Llama API error response:", errorText)
      throw new Error(`Llama API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log("Llama API response data:", JSON.stringify(data, null, 2))
    
    const content = data.choices?.[0]?.message?.content
    console.log("Llama API content extracted:", content)
    
    if (!content) {
      console.error("No content in Llama API response:", data)
      return "AI analysis unavailable - no content received"
    }
    
    return content
  } catch (error: any) {
    console.error("Llama API error:", error)
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

    // Wait 3 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 3000))
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
    
    // Check for agent-like language patterns
    const agentKeywords = ["thank you for calling", "how can i help", "i understand", "let me help", "i apologize", "i can assist", "welcome to", "my name is", "i'm here to help", "customer service", "support team"]
    const agentKeywordCount = agentKeywords.filter(keyword => 
      utterances.some((u: any) => u.text.toLowerCase().includes(keyword))
    ).length
    
    // Check for customer-like language patterns
    const customerKeywords = ["i want to", "i need", "i have a problem", "i'm calling about", "i ordered", "i received", "my order", "my account", "i'm not happy", "this is wrong", "i want to cancel", "i want a refund"]
    const customerKeywordCount = customerKeywords.filter(keyword => 
      utterances.some((u: any) => u.text.toLowerCase().includes(keyword))
    ).length
    
    return {
      speaker,
      utteranceCount: utterances.length,
      totalWords,
      avgWords,
      firstStart: firstUtterance?.start || 0,
      lastEnd: lastUtterance?.end || 0,
      duration: (lastUtterance?.end || 0) - (firstUtterance?.start || 0),
      agentKeywordCount,
      customerKeywordCount
    }
  })

  // Sort by various criteria to determine agent vs customer
  speakerStats.sort((a, b) => {
    // Agent typically uses more formal language and has agent-specific keywords
    const aAgentScore = a.agentKeywordCount * 3 + (a.avgWords > 8 ? 1 : 0)
    const bAgentScore = b.agentKeywordCount * 3 + (b.avgWords > 8 ? 1 : 0)
    
    // Customer typically uses more direct language and has customer-specific keywords
    const aCustomerScore = a.customerKeywordCount * 3 + (a.avgWords < 15 ? 1 : 0)
    const bCustomerScore = b.customerKeywordCount * 3 + (b.avgWords < 15 ? 1 : 0)
    
    // Agent often speaks first in customer service calls
    const aFirst = a.firstStart < b.firstStart ? 1 : 0
    const bFirst = b.firstStart < a.firstStart ? 1 : 0
    
    const aScore = aAgentScore + aFirst
    const bScore = bAgentScore + bFirst
    
    return bScore - aScore
  })

  // Assign roles based on analysis
  if (speakerStats.length >= 2) {
    speakerRoles[speakerStats[0].speaker as string] = "agent"
    speakerRoles[speakerStats[1].speaker as string] = "customer"
  } else if (speakerStats.length === 1) {
    speakerRoles[speakerStats[0].speaker as string] = "agent"
  }

  return speakerRoles
}

function inferNonAgentRole(transcript: any): 'Patient' | 'Guest' | 'Customer' {
  const text = (transcript.text || '').toLowerCase();
  const utterances = transcript.utterances || [];

  // Count domain-specific keywords
  const medicalKeywords = ['hospital', 'clinic', 'doctor', 'nurse', 'treatment', 'appointment', 'medical', 'medicine', 'prescription', 'ward', 'patient', 'sick', 'illness', 'symptoms', 'diagnosis', 'therapy', 'surgery', 'emergency', 'ambulance', 'pharmacy', 'medication', 'health', 'care', 'physician', 'specialist', 'consultation', 'examination', 'test', 'lab', 'x-ray', 'scan', 'procedure', 'recovery', 'discharge', 'admission', 'insurance', 'coverage', 'billing', 'copay', 'deductible'];
  const hospitalityKeywords = ['hotel', 'room', 'check-in', 'checkin', 'reservation', 'hospitality', 'guest', 'suite', 'concierge', 'lobby', 'stay', 'hotel membership', 'room cleanliness', 'late check-in', 'late checkin', 'early check-out', 'early checkout', 'housekeeping', 'maid service', 'room service', 'front desk', 'reception', 'bellhop', 'valet', 'parking', 'amenities', 'pool', 'gym', 'spa', 'restaurant', 'bar', 'catering', 'event', 'wedding', 'conference', 'meeting', 'banquet', 'catering', 'catering service', 'room type', 'king bed', 'queen bed', 'double bed', 'single bed', 'connecting rooms', 'adjoining rooms', 'upgrade', 'downgrade', 'rate', 'pricing', 'discount', 'package', 'deal', 'promotion', 'loyalty', 'rewards', 'points', 'status', 'elite', 'premium', 'luxury', 'budget', 'economy', 'standard', 'deluxe', 'executive', 'presidential'];
  const retailKeywords = ['order', 'delivery', 'refund', 'product', 'billing', 'charge', 'purchase', 'store', 'shopping', 'cart', 'checkout', 'payment', 'credit card', 'debit card', 'cash', 'receipt', 'invoice', 'shipping', 'tracking', 'package', 'item', 'goods', 'merchandise', 'sale', 'discount', 'coupon', 'promo', 'deal', 'offer', 'price', 'cost', 'expensive', 'cheap', 'affordable', 'quality', 'brand', 'manufacturer', 'supplier', 'vendor', 'retailer', 'merchant', 'seller', 'buyer', 'customer service', 'support', 'help', 'assistance', 'complaint', 'issue', 'problem', 'return', 'exchange', 'warranty', 'guarantee'];

  let medicalCount = 0;
  let hospitalityCount = 0;
  let retailCount = 0;

  utterances.forEach((u: any) => {
    const utteranceText = u.text.toLowerCase();
    medicalCount += medicalKeywords.filter(k => utteranceText.includes(k)).length;
    hospitalityCount += hospitalityKeywords.filter(k => utteranceText.includes(k)).length;
    retailCount += retailKeywords.filter(k => utteranceText.includes(k)).length;
  });

  // Prioritize based on keyword frequency
  if (medicalCount > hospitalityCount && medicalCount > retailCount) {
    return 'Patient';
  } else if (hospitalityCount > medicalCount && hospitalityCount > retailCount) {
    return 'Guest';
  } else {
    return 'Customer';
  }
}

// Format transcription with speaker labels
function formatTranscriptionWithSpeakers(transcript: any): string {
  if (!transcript.utterances || transcript.utterances.length === 0) {
    return transcript.text || ""
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const nonAgentRole = inferNonAgentRole(transcript)

  return transcript.utterances
    .map((utterance: any) => {
      const role = speakerRoles[utterance.speaker] || "unknown"
      const roleLabel = role === "agent" ? "🎧 Agent" : `👤 ${nonAgentRole}`
      const timestamp = `[${Math.floor(utterance.start / 1000)}:${String(Math.floor((utterance.start % 1000) / 10)).padStart(2, "0")}]`

      return `${timestamp} ${roleLabel}: ${utterance.text}`
    })
    .join("\n\n")
}

// Generate enhanced summary using AI with proper prompt
async function generateEnhancedSummary(transcript: any): Promise<string> {
  const utterances = transcript.utterances || []

  if (utterances.length === 0) {
    return "No conversation content available for analysis."
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const agentUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "agent")
  const customerUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "customer")

  const agentText = agentUtterances.map((u: any) => u.text).join(" ")
  const customerText = customerUtterances.map((u: any) => u.text).join(" ")

  // Use the same role inference as the transcript section
  const nonAgentRole = inferNonAgentRole(transcript)
  const nonAgentRoleLower = nonAgentRole.toLowerCase()

  const prompt = `You are an expert call analyst. Summarize this customer service conversation transcript accurately and concisely.

FULL TRANSCRIPT:
AGENT: ${agentText}
${nonAgentRole.toUpperCase()}: ${customerText}

INSTRUCTIONS:
1. Identify the EXACT purpose of the ${nonAgentRoleLower}'s call (e.g., cancel, refund, complain, reschedule).
2. Identify the SPECIFIC reason for the call based ONLY on the ${nonAgentRoleLower}'s explicit statements.
3. Use this EXACT format: "The ${nonAgentRoleLower} called to [purpose] because [specific reason]."
4. Avoid assumptions or inferences beyond the transcript.
5. Ensure the summary is professional, concise, and directly reflects the transcript content.
6. Use "${nonAgentRoleLower}" as the role label.

EXAMPLES:
- "The guest called to cancel their reservation because of a scheduling conflict."
- "The patient called to reschedule an appointment because of a delayed medical procedure."
- "The customer called to request a refund because of receiving a damaged product."

REJECTED EXAMPLES:
- "The customer called about an issue." (too vague)
- "The guest called to complain." (missing specific reason)

ANALYZE:
- What did the ${nonAgentRoleLower} say they wanted to achieve?
- What specific issue or trigger did they mention?
- Use their exact words or close paraphrases for accuracy.`

  const aiSummary = await callGemmaAPI(prompt)
  
  console.log("AI Summary raw response:", aiSummary)
  console.log("AI Summary includes 'AI analysis unavailable':", aiSummary.includes("AI analysis unavailable"))
  console.log("AI Summary length:", aiSummary.length)
  console.log("AI Summary starts with 'The':", aiSummary.trim().startsWith("The"))
  
  // If AI fails, use intelligent fallback
  if (aiSummary.includes("AI analysis unavailable")) {
    console.log("AI failed, using intelligent fallback");

    const customerText = customerUtterances.map((u: any) => u.text).join(" ").toLowerCase();
    const sentimentResults = transcript.sentiment_analysis_results || [];
    const negativeSentiments = sentimentResults.filter((s: any) => s.sentiment === "NEGATIVE").length;
    
    // Define complaint patterns first
    const complaintPatterns = [
      { pattern: /cold food|wrong food|wrong order|incorrect item/i, reason: "issues with food order accuracy" },
      { pattern: /damaged|spoiled|broken/i, reason: "damaged or spoiled items" },
      { pattern: /billing|overcharged|wrong charge/i, reason: "billing errors" },
      { pattern: /poor service|bad experience|unprofessional/i, reason: "poor service quality" },
      { pattern: /no one is telling|no updates|not informed/i, reason: "lack of communication" },
      { pattern: /late|delayed/i, reason: "service delays" },
      { pattern: /rude|unhelpful/i, reason: "unhelpful staff behavior" },
      { pattern: /dirty|unclean/i, reason: "unclean facilities" },
    ];
    
    const hasComplaint = sentimentResults.some((s: any) => 
      complaintPatterns.some(({ pattern }) => pattern.test(s.text))
    );

    let action = "get assistance";
    let reason = "general inquiry";

    // Determine action
    if (customerText.includes("cancel") || customerText.includes("terminate")) {
      action = "cancel their service";
    } else if (customerText.includes("refund") || customerText.includes("money back")) {
      action = "request a refund";
    } else if (customerText.includes("complaint") || customerText.includes("complain") || hasComplaint) {
      action = "file a complaint";
    } else if (customerText.includes("reschedule") || customerText.includes("appointment")) {
      action = "reschedule an appointment";
    } else if (customerText.includes("escalate") || customerText.includes("supervisor")) {
      action = "escalate the issue";
    } else if (negativeSentiments > sentimentResults.length * 0.3) {
      action = "address a concern"; // Use sentiment to infer a problem
    }

    // Determine reason using the patterns
    for (const { pattern, reason: r } of complaintPatterns) {
      if (pattern.test(customerText)) {
        reason = r;
        break;
      }
    }

    // If no specific reason found, use sentiment to refine
    if (reason === "general inquiry" && negativeSentiments > 0) {
      reason = "dissatisfaction with service";
    }

    // Final check for very short transcripts
    if (customerText.length < 50 && reason === "general inquiry") {
      return `The ${nonAgentRoleLower} called to discuss a concern, but specific details were not provided.`;
    }

    console.log("Using fallback summary:", `The ${nonAgentRoleLower} called to ${action} because of ${reason}.`)
    return `The ${nonAgentRoleLower} called to ${action} because of ${reason}.`;
  }
  
  console.log("Using AI summary:", aiSummary)
  
  // Post-process to ensure correct role label
  let summary = aiSummary
  summary = summary.replace(/customer/gi, nonAgentRoleLower)
  summary = summary.replace(/Customer/gi, nonAgentRole)
  summary = summary.replace(/guest/gi, nonAgentRoleLower)
  summary = summary.replace(/Guest/gi, nonAgentRole)
  summary = summary.replace(/patient/gi, nonAgentRoleLower)
  summary = summary.replace(/Patient/gi, nonAgentRole)
  
  return summary
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

  const prompt = `Analyze this specific customer service conversation for unique business intelligence insights:

AGENT: ${agentText}

CUSTOMER: ${customerText}

SENTIMENT: ${sentimentResults.map((s: any) => `${s.sentiment}`).join(', ')}

Instructions:
- You MUST infer the correct non-agent role from context:
  - If the conversation is about medical, hospital, clinic, doctors, nurses, appointments, treatment, or anything healthcare-related, ALWAYS use 'patient' (never use 'customer' or 'guest').
  - If the conversation is about hotels, rooms, check-in, reservations, hospitality, or anything hotel-related, ALWAYS use 'guest' (never use 'customer' or 'patient').
  - Only use 'customer' if the context is retail, service, or general business and there are no medical or hospitality clues.
- Always refer to the agent as 'agent'.
- Provide all insights, risks, and recommendations using the correct role label for the non-agent.
- If you are unsure, make your best guess based on context, but NEVER use 'customer' if there are any medical or hospitality clues.

Look for these specific keywords and issues:

EMOTION DETECTION:
- Frustration: frustrated, annoyed, irritated, exasperated, neglected, ignored, not being helped, no one is telling us anything, no updates, not informed, left in the dark, I wish someone would update me, I feel left out, I'm still waiting, I'm not sure what's happening, I haven't heard back, I'm not being kept in the loop, I'm waiting for a response, I'm not sure what's going on
- Anger: angry, upset, fed up, tired of, sick of, had enough
- Disappointment: disappointed, unhappy, dissatisfied
- Stress: stressed, worried, concerned, confused, exhausted
- Neglect/Lack of Communication: "no one is telling us anything", "no one is helping", "not being updated", "not informed", "left in the dark", "no communication", "no updates", "I wish someone would update me", "I feel left out", "I'm still waiting", "I'm not sure what's happening", "I haven't heard back", "I'm not being kept in the loop", "I'm waiting for a response", "I'm not sure what's going on"

COMPLAINT DETECTION:
- Any complaint, mismatch, or dissatisfaction (e.g., "I ordered this, I got that", "not what I expected", "not satisfied", "this isn't working as advertised", "this doesn't meet my needs", "this is wrong", "I want to complain", "I want to escalate", "I want a refund", "I want to cancel") should be flagged as negative sentiment and a churn risk, even if stated politely or indirectly. Analyze the meaning and context, not just keywords.

SERVICE ISSUES:
- Food Service: cold food, damaged items, spoiled meals, wrong food orders, incorrect items, pizza delivery problems
- General Service: poor service, bad experience, terrible service, wrong items received, incorrect orders, lack of communication, no updates
- Billing Issues: overcharging, wrong charges, billing errors, overcharged, undercharged

CUSTOMER ACTIONS:
- cancel, return, refund, complaint, escalate, speak to supervisor, file complaint, leave review, switch providers, never use again, warn others

POLITE COMPLAINTS:
- "I ordered this but got that", "it's not what I expected", "this isn't working as advertised", "I'm not satisfied", "this doesn't meet my needs"

DETECTION CATEGORIES:
- Order Accuracy: Wrong items, fulfillment failures
- Food Quality: Cold food, damaged items, quality control
- Billing Accuracy: Overcharging, incorrect charges
- Service Quality: Poor service, bad experiences, lack of communication, no updates
- Customer Emotions: Subtle dissatisfaction, gentle complaints, feeling neglected, not being informed
- Complaints: Any complaint, mismatch, or dissatisfaction should be flagged as negative sentiment and a churn risk, regardless of politeness or wording. Always analyze the meaning/context, not just keywords.

Analyze the agent's performance specifically:
- Did they listen actively and acknowledge the customer's concerns?
- Did they offer specific solutions or just generic responses?
- Did they show empathy and understanding?
- Did they take ownership of the problem?
- Did they escalate appropriately when needed?
- Did they follow up on promises made?
- Did they keep the customer informed and provide timely updates?

If the customer expressed neglect, lack of updates, not being informed, or any complaint, flag this as a major risk and area for improvement.

Provide business intelligence analysis in this exact JSON format with insights specific to THIS conversation:
{
  "areasOfImprovement": ["specific areas where service can be improved based on THIS customer's feedback"],
  "processGaps": ["identified gaps in processes or procedures that led to THIS customer's issues"],
  "trainingOpportunities": ["specific training needs for agents based on THIS interaction"],
  "preventiveMeasures": ["measures to prevent similar issues from occurring"],
  "customerExperienceInsights": ["key insights about THIS customer's experience and satisfaction"],
  "operationalRecommendations": ["operational improvements needed based on THIS call"],
  "riskFactors": ["potential risks identified including customer churn, negative reviews, escalation, communication breakdown, lack of updates, customer neglect, complaints, dissatisfaction"],
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

Base the quality score specifically on how THIS agent handled THIS customer. Consider:
- Responsiveness: How quickly and appropriately did the agent respond?
- Empathy: Did the agent show understanding and care for the customer's situation?
- Problem Solving: Did the agent offer effective solutions?
- Communication: Was the agent clear, professional, and helpful?
- Follow Up: Did the agent ensure the customer's needs were met?
- Did the agent keep the customer informed and provide timely updates?

Make all insights specific to this conversation, not generic.`

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

  const prompt = `Based on this specific customer service conversation, provide unique action items that directly address the issues discussed:

AGENT: ${agentText}

CUSTOMER: ${customerText}

Instructions:
- You MUST infer the correct non-agent role from context:
  - If the conversation is about medical, hospital, clinic, doctors, nurses, appointments, treatment, or anything healthcare-related, ALWAYS use 'patient' (never use 'customer' or 'guest').
  - If the conversation is about hotels, rooms, check-in, reservations, hospitality, or anything hotel-related, ALWAYS use 'guest' (never use 'customer' or 'patient').
  - Only use 'customer' if the context is retail, service, or general business and there are no medical or hospitality clues.
- Always refer to the agent as 'agent'.
- Write all action items using the correct role label for the non-agent.
- If you are unsure, make your best guess based on context, but NEVER use 'customer' if there are any medical or hospitality clues.

Look for these specific issues and keywords:

EMOTION DETECTION:
- Frustration: frustrated, annoyed, irritated, exasperated
- Anger: angry, upset, fed up, tired of, sick of, had enough
- Disappointment: disappointed, unhappy, dissatisfied
- Stress: stressed, worried, concerned, confused, exhausted

SERVICE ISSUES:
- Food Service: cold food, damaged items, spoiled meals, wrong food orders, incorrect items, pizza delivery problems
- General Service: poor service, bad experience, terrible service, wrong items received, incorrect orders
- Billing Issues: overcharging, wrong charges, billing errors, overcharged, undercharged

CUSTOMER ACTIONS:
- cancel, return, refund, complaint, escalate, speak to supervisor, file complaint, leave review, switch providers, never use again, warn others

POLITE COMPLAINTS:
- "I ordered this but got that", "it's not what I expected", "this isn't working as advertised", "I'm not satisfied", "this doesn't meet my needs"

Analyze the conversation carefully and provide action items ONLY if there are specific issues that require follow-up actions.

If the conversation was resolved satisfactorily with no outstanding issues, respond with: "No action needed"

If there are issues that require follow-up, provide 2-4 specific, actionable items such as:
- "Escalate to supervisor for billing dispute resolution"
- "Process refund for wrong items received"
- "Follow up with customer on service quality improvements"
- "Review order fulfillment process to prevent future errors"
- "Schedule training session for agent on conflict resolution"

Make each action item specific and directly related to what was discussed in THIS conversation. Do not provide generic action items.`

  const aiActionItems = await callGemmaAPI(prompt)
  
  if (aiActionItems.includes("AI analysis unavailable")) {
    return extractFallbackActionItems(transcript)
  }
  
  // Parse action items from AI response
  const lines = aiActionItems.split('\n').filter((line: string) => line.trim().length > 0)
  
  // Check if AI responded with "No action needed"
  if (aiActionItems.toLowerCase().includes("no action needed")) {
    return ["No action needed"]
  }
  
  const actionItems = lines
    .map((line: string) => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((item: string) => item.length > 10 && !item.includes("AI analysis"))
    .slice(0, 4)
  
  return actionItems.length > 0 ? actionItems : ["No action needed"]
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
  const sentimentResults = transcript.sentiment_analysis_results || []

  if (utterances.length === 0) {
    return ["No action needed"]
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const customerUtterances = utterances.filter((u: any) => speakerRoles[u.speaker] === "customer")
  const customerText = customerUtterances.map((u: any) => u.text).join(" ").toLowerCase()

  const actionItems = []

  // Check for specific issues that require action
  if (customerText.includes("cancel") || customerText.includes("terminate")) {
    actionItems.push("Process customer cancellation request")
  }
  
  if (customerText.includes("refund") || customerText.includes("money back")) {
    actionItems.push("Process refund for customer")
  }
  
  if (customerText.includes("supervisor") || customerText.includes("escalate")) {
    actionItems.push("Escalate to supervisor for resolution")
  }
  
  if (customerText.includes("wrong") || customerText.includes("incorrect") || customerText.includes("damaged")) {
    actionItems.push("Review order fulfillment process")
  }
  
  if (customerText.includes("billing") || customerText.includes("overcharged")) {
    actionItems.push("Review billing accuracy and process")
  }

  // If no specific issues found, return no action needed
  return actionItems.length > 0 ? actionItems : ["No action needed"]
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

    // Generate enhanced analysis using Meta Llama 4 Maverick for business intelligence and action items only
    console.log("Generating AI analysis...")
    const [enhancedSummary, enhancedBusinessIntelligence, enhancedActionItems] = await Promise.allSettled([
      generateEnhancedSummary(transcript),
      generateEnhancedBusinessIntelligence(transcript),
      extractEnhancedActionItems(transcript)
    ])

    console.log("AI analysis completed")

    let summary = enhancedSummary.status === 'fulfilled' ? enhancedSummary.value : "AI summary generation failed - please try again"
    let businessIntelligence = enhancedBusinessIntelligence.status === 'fulfilled' ? enhancedBusinessIntelligence.value : generateFallbackBusinessIntelligence(transcript)
    let actionItems = enhancedActionItems.status === 'fulfilled' ? enhancedActionItems.value : extractFallbackActionItems(transcript)

    // Always recalculate overall as the average of the five categories for consistency
    if (businessIntelligence.qualityScore && businessIntelligence.qualityScore.categories) {
      const cats = businessIntelligence.qualityScore.categories
      const avg = Math.round((cats.responsiveness + cats.empathy + cats.problemSolving + cats.communication + cats.followUp) / 5)
      businessIntelligence.qualityScore.overall = avg
    }

    // Only fallback if AI fails completely
    if (!businessIntelligence.qualityScore || !businessIntelligence.qualityScore.categories) {
      console.log("AI business intelligence failed, using fallback")
      businessIntelligence = generateFallbackBusinessIntelligence(transcript)
    }

    // Use AssemblyAI sentiment analysis for segments
    const sentimentResults = transcript.sentiment_analysis_results || [];
    let aiSegments = sentimentResults.map((result: any) => ({
      text: result.text,
      sentiment: result.sentiment,
      confidence: result.confidence,
      churnRisk: false
    }));
    // Post-process segment sentiment: flag complaints/neglect as negative
    const complaintPatterns = [
      /i (ordered|requested|expected) .+ (but|and) (got|received) .+/i,
      /not what i expected/i,
      /not satisfied/i,
      /this is wrong/i,
      /this isn\'t working as advertised/i,
      /this doesn\'t meet my needs/i,
      /i want to complain/i,
      /i want to escalate/i,
      /i want a refund/i,
      /i want to cancel/i,
      /wrong (item|order|product|food)/i,
      /incorrect (item|order|product|food)/i,
      /damaged|spoiled|broken/i,
      /overcharged|wrong charge|billing error/i,
      /no one is saying anything/i,
      /no one is telling us anything/i,
      /no one is updating us/i,
      /no one is helping/i,
      /not being informed/i,
      /not being updated/i,
      /left in the dark/i,
      /no communication/i,
      /no updates/i
    ];
    aiSegments = aiSegments.map((seg: any) => {
      if (
        complaintPatterns.some((pat) => pat.test(seg.text)) &&
        seg.sentiment !== 'NEGATIVE'
      ) {
        return { ...seg, sentiment: 'NEGATIVE', confidence: Math.max(seg.confidence, 0.8), churnRisk: true };
      }
      return seg;
    });
    // Compute overall sentiment from segments
    const sentimentCounts = aiSegments.reduce((acc: Record<string, number>, seg: any) => {
      acc[seg.sentiment] = (acc[seg.sentiment] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const dominantSentiment = Object.entries(sentimentCounts).sort(([, a], [, b]) => (b as number) - (a as number))[0] || ['NEUTRAL', 1];
    const sentiment = {
      overall: dominantSentiment[0],
      confidence: aiSegments.length > 0 ? (sentimentCounts[dominantSentiment[0]] / aiSegments.length) : 0.5,
      segments: aiSegments
    };

    // Post-process segment sentiment: flag complaints as negative
    const transcriptText = (transcript.text || '').toLowerCase()
    if (transcriptText.includes('no one is telling us anything')) {
      // Force negative sentiment if not already
      if (typeof sentiment === 'object' && sentiment && sentiment.overall && sentiment.overall !== 'NEGATIVE') {
        sentiment.overall = 'NEGATIVE'
      }
      // Add risk factor if not already present
      if (businessIntelligence && businessIntelligence.riskFactors && Array.isArray(businessIntelligence.riskFactors)) {
        if (!businessIntelligence.riskFactors.some((r: string) => r.toLowerCase().includes('communication breakdown'))) {
          businessIntelligence.riskFactors.push('Communication breakdown: customer reported no updates')
        }
        if (!businessIntelligence.areasOfImprovement.some((a: string) => a.toLowerCase().includes('communication'))) {
          businessIntelligence.areasOfImprovement.push('Improve proactive communication and customer updates')
        }
      }
    }

    if (actionItems.includes("Review conversation recording for insights")) {
      console.log("AI action items failed, using fallback")
      actionItems = extractFallbackActionItems(transcript)
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
