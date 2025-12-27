// src/types.ts

// --------------------
// Core Invoice Types
// --------------------

export interface LineItem {
  sku: string | null;
  description?: string;
  qty: number;
  unitPrice: number;
}

export interface InvoiceFields {
  invoiceNumber: string;
  invoiceDate: string;
  serviceDate: string | null;
  currency: string | null;
  poNumber?: string | null;
  netTotal: number;
  taxRate: number;
  taxTotal: number;
  grossTotal: number;
  lineItems: LineItem[];
}

export interface Invoice {
  invoiceId: string;
  vendor: string;
  fields: InvoiceFields;
  rawText: string;
  confidence: number;
}

// --------------------
// Memory Types
// --------------------

export type MemoryType = "vendor" | "correction" | "resolution";

export interface BaseMemory {
  id: string;
  type: MemoryType;
  vendor: string;
  pattern: string;
  confidence: number;
  approvals: number;
  rejections: number;
  lastUpdated: string;
}

// --------------------
// Proposed Corrections
// --------------------

export interface ProposedCorrection {
  field: string;
  from: any;
  to: any;
  sourceMemoryId: string;
  confidence: number;
}

// --------------------
// Decision & Audit
// --------------------

export type DecisionAction = "auto_correct" | "escalate";

export type PipelineStep = "recall" | "apply" | "decide" | "learn";

export interface AuditEntry {
  step: PipelineStep;
  timestamp: string;
  details: string;
}

// --------------------
// Output Contract
// --------------------

export interface OutputContract {
  normalizedInvoice: Partial<InvoiceFields>;
  proposedCorrections: ProposedCorrection[];
  requiresHumanReview: boolean;
  reasoning: string;
  confidenceScore: number;
  memoryUpdates: string[];
  auditTrail: AuditEntry[];
}
export {};
