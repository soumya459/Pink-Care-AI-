 #PINK CARE AI 

An informational chatbot providing general, guideline-grounded information about breast cancer — symptoms, screening, terminology, and treatment types built with Googl(Gemini API, React frontend, Node.js server).

**This is not a diagnostic tool.** It does not evaluate individual symptoms, assess personal risk, or replace professional medical care. See [Scope & Safety Boundaries](#scope--safety-boundaries) below.

---

## Live App

https://ais-pre-ulmaam7d5aalchukvgcewt-364073590572.asia-southeast1.run.app


# Development  preview link

https://ais-dev-ulmaam7d5aalchukvgcewt-364073590572.asia-southeast1.run.app


---

## What it does

- Answers general questions about breast cancer symptoms, screening guidelines, risk factors, diagnostic procedures, treatment types, and terminology.
- Grounds answers in live web search (Gemini's `googleSearch` tool), with a preference for trusted medical sources (ACS, NCCN, NCI, WHO, CDC, Mayo Clinic, breastcancer.org).
- Displays source citations under responses where grounding returns results.
- Detects personal-symptom disclosures and emergency language, and routes those to guided, non-diagnostic responses that recommend clinical follow-up rather than reassurance or evaluation.
- Provides a persistent "Talk to a Person" escalation path and a Doctor Prep Sheet feature, visible at all times — not buried in the chat flow.

## What it deliberately does not do

- Does not diagnose or tell a user whether *their* symptom indicates cancer.
- Does not recommend specific drug dosages or personalized treatment plans.
- Does not reassure users away from seeking in-person care.
- Does not answer outside its scope (general topics unrelated to breast cancer are declined or redirected).

---

## Architecture

```
User message
    │
    ▼
Emergency/symptom pre-check (keyword + pattern match)
    │
    ├── Emergency indicators detected → hard-coded urgent-care /
    │   crisis-resource response (bypasses model generation)
    │
    └── Normal query → Gemini API call (server-side)
            │
            ├── Tool: googleSearch (live grounding)
            ├── System instruction: scope, safety rules, source
            │   preference, response formatting
            │
            ▼
        Response + groundingMetadata (citations)
            │
            ▼
        Parsed (JSON extraction from system-instructed format,
        handles markdown-fenced or freeform output) → rendered
        in chat UI with source links
```

**Stack:** React frontend, Node.js/TypeScript server (`server.ts`), Gemini API via `@google/genai` SDK, deployed via AI Studio's Cloud Run integration.

**API key handling:** `GEMINI_API_KEY` is stored server-side only, managed via the AI Studio Secrets panel (Settings → Secrets). Never exposed to client-side code.

---

## Scope & Safety Boundaries

Enforced via system instruction on every Gemini call:

- Answers only from established medical consensus sources; explicitly states uncertainty rather than guessing when grounding doesn't return a trusted-source result.
- Personal symptom disclosures get empathetic, general-category information plus a clear recommendation to see a clinician — never an evaluation of severity or likelihood.
- Emergency/crisis language is caught by a pre-check *before* the model generates a response, and returns a fixed message with urgent-care and crisis-resource guidance.
- Every response touching personal symptoms carries a visible "not medical advice" disclaimer.




-

## Roadmap / open items

- [ ] Clinician/patient-advocate review of guardrail responses against real transcripts
- [ ] Persistent conversation logging + feedback (thumbs up/down) for post-launch review
- [ ] Evaluate moving off free-tier quota to billing for stable testing
- [ ] Consider curated vector-DB RAG as an alternative/supplement to live search grounding for core guideline facts
