import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName, getProviderNodes } from "@/lib/localDb";
import { validateComboPromptSettings } from "@/lib/comboPromptInjection";
import { validatePublication } from "@/shared/utils/publicModelId";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    let promptSettings;
    try {
      promptSettings = validateComboPromptSettings(body);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const { name, models, kind } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    // Publication is validated against every namespace a request could resolve
    // through, so a published id can never shadow a provider or another combo.
    const combos = await getCombos();
    const nodes = await getProviderNodes();
    let publication;
    try {
      publication = validatePublication({ ...body, name }, { combos, nodes });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const combo = await createCombo({ name, models: models || [], kind: kind || null, ...promptSettings, ...publication });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
