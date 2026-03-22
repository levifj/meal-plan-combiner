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
          Authorization: `Bearer ${notionApiKey}`,
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
    const first = notionData.results?.[0] || null;
    const p = first?.properties || {};

    return res.status(200).json({
      weekly_meal_plan_id: weeklyMealPlanId,
      recipe_count: recipeIds.length,
      notion_results_count: notionData.results?.length || 0,
      shopping_category_field: p["Shopping Category"] || null,
      quantity_field: p["Quantity"] || null,
      unit_field: p["Unit"] || null,
      ingredient_name_field: p["Ingredient Name"] || null
    });
  } catch (error) {
    return res.status(400).json({
      error: "Debug failed",
      details: error.message
    });
  }
}