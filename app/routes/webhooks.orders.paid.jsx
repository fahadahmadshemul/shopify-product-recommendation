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

    const customerId = payload.customer?.id ? String(payload.customer.id) : null;

    console.log(`Tracking purchase for order #${payload.order_number} and visitor ${visitorId} (Customer: ${customerId})`);

    // 2. Iterate line items and record purchase event for each
    const lineItems = payload.line_items || [];
    const orderId = payload.id ? String(payload.id) : null;

    for (const item of lineItems) {
      if (!item.product_id) {
        continue;
      }

      // Convert product_id to gid format matching database Product ID
      const productGid = `gid://shopify/Product/${item.product_id}`;
      const unitPrice = item.price ? parseFloat(item.price) : 0;
      const quantity = item.quantity ? Number(item.quantity) : 1;
      const price = unitPrice * quantity;

      try {
        await saveActivity({
          visitorId,
          shopDomain: shop,
          productId: productGid,
          eventType: "purchase",
          price,
          customerId,
          orderId,
        });
        console.log(`Recorded purchase activity for product ${productGid} (Price: ${price}, Order: ${orderId})`);
      } catch (err) {
        console.error(`Failed to save activity for product ${productGid}:`, err);
      }
    }
  }

  return new Response(null, { status: 200 });
};
