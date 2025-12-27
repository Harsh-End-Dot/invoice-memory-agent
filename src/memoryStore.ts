// src/memoryStore.ts

// --------------------
// Configuration (Decay)
// --------------------

const DECAY_RATE_PER_DAY = 0.01; // 1% confidence decay per day
const MIN_CONFIDENCE = 0.2;     // below this, memory is unsafe

// --------------------
// Imports
// --------------------

// We use require here to avoid TS typing issues with better-sqlite3
const Database = require("better-sqlite3");
import type { BaseMemory } from "./types";

// --------------------
// Database Setup
// --------------------

const db = new Database("memory.db");

// UNIQUE(vendor, pattern) ensures one memory per vendor-pattern
db.prepare(`
  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    type TEXT,
    vendor TEXT,
    pattern TEXT,
    confidence REAL,
    approvals INTEGER,
    rejections INTEGER,
    lastUpdated TEXT,
    UNIQUE(vendor, pattern)
  )
`).run();

// --------------------
// Confidence Decay Helper
// --------------------
// Time-based decay prevents stale memories from dominating automation

function applyConfidenceDecay(memory: BaseMemory): BaseMemory {
  const now = Date.now();
  const last = new Date(memory.lastUpdated).getTime();

  const daysPassed = Math.floor(
    (now - last) / (1000 * 60 * 60 * 24)
  );

  if (daysPassed <= 0) return memory;

  const decayedConfidence = Math.max(
    MIN_CONFIDENCE,
    memory.confidence - daysPassed * DECAY_RATE_PER_DAY
  );

  if (decayedConfidence !== memory.confidence) {
    db.prepare(`
      UPDATE memory
      SET confidence = ?, lastUpdated = ?
      WHERE id = ?
    `).run(
      decayedConfidence,
      new Date().toISOString(),
      memory.id
    );
  }

  return {
    ...memory,
    confidence: decayedConfidence
  };
}

// --------------------
// Memory Access Functions
// --------------------

export function getMemoriesForVendor(vendor: string): BaseMemory[] {
  const memories = db
    .prepare(`SELECT * FROM memory WHERE vendor = ?`)
    .all(vendor) as BaseMemory[];

  return memories.map(applyConfidenceDecay);
}

export function getMemoryByPattern(
  vendor: string,
  pattern: string
): BaseMemory | undefined {
  const memory = db
    .prepare(`SELECT * FROM memory WHERE vendor = ? AND pattern = ?`)
    .get(vendor, pattern) as BaseMemory | undefined;

  return memory ? applyConfidenceDecay(memory) : undefined;
}

// Canonical lookup used for merge logic
export function getMemoryByVendorAndPattern(
  vendor: string,
  pattern: string
): BaseMemory | undefined {
  return db
    .prepare(
      `SELECT * FROM memory WHERE vendor = ? AND pattern = ? LIMIT 1`
    )
    .get(vendor, pattern) as BaseMemory | undefined;
}

// --------------------
// Save / Merge Memory
// --------------------

export function saveMemory(memory: BaseMemory): void {
  const existing = getMemoryByVendorAndPattern(
    memory.vendor,
    memory.pattern
  );

  if (existing) {
    // Merge with existing memory instead of duplicating
    const mergedConfidence = Math.max(
      existing.confidence,
      memory.confidence
    );

    db.prepare(`
      UPDATE memory
      SET confidence = ?,
          approvals = approvals + ?,
          rejections = rejections + ?,
          lastUpdated = ?
      WHERE id = ?
    `).run(
      mergedConfidence,
      memory.approvals,
      memory.rejections,
      new Date().toISOString(),
      existing.id
    );
  } else {
    // Insert new memory
    db.prepare(`
      INSERT INTO memory
      (id, type, vendor, pattern, confidence, approvals, rejections, lastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.type,
      memory.vendor,
      memory.pattern,
      memory.confidence,
      memory.approvals,
      memory.rejections,
      memory.lastUpdated
    );
  }
}

// --------------------
// Confidence Update (Used by Engine)
// --------------------

export function updateMemoryConfidence(
  id: string,
  confidence: number,
  approvals: number,
  rejections: number
): void {
  db.prepare(`
    UPDATE memory
    SET confidence = ?, approvals = ?, rejections = ?, lastUpdated = ?
    WHERE id = ?
  `).run(confidence, approvals, rejections, new Date().toISOString(), id);
}

// --------------------
// Exports (CommonJS + TS)
// --------------------

export {};
module.exports = {
  getMemoriesForVendor,
  getMemoryByPattern,
  getMemoryByVendorAndPattern,
  saveMemory,
  updateMemoryConfidence
};
