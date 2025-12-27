# 🧠 Invoice Memory Agent
### Memory-Driven Invoice Normalization & Learning System

---

## 📌 Overview

**Invoice Memory Agent** is an AI-inspired, memory-driven system that processes invoices by learning from past human corrections rather than re-processing each invoice as an isolated event.

Instead of relying solely on static rules or retraining ML models, the system:
* **Remembers** vendor-specific correction patterns.
* **Assigns** confidence scores to learned memories.
* **Automatically applies** trusted corrections.
* **Escalates** uncertain cases for human review.
* **Continuously learns** and improves over time.

This design closely mirrors how human analysts learn patterns, making the system safer, explainable, and production-ready.

---

## 🎯 Key Problem Addressed

Traditional invoice processing systems often suffer from:
1.  **Repeated manual corrections** for the same recurring errors.
2.  **No learning** from past human decisions.
3.  **Unsafe automation** without confidence-based guardrails.
4.  **Lack of explainability** and audit trails.

This project solves these issues using a **memory-based learning architecture**.

---

## 🧩 Core Concepts Implemented

### 1️⃣ Learned Memory (Not Retraining)
The system does not require expensive model retraining. It stores human-approved correction patterns as "memories."
* **Vendor Context:** Memories are specific to the issuer.
* **Pattern Matching:** e.g., mapping `Leistungsdatum` → `serviceDate`.
* **Confidence Scores:** Based on approval/rejection counters.
* **Time Decay:** Older, unused memories lose influence.

### 2️⃣ Confidence-Guided Decision Policy
Every correction proposal carries a confidence score to determine the level of automation.

| Confidence Range | Action Taken by System | Rationale |
| :--- | :--- | :--- |
| **High (≥ threshold)** | **Auto-apply correction** | Memory has strong historical validation. |
| **Medium** | **Require human review** | Prevent unsafe or premature automation. |
| **Low** | **Skip correction** | Insufficient evidence to trust memory. |

### 3️⃣ Human-in-the-Loop (HITL)
* **Reinforcement:** Human approvals strengthen a memory's weight.
* **Correction:** Human rejections weaken memory confidence.
* **Progressive Trust:** Confidence grows gradually to ensure reliability.

### 4️⃣ Memory Decay (Forgetting Mechanism)
To mimic human behavior and maintain system hygiene, memories decay over time if they aren't reinforced. This prevents outdated business rules from becoming permanent.

### 5️⃣ Ground-Truth Evaluation Layer
The **Evaluator** validates invoices against external data (Purchase Orders/Delivery Notes):
* Acts as an automated "senior reviewer."
* Provides the final "Ground Truth" to feed back into the learning loop.

---

## 🔄 Engine Lifecycle (Step-by-Step)



1.  **Recall:** Fetch vendor-specific memories and apply time-based decay.
2.  **Apply:** Match memories against invoice content and generate proposed corrections (non-mutating phase).
3.  **Decide:** Deduplicate corrections, apply high-confidence changes, and flag exceptions.
4.  **Learn:** Update the SQLite memory store based on the final outcome (Success/Failure).

---

## 📤 Output Contract

The system guarantees a deterministic JSON output for every invoice:

```json
{
  "normalizedInvoice": {},
  "proposedCorrections": [],
  "requiresHumanReview": true,
  "reasoning": "...",
  "confidenceScore": 0.0,
  "memoryUpdates": [],
  "auditTrail": []
}
```
## 🧪 Demo & Testing

###  Run Demo
```bash
npx ts-node --transpile-only src/demoRunner.ts
```
The demo simulates:

1. Cold-start invoice: Processing when no prior memory exists.

2. correction bootstrapping: Initial learning from manual inputs.

3. Memory recall: Applying learned patterns to subsequent invoices.

4. Evaluator feedback loops: Real-time confidence updates based on outcomes.

## 🧠 Why This Design?
 **Safety**: Avoids "hallucinations" or unsafe automation.

 **Efficiency**: No ML retraining costs or GPU requirements.

 **Auditability**: Every change is linked to a specific memory and reasoning.

 **Scalability**: Handles thousands of vendors with unique formats.
 The demo simulates:

Cold-start invoice: Processing when no prior memory exists.

Human correction bootstrapping: Initial learning from manual inputs.

Memory recall: Applying learned patterns to subsequent invoices.

Evaluator feedback loops: Real-time confidence updates based on outcomes.

## 🚀 Future Extensions
1. Vector Similarity: Using embeddings for fuzzy pattern matching.

2. Vendor Clustering: Sharing "general knowledge" between similar vendors.

3. UI Workflow: A dedicated dashboard for human reviewers.

4.  LLM Reasoning: Using Generative AI to explain why a memory was formed.
