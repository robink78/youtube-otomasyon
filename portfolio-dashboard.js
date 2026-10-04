#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const dashboard = require("./core/analytics/portfolio").build();
if (process.argv.includes("--write")) {
  const file = path.join(__dirname, "analysis", "portfolio-dashboard.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(dashboard, null, 2) + "\n");
}
console.log(JSON.stringify(dashboard, null, 2));
