import { defineConfig } from "vitepress";

/**
 * The public site: the landing page and the agent's guide.
 *
 * `docs/technical` and `docs/README.md` are deliberately left out. They are
 * written for whoever builds the app and are read on GitHub, so publishing them
 * beside the guide would put architecture notes in front of an agent looking
 * for how to renew a policy.
 *
 * The sidebar below is the site's copy of the guide's contents page.
 * `npm run docs:check` fails when a page appears in one and not the other.
 */

const REPO = "https://github.com/laksagent-png/StayInsured";

export default defineConfig({
  title: "StayInsured",
  description:
    "Client and policy management for an insurance agency. Runs on your own computer, encrypted, with no account and no internet connection.",
  lang: "en-IN",

  // The site is served from a repository subpath, not the domain root.
  base: "/StayInsured/",
  srcDir: ".",
  outDir: ".vitepress/dist",

  // Kept out of the site, not out of the repository.
  srcExclude: ["README.md", "technical/**"],

  lastUpdated: true,
  cleanUrls: false,

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/StayInsured/favicon.png" }],
    ["meta", { property: "og:title", content: "StayInsured" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Your client book, every policy and every renewal date, on your own computer.",
      },
    ],
  ],

  themeConfig: {
    logo: "/logo.png",

    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Download", link: `${REPO}/releases` },
      { text: "Source", link: REPO },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting started",
          items: [
            { text: "Contents", link: "/guide/" },
            { text: "Install and first run", link: "/guide/install-and-first-run" },
            { text: "Find your way around", link: "/guide/getting-around" },
            { text: "Import your book", link: "/guide/import-your-book" },
          ],
        },
        {
          text: "Daily work",
          items: [{ text: "Renewals", link: "/guide/renewals" }],
        },
        {
          text: "The book",
          items: [
            { text: "Clients", link: "/guide/clients" },
            { text: "Insured members", link: "/guide/insured-members" },
            { text: "Policies", link: "/guide/policies" },
            { text: "Insurers and plans", link: "/guide/insurers-and-plans" },
          ],
        },
        {
          text: "Keeping it safe",
          items: [
            { text: "Settings", link: "/guide/settings" },
            { text: "Backups and data", link: "/guide/backups-and-data" },
          ],
        },
        {
          text: "Look it up",
          items: [{ text: "Reference", link: "/guide/reference" }],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: REPO }],

    search: { provider: "local" },

    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: "Suggest a change to this page",
    },

    footer: {
      message: "Your book stays on your machine. Nothing here is uploaded anywhere.",
      copyright: `<a href="${REPO}">StayInsured on GitHub</a>`,
    },

    outline: { level: [2, 3], label: "On this page" },
  },
});
