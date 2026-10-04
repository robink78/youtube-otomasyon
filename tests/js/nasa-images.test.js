"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Nasa = require("../../core/rendering/nasa-images");

const wiki = (title) => ({ url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` });
const item = (data) => ({ media_type: "image", nasa_id: data.title.replace(/\W+/g, "-"), center: "GSFC", keywords: [], ...data });

const moon = { topic: "If the Moon moved twice as close, when would Earth notice?", facts: [wiki("Moon"), wiki("Tidal force"), wiki("Tide")] };
const galileo = { topic: "The Satellite Clocks That Started Failing", facts: [wiki("Galileo (satellite navigation)")] };
const plankton = { topic: "What If Ocean Plankton Disappeared?", facts: [wiki("Phytoplankton")] };
const amoc = { topic: "What If the Atlantic Ocean Current Shut Down?", facts: [wiki("Atlantic meridional overturning circulation")] };

test("NASA images: the topic's own subject is accepted", () => {
  assert.equal(Nasa.accept(item({ title: "Moon - North Polar Mosaic, Color" }), Nasa.topicTerms(moon)), true);
  assert.equal(Nasa.accept(item({ title: "Phytoplankton bloom in the North Atlantic Ocean" }), Nasa.topicTerms(plankton)), true);
  assert.equal(Nasa.accept(item({ title: "Large Tabular Iceberg, South Atlantic Ocean", keywords: ["ATLANTIC OCEAN"] }), Nasa.topicTerms(amoc)), true);
});

test("NASA images: namesakes and other bodies are rejected", () => {
  // Galileo the Jupiter probe is not Galileo the navigation system.
  assert.equal(Nasa.accept(item({ title: "STS-34 Galileo spacecraft IUS deployment", keywords: ["Galileo", "spacecraft"] }), Nasa.topicTerms(galileo)), false);
  assert.equal(Nasa.accept(item({ title: "Galileo navigation satellite launch", keywords: ["satellite", "navigation"] }), Nasa.topicTerms(galileo)), true);
  assert.equal(Nasa.accept(item({ title: "Mars’ Moon Phobos is Slowly Falling Apart" }), Nasa.topicTerms(moon)), false);
  // "Tide" is a secondary article: on its own it would admit red-tide algae.
  assert.equal(Nasa.accept(item({ title: "Red Tide Strands South African Rock Lobsters" }), Nasa.topicTerms(moon)), false);
  assert.equal(Nasa.accept(item({ title: "Ocean currents off Norway" }), Nasa.topicTerms(amoc)), false, "one generic term is not enough");
});

test("NASA images: rights notices, partner credits and non-scene graphics are rejected", () => {
  const terms = Nasa.topicTerms(moon);
  assert.equal(Nasa.accept(item({ title: "Moon over the horizon", description: "© Getty Images" }), terms), false);
  assert.equal(Nasa.accept(item({ title: "Moon mosaic", secondary_creator: "ESA/DLR/FU Berlin" }), terms), false);
  assert.equal(Nasa.accept(item({ title: "Moon mosaic", description: "Scientists at the University of Arizona studied the Moon." }), terms), true, "a story mentioning a university is not a credit");
  assert.equal(Nasa.accept(item({ title: "Moon to Mars Infrastructure" }), terms), false);
  assert.equal(Nasa.accept(item({ title: "Administrator poses with Moon rock" }), terms), false);
  assert.equal(Nasa.accept({ ...item({ title: "Moon flyby" }), media_type: "video" }, terms), false);
});

test("NASA images: queries search one-word article titles and renditions prefer ~large JPEG", () => {
  assert.equal(Nasa.queries(plankton)[0], "Phytoplankton");
  assert.equal(Nasa.queries(galileo)[0], "Galileo satellite navigation");
  assert.equal(Nasa.pickRendition(["https://a/x~orig.tif", "https://a/x~orig.jpg", "https://a/x~large.jpg", "https://a/x~thumb.jpg"]), "https://a/x~large.jpg");
  assert.equal(Nasa.pickRendition(["https://a/x~orig.tif"]), null);
});

test("NASA images: search returns attributed public-domain stills and skips rejected items", async () => {
  const pages = {
    search: { collection: { items: [
      { href: "https://images-assets.nasa.gov/image/A/collection.json", data: [item({ title: "Moon - North Pole", nasa_id: "A" })] },
      { href: "https://images-assets.nasa.gov/image/B/collection.json", data: [item({ title: "Mars’ Moon Phobos", nasa_id: "B" })] },
    ] } },
    A: ["http://images-assets.nasa.gov/image/A/A~large.jpg", "http://images-assets.nasa.gov/image/A/A~orig.jpg"],
  };
  const requested = [];
  const get = async (url) => {
    requested.push(url);
    if (url.includes("/search?")) return { status: 200, body: JSON.stringify(pages.search) };
    if (url.includes("/A/collection.json")) return { status: 200, body: JSON.stringify(pages.A) };
    return { status: 404, body: "" };
  };
  const stills = await Nasa.search(moon, 4, get);
  assert.equal(stills.length, 1);
  assert.equal(stills[0].imageUrl, "https://images-assets.nasa.gov/image/A/A~large.jpg");
  assert.equal(stills[0].origin, "nasa-images");
  assert.equal(stills[0].licence, Nasa.LICENCE);
  assert.match(stills[0].sourceUrl, /^https:\/\/images\.nasa\.gov\/details\/A$/);
  assert.ok(requested.every((url) => url.startsWith("https://images-api.nasa.gov/") || url.startsWith("https://images-assets.nasa.gov/")));
});
