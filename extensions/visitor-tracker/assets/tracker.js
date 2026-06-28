(function () {
  const APP_URL = "/apps/recommendation-tracker";

  var shopDomain = window.Shopify?.shop || location.hostname;

  // --- GDPR Consent Management ---
  function getConsent() {
    return localStorage.getItem("vt_consent_withdrawn") !== "1";
  }

  // --- Visitor Token Management (HMAC-signed server-issued token) ---
  // The server signs the visitorId on every /api/track response.
  // We store this token and send it back on /api/gdpr requests so the server
  // can verify the caller genuinely owns this visitorId.
  // httpOnly cookies are NOT used — see visitor-token.server.js for the rationale.
  function getVisitorToken() {
    return localStorage.getItem("vt_visitor_token");
  }

  function setVisitorToken(token) {
    if (token) localStorage.setItem("vt_visitor_token", token);
  }

  function setConsent(granted) {
    if (granted) {
      localStorage.removeItem("vt_consent_withdrawn");
    } else {
      localStorage.setItem("vt_consent_withdrawn", "1");
      // Purge server-side data on opt-out
      var oldId = getVisitorId(false);
      var token = getVisitorToken();
      if (oldId) {
        // Include visitorToken so the server can verify we own this visitorId.
        // FALLBACK: If no token yet (e.g. first page load with immediate opt-out),
        // the DELETE will return 401. This is acceptable — no data was tracked yet.
        var gdprUrl = APP_URL + "/api/gdpr?visitorId=" + encodeURIComponent(oldId) +
          "&shop=" + encodeURIComponent(shopDomain) +
          (token ? "&visitorToken=" + encodeURIComponent(token) : "");
        fetch(gdprUrl, { method: "DELETE" }).catch(function () { });
      }
      localStorage.removeItem("vt_visitor_id");
      localStorage.removeItem("vt_visitor_token");
    }
  }

  // 1. Generate or retrieve visitor unique ID
  function getVisitorId(create) {
    if (create === undefined) create = true;
    var id = localStorage.getItem("vt_visitor_id");
    if (!id && create) {
      id = "v_" + Math.random().toString(36).substr(2, 9) + Date.now();
      localStorage.setItem("vt_visitor_id", id);
    }
    return id;
  }

  if (!getConsent()) {
    return; // User has opted out — don't track anything
  }

  // Show privacy notice banner on first visit (opt-out model)
  (function () {
    if (localStorage.getItem("vt_consent_banner_dismissed") === "1") return;
    if (document.getElementById("vt-consent-banner")) return;

    var banner = document.createElement("div");
    banner.id = "vt-consent-banner";
    banner.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;background:#1a1a1a;color:#fff;" +
      "padding:16px 20px;z-index:2147483647;display:flex;align-items:center;" +
      "justify-content:space-between;flex-wrap:wrap;gap:12px;font-family:" +
      "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;";
    banner.innerHTML =
      '<span style="flex:1;min-width:200px;">' +
      'This site uses analytics to personalize product recommendations. ' +
      'See our <a href="/policies/privacy-policy" style="color:#34d399;">privacy policy</a>. ' +
      'You can opt out at any time.' +
      "</span>" +
      '<div style="display:flex;gap:8px;flex-shrink:0;">' +
      '<button id="vt-consent-optout" style="background:transparent;color:#999;border:1px solid #555;' +
      'padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;">Opt Out</button>' +
      '<button id="vt-consent-dismiss" style="background:#008060;color:#fff;border:none;' +
      'padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;">OK</button>' +
      "</div>";
    document.body.appendChild(banner);

    document.getElementById("vt-consent-dismiss").addEventListener("click", function () {
      localStorage.setItem("vt_consent_banner_dismissed", "1");
      banner.remove();
    });

    document.getElementById("vt-consent-optout").addEventListener("click", function () {
      setConsent(false);
      localStorage.setItem("vt_consent_banner_dismissed", "1");
      banner.remove();
    });
  })();

  var visitorId = getVisitorId();

  // Set cart attribute with visitorId so it flows through to order for webhook tracking
  fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { _vt_visitor_id: visitorId } })
  }).catch(function() {});

  // 2. Event tracking helper
  function track(eventType, productId, duration = null, price = null) {
    var customerId = (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) ||
                     (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.customerId) ||
                     (window.__st && window.__st.cid) ||
                     null;

    fetch(`${APP_URL}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Note: credentials: 'include' is intentionally NOT set here.
      // This is a cross-domain App Proxy request and third-party cookies are blocked
      // in Safari/Chrome. Instead we use the HMAC-signed visitorToken returned in the
      // response body and stored in localStorage for authorization.
      body: JSON.stringify({
        visitorId,
        shopDomain,
        productId,
        eventType,
        duration,
        price,
        customerId: customerId ? String(customerId) : null,
      }),
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      // Store the server-issued signed token so we can authorize future /api/gdpr requests.
      if (data && data.visitorToken) {
        setVisitorToken(data.visitorToken);
      }
    })
    .catch((err) => console.error("Track failed:", err));
  }

  // 3. Detect product page — purchase tracking is handled via orders/create webhook
  const productId = window.ShopifyAnalytics?.meta?.product?.id;
  if (!productId) {
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
      // Refresh cart attribute with visitorId for webhook tracking
      fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: { _vt_visitor_id: visitorId } })
      }).catch(function() {});
    }
  });

  // 6. Fetch and render Product Recommendations
  fetch(`${APP_URL}/api/recommendations?productId=${encodeURIComponent(pid)}&visitorId=${encodeURIComponent(visitorId)}`)
    .then((res) => res.json())
    .then((data) => {
      if (data) {
        renderRecommendations(data);
      }
    })
    .catch((err) => console.error("Error loading recommendations:", err));

  // 7. Render widget function
  function renderRecommendations(data) {
    const recommendations = data.recommendations || [];
    // Skip products that haven't been synced with a handle yet so cards never link to "#".
    const displayRecommendations = recommendations.filter((rec) => rec.handle);
    const shopCurrency = data.shopCurrency || "USD";
    const coldStart = data.coldStart || false;

    var formatter = typeof Intl !== "undefined" && Intl.NumberFormat
      ? new Intl.NumberFormat(undefined, { style: "currency", currency: shopCurrency })
      : null;
    function formatPrice(amount) {
      if (formatter) return formatter.format(amount);
      return shopCurrency + " " + Number(amount).toFixed(2);
    }
    // Avoid duplicate insertions
    if (document.getElementById("shopify-recommendations-widget")) return;

    // Build Style Block
    const style = document.createElement("style");
    const ws = data.widgetSettings || {};
    const heading = ws.heading;
    const coldStartHeading = ws.coldStartHeading;
    const emptyHeading = ws.emptyHeading;
    const hasCustomBg = !!ws.backgroundColor;
    const hasCustomCardBg = !!ws.cardBackgroundColor;
    const hasCustomBorder = !!ws.borderColor;
    const customBorderW = ws.borderWidth ? ws.borderWidth + "px" : null;
    const customBorderR = ws.borderRadius ? ws.borderRadius + "px" : null;
    const customHeadingColor = ws.headingColor;
    const customTitleColor = ws.titleColor;
    const customPriceColor = ws.priceColor;
    const customSaleBg = ws.saleBadgeColor;

    const bg = hasCustomBg ? ws.backgroundColor : "rgb(var(--color-background, 255 255 255))";
    const cardBg = hasCustomCardBg ? ws.cardBackgroundColor : "rgb(var(--color-background, 255 255 255))";
    const borderCol = hasCustomBorder ? ws.borderColor : "rgba(var(--color-foreground, 0 0 0), var(--border-opacity, 0.08))";
    const headCol = customHeadingColor || "rgb(var(--color-foreground, 0 0 0))";
    const titleCol = customTitleColor || "rgb(var(--color-foreground, 0 0 0))";
    const priceCol = customPriceColor || "rgb(var(--color-foreground, 0 0 0))";
    const saleBgCol = customSaleBg || "rgb(var(--color-badge-sale-background, 200 30 30))";
    const radius = customBorderR || "var(--border-radius, 8px)";
    const bdrWidth = customBorderW || "var(--border-width, 1px)";
    const compareCol = customPriceColor
      ? `${customPriceColor}88`
      : "rgba(var(--color-foreground, 0 0 0), 0.55)";
    const shadowCol = hasCustomBorder
      ? `${ws.borderColor}22`
      : "rgba(var(--color-shadow, 0 0 0), var(--shadow-opacity, 0.08))";

    style.innerHTML = `
      #shopify-recommendations-widget {
        display: block;
        width: 100%;
        margin: 40px 0 20px;
        padding: 0;
      }
      #shopify-recommendations-widget *,
      #shopify-recommendations-widget *::before,
      #shopify-recommendations-widget *::after {
        box-sizing: border-box;
      }
      .shopify-recs-wrapper {
        background: ${bg};
        border-radius: ${radius};
        padding: 24px 16px;
        box-shadow: var(--shadow-horizontal-offset, 0) var(--shadow-vertical-offset, 2px)
          var(--shadow-blur-radius, 4px) ${shadowCol};
        border: ${bdrWidth} solid ${borderCol};
      }
      @media (min-width: 750px) {
        .shopify-recs-wrapper {
          padding: 28px 24px;
        }
      }
      .shopify-recs-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
      }
      .shopify-recs-title {
        font-size: calc(var(--font-heading-scale, 1) * 2.4rem);
        font-weight: 600;
        margin: 0;
        line-height: 1.3;
        letter-spacing: 0.06rem;
        color: ${headCol};
        font-family: var(--font-heading-family);
      }
      @media (min-width: 750px) {
        .shopify-recs-title {
          font-size: calc(var(--font-heading-scale, 1) * 2.6rem);
        }
      }
      .shopify-recs-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }
      @media (min-width: 750px) {
        .shopify-recs-grid {
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }
      }
      .shopify-recs-card {
        display: flex;
        flex-direction: column;
        text-decoration: none;
        color: inherit;
        height: 100%;
        position: relative;
        z-index: 0;
        border-radius: ${radius};
        overflow: hidden;
        background: ${cardBg};
      }
      .shopify-recs-card::after {
        content: '';
        position: absolute;
        z-index: -1;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border-radius: ${radius};
        border: ${bdrWidth} solid ${borderCol};
        box-shadow: var(--shadow-horizontal-offset, 0) var(--shadow-vertical-offset, 2px)
          var(--shadow-blur-radius, 4px) ${shadowCol};
      }
      .shopify-recs-image-wrapper {
        position: relative;
        width: 100%;
        padding-bottom: 100%;
        overflow: hidden;
        z-index: 0;
        background: ${cardBg};
      }
      .shopify-recs-image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform var(--duration-long, 0.4s) ease;
      }
      .shopify-recs-card:hover .shopify-recs-image {
        transform: scale(1.03);
      }
      .shopify-recs-sale-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        background: ${saleBgCol};
        color: #fff;
        font-size: 1rem;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 4px;
        line-height: 1.4;
        z-index: 1;
        text-transform: uppercase;
        letter-spacing: 0.1rem;
        font-family: var(--font-body-family);
        border: 1px solid rgba(255, 255, 255, 0.15);
      }
      .shopify-recs-info {
        padding: 12px 12px 14px;
        display: flex;
        flex-direction: column;
        flex: 1;
        width: 100%;
      }
      .shopify-recs-product-title {
        font-size: calc(var(--font-heading-scale, 1) * 1.4rem);
        font-weight: 500;
        line-height: calc(1 + 0.3 / max(1, var(--font-heading-scale, 1)));
        margin: 0 0 8px 0;
        color: ${titleCol};
        font-family: var(--font-body-family);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-decoration: none;
      }
      .shopify-recs-card:hover .shopify-recs-product-title {
        text-decoration: underline;
        text-underline-offset: 0.3rem;
      }
      .shopify-recs-price-row {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: auto;
      }
      .shopify-recs-price {
        font-size: 1.4rem;
        font-weight: 600;
        letter-spacing: 0.06rem;
        color: ${priceCol};
      }
      .shopify-recs-compare-price {
        font-size: 1.2rem;
        color: ${compareCol};
        text-decoration: line-through;
        font-weight: 400;
      }
      .shopify-recs-empty-message {
        text-align: center;
        padding: 30px 16px;
        color: rgba(var(--color-foreground, 0 0 0), 0.55);
        font-size: 1.4rem;
        line-height: 1.6;
        font-family: var(--font-body-family);
      }
    `;
    document.head.appendChild(style);

    // Build Cards HTML
    const cardsHtml = displayRecommendations.length > 0
      ? displayRecommendations
        .map((rec) => {
          const imageSrc = rec.imageUrl || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23F4F4F4'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='10' fill='%23999999'>No Image</text></svg>`;
          const productUrl = `/products/${rec.handle}`;
          const hasSale = rec.compareAtPrice && rec.compareAtPrice > rec.price;
          const saleBadge = hasSale
            ? `<span class="shopify-recs-sale-badge">SALE</span>`
            : "";
          const comparePriceHtml = hasSale
            ? '<span class="shopify-recs-compare-price">' + formatPrice(Number(rec.compareAtPrice)) + '</span>'
            : "";
          return `
          <a href="${escapeHtml(productUrl)}" class="shopify-recs-card" data-rec-id="${escapeHtml(rec.id)}">
            <div class="shopify-recs-image-wrapper">
              ${saleBadge}
              <img src="${imageSrc}" alt="${escapeHtml(rec.title)}" class="shopify-recs-image" loading="lazy" />
            </div>
            <div class="shopify-recs-info">
              <h4 class="shopify-recs-product-title">${escapeHtml(rec.title)}</h4>
              <div class="shopify-recs-price-row">
                <span class="shopify-recs-price">${formatPrice(Number(rec.price))}</span>
                ${comparePriceHtml}
              </div>
            </div>
          </a>
        `;
        })
        .join("")
      : "";

    const headerTitle = escapeHtml(
      coldStart
        ? (coldStartHeading || "Popular Products")
        : displayRecommendations.length > 0
          ? (heading || "Recommended for You")
          : (emptyHeading || "Coming Soon")
    );

    const emptyMessage = displayRecommendations.length === 0
      ? `<p class="shopify-recs-empty-message">We're learning what you love! Personalized recommendations will appear as you browse more products.</p>`
      : "";

    // Build Widget Container HTML
    const widgetHtml = `
      <div class="shopify-recs-wrapper">
        <div class="shopify-recs-section-header">
          <h3 class="shopify-recs-title">${headerTitle}</h3>
        </div>
        ${emptyMessage}
        ${cardsHtml ? `<div class="shopify-recs-grid">${cardsHtml}</div>` : ""}
      </div>
    `;

    const widgetContainer = document.createElement("div");
    widgetContainer.id = "shopify-recommendations-widget";
    widgetContainer.innerHTML = widgetHtml;

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
