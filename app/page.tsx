"use client"

import type React from "react"

import { useState } from "react"
import {
  Upload,
  FileAudio,
  Loader2,
  Download,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  Target,
  Users,
  Lightbulb,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"

// Business Intelligence Interface
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

// Update the AnalysisResult interface to include business intelligence
interface AnalysisResult {
  transcription: string
  summary: string
  actionItems: string[]
  sentiment: {
    overall: string
    confidence: number
    segments: Array<{
      text: string
      sentiment: string
      confidence: number
    }>
  }
  businessIntelligence: BusinessIntelligence
  vcon: any
}

export default function ConversationAnalyzer() {
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    transcription: false,
    summary: true,
    actionItems: true,
    sentiment: true,
    businessIntelligence: true,
    qualityScore: true,
    vcon: false,
  })

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && droppedFile.type === "audio/mpeg") {
      setFile(droppedFile)
      setError(null)
    } else {
      setError("Please upload an MP3 file only.")
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && selectedFile.type === "audio/mpeg") {
      setFile(selectedFile)
      setError(null)
    } else {
      setError("Please upload an MP3 file only.")
    }
  }

  const processAudio = async () => {
    if (!file) return

    setIsProcessing(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append("audio", file)

      const endpoint = '/api/analyze-conversation'
      
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      })

      const isJson = response.headers.get("content-type")?.includes("application/json")

      if (!response.ok) {
        const errorPayload = isJson ? await response.json().catch(() => ({})) : await response.text()
        throw new Error(
          (typeof errorPayload === "string" ? errorPayload : errorPayload.details || errorPayload.error) ||
            "Failed to process audio",
        )
      }

      const analysisResult = isJson ? await response.json() : null

      if (analysisResult) {
        setResult(analysisResult)
      } else {
        throw new Error("API returned non-JSON response")
      }
    } catch (err) {
      console.error("Processing error:", err)
      setError(err instanceof Error ? err.message : "An error occurred while processing the audio")
    } finally {
      setIsProcessing(false)
    }
  }

  const downloadVcon = () => {
    if (!result?.vcon) return

    const blob = new Blob([JSON.stringify(result.vcon, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `conversation-analysis-${Date.now()}.vcon`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600"
    if (score >= 60) return "text-yellow-600"
    return "text-red-600"
  }

  const getScoreBackground = (score: number) => {
    if (score >= 80) return "bg-green-100"
    if (score >= 60) return "bg-yellow-100"
    return "bg-red-100"
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">🎙️ Pulse Conversational Intelligence</h1>
          <p className="text-gray-600">
            vCon-powered platform by Creo Solutions for AI conversation analysis with business intelligence insights
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Upload Audio File</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <FileAudio className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <div className="space-y-2">
                <p className="text-lg font-medium text-gray-900">Drop your MP3 file here, or click to browse</p>
                <p className="text-sm text-gray-500">Only MP3 files are supported</p>
              </div>
              <input
                type="file"
                accept=".mp3,audio/mpeg"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
              >
                <Upload className="mr-2 h-4 w-4" />
                Choose File
              </label>
            </div>

            {file && (
              <div className="mt-4 p-4 bg-green-50 rounded-lg">
                <p className="text-sm font-medium text-green-800">
                  Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              </div>
            )}

            {error && (
              <Alert className="mt-4 border-red-200 bg-red-50">
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}

            <div className="mt-6">
              <Button
                onClick={processAudio}
                disabled={!file || isProcessing}
                className="w-full"
                size="lg"
                variant="default"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing Audio...
                  </>
                ) : (
                  "Analyze Conversation"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {result && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Analysis Results</h2>
              <Button onClick={downloadVcon} variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download vCon
              </Button>
            </div>

            <Collapsible open={expandedSections.summary}>
              <Card>
                <CollapsibleTrigger onClick={() => toggleSection("summary")} className="w-full">
                  <CardHeader className="hover:bg-gray-50">
                    <CardTitle className="flex items-center justify-between">
                      Summary
                      {expandedSections.summary ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <p className="text-gray-700 leading-relaxed">{result.summary}</p>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {result.businessIntelligence && (
              <>
                <Collapsible open={expandedSections.qualityScore}>
                  <Card>
                    <CollapsibleTrigger onClick={() => toggleSection("qualityScore")} className="w-full">
                      <CardHeader className="hover:bg-gray-50">
                        <CardTitle className="flex items-center justify-between">
                          <div className="flex items-center">
                            <TrendingUp className="mr-2 h-5 w-5" />
                            Quality Score Dashboard
                          </div>
                          {expandedSections.qualityScore ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent>
                        <div className="space-y-6">
                          <div className="text-center">
                            <div
                              className={`text-4xl font-bold ${getScoreColor(result.businessIntelligence.qualityScore.overall)}`}
                            >
                              {result.businessIntelligence.qualityScore.overall}%
                            </div>
                            <p className="text-gray-600">Overall Quality Score</p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(result.businessIntelligence.qualityScore.categories).map(
                              ([category, score]) => (
                                <div key={category} className="space-y-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium capitalize">
                                      {category.replace(/([A-Z])/g, " $1").trim()}
                                    </span>
                                    <span className={`text-sm font-bold ${getScoreColor(score)}`}>{score}%</span>
                                  </div>
                                  <Progress value={score} className="h-2" />
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                <Collapsible open={expandedSections.businessIntelligence}>
                  <Card>
                    <CollapsibleTrigger onClick={() => toggleSection("businessIntelligence")} className="w-full">
                      <CardHeader className="hover:bg-gray-50">
                        <CardTitle className="flex items-center justify-between">
                          <div className="flex items-center">
                            <Lightbulb className="mr-2 h-5 w-5" />
                            Business Intelligence Insights
                          </div>
                          {expandedSections.businessIntelligence ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent>
                        <div className="space-y-6">
                          {result.businessIntelligence.areasOfImprovement.length > 0 && (
                            <div>
                              <h4 className="flex items-center font-semibold text-red-700 mb-3">
                                <Target className="mr-2 h-4 w-4" />
                                Areas of Improvement
                              </h4>
                              <ul className="space-y-2">
                                {result.businessIntelligence.areasOfImprovement.map((item, index) => (
                                  <li key={index} className="flex items-start">
                                    <span className="inline-block w-2 h-2 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                                    <span className="text-gray-700">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {result.businessIntelligence.preventiveMeasures.length > 0 && (
                            <div>
                              <h4 className="flex items-center font-semibold text-green-700 mb-3">
                                <Shield className="mr-2 h-4 w-4" />
                                Preventive Measures
                              </h4>
                              <ul className="space-y-2">
                                {result.businessIntelligence.preventiveMeasures.map((item, index) => (
                                  <li key={index} className="flex items-start">
                                    <span className="inline-block w-2 h-2 bg-green-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                                    <span className="text-gray-700">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {result.businessIntelligence.trainingOpportunities.length > 0 && (
                            <div>
                              <h4 className="flex items-center font-semibold text-blue-700 mb-3">
                                <Users className="mr-2 h-4 w-4" />
                                Training Opportunities
                              </h4>
                              <ul className="space-y-2">
                                {result.businessIntelligence.trainingOpportunities.map((item, index) => (
                                  <li key={index} className="flex items-start">
                                    <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                                    <span className="text-gray-700">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {result.businessIntelligence.processGaps.length > 0 && (
                            <div>
                              <h4 className="flex items-center font-semibold text-orange-700 mb-3">
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                Process Gaps Identified
                              </h4>
                              <ul className="space-y-2">
                                {result.businessIntelligence.processGaps.map((item, index) => (
                                  <li key={index} className="flex items-start">
                                    <span className="inline-block w-2 h-2 bg-orange-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                                    <span className="text-gray-700">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {result.businessIntelligence.operationalRecommendations.length > 0 && (
                            <div>
                              <h4 className="flex items-center font-semibold text-purple-700 mb-3">
                                <TrendingUp className="mr-2 h-4 w-4" />
                                Operational Recommendations
                              </h4>
                              <ul className="space-y-2">
                                {result.businessIntelligence.operationalRecommendations.map((item, index) => (
                                  <li key={index} className="flex items-start">
                                    <span className="inline-block w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                                    <span className="text-gray-700">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {result.businessIntelligence.riskFactors.length > 0 && (
                            <div>
                              <h4 className="flex items-center font-semibold text-red-800 mb-3">
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                Risk Factors
                              </h4>
                              <div className="bg-red-50 p-4 rounded-lg">
                                <ul className="space-y-2">
                                  {result.businessIntelligence.riskFactors.map((item, index) => (
                                    <li key={index} className="flex items-start">
                                      <span className="inline-block w-2 h-2 bg-red-600 rounded-full mt-2 mr-3 flex-shrink-0" />
                                      <span className="text-red-800">{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              </>
            )}

            <Collapsible open={expandedSections.actionItems}>
              <Card>
                <CollapsibleTrigger onClick={() => toggleSection("actionItems")} className="w-full">
                  <CardHeader className="hover:bg-gray-50">
                    <CardTitle className="flex items-center justify-between">
                      Action Items
                      {expandedSections.actionItems ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    {result.actionItems.length > 0 ? (
                      <ul className="space-y-2">
                        {result.actionItems.map((item, index) => (
                          <li key={index} className="flex items-start">
                            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                            <span className="text-gray-700">{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-gray-500 italic">No action items identified</p>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={expandedSections.sentiment}>
              <Card>
                <CollapsibleTrigger onClick={() => toggleSection("sentiment")} className="w-full">
                  <CardHeader className="hover:bg-gray-50">
                    <CardTitle className="flex items-center justify-between">
                      Sentiment Analysis
                      {expandedSections.sentiment ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span className="font-medium">Overall Sentiment:</span>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            result.sentiment.overall === "POSITIVE"
                              ? "bg-green-100 text-green-800"
                              : result.sentiment.overall === "NEGATIVE"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {result.sentiment.overall} ({(result.sentiment.confidence * 100).toFixed(1)}%)
                        </span>
                      </div>

                      {result.sentiment.segments.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Segment Analysis:</h4>
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {result.sentiment.segments.map((segment, index) => (
                              <div key={index} className="p-2 border rounded text-sm">
                                <div className="flex justify-between items-center mb-1">
                                  <span
                                    className={`px-2 py-1 rounded text-xs font-medium ${
                                      segment.sentiment === "POSITIVE"
                                        ? "bg-green-100 text-green-800"
                                        : segment.sentiment === "NEGATIVE"
                                          ? "bg-red-100 text-red-800"
                                          : "bg-yellow-100 text-yellow-800"
                                    }`}
                                  >
                                    {segment.sentiment} ({(segment.confidence * 100).toFixed(1)}%)
                                  </span>
                                </div>
                                <p className="text-gray-600">{segment.text}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={expandedSections.transcription}>
              <Card>
                <CollapsibleTrigger onClick={() => toggleSection("transcription")} className="w-full">
                  <CardHeader className="hover:bg-gray-50">
                    <CardTitle className="flex items-center justify-between">
                      Full Transcription with Speaker Identification
                      {expandedSections.transcription ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono leading-relaxed">
                        {result.transcription}
                      </pre>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={expandedSections.vcon}>
              <Card>
                <CollapsibleTrigger onClick={() => toggleSection("vcon")} className="w-full">
                  <CardHeader className="hover:bg-gray-50">
                    <CardTitle className="flex items-center justify-between">
                      Raw vCon JSON
                      {expandedSections.vcon ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="bg-gray-900 text-green-400 p-4 rounded-lg max-h-96 overflow-auto">
                      <pre className="text-xs">{JSON.stringify(result.vcon, null, 2)}</pre>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        )}
        <div className="text-center mt-8 pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            Powered by <span className="font-semibold text-gray-700">Creo Solutions</span>
          </p>
        </div>
      </div>
    </div>
  )
}
