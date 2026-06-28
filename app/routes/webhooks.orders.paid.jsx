import { authenticate } from "../shopify.server";
import { saveActivity } from "../services/tracker.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received Webhook ${topic} for ${shop}`);

  if (topic === "ORDERS_PAID") {
    // 1. Extract visitorId from note_attributes
    const noteAttributes = payload.note_attributes || [];
    const visitorIdAttr = noteAttributes.find((attr) => attr.name === "_vt_visitor_id");
    const visitorId = visitorIdAttr?.value;

    if (!visitorId) {
      console.log(`Bypassing order tracking for order #${payload.order_number}: _vt_visitor_id is missing.`);
      return new Response(null, { status: 200 });
    }

    console.log(`Tracking purchase for order #${payload.order_number} and visitor ${visitorId}`);

    // 2. Iterate line items and record purchase event for each
    const lineItems = payload.line_items || [];
    for (const item of lineItems) {
      if (!item.product_id) {
        continue;
      }

      // Convert product_id to gid format matching database Product ID
      const productGid = `gid://shopify/Product/${item.product_id}`;
      const price = item.price ? parseFloat(item.price) : null;

      try {
        await saveActivity({
          visitorId,
          shopDomain: shop,
          productId: productGid,
          eventType: "purchase",
          price,
        });
        console.log(`Recorded purchase activity for product ${productGid} (Price: ${price})`);
      } catch (err) {
        console.error(`Failed to save activity for product ${productGid}:`, err);
      }
    }
  }

  return new Response(null, { status: 200 });
};
