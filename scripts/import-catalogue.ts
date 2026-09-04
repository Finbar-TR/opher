// Bulk-imports foods and their bulk units from a CSV file.
//
// Writes exactly what the Catalogue screen writes - a Product (the food) and a
// Sku (the unit you buy it in). Nothing marks a row as "imported", because
// there is no difference: the form is the same two writes done one at a time.
//
// PREVIEWS BY DEFAULT. Nothing is written unless IMPORT_APPLY=1, so you always
// see what a file will do before it does it. With 192 rows that is not a
// nicety - one wrong column heading would otherwise create 192 wrong records.
//
// Re-running is safe: a food already in the catalogue is skipped rather than
// duplicated. The schema has no uniqueness constraint on either name, so that
// matching happens here.
//
// Usage (via the wrapper):
//   .\scripts\import-catalogue.ps1 -File foods.csv          # preview
//   .\scripts\import-catalogue.ps1 -File foods.csv -Apply   # write

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PRODUCT_CATEGORIES } from "../src/lib/constants";
import { kgToGrams } from "../src/lib/weight";
import { poundsToPence } from "../src/lib/money";

const prisma = new PrismaClient();

// Ceilings mirror the Catalogue form's, so an import cannot create a record the
// form would have rejected. `weightGrams` and `wholesaleCostPence` are 32-bit
// ints in the database; these sit far below that.
const MAX_WEIGHT_KG = 10_000;
const MAX_COST_GBP = 1_000_000;

// Column headings people actually use. Matching is case-insensitive and ignores
// spaces, underscores and punctuation, so "Weight (kg)" and "weight_kg" agree.
const ALIASES: Record<string, string[]> = {
  name: ["name", "food", "product", "productname", "item", "itemname", "description1"],
  category: ["category", "type", "producttype", "foodtype"],
  description: ["description", "desc", "notes", "detail", "details"],
  unit: ["unit", "unitlabel", "sku", "skulabel", "bulkunit", "pack", "packsize", "size", "casesize"],
  weightKg: ["weightkg", "weight", "kg", "unitweightkg", "unitweight", "sizekg", "netweightkg"],
  costGbp: ["costgbp", "cost", "price", "unitcost", "wholesalecost", "wholesalecostgbp", "costprice", "buyprice"],
};

function normalise(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A CSV parser that handles quoted fields, commas and newlines inside quotes,
// doubled quotes as an escape, CRLF, and a leading byte-order mark. Excel
// produces all of these. Not worth a dependency.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

type Parsed = {
  line: number;
  name: string;
  category: string;
  description: string;
  unit: string;
  weightKg: number;
  costGbp: number;
  costBlank: boolean;
};

function money(n: number): string {
  return `£${n.toFixed(2)}`;
}

async function main() {
  const file = process.env.IMPORT_FILE ?? "";
  const apply = process.env.IMPORT_APPLY === "1";
  const update = process.env.IMPORT_UPDATE === "1";
  const url = process.env.DATABASE_URL ?? "";

  if (!file) throw new Error("IMPORT_FILE is not set. Run this through scripts/import-catalogue.ps1.");
  if (!url) throw new Error("DATABASE_URL is not set. Run this through scripts/import-catalogue.ps1.");

  const rows = parseCsv(readFileSync(file, "utf8"));
  if (rows.length < 2) throw new Error(`${file} has no data rows.`);

  // --- Map the headings -----------------------------------------------------
  const headings = rows[0].map((h) => normalise(h));
  const column: Partial<Record<keyof typeof ALIASES, number>> = {};

  for (const [field, names] of Object.entries(ALIASES)) {
    const idx = headings.findIndex((h) => names.includes(h));
    if (idx !== -1) column[field as keyof typeof ALIASES] = idx;
  }

  console.log("\nColumns found in your file:");
  for (const field of Object.keys(ALIASES)) {
    const idx = column[field as keyof typeof ALIASES];
    const found = idx === undefined ? "-- not found --" : `"${rows[0][idx].trim()}"`;
    console.log(`  ${field.padEnd(12)} ${found}`);
  }

  const required = ["name", "unit", "weightKg", "costGbp"] as const;
  const missing = required.filter((f) => column[f] === undefined);
  if (missing.length) {
    console.log(`\nHeadings in your file: ${rows[0].map((h) => `"${h.trim()}"`).join(", ")}`);
    throw new Error(
      `Could not find a column for: ${missing.join(", ")}.\n` +
        `Rename those columns in your spreadsheet, or tell Claude the heading names above.`
    );
  }

  // --- Validate every row ---------------------------------------------------
  const good: Parsed[] = [];
  const bad: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1; // 1-based, counting the heading row
    const cell = (f: keyof typeof ALIASES) => {
      const idx = column[f];
      return idx === undefined ? "" : (r[idx] ?? "").trim();
    };

    const name = cell("name");
    const unit = cell("unit");
    // Tolerate "25 kg", "£42.00" and thousands separators.
    const weightRaw = cell("weightKg").replace(/[^0-9.\-]/g, "");
    const costRaw = cell("costGbp").replace(/[^0-9.\-]/g, "");
    const weightKg = Number(weightRaw);
    const costGbp = Number(costRaw);

    let category = cell("category").toLowerCase();
    if (!category) category = "dry";
    if (!(PRODUCT_CATEGORIES as readonly string[]).includes(category)) {
      bad.push(`Line ${line}: category "${cell("category")}" is not ${PRODUCT_CATEGORIES.join(" or ")}.`);
      continue;
    }

    if (!name) { bad.push(`Line ${line}: no food name.`); continue; }
    if (!unit) { bad.push(`Line ${line}: no bulk unit for "${name}".`); continue; }
    if (!weightRaw || !Number.isFinite(weightKg) || weightKg <= 0) {
      bad.push(`Line ${line}: "${name}" has an unusable weight ("${cell("weightKg")}").`); continue;
    }
    if (weightKg > MAX_WEIGHT_KG) {
      bad.push(`Line ${line}: "${name}" weight ${weightKg} kg is above the ${MAX_WEIGHT_KG} kg limit.`); continue;
    }
    // A blank cost is allowed and recorded as zero. `wholesaleCostPence` is
    // shown on the Catalogue screen and used in no calculation - customers pay
    // the per-basket tier price, never this. Cataloguing what you sell before
    // you have supplier quotes is a normal order of work.
    if (costRaw !== "" && (!Number.isFinite(costGbp) || costGbp < 0)) {
      bad.push(`Line ${line}: "${name}" has an unusable cost ("${cell("costGbp")}").`); continue;
    }
    if (costGbp > MAX_COST_GBP) {
      bad.push(`Line ${line}: "${name}" cost ${money(costGbp)} is above the limit.`); continue;
    }

    good.push({
      line,
      name,
      category,
      description: cell("description"),
      unit,
      weightKg,
      costGbp: costRaw === "" ? 0 : costGbp,
      costBlank: costRaw === "",
    });
  }

  if (bad.length) {
    console.log(`\n${bad.length} row${bad.length === 1 ? "" : "s"} could not be read:`);
    for (const b of bad.slice(0, 25)) console.log(`  ${b}`);
    if (bad.length > 25) console.log(`  ...and ${bad.length - 25} more.`);
  }

  // --- Group rows by food ---------------------------------------------------
  // The same food listed twice with different units becomes one food with two
  // bulk units, which is how the catalogue is meant to work.
  const byFood = new Map<string, Parsed[]>();
  for (const p of good) {
    const key = p.name.toLowerCase();
    byFood.set(key, [...(byFood.get(key) ?? []), p]);
  }

  // --- Compare against what is already there --------------------------------
  const existingProducts = await prisma.product.findMany({ include: { skus: true } });
  const existingByName = new Map(existingProducts.map((p) => [p.name.toLowerCase(), p]));

  let newFoods = 0;
  let newUnits = 0;
  let skippedUnits = 0;
  let changedUnits = 0;
  const preview: string[] = [];
  const changes: string[] = [];

  const findSku = (existing: (typeof existingProducts)[number] | undefined, unit: string) =>
    existing?.skus.find((s) => s.label.trim().toLowerCase() === unit.toLowerCase());

  for (const [key, entries] of byFood) {
    const existing = existingByName.get(key);
    if (!existing) newFoods++;

    for (const e of entries) {
      const sku = findSku(existing, e.unit);
      if (!sku) {
        newUnits++;
        if (preview.length < 10) {
          preview.push(`  ${e.name} - ${e.unit} - ${e.weightKg} kg - ${money(e.costGbp)}`);
        }
        continue;
      }

      // Already present. Does the file now say something different? A blank
      // cost never overwrites a real one - that would silently undo work.
      const wantGrams = kgToGrams(e.weightKg);
      const wantPence = poundsToPence(e.costGbp);
      const costDiffers = !e.costBlank && wantPence !== sku.wholesaleCostPence;
      const weightDiffers = wantGrams !== sku.weightGrams;

      if (costDiffers || weightDiffers) {
        changedUnits++;
        if (changes.length < 10) {
          const bits: string[] = [];
          if (costDiffers) bits.push(`${money(sku.wholesaleCostPence / 100)} -> ${money(e.costGbp)}`);
          if (weightDiffers) bits.push(`${sku.weightGrams / 1000} kg -> ${e.weightKg} kg`);
          changes.push(`  ${e.name} - ${e.unit}: ${bits.join(", ")}`);
        }
      } else {
        skippedUnits++;
      }
    }
  }

  const blankCosts = good.filter((g) => g.costBlank).length;

  console.log(`\n${good.length} usable row${good.length === 1 ? "" : "s"} covering ${byFood.size} food${byFood.size === 1 ? "" : "s"}.`);
  console.log(`  New foods to create:      ${newFoods}`);
  console.log(`  New bulk units to create: ${newUnits}`);
  console.log(`  Already present, unchanged: ${skippedUnits}`);
  if (changedUnits) {
    console.log(`  Already present, DIFFERENT: ${changedUnits}${update ? " (will be updated)" : " (use -Update to apply)"}`);
  }

  if (blankCosts) {
    console.log(`\n${blankCosts} row${blankCosts === 1 ? " has" : "s have"} no cost - recorded as ${money(0)}.`);
    console.log("Cost is shown on the Catalogue screen and used in no calculation:");
    console.log("customers pay the prices you set per basket, never this figure.");
    console.log("Add the costs to your spreadsheet later and re-run with -Update.");
  }

  if (preview.length) {
    console.log("\nFirst few to be created:");
    for (const p of preview) console.log(p);
    if (newUnits > preview.length) console.log(`  ...and ${newUnits - preview.length} more.`);
  }

  if (changes.length) {
    console.log(`\nFirst few that differ from what is stored:`);
    for (const c of changes) console.log(c);
    if (changedUnits > changes.length) console.log(`  ...and ${changedUnits - changes.length} more.`);
  }

  if (!apply) {
    console.log("\nPREVIEW ONLY - nothing was written.");
    console.log("Re-run with -Apply to import.");
    return;
  }

  if (newFoods === 0 && newUnits === 0 && !(update && changedUnits)) {
    console.log("\nNothing new to import.");
    return;
  }

  // --- Write ----------------------------------------------------------------
  let createdFoods = 0;
  let createdUnits = 0;
  let updatedUnits = 0;

  for (const [key, entries] of byFood) {
    let product = existingByName.get(key);

    if (!product) {
      const first = entries[0];
      const created = await prisma.product.create({
        data: { name: first.name, description: first.description, category: first.category },
        include: { skus: true },
      });
      existingByName.set(key, created);
      product = created;
      createdFoods++;
    }

    for (const e of entries) {
      const sku = findSku(product, e.unit);
      if (sku) {
        if (!update) continue;
        const wantGrams = kgToGrams(e.weightKg);
        const wantPence = poundsToPence(e.costGbp);
        const data: { weightGrams?: number; wholesaleCostPence?: number } = {};
        if (wantGrams !== sku.weightGrams) data.weightGrams = wantGrams;
        // A blank cost never overwrites a real one.
        if (!e.costBlank && wantPence !== sku.wholesaleCostPence) data.wholesaleCostPence = wantPence;
        if (Object.keys(data).length) {
          await prisma.sku.update({ where: { id: sku.id }, data });
          updatedUnits++;
        }
        continue;
      }

      await prisma.sku.create({
        data: {
          productId: product.id,
          label: e.unit,
          weightGrams: kgToGrams(e.weightKg),
          wholesaleCostPence: poundsToPence(e.costGbp),
          // Unused this milestone - the purchase trigger was removed in spec
          // revision 4. Set to 1 so the NOT NULL column has a harmless value.
          purchaseThresholdGrams: 1,
        },
      });
      createdUnits++;
    }
  }

  const parts: string[] = [];
  if (createdFoods) parts.push(`created ${createdFoods} food${createdFoods === 1 ? "" : "s"}`);
  if (createdUnits) parts.push(`created ${createdUnits} bulk unit${createdUnits === 1 ? "" : "s"}`);
  if (updatedUnits) parts.push(`updated ${updatedUnits} bulk unit${updatedUnits === 1 ? "" : "s"}`);

  console.log(`\nDone - ${parts.length ? parts.join(", ") : "nothing to change"}.`);
  if (createdFoods || createdUnits || updatedUnits) {
    console.log("Visible now on the Catalogue screen, and in the Food list when you create a basket.");
  }
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
