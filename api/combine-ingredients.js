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

    return res.status(200).json({
      weekly_meal_plan_id: weeklyMealPlanId,
      recipe_ids_csv: recipeIdsCsv,
      recipe_ids: recipeIds,
      recipe_count: recipeIds.length
    });
  } catch (error) {
    return res.status(400).json({
      error: "Invalid request",
      details: error.message,
    });
  }
}