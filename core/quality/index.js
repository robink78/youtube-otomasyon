"use strict";

const impossibleBrief = require("./impossible-brief");
const criticalThread = require("./critical-thread");
const behindTheOrdinary = require("./behind-the-ordinary");

function engineFor(channelOrTopic) {
  const slug = typeof channelOrTopic === "string" ? channelOrTopic : channelOrTopic && (channelOrTopic.channel || channelOrTopic.slug);
  if (slug === "critical-thread") return criticalThread;
  if (slug === "behind-the-ordinary") return behindTheOrdinary;
  return impossibleBrief;
}

function evaluateTopic(topic, allTopics = []) { return engineFor(topic).evaluateTopic(topic, allTopics); }
function evaluatePackage(pkg) { return engineFor(pkg.channel || pkg.topic).evaluatePackage(pkg); }

module.exports = { engineFor, evaluateTopic, evaluatePackage };
