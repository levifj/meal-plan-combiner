export default async function handler(req, res) {
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
    const first = ingredients[0] || null;
    const p = first?.properties_value || {};

    return res.status(200).json({
      ingredient_count: ingredients.length,
      first_item: first,
      quantity_field: p?.Quantity ?? null,
      shopping_category_field: p?.["Shopping Category"] ?? null,
      unit_field: p?.Unit ?? null,
      ingredient_name_field_1: p?.["Ingredient Name"] ?? null,
      ingredient_name_field_2: p?.["Ingredient Name (text)"] ?? null
    });
  } catch (error) {
    return res.status(400).json({
      error: "Debug failed",
      details: error.message
    });
  }
}