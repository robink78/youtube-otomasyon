#!/usr/bin/env node
"use strict";

const Channel = require("./core/channel-context");
const selected = Channel.selectFromArgv(process.argv.slice(2));
const Health = require("./core/analytics/library-health");

const result = Health.write(selected.channel);
console.log(`[${selected.channel.name}]`);
console.log(`Qualified topics : ${result.status.qualifiedTopics}`);
console.log(`Ready Shorts     : ${result.status.readyShorts}`);
console.log(`Ready long-form  : ${result.status.readyLongForm}`);
console.log(`Inventory        : ${result.status.daysOfInventory} days (${result.status.monthsOfInventory} months)`);
console.log(`Source ready     : ${result.status.sourceReadyRate}%`);
console.log(`Visual ready     : ${result.status.visualReadyRate}%`);
console.log(`Duplicate rate   : ${result.status.duplicateRate}%`);
console.log(`Acceptance       : ${result.status.acceptance.passes ? "PASS" : "FAIL"} (minimum ${result.status.acceptance.minimumDays} days and ${result.status.acceptance.minimumQualifiedTopics} qualified topics)`);
if (!result.status.acceptance.passes) process.exitCode = 4;
