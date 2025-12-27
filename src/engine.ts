// src/engine.ts

import {
  Invoice,
  ProposedCorrection,
  OutputContract,
  AuditEntry,
} from "./types";

import {
  getMemoriesForVendor,
  getMemoryByPattern,
  updateMemoryConfidence
} from "./memoryStore";

// --------------------
// Configuration
// --------------------

const AUTO_CORRECT_THRESHOLD = 0.8;
const APPROVAL_BOOST = 0.15;
const REJECTION_PENALTY = 0.3;
const MAX_CONFIDENCE = 0.95;

const processedInvoices: Invoice[] = [];
// --------------------
// Main Entry
// --------------------

 function processInvoice(
  invoice: Invoice,
  humanApproved: boolean | null = null
): OutputContract {
  const auditTrail: AuditEntry[] = [];
  const proposedCorrections: ProposedCorrection[] = [];
  const memoryUpdates: string[] = [];

 // --------------------
  // DUPLICATE CHECK 
  // --------------------

  if (isPotentialDuplicate(invoice, processedInvoices)) {
    auditTrail.push({
      step: "decide",
      timestamp: new Date().toISOString(),
      details:
        "Potential duplicate invoice detected (same vendor + invoice number + close dates)"
    });

    return {
      normalizedInvoice: invoice.fields,
      proposedCorrections: [],
      requiresHumanReview: true,
      reasoning: `Invoice appears to be a potential duplicate for vendor "${invoice.vendor}". Human review required to prevent contradictory learning.`,
      confidenceScore: 0,
      memoryUpdates: [],
      auditTrail
    };
  }
// --------------------
// 1. RECALL
// --------------------

const recalledMemories = getMemoriesForVendor(invoice.vendor);

// Summarize memory types (vendor / correction / resolution)
const memorySummary = recalledMemories.reduce(
  (acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  },
  {} as Record<string, number>
);

// Base recall audit
auditTrail.push({
  step: "recall",
  timestamp: new Date().toISOString(),
  details: `Recalled ${recalledMemories.length} memories for vendor "${
    invoice.vendor
  }" (breakdown: ${JSON.stringify(memorySummary)})`
});

// Explicit cold-start signal
if (recalledMemories.length === 0) {
  auditTrail.push({
    step: "recall",
    timestamp: new Date().toISOString(),
    details: "No prior memories found; system operating in cold-start mode"
  });
}

// Identify high-confidence memories eligible for auto-application
const highConfidenceMemories = recalledMemories.filter(
  m => m.confidence >= AUTO_CORRECT_THRESHOLD
);

if (highConfidenceMemories.length > 0) {
  auditTrail.push({
    step: "recall",
    timestamp: new Date().toISOString(),
    details: `Found ${highConfidenceMemories.length} high-confidence memories eligible for auto-application`
  });
}

// surface recalled patterns for transparency
const recalledPatterns = recalledMemories.map(m => m.pattern);

if (recalledPatterns.length > 0) {
  auditTrail.push({
    step: "recall",
    timestamp: new Date().toISOString(),
    details: `Recalled memory patterns: ${recalledPatterns.join(", ")}`
  });
}
// --------------------
// 2. APPLY (Suggestions only)
// --------------------

for (const memory of recalledMemories) {

  // --------------------
  // Supplier GmbH: Service Date Normalization
  // --------------------
  if (
    invoice.vendor === "Supplier GmbH" &&
    memory.pattern === "Leistungsdatum -> serviceDate" &&
    invoice.fields.serviceDate === null &&
    invoice.rawText.includes("Leistungsdatum")
  ) {
    proposedCorrections.push({
      field: "serviceDate",
      from: null,
      to: extractDate(invoice.rawText),
      sourceMemoryId: memory.id,
      confidence: memory.confidence
    });
  }

  // --------------------
  // Parts AG: VAT-Inclusive Pricing
  // --------------------
  if (
    invoice.vendor === "Parts AG" &&
    memory.pattern === "VAT_INCLUSIVE_PRICING" &&
    (invoice.rawText.toLowerCase().includes("mwst. inkl") ||
      invoice.rawText.toLowerCase().includes("prices incl") ||
      invoice.rawText.toLowerCase().includes("inkl"))
  ) {
    const recomputedTax = recomputeTax(invoice);

    proposedCorrections.push({
      field: "taxTotal",
      from: invoice.fields.taxTotal,
      to: recomputedTax,
      sourceMemoryId: memory.id,
      confidence: memory.confidence
    });
  }

  // --------------------
  // Parts AG: Currency Recovery
  // --------------------
  if (
    invoice.vendor === "Parts AG" &&
    invoice.fields.currency === null &&
    memory.pattern === "CURRENCY_RECOVERY"
  ) {
    let detectedCurrency: string | null = null;

    if (
      invoice.rawText.includes("€") ||
      invoice.rawText.toLowerCase().includes("eur")
    ) {
      detectedCurrency = "EUR";
    }

    if (detectedCurrency) {
      proposedCorrections.push({
        field: "currency",
        from: null,
        to: detectedCurrency,
        sourceMemoryId: memory.id,
        confidence: memory.confidence
      });
    }
  }
 // --------------------
// Freight & Co: Skonto Detection
// --------------------
if (
  invoice.vendor === "Freight & Co" &&
  memory.pattern === "SKONTO_TERMS" &&
  invoice.rawText.toLowerCase().includes("skonto")
) {
  proposedCorrections.push({
    field: "paymentTerms",
    from: null,
    to: "SKONTO_DETECTED",
    sourceMemoryId: memory.id,
    confidence: memory.confidence
  });
}
// --------------------
// Freight & Co: Shipping Description → FREIGHT SKU
// --------------------
if (
  invoice.vendor === "Freight & Co" &&
  memory.pattern === "FREIGHT_SKU_MAPPING"
) {
  invoice.fields.lineItems.forEach((item, index) => {
    if (
      item.sku === null &&
      item.description &&
      (
        item.description.toLowerCase().includes("seefracht") ||
        item.description.toLowerCase().includes("shipping") ||
        item.description.toLowerCase().includes("freight")
      )
    ) {
      proposedCorrections.push({
        field: `lineItems[${index}].sku`,
        from: null,
        to: "FREIGHT",
        sourceMemoryId: memory.id,
        confidence: memory.confidence
      });
    }
  });
}
}
// --------------------
// Deduplicate Corrections (Keep Highest Confidence per Field)
// --------------------

const bestCorrectionsMap = new Map<string, ProposedCorrection>();

for (const correction of proposedCorrections) {
  const existing = bestCorrectionsMap.get(correction.field);

  if (!existing || correction.confidence > existing.confidence) {
    bestCorrectionsMap.set(correction.field, correction);
  }
}

// Replace proposedCorrections with deduplicated list
proposedCorrections.length = 0;
proposedCorrections.push(...Array.from(bestCorrectionsMap.values()));
  // --------------------
  // --------------------
// 3. DECIDE
// --------------------

let requiresHumanReview = false;
let normalizedInvoice = { ...invoice.fields };
let finalConfidence = 0;

// 🔹 Aggregate confidence (average instead of max)
if (proposedCorrections.length > 0) {
  finalConfidence =
    proposedCorrections.reduce(
      (sum, c) => sum + c.confidence,
      0
    ) / proposedCorrections.length;
}

// 🔹 Apply corrections safely
for (const correction of proposedCorrections) {
  if (correction.confidence >= AUTO_CORRECT_THRESHOLD) {
    // Auto-apply high-confidence corrections
    (normalizedInvoice as any)[correction.field] = correction.to;
  }
}

// 🔹 Decide if human review is required
if (
  proposedCorrections.length > 0 &&
  finalConfidence < AUTO_CORRECT_THRESHOLD
) {
  requiresHumanReview = true;
}

auditTrail.push({
  step: "decide",
  timestamp: new Date().toISOString(),
  details: requiresHumanReview
    ? `Human review required (avg confidence ${finalConfidence.toFixed(2)})`
    : `All corrections auto-applied (avg confidence ${finalConfidence.toFixed(2)})`
});

// --------------------
// 4. LEARN (only if human feedback provided)
// --------------------
// --------------------
// 4. LEARN (only if human / evaluator feedback provided)
// --------------------

if (humanApproved !== null) {
  for (const correction of proposedCorrections) {
    const pattern = getPatternFromCorrection(correction);

    const memory = getMemoryByPattern(invoice.vendor, pattern);
    if (!memory) continue;

    let approvals = memory.approvals;
    let rejections = memory.rejections;
    let newConfidence = memory.confidence;

    if (humanApproved) {
      approvals += 1;

      // Progressive trust curve:
      // Slower reinforcement when confidence is still low
      const learningRate =
        memory.confidence < AUTO_CORRECT_THRESHOLD
          ? 0.05
          : 1 / (approvals + 1);

      newConfidence = Math.min(
        MAX_CONFIDENCE,
        newConfidence + learningRate
      );
    } else {
      rejections += 1;

      // Strong rejection penalty to prevent unsafe automation
      newConfidence = Math.max(
        0,
        newConfidence - REJECTION_PENALTY
      );
    }

    updateMemoryConfidence(
      memory.id,
      newConfidence,
      approvals,
      rejections
    );

    memoryUpdates.push(
      `Memory "${memory.pattern}" updated: confidence ${memory.confidence.toFixed(
        2
      )} → ${newConfidence.toFixed(2)} (${
        humanApproved ? "reinforced" : "penalized"
      })`
    );
  }

  auditTrail.push({
    step: "learn",
    timestamp: new Date().toISOString(),
    details: humanApproved
      ? "Human/evaluator approval reinforced memory confidence"
      : "Human/evaluator rejection reduced memory confidence"
  });
}

// Track invoice for duplicate detection
processedInvoices.push(invoice);

  // --------------------
  // OUTPUT
  // --------------------

  return {
    normalizedInvoice,
    proposedCorrections,
    requiresHumanReview,
    reasoning: buildReasoning(invoice, proposedCorrections, finalConfidence),
    confidenceScore: finalConfidence,
    memoryUpdates,
    auditTrail
  };
}

// --------------------
// Helpers
// --------------------

function extractDate(text: string): string {
  const match = text.match(/\d{2}\.\d{2}\.\d{4}/);
  return match ? match[0].split(".").reverse().join("-") : "";
}

function recomputeTax(invoice: Invoice): number {
  return Number(
    (invoice.fields.grossTotal -
      invoice.fields.netTotal).toFixed(2)
  );
}

function getPatternFromCorrection(c: ProposedCorrection): string {
  if (c.field === "serviceDate") return "Leistungsdatum -> serviceDate";
  if (c.field === "taxTotal") return "VAT_INCLUSIVE_PRICING";
  return "UNKNOWN";
}

function buildReasoning(
  invoice: Invoice,
  corrections: ProposedCorrection[],
  confidence: number
): string {
  // Cold start / no memory applied
  if (corrections.length === 0) {
    return `No learned memory patterns were applicable for vendor "${invoice.vendor}". The system processed this invoice without automated corrections, either due to cold-start conditions or insufficient historical confidence.`;
  }

  const fields = corrections.map(c => c.field).join(", ");

  // Auto-applied corrections
  if (confidence >= 0.8) {
    return `The system recalled previously human-approved memory patterns for vendor "${invoice.vendor}" and applied corrections to field(s): ${fields}. The aggregated confidence score (${confidence.toFixed(
      2
    )}) exceeded the automation threshold, allowing safe and fully automated correction without human intervention.`;
  }

  // Human review required
  return `The system identified memory-based suggestions for vendor "${invoice.vendor}" affecting field(s): ${fields}. However, the confidence score (${confidence.toFixed(
    2
  )}) did not meet the automation threshold, so the invoice was intentionally escalated for human review to avoid unsafe or premature learning.`;
}

// --------------------
// Duplicate Detection Helper
// --------------------

function isPotentialDuplicate(
  invoice: Invoice,
  existingInvoices: Invoice[]
): boolean {
  return existingInvoices.some(prev => {
    if (prev.vendor !== invoice.vendor) return false;
    if (prev.fields.invoiceNumber !== invoice.fields.invoiceNumber) return false;

    const d1 = new Date(prev.fields.invoiceDate).getTime();
    const d2 = new Date(invoice.fields.invoiceDate).getTime();

    const DAY_MS = 24 * 60 * 60 * 1000;

    // Treat invoices within ±2 days as potential duplicates
    return Math.abs(d1 - d2) <= DAY_MS * 2;
  });
}


module.exports = {
  processInvoice
};


