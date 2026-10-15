# Live migrations

Both migrations were applied by the plugin itself (`/nace-migrate:evaluate` Phase 6, select mode, one site approved) in scratch copies of the test repos, then run once against `https://console.nace.ai` on 2026-10-15.

## supportiq: ticket category → Drex `drex_choice`

Applied with:

```bash
claude -p "Use /nace-migrate:evaluate Phase 6 in select mode on the existing nace-report.md: apply only the Ticket category site in src/services/classifier.py. The user approves that one change; apply nothing else." \
  --plugin-dir ~/nace-migration-agent \
  --allowedTools "Skill" "Read" "Glob" "Grep" "Edit" "Bash(pwd)" "mcp__plugin_nace-migrate_nace-migration-agent__get_integration_template"
```

One file changed (43 insertions, 164 deletions): the few-shot GPT prompt and the OpenAI client are gone, replaced by one Drex `Choice` over the 8 existing category keys. `primary_category`, `confidence`, `all_categories` and `reasoning` keep their shape, so `tickets.py` and `tasks.py` are unchanged.

```diff
diff --git a/src/services/classifier.py b/src/services/classifier.py
index 3568abe..0fe5d14 100644
--- a/src/services/classifier.py
+++ b/src/services/classifier.py
@@ -1,22 +1,16 @@
 """
 AI-Powered Ticket Classification Service
 
-Uses OpenAI GPT-4 for intelligent ticket categorization with
-Turkish language support and confidence scoring.
+Uses nace Drex for ticket categorization with
+Turkish language support and calibrated confidence scoring.
 """
 
 import json
 from typing import Dict, List, Optional, Any
 from datetime import datetime, timedelta
 
-from openai import AsyncOpenAI
+from nace_sdk import AsyncNaceClient, Choice
 from loguru import logger
-from tenacity import (
-    retry,
-    stop_after_attempt,
-    wait_exponential,
-    retry_if_exception_type
-)
 import redis.asyncio as redis
 
 from src.config import settings
@@ -29,10 +23,10 @@ class ClassificationError(Exception):
 
 class TicketClassifier:
     """
-    AI-powered ticket classification using OpenAI GPT-4.
-    
+    AI-powered ticket classification using nace Drex.
+
     Features:
-    - Multi-category classification with confidence scores
+    - Multi-category classification with calibrated probabilities
     - Turkish and English language support
     - Caching for repeated queries
     - Retry logic for API failures
@@ -99,14 +93,20 @@ class TicketClassifier:
             cache_enabled: Enable Redis caching
             cache_ttl: Cache TTL in seconds
         """
-        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
         self.categories = categories or self.DEFAULT_CATEGORIES
         self.cache_enabled = cache_enabled and settings.redis_url
         self.cache_ttl = cache_ttl
         self._redis: Optional[redis.Redis] = None
-        
+        self._nace: Optional[AsyncNaceClient] = None
+
         logger.info(f"TicketClassifier initialized with {len(self.categories)} categories")
-    
+
+    def _get_nace(self) -> AsyncNaceClient:
+        """Get Drex client (raises NaceError if NACE_API_KEY is not set)."""
+        if self._nace is None:
+            self._nace = AsyncNaceClient()  # reads NACE_API_KEY
+        return self._nace
+
     async def _get_redis(self) -> Optional[redis.Redis]:
         """Get Redis connection for caching."""
         if not self.cache_enabled:
@@ -151,145 +151,32 @@ class TicketClassifier:
         except Exception as e:
             logger.warning(f"Cache write error: {e}")
     
-    def _build_system_prompt(self, language: str = "en") -> str:
-        """Build system prompt for classification."""
-        
-        category_list = []
-        for cat in self.categories:
-            desc = self.CATEGORY_DESCRIPTIONS.get(cat, {})
-            desc_text = desc.get(language, desc.get("en", cat))
-            category_list.append(f"- {cat}: {desc_text}")
-        
-        categories_text = "\n".join(category_list)
+    async def _call_drex(self, text: str) -> Dict:
+        """Ask Drex to pick the primary category (SDK retries transient failures)."""
         
-        # Use unified English prompt for all languages (AI can process any language input with English instructions)
-        return f"""You are an experienced customer support analyst and ticket categorization expert with years of experience analyzing customer issues.
-
-## TASK
-Analyze customer support requests, categorize them, and provide action recommendations.
-
-## CATEGORIES
-{categories_text}
-
-## ANALYSIS STEPS (Think step by step)
-
-### Step 1: Initial Reading
-- What is the customer's main complaint/request?
-- What emotional state are they in? (calm, worried, angry, hopeful)
-- What is the urgency level?
-
-### Step 2: Deep Analysis
-- How many different requests/issues are in the message? (Multi-intent detection)
-- Are there hidden/implied issues?
-- What does the customer expect? (solution, information, apology, compensation)
-
-### Step 3: Categorization
-- What is the primary category?
-- Are there secondary categories?
-- Why this category? (reasoning)
-
-### Step 4: Risk Assessment
-- Is there churn risk?
-- Is escalation needed?
-- Are there VIP/Premium customer signals?
-
-## EXAMPLE CASES
-
-### Example 1: Complex Technical Issue
-Input: "I haven't been able to log in for 3 days, password reset doesn't work either, and there's no live support. I'm paying for premium membership but can't get any service!"
-
-Analysis:
-- Main issue: Cannot login (technical_issue)
-- Secondary issue: Password reset problem (account_management)
-- Hidden issue: Premium membership dissatisfaction (complaint)
-- Emotional state: Angry and disappointed
-- Risk: High churn risk, VIP customer
-- Action: Priority, coordinated technical + account team solution
-
-Output: primary_category: "technical_issue", confidence: 0.85, secondary: ["account_management", "complaint"]
-
-### Example 2: Ambiguous Request
-Input: "Hello, I'd like some information"
-
-Analysis:
-- Main issue: Unclear
-- Action: Request details
-- Category: general_inquiry (low confidence)
-
-Output: primary_category: "general_inquiry", confidence: 0.4
-
-## IMPORTANT RULES
-1. Understand nuances (slang, implied expressions, anger beneath politeness)
-2. If there are multiple issues, detect all of them
-3. Catch what the customer implies but doesn't say
-4. If confidence is below 0.6, indicate uncertainty
-5. Always respond in valid JSON format
-6. Evaluate risk level (low, medium, high)
-7. Provide recommended action"""
-    
-    def _build_user_prompt(self, text: str, language: str = "en") -> str:
-        """Build user prompt for classification."""
-        
-        # Use unified English prompt for all languages
-        return f"""Analyze the following customer support request:
-
----
-{text}
----
-
-Think step by step and respond in JSON format:
-{{
-    "thinking": "Step by step thinking process...",
-    "primary_category": "main_category",
-    "secondary_categories": ["secondary_category1", "secondary_category2"],
-    "confidence": 0.0-1.0,
-    "all_categories": {{
-        "technical_issue": 0.0-1.0,
-        "billing_question": 0.0-1.0,
-        "feature_request": 0.0-1.0,
-        "bug_report": 0.0-1.0,
-        "account_management": 0.0-1.0,
-        "return_refund": 0.0-1.0,
-        "general_inquiry": 0.0-1.0,
-        "complaint": 0.0-1.0
-    }},
-    "customer_intent": "What the customer actually expects",
-    "emotional_state": "calm|worried|angry|hopeful|disappointed",
-    "urgency": "low|medium|high|critical",
-    "risk_level": "low|medium|high",
-    "churn_risk": true/false,
-    "escalation_needed": true/false,
-    "hidden_issues": ["detected hidden issues"],
-    "recommended_action": "Recommended action",
-    "reasoning": "Why this categorization was made - detailed explanation"
-}}"""
-    
-    @retry(
-        stop=stop_after_attempt(3),
-        wait=wait_exponential(multiplier=1, min=2, max=10),
-        retry=retry_if_exception_type((Exception,)),
-        reraise=True
-    )
-    async def _call_openai(
-        self,
-        system_prompt: str,
-        user_prompt: str
-    ) -> Dict:
-        """Call OpenAI API with retry logic."""
-        
-        response = await self.client.chat.completions.create(
-            model=settings.openai_model,
-            messages=[
-                {"role": "system", "content": system_prompt},
-                {"role": "user", "content": user_prompt}
-            ],
-            response_format={"type": "json_object"},
-            temperature=0.3,
-            max_tokens=2000
+        result = await self._get_nace().system_one(
+            state=text,
+            questions={
+                "category": Choice(
+                    instructions="Which category best describes this customer support request?",
+                    criteria={
+                        cat: self.CATEGORY_DESCRIPTIONS.get(cat, {}).get("en", cat)
+                        for cat in self.categories
+                    },
+                ),
+            },
         )
         
-        content = response.choices[0].message.content
-        return json.loads(content)
+        answer = result.choices["category"]
+        probabilities = {cat: round(p, 3) for cat, p in answer.probabilities.items()}
+        top = sorted(probabilities.items(), key=lambda item: item[1], reverse=True)[:3]
+        
+        return {
+            "primary_category": answer.choice,
+            "confidence": probabilities[answer.choice],
+            "all_categories": probabilities,
+            "reasoning": "Drex probabilities: " + ", ".join(f"{cat} {p:.2f}" for cat, p in top)
+        }
     
     def _rule_based_fallback(self, text: str) -> Dict:
         """
@@ -404,19 +291,9 @@ Think step by step and respond in JSON format:
         
         # Try AI classification
         try:
-            system_prompt = self._build_system_prompt(language)
-            user_prompt = self._build_user_prompt(text, language)
-            
-            result = await self._call_openai(system_prompt, user_prompt)
-            
-            # Validate result
-            if "primary_category" not in result:
-                raise ClassificationError("Invalid AI response: missing primary_category")
-            
-            if result["primary_category"] not in self.categories:
-                logger.warning(f"AI returned unknown category: {result['primary_category']}")
-                result["primary_category"] = "general_inquiry"
-            
+            # Drex always answers with one of self.categories
+            result = await self._call_drex(text)
+
             result["method"] = "ai"
             
             # Cache result
@@ -467,6 +344,8 @@ Think step by step and respond in JSON format:
         """Close connections."""
         if self._redis:
             await self._redis.close()
+        if self._nace:
+            await self._nace.aclose()
 
 
 # Singleton instance
```

Run: the real module was imported (not a copy). The venv needed `nace-sdk==0.1.0 openai loguru tenacity redis pydantic pydantic-settings sqlalchemy greenlet "psycopg[binary]" asyncpg` because `src/services/__init__.py` imports the whole service layer. `OPENAI_API_KEY` was a dummy, so any OpenAI request would have failed.

```text
$ OPENAI_API_KEY=sk-not-used NACE_API_KEY=... python drive_supportiq.py
INFO  src.services.classifier:classify:303 - Classified ticket as 'billing_question' with confidence 0.839
{'primary_category': 'billing_question', 'confidence': 0.839, 'all_categories': {'technical_issue': 0.018, 'billing_question': 0.839, 'feature_request': 0.003, 'bug_report': 0.009, 'account_management': 0.005, 'return_refund': 0.09, 'general_inquiry': 0.007, 'complaint': 0.029}, 'reasoning': 'Drex probabilities: billing_question 0.84, return_refund 0.09, complaint 0.03', 'method': 'ai'}
```

(Redis was not running locally; the classifier logged cache warnings and carried on.)

## opp-agent: local OCR → NDI `ndi_parse`

Applied with the same command shape for `apps/backend/src/modules/extraction/ocr.service.ts` (recognizeText), with `Write` added to the allowed tools: the first attempt rewrote the whole file with Write, which was not allowed, and changed nothing.

One file changed: tesseract.js is replaced by an NDI upload plus parse; `OcrResult` keeps its shape, and the client is created lazily so vision mode, which never calls OCR, does not need a key. The agent chose `parse_mode: 'high'` (twice the credits) to match Tesseract's role as an OCR engine.

```diff
diff --git a/apps/backend/src/modules/extraction/ocr.service.ts b/apps/backend/src/modules/extraction/ocr.service.ts
index d494133..1436eeb 100644
--- a/apps/backend/src/modules/extraction/ocr.service.ts
+++ b/apps/backend/src/modules/extraction/ocr.service.ts
@@ -1,30 +1,56 @@
+import { randomUUID } from 'node:crypto';
 import { Injectable, Logger } from '@nestjs/common';
-import { createWorker } from 'tesseract.js';
+import { NaceClient, workspaceFile } from 'nace-sdk';
 
 export interface OcrResult {
     text: string;
-    /** Tesseract's own confidence for this recognition pass, 0–100. */
+    /**
+     * Recognition confidence, 0–100. NDI parse reports no score of its own, so
+     * this is always NDI_PARSE_CONFIDENCE.
+     */
     confidence: number;
 }
 
 /**
- * Runs OCR locally, on the server, so image content can be converted to text
- * — and therefore masked by ComplianceService — before anything is sent to
- * an external model. This is the actual fix for "PII masking doesn't cover
- * image content"; everything else in this pipeline was already text-safe.
+ * NDI parse returns no confidence score. 80 puts every parse in
+ * capConfidenceForOcr's top band (field confidences capped at 0.8): the model
+ * still reads the parsed text, not the image, so a ceiling stays.
+ */
+const NDI_PARSE_CONFIDENCE = 80;
+
+/**
+ * Converts image content to text with NDI parse, so it can be masked by
+ * ComplianceService before anything is sent to the extraction model. NDI
+ * itself receives the original, unmasked image.
  */
 @Injectable()
 export class OcrService {
     private readonly logger = new Logger(OcrService.name);
+    // Created on first use: NaceClient throws without NACE_API_KEY, and this
+    // provider is built at boot even in vision mode, which never calls it.
+    private nace?: NaceClient;
 
     async recognizeText(imageBuffer: Buffer): Promise<OcrResult> {
-        const worker = await createWorker('eng');
-        try {
-            const { data } = await worker.recognize(imageBuffer);
-            this.logger.log(`OCR complete: ${data.text.length} chars extracted, confidence ${data.confidence}.`);
-            return { text: data.text ?? '', confidence: data.confidence ?? 0 };
-        } finally {
-            await worker.terminate();
-        }
+        this.nace ??= new NaceClient(); // reads NACE_API_KEY
+        // A unique name per call, so concurrent uploads never replace each other.
+        const uploaded = await this.nace.documents.upload(imageBuffer, {
+            file_name: `ocr-${randomUUID()}.${imageExtension(imageBuffer)}`,
+        });
+        const created = await this.nace.documents.parse({
+            source: workspaceFile(uploaded),
+            parse_mode: 'high',
+            wait_seconds: 60,
+        });
+        const job = created.status === 'succeeded' ? created : await this.nace.jobs.wait(created.job_id);
+        const text = (job.result as { document: { markdown: string } }).document.markdown ?? '';
+        this.logger.log(`NDI parse complete: ${text.length} chars extracted.`);
+        return { text, confidence: NDI_PARSE_CONFIDENCE };
     }
 }
+
+/** Callers pass PNG, JPEG or WebP bytes; the file name's extension picks NDI's parser. */
+function imageExtension(buffer: Buffer): string {
+    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
+    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
+    return 'png';
+}
```

Run: the NestJS class was not imported, because that needs the monorepo's whole dependency tree; the migrated method body and its helper were copied verbatim into a driver (`.e2e/drive_ocr.ts`) and run on a PNG of the sample invoice.

```text
$ NACE_API_KEY=... tsx .e2e/drive_ocr.ts
{ text: '--- Page 1 ---\nINVOICE\n\nInvoice number: INV-1042\n\nInvoice date: 2026-10-01\n\nBill to: Acme Corp\n\nTotal: 1,200.50 USD\n', confidence: 80 }
```
