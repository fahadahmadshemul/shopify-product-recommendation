(function () {
  // ১. Visitor এর unique ID বানাও (বা existing টা নাও)
  function getVisitorId() {
    let id = localStorage.getItem("vt_visitor_id");
    if (!id) {
      id = "v_" + Math.random().toString(36).substr(2, 9) + Date.now();
      localStorage.setItem("vt_visitor_id", id);
    }
    return id;
  }

  const visitorId = getVisitorId();
  const shopDomain = window.Shopify?.shop || location.hostname;
  // ← npm run dev করলে Shopify CLI যে URL দেয় সেটা এখানে বসাও
  // Example: https://abc-xyz-123.trycloudflare.com
  const APP_URL = "https://retailers-charitable-cartridges-healing.trycloudflare.com";

  // ২. Activity পাঠানোর function
  function track(eventType, productId, duration = null) {
    fetch(`${APP_URL}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId,
        shopDomain,
        productId,
        eventType,
        duration,
      }),
    }).catch((err) => console.error("Track failed:", err));
  }

  // ৩. Product page detect করো
  const productId = window.ShopifyAnalytics?.meta?.product?.id;
  if (!productId) return; // Product page না হলে বন্ধ

  const pid = `gid://shopify/Product/${productId}`;

  // ৪. VIEW — page load এ track করো
  let viewStart = Date.now();
  track("view", pid);

  // ৫. DURATION — page ছাড়ার সময় কতক্ষণ দেখলো save করো
  window.addEventListener("beforeunload", () => {
    const duration = Math.round((Date.now() - viewStart) / 1000);
    track("view", pid, duration);
  });

  // ৬. CART — Add to cart button track করো
  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[name="add"], .add-to-cart, #AddToCart');
    if (btn) {
      track("cart", pid);
    }
  });

  // ৭. PURCHASE — Thank you page detect করো
  if (window.Shopify?.Checkout?.step === "thank_you") {
    const items = window.Shopify?.checkout?.line_items || [];
    items.forEach((item) => {
      track("purchase", `gid://shopify/Product/${item.product_id}`);
    });
  }
})();
