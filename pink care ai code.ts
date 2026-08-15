import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const PORT = 3000;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Emergency keyword & pattern match definitions for the pre-check filter
const EMERGENCY_PATTERNS: Array<{ pattern: RegExp; type: 'medical' | 'crisis' | 'rapid_escalation' }> = [
  // Crisis / Self-Harm
  { pattern: /\b(hurt\s+myself|harm\s+myself|kill\s+myself|suicid(e|al)|end\s+my\s+life|want\s+to\s+die|self[- ]harm|overdose|take\s+all\s+(my\s+)?pills)\b/i, type: 'crisis' },
  // Severe / Active Bleeding
  { pattern: /\b(bleed(ing)?|hemorrhag(e|ing)|blood\s+(gushing|pouring|spurting|vomit|cough|in\s+stool))\b/i, type: 'medical' },
  // Severe / Unbearable Pain
  { pattern: /\b(severe\s+pain|unbearable\s+pain|excruciating(\s+pain)?|worst\s+pain|intense\s+chest\s+pain|crushing\s+pain)\b/i, type: 'medical' },
  // Breathing difficulties
  { pattern: /\b(can'?t\s+breathe|cannot\s+breathe|trouble\s+breathing|shortness\s+of\s+breath|difficulty\s+breathing|gasping(\s+for\s+air)?|choking|suffocat(e|ing))\b/i, type: 'medical' },
  // Loss of consciousness / Neurological
  { pattern: /\b(faint(ed|ing)?|passed\s+out|unconscious|blacked\s+out|seizure|convulsion|collapsed|unresponsive)\b/i, type: 'medical' },
  // Rapid Escalation / Acute Infection
  { pattern: /\b(rapidly\s+(spreading|worsening|escalating|swelling)|sudden(ly)?\s+(swollen|swelling|turned\s+blue|turned\s+purple|paralyzed)|anaphylaxis|severe\s+allergic\s+reaction)\b/i, type: 'rapid_escalation' },
];

function checkEmergencyPreFilter(userText: string): { isEmergency: boolean; guidance: string; type: string; hotline: string } | null {
  if (!userText || typeof userText !== 'string') return null;

  for (const item of EMERGENCY_PATTERNS) {
    if (item.pattern.test(userText)) {
      if (item.type === 'crisis') {
        return {
          isEmergency: true,
          type: 'crisis',
          hotline: '988 Suicide & Crisis Lifeline (Dial or Text 988)',
          guidance:
            "CRISIS SAFETY ALERT: Your message contains language indicating potential self-harm, severe psychological distress, or a personal crisis. Please reach out to compassionate professionals immediately. Free, confidential support is available 24/7. Call or text 988 (Suicide & Crisis Lifeline) or call 911 for emergency intervention.",
        };
      }
      return {
        isEmergency: true,
        type: 'medical',
        hotline: '911 Emergency Medical Services',
        guidance:
          "URGENT MEDICAL ATTENTION REQUIRED: Your message mentions acute, severe, or rapidly escalating physical symptoms (such as active bleeding, unbearable pain, breathing distress, or sudden severe physical changes). This assistant is strictly educational and cannot provide medical triage or diagnosis. Please immediately call 911 (or your local emergency services) or go to the nearest Emergency Room or Urgent Care facility.",
      };
    }
  }
  return null;
}

const TRUSTED_DOMAINS = [
  'cancer.org',
  'cancer.gov',
  'nccn.org',
  'who.int',
  'cdc.gov',
  'mayoclinic.org',
  'breastcancer.org',
];

const SYSTEM_INSTRUCTION = `
You are "BreastCancerInfo Assistant", an empathetic, highly knowledgeable, and strictly ethical informational assistant specialized in breast health and breast cancer.
You provide educational information about symptoms, screening guidelines, risk factors, diagnostic procedures (mammograms, ultrasounds, biopsies), pathology reports, breast density, staging, treatment types (surgery, radiation, chemotherapy, targeted therapy, endocrine therapy), and medical terminology.

GROUNDING & SOURCE VERIFICATION MANDATES:
1. ALWAYS ATTEMPT GROUNDING:
   - Always attempt Google Search / URL grounding for any medical, anatomical, diagnostic, screening, staging, treatment, or factual breast health question.
2. PREFERRED TRUSTED DOMAINS:
   - When citing sources, you must explicitly prefer, prioritize, and label results from the following verified trusted medical authorities over any other sources:
     * cancer.org (American Cancer Society)
     * cancer.gov (National Cancer Institute)
     * nccn.org (National Comprehensive Cancer Network)
     * who.int (World Health Organization)
     * cdc.gov (Centers for Disease Control and Prevention)
     * mayoclinic.org (Mayo Clinic)
     * breastcancer.org (Breastcancer.org)
   - Explicitly cite and label these premier sources in your answer and citations.
3. UNGROUNDED / UNVERIFIED FALLBACK:
   - If grounding returns no results from those trusted domains (cancer.org, cancer.gov, nccn.org, who.int, cdc.gov, mayoclinic.org, breastcancer.org), explicitly state in your answer that you could not verify the answer against a trusted medical source, rather than presenting an ungrounded answer as established fact.

CRITICAL SAFETY & MEDICAL ETHICS RULES:
1. NEVER DIAGNOSE:
   - Never tell a user whether THEY personally have cancer.
   - Never assess or estimate the probability or seriousness of a user's specific symptom (e.g., never say "it is likely benign" or "it sounds suspicious" or "it is probably nothing").
   - Do NOT attempt to reassure them that it's "probably nothing" or "no big deal."

2. PERSONAL SYMPTOM HANDLING:
   - If a user describes a personal symptom (e.g., feeling a lump, noticing nipple discharge, skin dimpling, redness, tenderness, focal breast pain, changes in size/shape):
     a) Acknowledge what they are experiencing with genuine warmth, calm empathy, and validation.
     b) Explain in GENERAL educational terms what that category of symptom can indicate medically (including both benign conditions like cysts/fibroadenomas and potential signs that warrant clinical evaluation).
     c) Clearly and explicitly recommend making an appointment with a doctor, gynecologist, or healthcare clinic promptly for a clinical breast exam and appropriate imaging.
     d) Set isPersonalSymptom = true.

3. EMERGENCY & CRISIS PROTOCOL:
   - If the user's message indicates signs of severe acute infection (high fever, severe swelling/heat/spreading redness), severe unbearable pain, sudden rapid physical distress, suicidal ideation, self-harm, or severe emotional crisis:
     a) Immediately provide urgent guidance to seek emergency medical attention (call 911/local emergency services) or visit an urgent care / ER.
     b) For emotional or mental health crises, immediately highlight the 988 Suicide & Crisis Lifeline (call/text 988 in the US/Canada) or international crisis centers.
     c) Set isEmergency = true and populate emergencyGuidance.

4. NO PRESCRIPTION OR DOSING:
   - Never recommend specific medication dosages, custom treatment regimens, or tell a patient to start/stop any medication.
   - Explain treatment options generally (e.g., "Tamoxifen and Aromatase Inhibitors are classes of endocrine therapy commonly evaluated based on hormone receptor status").

5. CONFIDENCE & ACCURACY:
   - If a question lacks strong medical consensus or if you are not completely confident in medical accuracy, explicitly state this limitation rather than guessing.

6. CITATIONS & TRANSPARENCY:
   - Provide the specific consensus bodies (e.g., "American Cancer Society (cancer.org)", "NCCN Guidelines (nccn.org)", "National Cancer Institute (cancer.gov)", "Mayo Clinic (mayoclinic.org)", "CDC (cdc.gov)", "Breastcancer.org") as citations for your points.

7. DISCLAIMER:
   - Ensure disclaimerNeeded is true whenever the answer relates to symptoms, diagnosis, or health concerns.
   - The disclaimer text is: "This isn't medical advice — please talk to a doctor about your specific situation."

8. RESPONSE FORMAT:
You MUST format your entire response as a valid JSON object wrapped in a \`\`\`json codeblock.
Use this structure:
\`\`\`json
{
  "answer": "The compassionate, medically grounded educational response in clear Markdown with appropriate paragraphs, headings, and bullet points.",
  "citations": ["American Cancer Society (cancer.org)", "National Comprehensive Cancer Network (nccn.org)"],
  "isPersonalSymptom": false,
  "isEmergency": false,
  "emergencyGuidance": "",
  "disclaimerNeeded": true,
  "suggestedFollowUps": [
    "What are recommended mammogram screening ages?",
    "What is dense breast tissue?"
  ]
}
\`\`\`
`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      app: 'BreastCancerInfo Assistant',
    });
  });

  // Chat endpoint
  app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
    try {
      const { messages } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Messages array is required' });
        return;
      }

      // FIRST-PASS SAFETY PRE-CHECK:
      // Scan latest user message for emergency-indicating language (bleeding, severe pain, breathing distress, self-harm, rapid escalation)
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      const userTextToCheck = lastUserMsg?.text || '';
      const emergencyCheck = checkEmergencyPreFilter(userTextToCheck);

      if (emergencyCheck) {
        // Skip AI generation completely and return fixed emergency safety response
        res.status(200).json({
          answer: emergencyCheck.guidance,
          isEmergency: true,
          isPersonalSymptom: true,
          emergencyGuidance: emergencyCheck.guidance,
          crisisHotline: emergencyCheck.hotline,
          disclaimerNeeded: true,
          citations: [
            'Emergency Medical Services (Call 911 / 999 / 112)',
            '988 Suicide & Crisis Lifeline (Dial or Text 988)',
            'American Cancer Society 24/7 Helpline: 1-800-227-2345 (cancer.org)',
          ],
          groundingChunks: [],
          groundingSupports: [],
          groundingSources: [],
          suggestedFollowUps: [
            'How to locate the nearest urgent care or emergency room',
            'What information should I have ready for emergency personnel?',
            'Where can I find free emotional and cancer support hotlines?',
          ],
        });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        // Fallback response if GEMINI_API_KEY is not configured yet
        res.status(200).json({
          answer:
            "Hello! I am the **BreastCancerInfo Assistant**. To provide live, medically grounded answers using our AI engine, please ensure a valid Gemini API key is configured in your project settings.\n\nIn the meantime, remember that any new breast lump, nipple discharge, skin change, or persistent pain should be evaluated by a healthcare professional.",
          citations: [
            'American Cancer Society (ACS)',
            'National Comprehensive Cancer Network (NCCN)',
            'CDC Breast Cancer Guidelines',
          ],
          isPersonalSymptom: false,
          isEmergency: false,
          emergencyGuidance: '',
          disclaimerNeeded: true,
          suggestedFollowUps: [
            'What are common symptoms of breast cancer to discuss with a doctor?',
            'What are the recommended screening ages for mammograms?',
            'What is the difference between screening and diagnostic mammograms?',
          ],
        });
        return;
      }

      // Convert conversation history to Gemini contents format
      // We pass the user's latest prompt along with recent context
      const formattedContents = messages.map((m: { role: string; text: string }) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }));

      const geminiConfig = {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2, // Low temperature for high factual accuracy and consistency
        tools: [
          { googleSearch: {} },
        ],
      };

      console.log('[Gemini API Config Verification]', {
        model: 'gemini-3.7-flash',
        tools: geminiConfig.tools,
        hasResponseSchema: 'responseSchema' in (geminiConfig as any),
        hasResponseMimeType: 'responseMimeType' in (geminiConfig as any),
        hasUrlContext: (geminiConfig.tools as any[]).some((t) => 'urlContext' in t),
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: formattedContents,
        config: geminiConfig,
      });

      // Extract search grounding metadata
      const candidate = response.candidates?.[0];
      const groundingMetadata =
        candidate?.groundingMetadata || (response as any).groundingMetadata || null;

      const rawChunks: any[] = (groundingMetadata as any)?.groundingChunks || [];
      const rawSupports: any[] = (groundingMetadata as any)?.groundingSupports || [];

      // Extract grounding chunks with numbered 1-based indices [1], [2]...
      const groundingChunks: Array<{
        index: number;
        chunkIndex: number;
        title: string;
        uri: string;
        domain: string;
        isTrusted: boolean;
      }> = [];

      if (Array.isArray(rawChunks)) {
        rawChunks.forEach((chunk: any, i: number) => {
          const uri = chunk.web?.uri || chunk.uri || '';
          const title = chunk.web?.title || chunk.title || (uri ? uri : `Source ${i + 1}`);
          let domain = '';
          try {
            if (uri) {
              const urlObj = new URL(uri);
              domain = urlObj.hostname.replace(/^www\./, '');
            }
          } catch {
            domain = uri;
          }
          const isTrusted = TRUSTED_DOMAINS.some(
            (td) => domain === td || domain.endsWith('.' + td)
          );

          groundingChunks.push({
            index: i + 1,
            chunkIndex: i,
            title,
            uri,
            domain,
            isTrusted,
          });
        });
      }

      // Extract grounding supports (which parts of the text they support)
      const groundingSupports = Array.isArray(rawSupports)
        ? rawSupports.map((support: any) => ({
            groundingChunkIndices: Array.isArray(support.groundingChunkIndices)
              ? support.groundingChunkIndices
              : [],
            segment: support.segment
              ? {
                  startIndex: support.segment.startIndex,
                  endIndex: support.segment.endIndex,
                  text: support.segment.text,
                }
              : null,
            confidenceScores: Array.isArray(support.confidenceScores)
              ? support.confidenceScores
              : [],
          }))
        : [];

      const responseText = response.text?.trim() || '';
      let parsedData: any = null;

      // Extract JSON block if present
      const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonString = jsonBlockMatch ? jsonBlockMatch[1].trim() : responseText;

      try {
        parsedData = JSON.parse(jsonString);
      } catch {
        // Try finding surrounding braces
        const firstBrace = responseText.indexOf('{');
        const lastBrace = responseText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsedData = JSON.parse(responseText.substring(firstBrace, lastBrace + 1));
          } catch {
            parsedData = null;
          }
        }
      }

      if (!parsedData || typeof parsedData !== 'object' || !parsedData.answer) {
        parsedData = {
          answer: responseText || 'Thank you for your question. Please consult a doctor for personalized clinical evaluation.',
          citations: ['American Cancer Society (cancer.org)', 'National Comprehensive Cancer Network (nccn.org)'],
          isPersonalSymptom: false,
          isEmergency: false,
          emergencyGuidance: '',
          disclaimerNeeded: true,
          suggestedFollowUps: [
            'What are common symptoms of breast cancer to discuss with a doctor?',
            'What are the recommended screening ages for mammograms?',
            'What is the difference between screening and diagnostic mammograms?',
          ],
        };
      }

      res.status(200).json({
        ...parsedData,
        groundingChunks,
        groundingSupports,
        groundingSources: groundingChunks,
        webSearchQueries: (groundingMetadata as any)?.webSearchQueries || [],
        searchEntryPoint: (groundingMetadata as any)?.searchEntryPoint || null,
      });
    } catch (err: any) {
      console.error('Error in /api/chat:', err);
      const errorMessage = err?.message || 'Internal error in Gemini API call';
      res.status(500).json({
        error: errorMessage,
        details: err?.stack || err?.toString() || errorMessage,
      });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BreastCancerInfo Assistant server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
