export default async function handler(req, res) {
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const weeklyMealPlanId = body.weekly_meal_plan_id || "";
    const recipeIdsCsv = body.recipe_ids_csv || "";
    const recipeIds = recipeIdsCsv
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

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
        grouped_categories: {},
        shopping_lines: [],
        shopping_list_html: "",
      });
    }

    const orFilters = recipeIds.map((id) => ({
      property: "Recipes",
      relation: {
        contains: id
      }
    }));

    const notionResponse = await fetch(
      `https://api.notion.com/v1/databases/${recipeIngredientsDbId}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${notionApiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28"
        },
        body: JSON.stringify({
          filter: {
            or: orFilters
          },
          page_size: 100
        })
      }
    );

    const notionData = await notionResponse.json();

    if (!notionResponse.ok) {
      return res.status(400).json({
        error: "Notion query failed",
        notion_data: notionData
      });
    }

    const combined = new Map();

    for (const row of notionData.results || []) {
      const p = row.properties || {};

      const ingredientRelation = p["Ingredient"]?.relation || [];
      const ingredientId = ingredientRelation[0]?.id || "";

      const ingredientName =
        p["Ingredient Name"]?.rollup?.array?.[0]?.title?.[0]?.plain_text ||
        "Unknown ingredient";

      const quantity = Number(p["Quantity"]?.number || 0);
      if (quantity <= 0) continue;

      const unit = p["Unit"]?.select?.name || "";

      const category =
        p["Shopping Category"]?.select?.name ||
        p["Shopping Category"]?.multi_select?.[0]?.name ||
        "Other";

      if (!ingredientName) continue;

      const key = `${ingredientId || ingredientName}__${unit}__${category}`;

      if (!combined.has(key)) {
        combined.set(key, {
          ingredient_id: ingredientId,
          name: ingredientName,
          quantity: 0,
          unit,
          category,
        });
      }

      combined.get(key).quantity += quantity;
    }

    const groupedCategories = {};

    for (const item of combined.values()) {
      if (!groupedCategories[item.category]) {
        groupedCategories[item.category] = [];
      }

      groupedCategories[item.category].push({
        name: item.name,
        quantity: Number(item.quantity.toFixed(2)),
        unit: item.unit,
      });
    }

    const categoryOrder = [
      "Produce",
      "Meat",
      "Dairy",
      "Frozen",
      "Canned",
      "Dry",
      "Baking",
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
      shoppingLines.push(category);
      shoppingListHtmlParts.push(`<h3>${escapeHtml(category)}</h3><ul>`);

      groupedCategories[category].sort((a, b) => a.name.localeCompare(b.name));

      for (const item of groupedCategories[category]) {
        const qty = formatQty(item.quantity);
        const line = `${qty}${item.unit ? ` ${item.unit}` : ""} ${item.name}`.trim();

        shoppingLines.push(line);
        shoppingListHtmlParts.push(`<li>${escapeHtml(line)}</li>`);
      }

      shoppingListHtmlParts.push(`</ul>`);
    }

    return res.status(200).json({
      weekly_meal_plan_id: weeklyMealPlanId,
      grouped_categories: groupedCategories,
      shopping_lines: shoppingLines,
      shopping_list_html: shoppingListHtmlParts.join(""),
    });
  } catch (error) {
    return res.status(400).json({
      error: "Invalid request",
      details: error.message,
    });
  }
}

function formatQty(value) {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}