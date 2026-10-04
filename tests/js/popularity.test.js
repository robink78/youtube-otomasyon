"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Popularity = require("../../core/growth/popularity");
const TopicModel = require("../../core/growth/topic-model");

test("popularity score is log-scaled monthly pageviews", () => {
  assert.equal(Popularity.score(1000), 40);
  assert.equal(Popularity.score(10000), 60);
  assert.equal(Popularity.score(100000), 80);
  assert.equal(Popularity.score(1000000), 100);
  assert.equal(Popularity.score(5000000), 100);
  assert.equal(Popularity.score(0), null);
  assert.equal(Popularity.score(undefined), null);
});

test("the primary article is the topic's own Wikipedia source for each channel", () => {
  assert.equal(Popularity.primaryArticle("failure-reconstructed", { vaka: { kaynakca: [
    { ad: "USGS report", url: "https://pubs.usgs.gov/x.pdf" },
    { ad: "Wikipedia — Lower Van Norman Dam", url: "https://en.wikipedia.org/wiki/Lower_Van_Norman_Dam" },
  ] } }), "Lower Van Norman Dam");
  assert.equal(Popularity.primaryArticle("impossible-brief", { facts: [{ url: "https://en.wikipedia.org/wiki/Europa_(moon)" }] }), "Europa (moon)");
  assert.equal(Popularity.primaryArticle("critical-thread", { facts: [{ url: "https://www.itf-oecd.org/" }] }), null);
});

test("the committed pageview file covers the produced topics and resolves redirects", () => {
  const data = Popularity.load();
  assert.ok(Object.keys(data.articles).length >= 600);
  assert.ok(data.articles["Space Shuttle Challenger disaster"].monthlyViews > data.articles["Lower Van Norman Dam"].monthlyViews * 50);
  assert.equal(data.articles["2005 Buncefield fire"].resolvedTitle, "Buncefield fire");
});

test("normalized topics carry measured popularity, and it drives demand and recognizability", () => {
  const Channel = require("../../core/channel-context");
  const K = require("../../lib/kutuphane");
  const raw = K.konular().find((item) => item.slug === "challenger-1986");
  const topic = TopicModel.normalize(Channel.getChannel("failure-reconstructed"), raw.raw || raw, "challenger-1986");
  assert.equal(topic.popularity.article, "Space Shuttle Challenger disaster");
  assert.ok(topic.signals.popularity >= 80);
  const scoring = require("fs").readFileSync(require("path").join(__dirname, "../../core/growth/topic-scoring.js"), "utf8");
  assert.match(scoring, /else if \(has\(s\.popularity\)\) f\.TopicDemandScore = factor\(s\.popularity, "measured"/);
  assert.match(scoring, /has\(topic\.signals && topic\.signals\.popularity\) \? topic\.signals\.popularity/);
});
