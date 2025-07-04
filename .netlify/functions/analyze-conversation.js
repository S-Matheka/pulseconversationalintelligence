const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "4ee04704fdba4972a2c98ee62760a4c8"
const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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"
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://conversation-analyzer.netlify.app/api/webhook"

// Call Google Gemma 3N 4B for enhanced analysis
async function callGemmaAPI(prompt) {
  try {
    console.log("Calling Gemma API with prompt:", prompt.substring(0, 100) + "...")
    
    // Add timeout to the fetch request
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000) // Reduced to 8 second timeout
    
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://conversation-analyzer.netlify.app",
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
        max_tokens: 400, // Further reduced
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
  } catch (error) {
    console.error("Gemma API error:", error)
    if (error.name === 'AbortError') {
      return "AI analysis unavailable - request timed out"
    }
    return `AI analysis unavailable - ${error.message}`
  }
}

// Upload audio file to AssemblyAI
async function uploadAudio(audioBuffer) {
  console.log("Starting audio upload to AssemblyAI...")
  console.log("Audio buffer size:", audioBuffer.length, "bytes")
  
  try {
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
      console.error("AssemblyAI upload error:", response.status, errorText)
      throw new Error(`Failed to upload audio: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log("Audio uploaded successfully, URL:", data.upload_url)
    return data.upload_url
  } catch (error) {
    console.error("Error uploading audio:", error.message)
    throw new Error(`Audio upload failed: ${error.message}`)
  }
}

// Submit transcription request
async function submitTranscription(audioUrl) {
  console.log("Submitting transcription request...")
  console.log("Audio URL:", audioUrl)
  
  try {
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
      console.error("AssemblyAI transcription submission error:", response.status, errorText)
      throw new Error(`Failed to submit transcription: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log("Transcription submitted successfully, ID:", data.id)
    return data.id
  } catch (error) {
    console.error("Error submitting transcription:", error.message)
    throw new Error(`Transcription submission failed: ${error.message}`)
  }
}

// Poll for transcription completion
async function pollTranscription(transcriptId) {
  let attempts = 0
  const maxAttempts = 20 // Reduced to 1.5 minutes max (20 * 4.5 seconds)
  
  while (attempts < maxAttempts) {
    attempts++
    console.log(`Polling attempt ${attempts}/${maxAttempts} for transcript ${transcriptId}`)
    
    try {
      const response = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${transcriptId}`, {
        headers: {
          Authorization: ASSEMBLYAI_API_KEY,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`AssemblyAI API error (attempt ${attempts}):`, response.status, errorText)
        throw new Error(`Failed to get transcription status: ${response.status} - ${errorText}`)
      }

      const transcript = await response.json()
      console.log(`Transcription status (attempt ${attempts}):`, transcript.status)

      if (transcript.status === "completed") {
        console.log("Transcription completed successfully")
        return transcript
      } else if (transcript.status === "error") {
        console.error("Transcription failed with error:", transcript.error)
        throw new Error(`Transcription failed: ${transcript.error || 'Unknown error'}`)
      } else if (transcript.status === "queued") {
        console.log("Transcription still queued...")
      } else if (transcript.status === "processing") {
        console.log("Transcription still processing...")
      }

      // Wait 4.5 seconds before polling again (reduced from 5)
      await new Promise((resolve) => setTimeout(resolve, 4500))
    } catch (error) {
      console.error(`Error during polling attempt ${attempts}:`, error.message)
      if (attempts >= maxAttempts) {
        throw new Error(`Transcription polling failed after ${maxAttempts} attempts: ${error.message}`)
      }
      // Wait 4.5 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 4500))
    }
  }
  
  throw new Error(`Transcription timed out after ${maxAttempts} attempts`)
}

// Improved speaker role detection with better heuristics
function detectSpeakerRoles(transcript) {
  const speakerRoles = {}

  if (!transcript.utterances || transcript.utterances.length === 0) {
    return speakerRoles
  }

  const speakers = [...new Set(transcript.utterances.map((u) => u.speaker))]
  
  if (speakers.length === 0) {
    return speakerRoles
  }

  // Analyze the first few utterances to determine roles
  const firstUtterances = transcript.utterances.slice(0, Math.min(5, transcript.utterances.length))
  
  // Keywords that typically indicate a customer speaking first
  const customerFirstIndicators = [
    "hello", "hi", "good morning", "good afternoon", "good evening",
    "is this", "can i speak to", "i need to", "i want to", "i'm calling about",
    "i have a question", "i need help", "i'm having trouble", "there's a problem",
    "i'd like to", "i want to make", "i need to schedule", "i need to cancel",
    "i need to change", "i need to reschedule", "i need to book"
  ]

  // Keywords that typically indicate an agent speaking first
  const agentFirstIndicators = [
    "thank you for calling", "welcome to", "how may i help you", "how can i assist you",
    "good morning, thank you", "good afternoon, thank you", "good evening, thank you",
    "this is", "my name is", "i'm", "department", "service", "support"
  ]

  const firstSpeaker = speakers[0]
  const firstUtteranceText = firstUtterances
    .filter(u => u.speaker === firstSpeaker)
    .map(u => u.text.toLowerCase())
    .join(" ")

  // Count indicators
  let customerScore = 0
  let agentScore = 0

  customerFirstIndicators.forEach(indicator => {
    if (firstUtteranceText.includes(indicator)) {
      customerScore += 1
    }
  })

  agentFirstIndicators.forEach(indicator => {
    if (firstUtteranceText.includes(indicator)) {
      agentScore += 1
    }
  })

  // Determine roles based on scores and conversation patterns
  if (customerScore > agentScore) {
    // Customer likely spoke first
    speakerRoles[firstSpeaker] = "customer"
    if (speakers.length > 1) {
      speakerRoles[speakers[1]] = "agent"
    }
  } else if (agentScore > customerScore) {
    // Agent likely spoke first
    speakerRoles[firstSpeaker] = "agent"
    if (speakers.length > 1) {
      speakerRoles[speakers[1]] = "customer"
    }
  } else {
    // Fallback: analyze conversation length and patterns
    const speakerUtteranceCounts = speakers.map(speaker => ({
      speaker,
      count: transcript.utterances.filter(u => u.speaker === speaker).length,
      avgLength: transcript.utterances
        .filter(u => u.speaker === speaker)
        .reduce((sum, u) => sum + u.text.length, 0) / 
        transcript.utterances.filter(u => u.speaker === speaker).length
    }))

    // Sort by utterance count (customer usually has fewer, longer utterances)
    speakerUtteranceCounts.sort((a, b) => a.count - b.count)
    
    if (speakerUtteranceCounts.length >= 2) {
      speakerRoles[speakerUtteranceCounts[0].speaker] = "customer"
      speakerRoles[speakerUtteranceCounts[1].speaker] = "agent"
    }
  }

  return speakerRoles
}

// Format transcription with speaker labels
function formatTranscriptionWithSpeakers(transcript) {
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

// Enhanced summary generation using Gemma 3N 4B
async function generateEnhancedSummary(transcript) {
  const utterances = transcript.utterances || []
  
  if (utterances.length === 0) {
    return "No conversation content available for summary."
  }

  const formattedTranscript = formatTranscriptionWithSpeakers(transcript)

  const prompt = `Analyze this customer service conversation and provide a detailed summary of why the customer called.

Focus on identifying the customer's primary reason for calling and any underlying issues. Be specific about service problems, quality issues, or customer dissatisfaction.

Look for:
- Service quality problems (poor service, bad experience)
- Wrong or incorrect items received
- Food quality issues (cold food, damaged items)
- Billing problems (overcharging, wrong charges)
- Customer emotions (frustrated, upset, annoyed, disappointed)
- Cancellation requests and their reasons
- Technical or operational issues

Examples of detailed summaries:
- "Customer called to cancel their hotel membership due to poor service quality, including room cleanliness issues and late check-ins."
- "Customer called to report receiving wrong food order and cold pizza, expressing frustration with delivery service."
- "Customer called regarding incorrect billing charges and overcharging on their account."
- "Customer called to report technical issues with their service and poor customer support experience."

Conversation transcript:
${formattedTranscript}

Provide a detailed, specific summary that captures the customer's main issue and any underlying problems. Include context about service quality, product issues, or customer dissatisfaction when relevant.`

  return await callGemmaAPI(prompt)
}

// Enhanced business intelligence using Gemma 3N 4B
async function generateEnhancedBusinessIntelligence(transcript) {
  const utterances = transcript.utterances || []
  
  if (utterances.length === 0) {
    return {
      areasOfImprovement: [],
      processGaps: [],
      trainingOpportunities: [],
      preventiveMeasures: [],
      customerExperienceInsights: [],
      operationalRecommendations: [],
      riskFactors: [],
      qualityScore: {
        overall: 75,
        categories: {
          responsiveness: 80,
          empathy: 75,
          problemSolving: 70,
          communication: 80,
          followUp: 75,
        },
      },
    }
  }

  const formattedTranscript = formatTranscriptionWithSpeakers(transcript)
  const sentimentResults = transcript.sentiment_analysis_results || []

  const prompt = `Analyze this customer service conversation and provide detailed business intelligence insights. Be specific and actionable.

Pay special attention to:
- Customer emotions (frustrated, upset, annoyed, disappointed, fed up, tired of, sick of, had enough, exasperated, exhausted, stressed, worried, concerned, confused)
- Service quality issues (poor service, bad experience, terrible service)
- Product problems (wrong items, incorrect orders, damaged goods, cold food, spoiled items)
- Billing issues (overcharging, wrong charges, incorrect billing)
- Operational failures (long wait times, multiple transfers, lack of follow-up)
- Customer dissatisfaction indicators (gentle complaints, subtle frustration, repeated issues)

**Areas of Improvement** (only if issues exist):
- List specific skills, processes, or behaviors that need enhancement
- Focus on concrete, observable issues

**Process Gaps** (only if systemic problems exist):
- Identify procedural failures or system issues
- Highlight where processes broke down

**Training Opportunities** (only if agent needs coaching):
- List specific skills the agent needs to develop
- If agent performed well, state "No training needed - agent demonstrated professional competence"

**Preventive Measures** (to avoid similar issues):
- Actions to prevent customer problems
- Proactive steps the business can take

**Customer Experience Insights**:
- Key learnings about customer needs and expectations
- What customers value or find frustrating

**Operational Recommendations**:
- Process improvements or system changes
- Business operations that could be enhanced

**Risk Factors** (if any exist):
- Potential business risks or customer churn indicators
- Issues that could impact customer retention

**Quality Assessment** (score 0-100 for each):
- Responsiveness: How quickly and efficiently the agent responded
- Empathy: How well the agent showed understanding and care
- Problem Solving: How effectively the agent resolved the issue
- Communication: How clearly and professionally the agent communicated
- Follow-up: Whether proper follow-up procedures were mentioned

Conversation transcript:
${formattedTranscript}

Sentiment analysis: ${sentimentResults.length > 0 ? sentimentResults.map(s => `${s.text}: ${s.sentiment}`).join(', ') : 'No sentiment data'}

Provide specific, actionable insights. If the agent performed excellently, acknowledge that. If there are issues, be specific about what needs improvement. Pay attention to subtle customer dissatisfaction and service quality problems.`

  const aiAnalysis = await callGemmaAPI(prompt)

  // Parse AI response and extract insights
  const analysis = {
    areasOfImprovement: [],
    processGaps: [],
    trainingOpportunities: [],
    preventiveMeasures: [],
    customerExperienceInsights: [],
    operationalRecommendations: [],
    riskFactors: [],
    qualityScore: {
      overall: 75,
      categories: {
        responsiveness: 80,
        empathy: 75,
        problemSolving: 70,
        communication: 80,
        followUp: 75,
      },
    },
  }

  // Extract insights from AI response
  const lines = aiAnalysis.split('\n')
  let currentCategory = ''
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase()
    
    if (lowerLine.includes('areas of improvement') || lowerLine.includes('improvement')) {
      currentCategory = 'areasOfImprovement'
    } else if (lowerLine.includes('process gap') || lowerLine.includes('systemic') || lowerLine.includes('procedural')) {
      currentCategory = 'processGaps'
    } else if (lowerLine.includes('training') || lowerLine.includes('coaching') || lowerLine.includes('skill')) {
      currentCategory = 'trainingOpportunities'
    } else if (lowerLine.includes('preventive') || lowerLine.includes('prevent')) {
      currentCategory = 'preventiveMeasures'
    } else if (lowerLine.includes('customer experience') || lowerLine.includes('customer insight')) {
      currentCategory = 'customerExperienceInsights'
    } else if (lowerLine.includes('operational') || lowerLine.includes('recommendation')) {
      currentCategory = 'operationalRecommendations'
    } else if (lowerLine.includes('risk') || lowerLine.includes('churn')) {
      currentCategory = 'riskFactors'
    } else if (line.trim() && currentCategory && (line.includes('-') || line.includes('•') || line.includes('*'))) {
      const insight = line.replace(/^[-•*]\s*/, '').trim()
      if (insight && analysis[currentCategory] && Array.isArray(analysis[currentCategory])) {
        analysis[currentCategory].push(insight)
      }
    }
  }

  // Calculate quality scores from sentiment
  if (sentimentResults.length > 0) {
    const negativeCount = sentimentResults.filter(s => s.sentiment === "NEGATIVE").length
    const positiveCount = sentimentResults.filter(s => s.sentiment === "POSITIVE").length
    const totalSentiments = sentimentResults.length
    
    const sentimentScore = Math.max(0, Math.min(100, ((positiveCount - negativeCount) / totalSentiments) * 100 + 50))
    analysis.qualityScore.overall = Math.round(sentimentScore)
  }

  return analysis
}

// Extract action items using Gemma 3N 4B
async function extractEnhancedActionItems(transcript) {
  const utterances = transcript.utterances || []
  
  if (utterances.length === 0) {
    return []
  }

  const formattedTranscript = formatTranscriptionWithSpeakers(transcript)

  const prompt = `Extract specific action items and follow-up tasks from this customer service conversation. Look for:

1. **Tasks Promised**: What did the agent promise to do?
2. **Follow-up Actions**: What follow-up is needed?
3. **Investigations Required**: What needs to be looked into?
4. **Deadlines Mentioned**: Any timeframes or deadlines discussed?
5. **Customer Commitments**: What did the agent commit to doing?
6. **Escalations**: Any issues that need to be escalated?
7. **Documentation**: What needs to be recorded or documented?

Conversation transcript:
${formattedTranscript}

List only concrete, actionable items with clear next steps. If no specific action items were mentioned, state "No specific action items identified in this call."

Format as a clear list of tasks.`

  const aiResponse = await callGemmaAPI(prompt)
  
  // Parse action items from AI response
  const actionItems = aiResponse
    .split('\n')
    .filter(line => line.trim() && (line.includes('-') || line.includes('•') || line.includes('*')))
    .map(line => line.replace(/^[-•*]\s*/, '').trim())
    .filter(item => item.length > 10 && !item.toLowerCase().includes('no specific action items'))
    .slice(0, 10)

  return actionItems
}

// Create enhanced vCon object
function createEnhancedVcon(transcript, audioUrl, fileName, businessIntelligence, enhancedSummary, actionItems) {
  const now = new Date().toISOString()
  const speakerRoles = detectSpeakerRoles(transcript)

  return {
    vcon: "0.0.1",
    uuid: `vcon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    created_at: now,
    updated_at: now,
    subject: `Enhanced Conversation Analysis - ${fileName}`,
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
        body: enhancedSummary,
        vendor: "Google Gemma 3N 4B",
        product: "Enhanced AI Summary",
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
        vendor: "Google Gemma 3N 4B",
        product: "Enhanced Business Intelligence",
      },
      {
        type: "action_items",
        dialog: 0,
        body: actionItems,
        vendor: "Google Gemma 3N 4B",
        product: "AI-Extracted Action Items",
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

// Fallback summary generation if AI fails
function generateFallbackSummary(transcript) {
  const utterances = transcript.utterances || []
  
  if (utterances.length === 0) {
    return "No conversation content available for summary."
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const customerUtterances = utterances.filter(u => speakerRoles[u.speaker] === "customer")
  const customerText = customerUtterances.map(u => u.text).join(" ")

  // Identify customer's reason for calling with more detail
  if (customerText.includes("cancel") || customerText.includes("cancellation")) {
    if (customerText.includes("poor service") || customerText.includes("bad service") || customerText.includes("frustrated") || customerText.includes("upset")) {
      return "Customer called to cancel their membership due to poor service quality and dissatisfaction."
    } else if (customerText.includes("wrong") || customerText.includes("incorrect") || customerText.includes("ordered") || customerText.includes("received")) {
      return "Customer called to cancel their membership due to receiving incorrect or wrong items."
    } else {
      return "Customer called to cancel their membership or subscription."
    }
  } else if (customerText.includes("bill") || customerText.includes("payment") || customerText.includes("charge")) {
    if (customerText.includes("wrong") || customerText.includes("incorrect") || customerText.includes("overcharged")) {
      return "Customer called to report incorrect billing or overcharging issues."
    } else {
      return "Customer called regarding billing or payment issues."
    }
  } else if (customerText.includes("wrong") || customerText.includes("incorrect") || customerText.includes("ordered") || customerText.includes("received")) {
    if (customerText.includes("food") || customerText.includes("pizza") || customerText.includes("meal")) {
      return "Customer called to report receiving wrong food order or cold/damaged food items."
    } else {
      return "Customer called to report receiving incorrect or wrong items instead of what was ordered."
    }
  } else if (customerText.includes("cold") || customerText.includes("damaged") || customerText.includes("broken")) {
    if (customerText.includes("food") || customerText.includes("pizza") || customerText.includes("meal")) {
      return "Customer called to report receiving cold, damaged, or poor quality food items."
    } else {
      return "Customer called to report receiving damaged or defective items."
    }
  } else if (customerText.includes("problem") || customerText.includes("issue") || customerText.includes("not working")) {
    return "Customer called to report a problem or technical issue with their service or product."
  } else if (customerText.includes("appointment") || customerText.includes("schedule") || customerText.includes("booking")) {
    return "Customer called to schedule or modify an appointment or booking."
  } else if (customerText.includes("question") || customerText.includes("information") || customerText.includes("ask")) {
    return "Customer called seeking information or to ask questions about their service."
  } else if (customerText.includes("hotel") || customerText.includes("room") || customerText.includes("reservation")) {
    return "Customer called regarding hotel services, room issues, or reservation problems."
  } else if (customerText.includes("membership") || customerText.includes("account")) {
    return "Customer called regarding their membership or account-related issues."
  } else {
    return "Customer called for general assistance with their service or account."
  }
}

// Fallback business intelligence if AI fails
function generateFallbackBusinessIntelligence(transcript) {
  const utterances = transcript.utterances || []
  
  if (utterances.length === 0) {
    return {
      areasOfImprovement: [],
      processGaps: [],
      trainingOpportunities: [],
      preventiveMeasures: [],
      customerExperienceInsights: [],
      operationalRecommendations: [],
      riskFactors: [],
      qualityScore: {
        overall: 75,
        categories: {
          responsiveness: 80,
          empathy: 75,
          problemSolving: 70,
          communication: 80,
          followUp: 75,
        },
      },
    }
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const customerUtterances = utterances.filter(u => speakerRoles[u.speaker] === "customer")
  const agentUtterances = utterances.filter(u => speakerRoles[u.speaker] === "agent")

  const customerText = customerUtterances.map(u => u.text.toLowerCase()).join(" ")
  const agentText = agentUtterances.map(u => u.text.toLowerCase()).join(" ")

  const analysis = {
    areasOfImprovement: [],
    processGaps: [],
    trainingOpportunities: [],
    preventiveMeasures: [],
    customerExperienceInsights: [],
    operationalRecommendations: [],
    riskFactors: [],
    qualityScore: {
      overall: 75,
      categories: {
        responsiveness: 80,
        empathy: 75,
        problemSolving: 70,
        communication: 80,
        followUp: 75,
      },
    },
  }

  // Enhanced customer emotion detection
  const negativeEmotions = [
    "frustrated", "angry", "upset", "annoyed", "irritated", "disappointed", 
    "unhappy", "dissatisfied", "fed up", "tired of", "sick of", "had enough",
    "exasperated", "exhausted", "stressed", "worried", "concerned", "confused"
  ]
  
  const hasNegativeEmotion = negativeEmotions.some(emotion => customerText.includes(emotion))
  
  if (hasNegativeEmotion) {
    analysis.customerExperienceInsights.push("Customer expressed negative emotions during the call")
    analysis.riskFactors.push("High risk of customer churn due to negative experience")
    analysis.qualityScore.categories.empathy = 60
  }

  // Service quality issues
  if (customerText.includes("poor service") || customerText.includes("bad service") || customerText.includes("terrible service")) {
    analysis.areasOfImprovement.push("Improve overall service quality")
    analysis.processGaps.push("Service quality standards not being met")
    analysis.operationalRecommendations.push("Review and enhance service delivery processes")
  }

  // Wrong/incorrect items
  if (customerText.includes("wrong") || customerText.includes("incorrect") || customerText.includes("ordered") || customerText.includes("received")) {
    analysis.areasOfImprovement.push("Improve order accuracy and fulfillment")
    analysis.processGaps.push("Order fulfillment process failing")
    analysis.preventiveMeasures.push("Implement double-check system for order accuracy")
    analysis.operationalRecommendations.push("Review order processing and fulfillment procedures")
  }

  // Food quality issues
  if (customerText.includes("cold") || customerText.includes("damaged") || customerText.includes("spoiled")) {
    if (customerText.includes("food") || customerText.includes("pizza") || customerText.includes("meal")) {
      analysis.areasOfImprovement.push("Improve food quality and delivery standards")
      analysis.processGaps.push("Food quality control failing")
      analysis.preventiveMeasures.push("Implement food quality checks before delivery")
      analysis.operationalRecommendations.push("Review food preparation and delivery processes")
    }
  }

  // Cancellation requests
  if (customerText.includes("cancel") || customerText.includes("cancellation")) {
    analysis.customerExperienceInsights.push("Customer requested service cancellation")
    analysis.riskFactors.push("Customer churn risk - service cancellation requested")
    analysis.preventiveMeasures.push("Address service quality issues before customers request cancellation")
  }

  // Billing issues
  if (customerText.includes("overcharged") || customerText.includes("wrong charge") || customerText.includes("incorrect bill")) {
    analysis.areasOfImprovement.push("Improve billing accuracy")
    analysis.processGaps.push("Billing system errors occurring")
    analysis.preventiveMeasures.push("Implement billing verification processes")
  }

  // Wait time issues
  if (customerText.includes("wait") || customerText.includes("long time") || customerText.includes("forever")) {
    analysis.areasOfImprovement.push("Reduce customer wait times")
    analysis.qualityScore.categories.responsiveness = 60
  }

  // Communication issues
  if (customerText.includes("don't understand") || customerText.includes("confused") || customerText.includes("unclear")) {
    analysis.trainingOpportunities.push("Improve communication clarity")
    analysis.qualityScore.categories.communication = 65
  }

  // Analyze agent performance
  if (agentText.includes("sorry") || agentText.includes("apologize") || agentText.includes("regret")) {
    analysis.qualityScore.categories.empathy = 85
  } else {
    analysis.trainingOpportunities.push("Enhance empathetic communication")
    analysis.qualityScore.categories.empathy = 60
  }

  if (agentText.includes("follow up") || agentText.includes("call back")) {
    analysis.operationalRecommendations.push("Follow-up procedures were mentioned")
    analysis.qualityScore.categories.followUp = 85
  }

  if (agentText.includes("investigate") || agentText.includes("look into")) {
    analysis.operationalRecommendations.push("Issue investigation process initiated")
    analysis.qualityScore.categories.problemSolving = 80
  }

  // Add general insights if no specific issues found
  if (analysis.customerExperienceInsights.length === 0) {
    analysis.customerExperienceInsights.push("Customer contacted support for assistance")
  }

  if (analysis.operationalRecommendations.length === 0) {
    analysis.operationalRecommendations.push("Continue monitoring call quality and agent performance")
  }

  // Calculate overall score
  const categoryScores = Object.values(analysis.qualityScore.categories)
  analysis.qualityScore.overall = Math.round(categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length)

  return analysis
}

// Fallback action items if AI fails
function extractFallbackActionItems(transcript) {
  const utterances = transcript.utterances || []
  
  if (utterances.length === 0) {
    return []
  }

  const speakerRoles = detectSpeakerRoles(transcript)
  const agentUtterances = utterances.filter(u => speakerRoles[u.speaker] === "agent")
  const agentText = agentUtterances.map(u => u.text.toLowerCase()).join(" ")

  const actionItems = []

  if (agentText.includes("follow up") || agentText.includes("call back")) {
    actionItems.push("Follow up with customer as promised")
  }

  if (agentText.includes("investigate") || agentText.includes("look into")) {
    actionItems.push("Investigate the reported issue")
  }

  if (agentText.includes("escalate") || agentText.includes("supervisor")) {
    actionItems.push("Escalate issue to appropriate department")
  }

  if (agentText.includes("document") || agentText.includes("record")) {
    actionItems.push("Document the conversation and actions taken")
  }

  if (actionItems.length === 0) {
    actionItems.push("No specific action items identified in this call")
  }

  return actionItems
}

// Export the handler with webhook-based processing
exports.handler = async (event, context) => {
  // Set function timeout to 5 minutes (300 seconds)
  context.callbackWaitsForEmptyEventLoop = false
  
  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    }
  }

  // For POST requests, start background processing and return immediately
  if (event.httpMethod === 'POST') {
    try {
      // Parse the request to get audio data
      const boundary = event.headers['content-type']?.split('boundary=')[1]
      if (!boundary) {
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ error: 'No boundary found in content-type' }),
        }
      }

      // Parse the multipart data manually
      const body = Buffer.from(event.body, 'base64')
      const parts = body.toString().split(`--${boundary}`)
      
      let audioBuffer = null
      let fileName = 'audio.mp3'
      
      for (const part of parts) {
        if (part.includes('name="audio"')) {
          const lines = part.split('\r\n')
          const contentIndex = lines.findIndex(line => line === '')
          if (contentIndex !== -1) {
            const content = lines.slice(contentIndex + 1, -1).join('\r\n')
            audioBuffer = Buffer.from(content, 'binary')
            
            // Extract filename if present
            const filenameMatch = part.match(/filename="([^"]+)"/)
            if (filenameMatch) {
              fileName = filenameMatch[1]
            }
          }
          break
        }
      }

      if (!audioBuffer) {
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ error: 'No audio file provided' }),
        }
      }

      // Check file size (Netlify has 6MB limit)
      if (audioBuffer.length > 6 * 1024 * 1024) {
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ error: 'Audio file too large. Maximum size is 6MB.' }),
        }
      }

      // Start background processing
      processAudioInBackground(audioBuffer, fileName).catch(error => {
        console.error("Background processing error:", error)
      })

      // Return immediately with processing status
      return {
        statusCode: 202, // Accepted
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'processing',
          message: 'Audio processing started. Results will be available via webhook.',
          fileName: fileName,
          fileSize: audioBuffer.length
        }),
      }
    } catch (error) {
      console.error("Error starting background processing:", error)
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          error: "Failed to start audio processing",
          details: error.message
        }),
      }
    }
  }

  // Handle other HTTP methods
  return {
    statusCode: 405,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ error: 'Method not allowed' }),
  }
}

// Background processing function
async function processAudioInBackground(audioBuffer, fileName) {
  try {
    console.log("Starting background audio processing for:", fileName)
    
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

    // Generate enhanced analysis using Gemma 3N 4B (with timeout)
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
            (acc, curr) => {
              acc[curr.sentiment] = (acc[curr.sentiment] || 0) + curr.confidence
              return acc
            },
            {},
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

    // Create enhanced vCon object
    const vcon = createEnhancedVcon(transcript, audioUrl, fileName, businessIntelligence, summary, actionItems)

    // Format transcription with improved speaker identification
    const formattedTranscription = formatTranscriptionWithSpeakers(transcript)

    // Send results via webhook
    const results = {
      status: 'completed',
      transcription: formattedTranscription,
      summary: summary,
      actionItems: actionItems,
      sentiment,
      businessIntelligence: businessIntelligence,
      vcon,
      fileName: fileName,
      timestamp: new Date().toISOString()
    }

    console.log("Sending results via webhook...")
    await sendWebhook(results)
    console.log("Background processing completed successfully")

  } catch (error) {
    console.error("Background processing failed:", error)
    
    // Send error via webhook
    const errorResult = {
      status: 'error',
      error: error.message,
      fileName: fileName,
      timestamp: new Date().toISOString()
    }
    
    try {
      await sendWebhook(errorResult)
    } catch (webhookError) {
      console.error("Failed to send error webhook:", webhookError)
    }
  }
}

// Send webhook with results
async function sendWebhook(data) {
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`)
    }

    console.log("Webhook sent successfully")
  } catch (error) {
    console.error("Webhook error:", error)
    throw error
  }
} 