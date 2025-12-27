// src/demoRunner.ts

const fs = require("fs");
const path = require("path");

const engine = require("./engine");
const processInvoice =
  engine.processInvoice || engine.default?.processInvoice;

const { evaluateInvoice } = require("./evaluator");
const { loadHumanCorrections } = require("./humanCorrectionLoader");

console.log(" DEMO START: Memory-Driven Learning \n");

// METRICS TRACKING

let totalInvoices = 0;
let autoApprovedCount = 0;
let humanReviewCount = 0;
let evaluatorApprovedCount = 0;
let evaluatorRejectedCount = 0;
// BOOTSTRAP MEMORY

loadHumanCorrections();
// LOAD INVOICE DATASET

const invoicesPath = path.join(
  __dirname,
  "..",
  "data",
  "invoices_extracted.json"
);

const invoices = JSON.parse(
  fs.readFileSync(invoicesPath, "utf-8")
);

console.log(`Loaded ${invoices.length} invoices from dataset\n`);

// MAIN PROCESSING LOOP

for (const invoice of invoices) {
  totalInvoices += 1;

  console.log("\n==============================");
  console.log(`Processing Invoice: ${invoice.invoiceId}`);
  console.log(`Vendor: ${invoice.vendor}`);
  console.log("==============================\n");

  // 1️ ENGINE PASS 
  const result = processInvoice(invoice);

  console.log("Engine Output:");
  console.log(JSON.stringify(result, null, 2));

  // Track automation vs human review
  if (result.requiresHumanReview) {
    humanReviewCount += 1;
  } else {
    autoApprovedCount += 1;
  }

  // 2️ EVALUATOR PASS (ground truth)
  const evaluation = evaluateInvoice(invoice);

  console.log("Evaluation Result:");
  console.log(JSON.stringify(evaluation, null, 2));

  if (evaluation.status === "APPROVED") {
    evaluatorApprovedCount += 1;
  } else {
    evaluatorRejectedCount += 1;
  }

  // 3️ AUDIT evaluator decision
  result.auditTrail.push({
    step: "decide",
    timestamp: new Date().toISOString(),
    details: `Evaluator decision: ${evaluation.status} — ${evaluation.reason}`
  });

  // 4️ LEARNING PASS 
  const autoApproved = evaluation.status === "APPROVED";

  processInvoice(
    {
      ...invoice,
      fields: result.normalizedInvoice
    },
    autoApproved
  );

  result.auditTrail.push({
    step: "learn",
    timestamp: new Date().toISOString(),
    details: autoApproved
      ? "Memory reinforced based on evaluator approval"
      : "Memory weakened based on evaluator rejection"
  });

  console.log(
    `Learning outcome: ${
      autoApproved ? "Memory reinforced" : "Memory weakened"
    }`
  );
}

// FINAL METRICS SUMMARY
console.log("\n FINAL EVALUATION SUMMARY");

console.log(`Total Invoices Processed: ${totalInvoices}`);

console.log(
  `Auto-Approved (No Human Review): ${autoApprovedCount} ` +
    `(${((autoApprovedCount / totalInvoices) * 100).toFixed(2)}%)`
);

console.log(
  `Required Human Review: ${humanReviewCount} ` +
    `(${((humanReviewCount / totalInvoices) * 100).toFixed(2)}%)`
);

console.log(`Evaluator Approved: ${evaluatorApprovedCount}`);
console.log(`Evaluator Rejected: ${evaluatorRejectedCount}`);

console.log("\n");

console.log(" DEMO END ");
