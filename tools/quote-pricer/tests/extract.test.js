const test = require("node:test");
const assert = require("node:assert");
const { extractProduct, toNumber } = require("../lib/extract.js");

const check = (name, got, want) => test(name, () => assert.deepStrictEqual(got, want));

check("num nl", toNumber("1.234,50"), 1234.5);
check("num comma", toNumber("139,00"), 139);
check("num dot", toNumber("139.99"), 139.99);

// JSON-LD Product with a single offer
const a =
  '<html><head><title>x</title><script type="application/ld+json">' +
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Example DMX Cable &amp; Co",
    offers: { "@type": "Offer", price: "15.90", priceCurrency: "EUR" },
  }) +
  "</script></head></html>";
check("jsonld single", extractProduct(a), {
  name: "Example DMX Cable & Co",
  price: 15.9,
  currency: "EUR",
  vatIncluded: null,
  source: "json-ld",
});

// @graph + array of offers: cheapest wins; VAT flag read
const b =
  '<script type="application/ld+json">' +
  JSON.stringify({
    "@graph": [
      { "@type": "WebSite", name: "Shop" },
      {
        "@type": ["Product"],
        name: "Example Mini PC",
        offers: [
          { price: 720, priceCurrency: "EUR", priceSpecification: { valueAddedTaxIncluded: true } },
          { price: 680, priceCurrency: "EUR", priceSpecification: { valueAddedTaxIncluded: true } },
        ],
      },
    ],
  }) +
  "</script>";
check("jsonld graph", extractProduct(b), {
  name: "Example Mini PC",
  price: 680,
  currency: "EUR",
  vatIncluded: true,
  source: "json-ld",
});

// AggregateOffer
const c =
  '<script type="application/ld+json">{"@type":"Product","name":"Example Bar","offers":{"@type":"AggregateOffer","lowPrice":"150.00","priceCurrency":"EUR"}}</script>';
check("aggregate", extractProduct(c).price, 150);

// meta fallback + og:title; broken JSON-LD ignored
const d =
  '<script type="application/ld+json">{broken</script><meta property="og:title" content="Example Keyboard"><meta property="product:price:amount" content="24,99"><meta property="product:price:currency" content="EUR">';
check("meta fallback", extractProduct(d), {
  name: "Example Keyboard",
  price: 24.99,
  currency: "EUR",
  vatIncluded: null,
  source: "meta",
});

// name only
check("title only", extractProduct("<title>Just a page</title>"), {
  name: "Just a page",
  price: null,
  currency: null,
  vatIncluded: null,
  source: null,
});
check("empty", extractProduct("").name, null);
