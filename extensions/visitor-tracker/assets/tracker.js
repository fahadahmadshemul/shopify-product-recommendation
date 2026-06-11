(function () {
  // 1. Generate or retrieve visitor unique ID
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
  
  // Use relative App Proxy URL so that tunnel URL changes on npm run dev don't break tracking
  const APP_URL = "/apps/recommendation-tracker";

  // 2. Event tracking helper
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

  // 3. Detect product page
  const productId = window.ShopifyAnalytics?.meta?.product?.id;
  if (!productId) {
    // Check if we are on a thank you / order confirmation page to track purchases
    if (window.Shopify?.Checkout?.step === "thank_you") {
      const items = window.Shopify?.checkout?.line_items || [];
      items.forEach((item) => {
        track("purchase", `gid://shopify/Product/${item.product_id}`);
      });
    }
    return;
  }

  const pid = `gid://shopify/Product/${productId}`;

  // 4. View event tracking
  let viewStart = Date.now();
  track("view", pid);

  // Track view duration on exit
  window.addEventListener("beforeunload", () => {
    const duration = Math.round((Date.now() - viewStart) / 1000);
    track("view", pid, duration);
  });

  // 5. Add-to-cart click tracking
  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[name="add"], .add-to-cart, #AddToCart, .product-form__submit');
    if (btn) {
      track("cart", pid);
    }
  });

  // 6. Fetch and render Product Recommendations
  fetch(`${APP_URL}/api/recommendations?productId=${encodeURIComponent(pid)}&visitorId=${encodeURIComponent(visitorId)}`)
    .then((res) => res.json())
    .then((data) => {
      if (data && data.recommendations && data.recommendations.length > 0) {
        renderRecommendations(data.recommendations);
      }
    })
    .catch((err) => console.error("Error loading recommendations:", err));

  // 7. Render widget function
  function renderRecommendations(recommendations) {
    // Avoid duplicate insertions
    if (document.getElementById("shopify-recommendations-widget")) return;

    // Build Style Block
    const style = document.createElement("style");
    style.innerHTML = `
      #shopify-recommendations-widget {
        clear: both;
        width: 100%;
        max-width: 1200px;
        margin: 40px auto;
        padding: 0 20px;
        box-sizing: border-box;
      }
      .shopify-recs-wrapper {
        background: #ffffff;
        border-radius: 12px;
        padding: 28px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
        border: 1px solid #eaeaea;
        box-sizing: border-box;
      }
      .shopify-recs-title {
        font-size: 22px;
        font-weight: 700;
        margin: 0 0 24px 0;
        color: #1a1a1a;
        letter-spacing: -0.5px;
      }
      .shopify-recs-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px;
      }
      @media (min-width: 768px) {
        .shopify-recs-grid {
          grid-template-columns: repeat(4, 1fr);
          gap: 24px;
        }
      }
      .shopify-recs-card {
        display: flex;
        flex-direction: column;
        text-decoration: none;
        background: transparent;
        border-radius: 8px;
        overflow: hidden;
        transition: transform 0.3s ease;
      }
      .shopify-recs-card:hover {
        transform: translateY(-5px);
      }
      .shopify-recs-image-wrapper {
        position: relative;
        width: 100%;
        padding-bottom: 100%;
        overflow: hidden;
        border-radius: 8px;
        background: #f8f8f8;
        border: 1px solid #f0f0f0;
      }
      .shopify-recs-image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.4s ease;
      }
      .shopify-recs-card:hover .shopify-recs-image {
        transform: scale(1.04);
      }
      .shopify-recs-info {
        padding: 12px 2px;
      }
      .shopify-recs-product-title {
        font-size: 14px;
        font-weight: 600;
        color: #2c3e50;
        margin: 0 0 6px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color 0.2s ease;
      }
      .shopify-recs-card:hover .shopify-recs-product-title {
        color: #008060;
      }
      .shopify-recs-price {
        font-size: 15px;
        font-weight: 700;
        color: #008060;
      }
      @media (prefers-color-scheme: dark) {
        .shopify-recs-wrapper {
          background: #1a1a1a;
          border-color: #2c2c2e;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
        }
        .shopify-recs-title {
          color: #ffffff;
        }
        .shopify-recs-product-title {
          color: #e5e5ea;
        }
        .shopify-recs-image-wrapper {
          background: #2c2c2e;
          border-color: #3a3a3c;
        }
      }
    `;
    document.head.appendChild(style);

    // Build Cards HTML
    const cardsHtml = recommendations
      .map((rec) => {
        const imageSrc = rec.imageUrl || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23F4F4F4'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='10' fill='%23999999'>No Image</text></svg>`;
        const productUrl = `/products/${rec.handle || ""}`;
        return `
          <a href="${productUrl}" class="shopify-recs-card" data-rec-id="${rec.id}">
            <div class="shopify-recs-image-wrapper">
              <img src="${imageSrc}" alt="${escapeHtml(rec.title)}" class="shopify-recs-image" loading="lazy" />
            </div>
            <div class="shopify-recs-info">
              <h4 class="shopify-recs-product-title">${escapeHtml(rec.title)}</h4>
              <span class="shopify-recs-price">$${Number(rec.price).toFixed(2)}</span>
            </div>
          </a>
        `;
      })
      .join("");

    // Build Widget Container HTML
    const widgetHtml = `
      <div class="shopify-recs-wrapper">
        <h3 class="shopify-recs-title">Recommended for You</h3>
        <div class="shopify-recs-grid">
          ${cardsHtml}
        </div>
      </div>
    `;

    const widgetContainer = document.createElement("div");
    widgetContainer.id = "shopify-recommendations-widget";
    widgetContainer.innerHTML = widgetHtml;

    // Add click event tracking to recommendation cards
    widgetContainer.querySelectorAll(".shopify-recs-card").forEach((card) => {
      card.addEventListener("click", () => {
        const recId = card.getAttribute("data-rec-id");
        track("view", recId); // Register a view event on the recommended product upon click
      });
    });

    // Smart insertion point
    const mainProductSection = document.querySelector(".product") || 
                               document.querySelector(".product-single") || 
                               document.querySelector("#MainContent") || 
                               document.querySelector("main");
                               
    if (mainProductSection) {
      // Append right below the main product details section
      mainProductSection.parentNode.insertBefore(widgetContainer, mainProductSection.nextSibling);
    } else {
      // Fallback
      document.body.appendChild(widgetContainer);
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
