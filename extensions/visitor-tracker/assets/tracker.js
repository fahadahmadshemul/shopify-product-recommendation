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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .shopify-recs-wrapper {
        background: #ffffff;
        border-radius: 12px;
        padding: 28px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
        border: 1px solid #eaeaea;
        box-sizing: border-box;
      }
      .shopify-recs-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
      }
      .shopify-recs-title {
        font-size: 22px;
        font-weight: 700;
        margin: 0;
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
          gap: 20px;
        }
      }
      .shopify-recs-card {
        display: flex;
        flex-direction: column;
        text-decoration: none;
        background: #fafafa;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid #f0f0f0;
        transition: transform 0.25s ease, box-shadow 0.25s ease;
        position: relative;
      }
      .shopify-recs-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
      }
      .shopify-recs-image-wrapper {
        position: relative;
        width: 100%;
        padding-bottom: 100%;
        overflow: hidden;
        background: #f4f4f4;
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
        transform: scale(1.06);
      }
      .shopify-recs-sale-badge {
        position: absolute;
        top: 10px;
        left: 10px;
        background: #e22120;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
        border-radius: 4px;
        line-height: 1;
        z-index: 1;
      }
      .shopify-recs-info {
        padding: 12px 12px 0;
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      .shopify-recs-product-title {
        font-size: 13px;
        font-weight: 600;
        color: #2c3e50;
        margin: 0 0 6px 0;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        min-height: 35px;
        transition: color 0.2s ease;
      }
      .shopify-recs-card:hover .shopify-recs-product-title {
        color: #008060;
      }
      .shopify-recs-price-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 0;
      }
      .shopify-recs-price {
        font-size: 16px;
        font-weight: 700;
        color: #008060;
      }
      .shopify-recs-compare-price {
        font-size: 13px;
        font-weight: 500;
        color: #999;
        text-decoration: line-through;
      }
      .shopify-recs-card-footer {
        padding: 10px 12px 12px;
        margin-top: auto;
      }
      .shopify-recs-atc-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        padding: 10px 0;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: #008060;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.15s ease;
      }
      .shopify-recs-atc-btn:hover {
        background: #006e52;
      }
      .shopify-recs-atc-btn:active {
        transform: scale(0.97);
      }
      .shopify-recs-atc-btn.added {
        background: #1a1a1a;
        pointer-events: none;
      }
      .shopify-recs-atc-spinner {
        display: none;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: recs-spin 0.6s linear infinite;
      }
      @keyframes recs-spin {
        to { transform: rotate(360deg); }
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
        .shopify-recs-card {
          background: #222224;
          border-color: #2c2c2e;
        }
        .shopify-recs-product-title {
          color: #e5e5ea;
        }
        .shopify-recs-price {
          color: #34d399;
        }
        .shopify-recs-image-wrapper {
          background: #2c2c2e;
        }
        .shopify-recs-card:hover .shopify-recs-product-title {
          color: #34d399;
        }
      }
    `;
    document.head.appendChild(style);

    // Build Cards HTML
    const cardsHtml = recommendations
      .map((rec) => {
        const imageSrc = rec.imageUrl || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23F4F4F4'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='10' fill='%23999999'>No Image</text></svg>`;
        const handleSlug = rec.handle || rec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const productUrl = `/products/${handleSlug}`;
        const hasSale = rec.compareAtPrice && rec.compareAtPrice > rec.price;
        const variantId = rec.firstVariantId || "";
        const saleBadge = hasSale
          ? `<span class="shopify-recs-sale-badge">SALE</span>`
          : "";
        const comparePriceHtml = hasSale
          ? `<span class="shopify-recs-compare-price">$${Number(rec.compareAtPrice).toFixed(2)}</span>`
          : "";
        return `
          <div class="shopify-recs-card" data-rec-id="${rec.id}" data-variant-id="${escapeHtml(variantId)}">
            <a href="${productUrl}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;flex:1;">
              <div class="shopify-recs-image-wrapper">
                ${saleBadge}
                <img src="${imageSrc}" alt="${escapeHtml(rec.title)}" class="shopify-recs-image" loading="lazy" />
              </div>
              <div class="shopify-recs-info">
                <h4 class="shopify-recs-product-title">${escapeHtml(rec.title)}</h4>
                <div class="shopify-recs-price-row">
                  <span class="shopify-recs-price">$${Number(rec.price).toFixed(2)}</span>
                  ${comparePriceHtml}
                </div>
              </div>
            </a>
            <div class="shopify-recs-card-footer">
              ${variantId ? `<button class="shopify-recs-atc-btn" data-variant-id="${escapeHtml(variantId)}" data-rec-id="${rec.id}">
                <span class="shopify-recs-atc-spinner"></span>
                <span class="shopify-recs-atc-label">Add to Cart</span>
              </button>` : ""}
            </div>
          </div>
        `;
      })
      .join("");

    // Build Widget Container HTML
    const widgetHtml = `
      <div class="shopify-recs-wrapper">
        <div class="shopify-recs-section-header">
          <h3 class="shopify-recs-title">Recommended for You</h3>
        </div>
        <div class="shopify-recs-grid">
          ${cardsHtml}
        </div>
      </div>
    `;

    const widgetContainer = document.createElement("div");
    widgetContainer.id = "shopify-recommendations-widget";
    widgetContainer.innerHTML = widgetHtml;

    // Add-to-Cart button handlers
    widgetContainer.querySelectorAll(".shopify-recs-atc-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const variantId = btn.getAttribute("data-variant-id");
        const recId = btn.getAttribute("data-rec-id");
        const label = btn.querySelector(".shopify-recs-atc-label");
        const spinner = btn.querySelector(".shopify-recs-atc-spinner");

        if (!variantId || btn.classList.contains("added")) return;

        btn.classList.add("loading");
        spinner.style.display = "block";
        label.textContent = "Adding...";

        try {
          const res = await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: variantId, quantity: 1 }),
          });

          if (res.ok) {
            btn.classList.add("added");
            label.textContent = "✓ Added";
            track("cart", recId);
          } else {
            label.textContent = "Error";
            setTimeout(() => {
              btn.classList.remove("loading");
              spinner.style.display = "none";
              label.textContent = "Add to Cart";
            }, 1500);
          }
        } catch (err) {
          label.textContent = "Error";
          setTimeout(() => {
            btn.classList.remove("loading");
            spinner.style.display = "none";
            label.textContent = "Add to Cart";
          }, 1500);
        }
      });
    });

    // Click tracking on card title/image area
    widgetContainer.querySelectorAll(".shopify-recs-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".shopify-recs-atc-btn")) return;
        const recId = card.getAttribute("data-rec-id");
        track("view", recId);
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
