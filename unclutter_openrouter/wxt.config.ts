import { defineConfig } from "wxt";

export default defineConfig({
  manifest: ({ browser }) => ({
    name: "Unclutter",
    description: "Hide ads and promotions with reusable, AI-reviewed page-template rules.",
    permissions: ["storage", "activeTab"],
    host_permissions: ["http://*/*", "https://*/*"],
    action: { default_title: "Unclutter" },
    icons: { 16: "/icon/16.png", 32: "/icon/32.png", 48: "/icon/48.png", 128: "/icon/128.png" },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "unclutter@kitze.io",
              strict_min_version: "140.0",
              data_collection_permissions: { required: ["websiteContent", "authenticationInfo"] },
            },
          },
        }
      : {}),
  }),
});
