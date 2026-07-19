const { put } = require("@vercel/blob");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const secret = req.headers["x-preppi-secret"];

    if (!secret || secret !== process.env.PREPPI_UPDATE_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { recipes, stealOurPlanUrl = null } = req.body || {};

    if (!Array.isArray(recipes)) {
      return res.status(400).json({
        error: "Invalid request",
        message: "recipes must be an array",
      });
    }

    const data = {
      recipes,
      stealOurPlanUrl,
    };

    const blob = await put(
      "mealplan-combiner-blob/recipes.json",
      JSON.stringify(data, null, 2),
      {
        access: "public",
        contentType: "application/json",
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }
    );

    return res.status(200).json({
      success: true,
      recipeCount: recipes.length,
      url: blob.url,
    });
  } catch (error) {
    console.error("Failed to update recipe cache:", error);

    return res.status(500).json({
      error: "Failed to update recipe cache",
      message: error.message,
    });
  }
};