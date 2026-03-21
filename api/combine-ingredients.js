export default async function handler(req, res) {
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const recipeIdsCsv = body.recipe_ids_csv || "";
    const recipeIds = recipeIdsCsv
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const notionApiKey = process.env.NOTION_API_KEY;
    const recipesDbId = process.env.RECIPES_DB_ID;

    if (!notionApiKey) {
      return res.status(400).json({ error: "Missing NOTION_API_KEY" });
    }

    if (!recipesDbId) {
      return res.status(400).json({ error: "Missing RECIPES_DB_ID" });
    }

    const recipes = [];

    for (const recipeId of recipeIds) {
      const response = await fetch(
        `https://api.notion.com/v1/pages/${recipeId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${notionApiKey}`,
            "Notion-Version": "2022-06-28"
          }
        }
      );

      const data = await response.json();
      const p = data.properties || {};

      const name =
        p["Name"]?.title?.[0]?.plain_text || "Unnamed recipe";

      const instructions =
        p["Instructions"]?.rich_text?.[0]?.plain_text || "";

      recipes.push({
        id: recipeId,
        name,
        instructions
      });
    }

    return res.status(200).json({
      recipe_count: recipes.length,
      recipes
    });
  } catch (error) {
    return res.status(400).json({
      error: "Failed to build recipes payload",
      details: error.message,
    });
  }
}