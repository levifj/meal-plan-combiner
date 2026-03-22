export default async function handler(req, res) {
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const weeklyMealPlanId = body.weekly_meal_plan_id || "";
    const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];

    const combined = new Map();

    for (const item of ingredients) {
      const p = item?.properties_value || {};

      const ingredientId = p?.Ingredient?.[0]?.id || "";

      const ingredientName =
        p?.["Ingredient Name"]?.rollup?.array?.[0]?.title?.[0]?.plain_text ||
        p?.["Ingredient Name (text)"]?.string ||
        "Unknown ingredient";

      const rawQty = p?.Quantity;
      const quantity =
        rawQty !== null && rawQty !== undefined && rawQty !== ""
          ? Number(rawQty)
          : null;

      const unit = p?.Unit?.name || "";

      const category =
        p?.["Shopping Category"]?.array?.[0]?.select?.name ||
        p?.["Shopping Category"]?.select?.name ||
        p?.["Shopping Category"]?.multi_select?.[0]?.name ||
        "Other";

      if (!ingredientId || !ingredientName) continue;

      // Skip only explicit zero quantities
      if (quantity === 0) continue;

      const key = `${ingredientId}__${unit}`;

      if (!combined.has(key)) {
        combined.set(key, {
          ingredient_id: ingredientId,
          name: ingredientName,
          quantity: 0,
          unit,
          category,
        });
      }

      combined.get(key).quantity += quantity || 0;
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
      "Protein",
      "Meat",
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
      shoppingLines.push(category);
      shoppingListHtmlParts.push(`<h3>${escapeHtml(category)}</h3><ul>`);

      groupedCategories[category].sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      for (const item of groupedCategories[category]) {
        const hasQty = item.quantity > 0;
        const qty = hasQty ? formatQty(item.quantity) : "";
        const line = `${qty}${qty && item.unit ? ` ${item.unit}` : ""} ${item.name}`.trim();

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