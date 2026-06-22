import db from "../db.server";

const DEFAULTS = {
  heading: "Recommended for You",
  coldStartHeading: "Popular Products",
  emptyHeading: "Coming Soon",
  backgroundColor: null,
  cardBackgroundColor: null,
  borderColor: null,
  borderWidth: null,
  borderRadius: null,
  headingColor: null,
  titleColor: null,
  priceColor: null,
  saleBadgeColor: null,
};

export function getDefaults() {
  return { ...DEFAULTS };
}

export async function getWidgetSettings(shopDomain) {
  const shop = await db.shop.findUnique({
    where: { shop: shopDomain },
    select: { widgetSettings: true },
  });

  try {
    const dbSettings = JSON.parse(shop?.widgetSettings || "{}");
    return { ...DEFAULTS, ...dbSettings };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveWidgetSettings(shopDomain, settings) {
  const cleaned = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value !== null && value !== "" && value !== undefined) {
      cleaned[key] = value;
    }
  }

  await db.shop.update({
    where: { shop: shopDomain },
    data: { widgetSettings: JSON.stringify(cleaned) },
  });

  return { ...DEFAULTS, ...cleaned };
}
