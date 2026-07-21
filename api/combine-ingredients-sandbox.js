module.exports = async function handler(req, res) {try {const body =typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

const weeklyMealPlanId = body.weekly_meal_plan_id || "";
const recipeServingsPairs = body.recipe_servings_pairs || "";
const selectedServings = Number(body.selected_servings) || 4;

const servingsLookup = new Map(
  recipeServingsPairs
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [id, servings] = pair.split("|");

      return [
        id?.trim(),
        Number(servings) || 4,
      ];
    })
);

const explicitRecipeIds = [
  body.recipe_1_id,
  body.recipe_2_id,
  body.recipe_3_id,
  body.recipe_4_id,
  body.recipe_5_id,
]
  .map((id) => String(id || "").trim())
  .filter(Boolean);

const fallbackRecipeMeta = recipeServingsPairs
  .split(",")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => {
    const [id, servings] = pair.split("|");

    return {
      id: id?.trim(),
      baseServings: Number(servings) || 4,
    };
  })
  .filter((recipe) => recipe.id);

const recipeMeta =
  explicitRecipeIds.length === 5
    ? explicitRecipeIds.map((id) => ({
        id,
        baseServings: servingsLookup.get(id) || 4,
      }))
    : fallbackRecipeMeta;

const recipeIds = recipeMeta.map((recipe) => recipe.id);

const notionApiKey = process.env.NOTION_API_KEY;
const recipeIngredientsDbId = process.env.RECIPE_INGREDIENTS_DB_ID;

if (!notionApiKey) {
  return res.status(400).json({ error: "Missing NOTION_API_KEY" });
}

if (!recipeIngredientsDbId) {
  return res.status(400).json({ error: "Missing RECIPE_INGREDIENTS_DB_ID" });
}

if (!recipeIds.length) {
  return res.status(200).json({
    weekly_meal_plan_id: weeklyMealPlanId,
    recipe_meta: recipeMeta,
    grouped_categories: {},
    shopping_lines: [],
    shopping_list_html: "",
    shopping_list_html_1: "",
    shopping_list_html_2: "",
    shopping_list_html_3: "",
  });
}

const orFilters = recipeIds.map((id) => ({
  property: "Recipes",
  relation: {
    contains: id,
  },
}));

const allRows = await queryAllNotionRows({
  notionApiKey,
  recipeIngredientsDbId,
  filter: { or: orFilters },
});

const combined = new Map();

const scaledRecipes = new Map();

for (const recipe of recipeMeta) {
  scaledRecipes.set(recipe.id, []);
}

for (const row of allRows) {
  const p = row.properties || {};

  const recipeId = p["Recipes"]?.relation?.[0]?.id || "";

  const ingredientName =
    p["Ingredient Name"]?.rollup?.array?.[0]?.title?.[0]?.plain_text || "";

  const rawQty = p["Quantity"]?.number;
  const quantity =
    rawQty !== null && rawQty !== undefined ? Number(rawQty) : null;

  const rawUnit = p["Unit"]?.select?.name || "";
  const ingredientRole = p["Ingredient Role"]?.select?.name || "";
  const notes = p["Notes"]?.rich_text?.[0]?.plain_text || "";

  const rawCategory =
    p["Shopping Category"]?.rollup?.array?.[0]?.select?.name || "Other";

  if (!ingredientName) continue;

const isRoleOnlyItem = ["For Serving", "Optional", "Topping", "Garnish", "To Taste"].includes(ingredientRole);

if (!isRoleOnlyItem &&(quantity === null ||quantity === undefined ||Number.isNaN(quantity) ||quantity <= 0)) {continue;}

  const normalizedName = normalizeIngredientName(ingredientName);
  let normalizedCategory = normalizeCategory(rawCategory);

  const normalizedUnit = normalizeUnit(rawUnit);

const safeQuantity =
  quantity === null ||
  quantity === undefined ||
  Number.isNaN(quantity)
    ? 0
    : quantity;

const recipeBaseServings =
  recipeMeta.find((recipe) => recipe.id === recipeId)?.baseServings || 4;

const effectiveServings = Math.max(
  recipeBaseServings,
  selectedServings
);

const servingMultiplier =
  effectiveServings / recipeBaseServings;

const scaledQuantity =
  safeQuantity * servingMultiplier;

const converted = convertUnit(
  scaledQuantity,
  normalizedUnit,
  normalizedName
);

const scaledRecipeItems = scaledRecipes.get(recipeId);

if (scaledRecipeItems) {
  scaledRecipeItems.push({
    name: ingredientName,
    quantity: Number(scaledQuantity.toFixed(2)),
    unit: normalizedUnit,
    role: ingredientRole,
    notes,
  });
}

  let normalizedNameForCombine = normalizedName;

if (normalizedName === "chicken breast" ||normalizedName === "chicken breasts" ||normalizedName === "chicken thigh" ||normalizedName === "chicken thighs") {normalizedNameForCombine = "chicken breast or thighs";}

const groceryProduce = ["cucumber","cilantro","parsley","green onion","green onions","lime","lemon"];

if (groceryProduce.includes(normalizedName)) {normalizedNameForCombine = normalizedName;}

let unitForCombine = converted.unit;

if (groceryProduce.includes(normalizedName)) {unitForCombine = "whole";}

const key = `${normalizedNameForCombine}__${unitForCombine}__${normalizedCategory}`;
  if (!combined.has(key)) {
    combined.set(key, {
      name: getDisplayName(normalizedNameForCombine, ingredientName),
      quantity: 0,
      unit: unitForCombine,
      category: normalizedCategory,
      roles: new Set(),
      notes: new Set(),
    });
  }

  combined.get(key).quantity += converted.quantity;

  if (ingredientRole) {
    combined.get(key).roles.add(ingredientRole);
  }

  if (notes) {
    combined.get(key).notes.add(notes);
  }
}

const groupedCategories = {};

for (const item of combined.values()) {const isDisplayOnlyItem =item.roles?.has("For Serving") ||item.roles?.has("Optional") ||item.roles?.has("Topping") ||item.roles?.has("Garnish") ||item.roles?.has("To Taste");

if (item.quantity <= 0 && !isDisplayOnlyItem) continue;

const finalized = finalizeUnit(item);const shopperItem = makeShopperFriendlyItem(finalized);

if (!shopperItem) continue;

if (!groupedCategories[shopperItem.category]) {groupedCategories[shopperItem.category] = [];}

groupedCategories[shopperItem.category].push({name: shopperItem.name,quantity: Number(shopperItem.quantity.toFixed(2)),unit: shopperItem.unit,roles: shopperItem.roles,notes: shopperItem.notes,});}

const categoryOrder = [
  "Produce",
  "Meat",
  "Protein",
  "Dairy",
  "Frozen",
  "Canned",
  "Pantry",
  "Dry",
  "Baking",
  "Seasonings",
  "Spices",
  "Other",
];

const orderedCategoryNames = [
  ...categoryOrder.filter((c) => groupedCategories[c]),
  ...Object.keys(groupedCategories)
    .filter((c) => !categoryOrder.includes(c))
    .sort(),
];

const shoppingLines = [];
const shoppingListHtmlParts = [];

for (const category of orderedCategoryNames) {

groupedCategories[category].sort((a, b) => a.name.localeCompare(b.name));

const listItems = [];shoppingLines.push(category);

for (const item of groupedCategories[category]) {const isDisplayOnlyItem =item.roles?.includes("For Serving") ||item.roles?.includes("Optional") ||item.roles?.includes("Topping") ||item.roles?.includes("To Taste") ||item.roles?.includes("Garnish");

if ((!item.quantity || item.quantity <= 0) && !isDisplayOnlyItem) continue;

const qty = formatQty(item.quantity);

const normalizedUnit = (item.unit || "").trim().toLowerCase();
const normalizedName = (item.name || "").trim().toLowerCase();

const displayUnit =
  normalizedUnit && normalizedUnit !== normalizedName ? item.unit : "";

const nameLower = String(item.name || "").toLowerCase();const roleLower = (item.roles || []).map((r) => String(r).toLowerCase());

if ((!item.quantity || item.quantity <= 0) &&roleLower.includes("to taste") &&(nameLower === "salt" || nameLower === "pepper" || nameLower === "black pepper")) {continue;}

const roleLabel = formatRoleLabel(item.roles);
const noteLabel = formatNotesLabel(item.notes);

let line = `${qty}${qty && displayUnit ? ` ${displayUnit}` : ""} ${
  item.name
}${noteLabel}${roleLabel}`.trim();

line = cleanDisplayLine(line);

shoppingLines.push(line);
listItems.push(`<li>${escapeHtml(line)}</li>`);

}

if (listItems.length) {
  shoppingListHtmlParts.push(
    `<div class="shopping-category"><h3>${escapeHtml(
      category
    )}</h3><ul>${listItems.join("")}</ul></div>`
  );
}
}

const shoppingListHtml = shoppingListHtmlParts.join("");
const htmlChunks = chunkString(shoppingListHtml, 1900);

return res.status(200).json({
  weekly_meal_plan_id: weeklyMealPlanId,
  recipe_meta: recipeMeta,
  grouped_categories: groupedCategories,
  shopping_lines: shoppingLines,
  shopping_list_html: shoppingListHtml,
  shopping_list_html_1: htmlChunks[0] || "",
  shopping_list_html_2: htmlChunks[1] || "",
  shopping_list_html_3: htmlChunks[2] || "",

  scaled_recipe_1_ingredients: formatScaledRecipeIngredients(
    scaledRecipes.get(recipeMeta[0]?.id) || []
  ),
  scaled_recipe_2_ingredients: formatScaledRecipeIngredients(
    scaledRecipes.get(recipeMeta[1]?.id) || []
  ),
  scaled_recipe_3_ingredients: formatScaledRecipeIngredients(
    scaledRecipes.get(recipeMeta[2]?.id) || []
  ),
  scaled_recipe_4_ingredients: formatScaledRecipeIngredients(
    scaledRecipes.get(recipeMeta[3]?.id) || []
  ),
  scaled_recipe_5_ingredients: formatScaledRecipeIngredients(
    scaledRecipes.get(recipeMeta[4]?.id) || []
  ),
});
  } catch (error) {
    return res.status(400).json({
      error: "Invalid request",
      details: error.message,
    });
  }
};

async function queryAllNotionRows({
  notionApiKey,
  recipeIngredientsDbId,
  filter,
}) {
  const allRows = [];
  let startCursor = undefined;

  while (true) {
    const notionResponse = await fetch(
      `https://api.notion.com/v1/databases/${recipeIngredientsDbId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionApiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          filter,
          page_size: 100,
          ...(startCursor ? { start_cursor: startCursor } : {}),
        }),
      }
    );

    const notionData = await notionResponse.json();

    if (!notionResponse.ok) {
      throw new Error(
        `Notion query failed: ${JSON.stringify(notionData)}`
      );
    }

    allRows.push(...(notionData.results || []));

    if (!notionData.has_more || !notionData.next_cursor) {
      break;
    }

    startCursor = notionData.next_cursor;
  }

  return allRows;
}

function normalizeIngredientName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(optional\)\s*/g, "")
    .replace(/^fresh /, "")
    .replace(/^whole /, "")
    .replace(/^plain /, "")
    .replace(/^shredded /, "")
    .replace(/^diced /, "")
    .replace(/^chopped /, "")
    .replace(/^minced /, "")
    .replace(/^sliced /, "")
    .replace(/^grated /, "")
    .replace(/^cooked /, "")
    .replace(/greek yogurt/g, "yogurt")
    .replace(/plain yogurt/g, "yogurt")
    .replace(/lime juice/g, "lime")
    .replace(/lemon juice/g, "lemon")
    .replace(/green onion$/g, "green onions")
    .replace(/cherry tomato$/g, "cherry tomatoes")
    .replace(/tomato$/g, "tomatoes")
    .replace(/garlic cloves/g, "garlic")
    .replace(/cloves garlic/g, "garlic")
    .replace(/beef chuck roast/g, "beef chuck roast")
    .trim();
}

function getDisplayName(normalizedName, originalName) {
  const displayMap = {
    yogurt: "yogurt",
    lime: "lime",
    lemon: "lemon",
    garlic: "garlic",
    tomatoes: "tomatoes",
    "cherry tomatoes": "cherry tomatoes",
    "green onions": "green onions",
  };

  return (
    displayMap[normalizedName] ||
    String(originalName || normalizedName).trim()
  );
}

function normalizeUnit(unit) {
  const u = String(unit || "").trim().toLowerCase();

  const unitMap = {
    teaspoon: "tsp",
    teaspoons: "tsp",
    tsp: "tsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    tbsp: "tbsp",
    cup: "cup",
    cups: "cup",
    pound: "lb",
    pounds: "lb",
    lb: "lb",
    lbs: "lb",
    ounce: "oz",
    ounces: "oz",
    oz: "oz",
    clove: "clove",
    cloves: "clove",
    can: "can",
    cans: "can",
    whole: "whole",
    large: "large",
    small: "small",
    medium: "medium",
    bunch: "bunch",
    pint: "pint",
    jar: "jar",
    package: "package",
    packages: "package",
  };

  return unitMap[u] || u;
}

function normalizeCategory(category) {
  const c = String(category || "").trim();

  const categoryMap = {
    Produce: "Produce",
    Protein: "Meat",
    Meat: "Meat",
    Dairy: "Dairy",
    Frozen: "Frozen",
    Canned: "Canned",
    Pantry: "Pantry",
    Dry: "Dry",
    Baking: "Baking",
    Seasonings: "Spices",
    Spices: "Spices",
    Other: "Other",
  };

  return categoryMap[c] || c || "Other";
}

function convertUnit(quantity, unit, ingredientName) {
  let q = Number(quantity);
  let u = unit;
  const name = String(ingredientName || "").trim().toLowerCase();

  if (Number.isNaN(q)) {
    return { quantity, unit };
  }

  const liquidVolumeIngredients = new Set([
    "honey",
    "gochujang",
    "avocado oil",
    "olive oil",
    "vinegar",
    "rice vinegar",
    "apple cider vinegar",
    "soy sauce",
    "coconut aminos",
    "lemon",
    "lime",
    "water",
  ]);

  if (liquidVolumeIngredients.has(name)) {
    if (u === "tsp") {
      q = q / 3;
      u = "tbsp";
    }

    if (u === "cup") {
      q = q * 16;
      u = "tbsp";
    }

    return { quantity: q, unit: u };
  }

  if (u === "tsp" && q >= 3) {
    q = q / 3;
    u = "tbsp";
  }

  if (u === "tbsp" && q >= 8) {
    q = q / 16;
    u = "cup";
  }

  if (u === "oz" && q >= 16) {
    q = q / 16;
    u = "lb";
  }

  return { quantity: q, unit: u };
}

function finalizeUnit(item) {
  let quantity = item.quantity;
  let unit = item.unit;

  if (unit === "tsp" && quantity >= 3) {
    quantity = quantity / 3;
    unit = "tbsp";
  }

  if (unit === "tbsp" && quantity >= 8) {
    quantity = quantity / 16;
    unit = "cup";
  }

  if (unit === "oz" && quantity >= 16) {
    quantity = quantity / 16;
    unit = "lb";
  }

  return {
    ...item,
    quantity,
    unit,
  };
}

function makeShopperFriendlyItem(item) {
  let name = String(item.name || "").trim().toLowerCase();
  let unit = String(item.unit || "").trim().toLowerCase();
  let quantity = item.quantity;
  let category = item.category;
  let roles = Array.from(item.roles || []);
  let notes = Array.from(item.notes || []);

  if (name === "cilantro") {
    quantity = 1;
    unit = "bunch";
  }

  if (name === "parsley") {
    quantity = 1;
    unit = "bunch";
  }

  if (name === "onion") {
    unit = "whole";
    quantity = Math.max(1, Math.ceil(quantity || 1));

    notes = notes.filter((n) => {
      const v = String(n).toLowerCase();
      return !v.includes("medium") && !v.includes("quartered");
    });
  }

  if (
    ["cucumber", "lime", "lemon", "onion"].includes(name) &&
    unit === "whole"
  ) {
    quantity = Math.ceil(quantity);
  }

  notes = notes.filter((note) => {
    const n = String(note || "").toLowerCase().trim();

    return ![
      "chopped",
      "diced",
      "sliced",
      "thinly sliced",
      "minced",
      "finely minced",
      "halved",
      "grated",
      "squeezed dry",
      "small",
      "medium",
      "large",
      "fresh",
      "extra",
      "garnish",
      "topping",
      "for serving",
    ].includes(n);
  });

  if (name === "cucumber") {
    unit = "whole";
    notes = [];
  }

  if (
    name === "chicken breast" ||
    name === "chicken thighs" ||
    name === "chicken thigh"
  ) {
    name = "chicken breast or thighs";

    notes = notes.filter((n) => {
      const v = String(n).toLowerCase();
      return !v.includes("or thighs") && !v.includes("or breasts");
    });
  }

  if (name === "rice") {
    notes = notes.filter((n) => {
      const v = String(n).toLowerCase();
      return !v.includes("cooked") && !v.includes("for serving");
    });

    category = "Pantry";
  }

  if (quantity > 0 && roles.includes("Optional")) {
    roles = roles.filter((r) => r !== "Optional");
  }

  return {
    ...item,
    name,
    unit,
    quantity,
    category,
    roles,
    notes,
  };
}

function formatQty(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    Number(value) === 0
  ) {
    return "";
  }

  const n = Number(value);

  if (Number.isNaN(n)) {
    return String(value);
  }

  const rounded = Math.round(n * 100) / 100;
  const whole = Math.floor(rounded);
  const decimal = rounded - whole;

  const fractions = [
    { value: 0.125, label: "1/8" },
    { value: 1 / 6, label: "1/6" },
    { value: 0.25, label: "1/4" },
    { value: 1 / 3, label: "1/3" },
    { value: 0.5, label: "1/2" },
    { value: 2 / 3, label: "2/3" },
    { value: 0.75, label: "3/4" },
    { value: 5 / 6, label: "5/6" },
    { value: 0.875, label: "7/8" },
  ];

  const closest = fractions.reduce((best, fraction) =>
    Math.abs(fraction.value - decimal) <
    Math.abs(best.value - decimal)
      ? fraction
      : best
  );

  const isClose = Math.abs(closest.value - decimal) <= 0.041;

  if (!isClose) {
    return String(rounded);
  }

  if (whole === 0) {
    return closest.label;
  }

  return `${whole} ${closest.label}`;
}

function formatRoleLabel(roles) {
  if (!roles || !roles.length) {
    return "";
  }

  const normalizedRoles = roles
    .map((role) => String(role || "").trim().toLowerCase())
    .filter(Boolean);

  if (
    normalizedRoles.includes("optional") &&
    normalizedRoles.every((role) => role === "optional")
  ) {
    return " (optional)";
  }

  if (normalizedRoles.includes("for serving")) return " (for serving)";
  if (normalizedRoles.includes("serving")) return " (for serving)";
  if (normalizedRoles.includes("topping")) return " (topping)";
  if (normalizedRoles.includes("garnish")) return " (garnish)";
  if (normalizedRoles.includes("to taste")) return " (to taste)";

  return "";
}

function formatNotesLabel(notes) {
  if (!notes || !notes.length) {
    return "";
  }

  const hiddenNotes = new Set([
    "chopped",
    "diced",
    "sliced",
    "thinly sliced",
    "minced",
    "finely minced",
    "halved",
    "grated",
    "squeezed dry",
    "wedges",
    "cut into wedges",
    "small",
    "medium",
    "large",
    "fresh",
    "extra",
    "garnish",
    "for serving",
    "topping",
  ]);

  const cleanNotes = notes
    .map((note) => String(note || "").trim())
    .filter(Boolean)
    .filter((note) => !hiddenNotes.has(note.toLowerCase()));

  if (!cleanNotes.length) {
    return "";
  }

  return ` (${cleanNotes.join("; ")})`;
}

function cleanDisplayLine(line) {
  return String(line || "")
    .replace(/\bwhole lime juice\b/gi, "whole lime")
    .replace(/\bwhole lemon juice\b/gi, "whole lemon")
    .replace(/\blime lime juice\b/gi, "lime")
    .replace(/\blemon lemon juice\b/gi, "lemon")
    .replace(/\bwhole whole\b/gi, "whole")
    .replace(/\bcup cup\b/gi, "cup")
    .replace(/\btbsp tbsp\b/gi, "tbsp")
    .replace(/\btsp tsp\b/gi, "tsp")
    .replace(/\s+/g, " ")
    .trim();
}

function formatScaledRecipeIngredients(items) {
  return items
    .map((item) => {
      const qty = formatQty(item.quantity);

      const unit = item.unit
        ? `${item.unit} `
        : "";

      const notes = item.notes
        ? `, ${item.notes}`
        : "";

      const role = item.role
        ? ` (${item.role})`
        : "";

      return `${qty}${qty ? " " : ""}${unit}${item.name}${notes}${role}`.trim();
    })
    .join("\n");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function chunkString(str, maxLength) {
  const chunks = [];

  for (let i = 0; i < str.length; i += maxLength) {
    chunks.push(str.slice(i, i + maxLength));
  }

  return chunks;
}
