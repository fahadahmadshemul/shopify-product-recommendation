import {
  useLoaderData,
  useSubmit,
  useRouteError,
  useActionData,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  Page,
  Card,
  Text,
  TextField,
  Button,
  BlockStack,
  FormLayout,
  InlineGrid,
  Box,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import { useState, useEffect } from "react";

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
  buttonBackgroundColor: null,
  buttonTextColor: null,
  dropdownBorderColor: null,
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { resolveTenant } = await import("../services/tenant.service");
  await resolveTenant(session);
  const { getWidgetSettings } =
    await import("../services/widget-settings.service");
  const settings = await getWidgetSettings(session.shop);
  return { settings, defaults: DEFAULTS };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const { saveWidgetSettings } =
    await import("../services/widget-settings.service");

  if (intent === "save") {
    const settings = {};
    const allFields = [
      "heading",
      "coldStartHeading",
      "emptyHeading",
      "backgroundColor",
      "cardBackgroundColor",
      "borderColor",
      "headingColor",
      "titleColor",
      "priceColor",
      "saleBadgeColor",
      "buttonBackgroundColor",
      "buttonTextColor",
      "dropdownBorderColor",
    ];
    for (const f of allFields) {
      const val = formData.get(f);
      settings[f] = val && val.trim() ? val.trim() : null;
    }
    const bw = formData.get("borderWidth");
    const br = formData.get("borderRadius");
    settings.borderWidth = bw ? parseFloat(bw) : null;
    settings.borderRadius = br ? parseFloat(br) : null;

    await saveWidgetSettings(session.shop, settings);
    return { success: true, settings };
  }

  if (intent === "reset") {
    await saveWidgetSettings(session.shop, {});
    return { success: true, reset: true, settings: DEFAULTS };
  }

  return { success: false, error: "Unknown intent" };
};

export default function WidgetSettings() {
  const { settings, defaults } = useLoaderData();
  const submit = useSubmit();
  const actionData = useActionData();

  const [form, setForm] = useState({ ...settings });
  const [saving, setSaving] = useState(false);
  const [bannerKey, setBannerKey] = useState(0);

  // Re-sync form from loader after save/reset
  useEffect(() => {
    setForm({ ...settings });
  }, [settings]);

  // Show banner after action completes
  useEffect(() => {
    if (actionData?.success) {
      setSaving(false);
      setBannerKey((k) => k + 1);
    }
  }, [actionData]);

  const defs = defaults || DEFAULTS;

  const handleChange = (field) => (value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    const fd = new FormData();
    fd.set("intent", "save");

    const allFields = [
      "heading",
      "coldStartHeading",
      "emptyHeading",
      "backgroundColor",
      "cardBackgroundColor",
      "borderColor",
      "headingColor",
      "titleColor",
      "priceColor",
      "saleBadgeColor",
      "buttonBackgroundColor",
      "buttonTextColor",
      "dropdownBorderColor",
      "borderWidth",
      "borderRadius",
    ];
    for (const f of allFields) {
      const v = form[f];
      if (v) fd.set(f, v);
    }

    setSaving(true);
    submit(fd, { method: "post" });
  };

  const handleReset = () => {
    setForm({ ...defs });
    const fd = new FormData();
    fd.set("intent", "reset");
    submit(fd, { method: "post" });
    setSaving(true);
  };

  const colorFields = [
    { label: "Background", field: "backgroundColor", def: "theme default" },
    { label: "Card bg", field: "cardBackgroundColor", def: "theme default" },
    { label: "Border", field: "borderColor", def: "theme default" },
    { label: "Heading", field: "headingColor", def: "theme default" },
    { label: "Title", field: "titleColor", def: "theme default" },
    { label: "Price", field: "priceColor", def: "theme default" },
    { label: "Sale badge", field: "saleBadgeColor", def: "#C81E1E" },
    { label: "Button background", field: "buttonBackgroundColor", def: "#000000" },
    { label: "Button text", field: "buttonTextColor", def: "#FFFFFF" },
    { label: "Dropdown border", field: "dropdownBorderColor", def: "#000000" },
  ];

  return (
    <Page
      title="Widget Settings"
      subtitle="Customize how recommendations look on your storefront."
    >
      <BlockStack gap="500">
        {actionData?.success && (
          <Banner
            key={bannerKey}
            title={
              actionData.reset
                ? "Widget reset to theme defaults"
                : "Widget settings saved"
            }
            tone="success"
          />
        )}

        <BlockStack gap="500">
          {/* Heading Text */}
          <Card roundedAbove="xs">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                Heading Text
              </Text>
              <FormLayout>
                <TextField
                  label="Personalized"
                  name="heading"
                  value={form.heading || ""}
                  onChange={handleChange("heading")}
                  placeholder={defs.heading}
                  autoComplete="off"
                  helpText='e.g. "Recommended for You"'
                />
                <TextField
                  label="Cold start / fallback"
                  name="coldStartHeading"
                  value={form.coldStartHeading || ""}
                  onChange={handleChange("coldStartHeading")}
                  placeholder={defs.coldStartHeading}
                  autoComplete="off"
                  helpText="No personal data yet"
                />
                <TextField
                  label="Empty state"
                  name="emptyHeading"
                  value={form.emptyHeading || ""}
                  onChange={handleChange("emptyHeading")}
                  placeholder={defs.emptyHeading}
                  autoComplete="off"
                  helpText="Zero recommendations"
                />
              </FormLayout>
            </BlockStack>
          </Card>

          {/* Colors */}
          <Card roundedAbove="xs">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                Colors
              </Text>
              <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                {colorFields.map(({ label, field, def }) => {
                  const current = form[field] || "";
                  return (
                    <Box key={field}>
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <span
                            style={{
                              display: "inline-block",
                              width: "24px",
                              height: "24px",
                              borderRadius: "4px",
                              border: "1px solid rgba(0,0,0,0.15)",
                              background: current || "transparent",
                              flexShrink: 0,
                            }}
                          />
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {label}
                          </Text>
                        </InlineStack>

                        <input
                          type="text"
                          value={current}
                          onChange={(e) => handleChange(field)(e.target.value)}
                          placeholder={def}
                          style={{
                            width: "100%",
                            padding: "6px 10px",
                            border: "1px solid #ccc",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontFamily: "monospace",
                          }}
                        />
                        <InlineStack gap="100" blockAlign="center">
                          <input
                            type="color"
                            value={current || "#ffffff"}
                            onChange={(e) =>
                              handleChange(field)(e.target.value)
                            }
                            style={{
                              width: "28px",
                              height: "28px",
                              border: "none",
                              padding: "0",
                              cursor: "pointer",
                              background: "transparent",
                            }}
                          />
                          <Text as="span" variant="bodySm" tone="subdued">
                            Pick
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  );
                })}
              </InlineGrid>
            </BlockStack>
          </Card>

          {/* Dimensions */}
          <Card roundedAbove="xs">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                Dimensions
              </Text>
              <FormLayout>
                <TextField
                  label="Border width (px)"
                  name="borderWidth"
                  type="number"
                  value={form.borderWidth || ""}
                  onChange={handleChange("borderWidth")}
                  autoComplete="off"
                  placeholder="1"
                  min="0"
                  max="10"
                  helpText="Card and widget border thickness"
                />
                <TextField
                  label="Border radius (px)"
                  name="borderRadius"
                  type="number"
                  value={form.borderRadius || ""}
                  onChange={handleChange("borderRadius")}
                  autoComplete="off"
                  placeholder="8"
                  min="0"
                  max="30"
                  helpText="Corner roundness"
                />
              </FormLayout>
            </BlockStack>
          </Card>

          <div style={{ marginBottom: "20px" }}>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
              <Button onClick={handleSave} loading={saving} variant="primary">
                Save Settings
              </Button>

              <Button onClick={handleReset} variant="secondary" tone="critical">
                Reset to Defaults
              </Button>
            </InlineGrid>
          </div>
        </BlockStack>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
