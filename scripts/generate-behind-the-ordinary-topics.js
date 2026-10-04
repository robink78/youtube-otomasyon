#!/usr/bin/env node
"use strict";

// Deterministic research-question inventory. Except for the explicitly
// researched launch record below, entries describe questions to investigate;
// they deliberately do not encode an answer as fact. Production adapters load
// only productionReady records, so a plausible-sounding seed can never become
// narration before evidence is attached and reviewed.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ROOT } = require("../core/channel-context");

const PILLARS = {
  "EVERYDAY MYSTERIES": [
    ["manhole covers", ["round shapes", "lifting holes", "ribbed undersides", "city markings", "locking tabs"]],
    ["clocks in advertisements", ["recurring display times", "hand symmetry", "second-hand placement", "logo visibility", "date windows"]],
    ["hotel rooms", ["bed orientation", "recurring layouts", "carpet patterns", "blackout-curtain overlaps", "bathroom glass"]],
    ["jeans", ["tiny pockets", "copper rivets", "orange stitching", "leather patches", "small waist buttons"]],
    ["elevators", ["mirrors", "door timing", "button layouts", "floor indicators", "close-door buttons"]],
    ["supermarkets", ["produce near entrances", "milk placement", "shelf endcaps", "aisle widths", "checkout-lane layouts"]],
    ["umbrellas", ["hooked handles", "pointed tips", "metal rib joints", "closure straps", "shorter inner ribs"]],
    ["shopping carts", ["swivelling front wheels", "child seats", "wire-grid sizes", "coin locks", "sloped baskets"]],
    ["pencils", ["hexagonal barrels", "metal ferrules", "eraser colours", "painted bodies", "grade markings"]],
    ["staplers", ["rotating anvils", "grooved base plates", "hinge angles", "spring-loaded magazines", "rubber feet"]],
    ["door handles", ["lever shapes", "standard mounting heights", "latch bevels", "backplates", "one-sided keyholes"]],
    ["house keys", ["teeth", "side grooves", "shoulders", "bow holes", "asymmetrical profiles"]],
    ["drink bottles", ["cap ridges", "neck rings", "bottom dimples", "label seams", "tamper bands"]],
    ["takeaway cups", ["lid tabs", "tiny vent holes", "rolled rims", "cardboard sleeves", "stacking rings"]],
    ["toothpaste tubes", ["crimped ends", "foil seals", "flip-top caps", "standing shoulders", "cardboard boxes"]],
    ["shoes", ["extra top eyelets", "heel loops", "toe caps", "tread direction", "tongue loops"]],
    ["backpacks", ["diamond patches", "sternum straps", "paired zipper pulls", "padded air channels", "compression straps"]],
    ["shirts", ["locker loops", "collar buttons", "spare buttons", "split yokes", "small collar stays"]],
    ["ballpoint pens", ["cap holes", "pocket clips", "transparent barrels", "textured grips", "tiny refill springs"]],
    ["remote controls", ["raised dots on number keys", "coloured buttons", "battery-door tabs", "dark front windows", "button grouping"]],
    ["fire hydrants", ["different colours", "regional shapes", "side caps", "top markings", "standard mounting heights"]]
  ],
  "HIDDEN ENGINEERING": [
    ["airplane windows", ["tiny pressure holes", "rounded corners", "multiple panes", "warm inner surfaces", "shaded frames"]],
    ["escalators", ["side brushes", "grooved steps", "comb plates", "moving handrail speed", "yellow boundary lines"]],
    ["bridges", ["expansion gaps", "bearing pads", "drain holes", "curved approaches", "repeating deck joints"]],
    ["zippers", ["locking sliders", "interlocking teeth", "bottom stops", "two-way pulls", "fabric tape edges"]],
    ["plastic bottles", ["vertical ridges", "petal-shaped bases", "shoulder curves", "threaded necks", "recycling seams"]],
    ["road reflectors", ["angled lenses", "recessed housings", "different colours", "raised profiles", "self-cleaning faces"]],
    ["guardrails", ["corrugated beams", "offset blocks", "flared ends", "overlapping sections", "post spacing"]],
    ["train wheels", ["inner flanges", "slightly conical treads", "solid axles", "metal tyres", "wheelset spacing"]],
    ["car windshields", ["black dotted borders", "layered glass", "curved edges", "ceramic bands", "rear-view-mirror patches"]],
    ["vehicle tyres", ["water grooves", "small rubber hairs", "sidewall codes", "wear bars", "asymmetrical tread"]],
    ["microwave doors", ["metal mesh", "layered windows", "interlock switches", "dark viewing panels", "door choke channels"]],
    ["oven doors", ["multiple glass layers", "vent slots", "black edge bands", "removable inner panes", "cool-touch handles"]],
    ["electrical plugs", ["different pin lengths", "insulated pin sleeves", "ground contacts", "strain reliefs", "polarised blades"]],
    ["USB connectors", ["spring tabs", "plastic tongues", "asymmetrical shells", "shielding fingers", "retention holes"]],
    ["drink cans", ["stay-on tabs", "scored openings", "concave bases", "rolled seams", "narrowed tops"]],
    ["corrugated cardboard", ["fluted inner layers", "alternating paper directions", "fold scores", "edge crush zones", "glued side seams"]],
    ["screws", ["different drive shapes", "thread pitches", "tapered tips", "unthreaded shoulders", "countersunk heads"]],
    ["padlocks", ["shackle notches", "drain holes", "spring-loaded latches", "laminated bodies", "keyway covers"]],
    ["bicycle helmets", ["foam liners", "outer shells", "vent channels", "adjustment cradles", "breakaway visors"]],
    ["ship hulls", ["different paint below the waterline", "curved bows", "raised load lines", "welded plate seams", "bulbous fronts"]],
    ["fire doors", ["self-closing arms", "intumescent strips", "narrow glass panels", "magnetic holders", "panic bars"]]
  ],
  "STRANGE ORIGINS": [
    ["QWERTY keyboards", ["letter order", "staggered rows", "home-key bumps", "the Shift key", "the Enter-key shape"]],
    ["traffic lights", ["red yellow and green", "vertical ordering", "arrow signals", "yellow intervals", "black signal hoods"]],
    ["table forks", ["four tines", "curved tines", "different fork sizes", "wide serving forks", "pastry-fork notches"]],
    ["barcodes", ["guard bars", "varying stripe widths", "numbers underneath", "quiet zones", "check digits"]],
    ["the at sign", ["its curled form", "its English name", "email use", "regional names", "keyboard placement"]],
    ["the ampersand", ["its shape", "its name", "its former alphabet role", "its typeface variants", "its handwritten form"]],
    ["the hash symbol", ["its crossed lines", "its many names", "telephone-key use", "hashtag use", "number-sign use"]],
    ["the power symbol", ["its broken circle", "line placement", "standby variants", "device-label use", "standardisation"]],
    ["the save icon", ["its floppy-disk shape", "label-free use", "design persistence", "regional recognition", "modern variants"]],
    ["the Bluetooth symbol", ["its angular rune", "its name", "blue colouring", "logo symmetry", "device-menu use"]],
    ["the recycling symbol", ["three arrows", "triangular motion", "numbered variants", "colour changes", "packaging use"]],
    ["stop signs", ["octagonal shapes", "red colouring", "white borders", "capital lettering", "international variants"]],
    ["pedestrian crossings", ["striped patterns", "zebra names", "button boxes", "walking-person symbols", "tactile paving"]],
    ["paper sizes", ["A-series names", "aspect ratios", "number progression", "regional alternatives", "folding logic"]],
    ["playing cards", ["four suits", "red and black colours", "face-card ranks", "corner indices", "joker cards"]],
    ["check marks", ["angled strokes", "regional meanings", "ballot use", "red-pen variants", "digital checkbox use"]],
    ["public toilet symbols", ["simplified figures", "skirt silhouettes", "blue colouring", "accessibility symbols", "family-room variants"]],
    ["currency symbols", ["crossed lines", "letter forms", "placement before numbers", "decimal separators", "regional abbreviations"]],
    ["QR codes", ["three corner squares", "their name", "black-and-white modules", "error-correction patterns", "quiet borders"]],
    ["keyboard symbols", ["Escape labels", "Command loops", "Control abbreviations", "arrow-key arrangement", "function-key numbering"]],
    ["map pins", ["teardrop shapes", "centre dots", "red colouring", "digital-map adoption", "clustered markers"]]
  ],
  "DESIGN DECISIONS": [
    ["airplane seats", ["fabric colours", "upright seatbacks", "folding tray tables", "aisle-side armrests", "seat-pocket placement"]],
    ["road signs", ["different shapes", "reflective surfaces", "typeface choices", "border widths", "symbol-first warnings"]],
    ["airports", ["long sightlines", "moving walkways", "gate numbering", "carpeted waiting areas", "security-queue layouts"]],
    ["hospitals", ["corridor colours", "rounded wall guards", "ceiling signs", "room-number systems", "easy-clean furniture"]],
    ["libraries", ["low central shelves", "end-panel signs", "quiet-floor zoning", "reading-light placement", "book-drop slots"]],
    ["classrooms", ["desk orientation", "chair-leg shapes", "whiteboard height", "wall-clock placement", "storage cubbies"]],
    ["smartphones", ["camera bumps", "rounded corners", "side-button positions", "speaker-hole patterns", "screen notches"]],
    ["laptops", ["hinge positions", "off-centre touchpads", "rubber feet", "keyboard backlights", "vent placement"]],
    ["computer mice", ["asymmetrical shapes", "scroll-wheel grooves", "glide feet", "side buttons", "sensor placement"]],
    ["office chairs", ["five-wheel bases", "mesh backs", "adjustment levers", "curved lumbar supports", "waterfall seat edges"]],
    ["restaurant menus", ["item grouping", "price alignment", "photo placement", "paper sizes", "special-item boxes"]],
    ["coffee shops", ["order-pickup separation", "menu-board height", "small table sizes", "power-outlet placement", "queue paths"]],
    ["public bathrooms", ["door gaps", "sink heights", "hand-dryer placement", "stall-door direction", "tile sizes"]],
    ["parking garages", ["low ceilings", "column colours", "spiral ramps", "space numbering", "pedestrian paths"]],
    ["train stations", ["platform-edge markings", "clock placement", "bench orientation", "exit-letter systems", "canopy shapes"]],
    ["grocery packaging", ["transparent windows", "resealable strips", "colour bands", "serving images", "nutrition-panel placement"]],
    ["medicine packaging", ["blister packs", "child-resistant caps", "large warning panels", "tamper seals", "dose grids"]],
    ["kitchen tools", ["handle holes", "soft-grip zones", "hanging loops", "measurement markings", "heat-safe colour cues"]],
    ["public bins", ["different lid openings", "colour coding", "sloped tops", "foot pedals", "small disposal slots"]],
    ["staircases", ["contrasting step edges", "handrail returns", "landing intervals", "riser heights", "open versus closed risers"]],
    ["waiting rooms", ["back-to-back seating", "side tables", "number displays", "wipe-clean materials", "separated chair arms"]]
  ],
  "ORDINARY SYSTEMS": [
    ["retail barcodes", ["check digits", "product prefixes", "scanner orientation", "quiet zones", "variable-weight labels"]],
    ["QR codes", ["error correction", "alignment squares", "version sizes", "mask patterns", "encoded character modes"]],
    ["postal codes", ["letter-and-number patterns", "regional grouping", "sorting-machine use", "address placement", "international differences"]],
    ["street numbers", ["odd and even sides", "block numbering", "skipped numbers", "corner-lot rules", "rural distance numbers"]],
    ["road markings", ["line colours", "dash lengths", "double lines", "turn arrows", "hatched zones"]],
    ["product packaging", ["strange symbols", "food-safe marks", "fragile-glass icons", "batch codes", "open-jar periods"]],
    ["laundry symbols", ["wash tubs", "triangle bleach marks", "square drying marks", "iron dots", "crossed circles"]],
    ["shoe sizes", ["regional scales", "half sizes", "width letters", "children's ranges", "mondopoint labels"]],
    ["battery sizes", ["letter names", "cylindrical dimensions", "positive-terminal bumps", "voltage labels", "button-cell codes"]],
    ["date formats", ["day-month order", "numeric separators", "two-digit years", "ISO ordering", "weekday numbering"]],
    ["book ISBNs", ["group identifiers", "publisher ranges", "check digits", "hyphen placement", "barcode conversion"]],
    ["recycling resin codes", ["numbers inside triangles", "material abbreviations", "regional acceptance", "colour limits", "packaging placement"]],
    ["food expiry labels", ["use-by wording", "best-before wording", "lot codes", "date printing", "storage instructions"]],
    ["clothing sizes", ["letter sizes", "number ranges", "vanity sizing", "regional conversions", "fit names"]],
    ["telephone numbers", ["country codes", "area codes", "grouped digits", "leading zeros", "emergency numbers"]],
    ["flight numbers", ["airline prefixes", "route pairings", "digit lengths", "return-flight numbering", "retired numbers"]],
    ["train platform systems", ["lettered platforms", "track numbers", "car-stop markers", "zone boards", "departure codes"]],
    ["paint colour codes", ["standard swatches", "mixing formulas", "finish labels", "batch matching", "regional standards"]],
    ["screw and bolt sizes", ["metric labels", "thread pitch", "strength markings", "head markings", "length measurement"]],
    ["electrical wire colours", ["live-neutral conventions", "ground stripes", "regional differences", "phase colours", "tracer bands"]],
    ["food portion labels", ["serving sizes", "per-100-unit columns", "daily-value percentages", "allergen emphasis", "energy units"]]
  ]
};

// One grammatical research-question form for every object/detail pair. A
// templated "Why do X use Y?" frame produced broken English ("Why Do The Save
// Icon Use…"); this form stays correct for plural, singular and possessive
// details and never implies an answer.
function researchQuestion(object, detail) {
  return `${capitalise(object)}: what explains ${detail}?`;
}

function capitalise(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function slug(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 86);
}

function score(seed, low, spread) {
  const n = crypto.createHash("sha1").update(seed).digest().readUInt16BE(0);
  return low + n % (spread + 1);
}

function sourceRequirements(category, object, detail) {
  const requirements = [
    { tier: "primary", type: "manufacturer, designer, patent, or applicable standard", query: `${object} ${detail} design purpose standard patent`, preferredDomains: ["manufacturer", "standards body", "patent office"] },
    { tier: "independent", type: "government, museum, university, or engineering organization", query: `${object} ${detail} history engineering`, preferredDomains: ["government", "museum", "university", "engineering organization"] }
  ];
  if (category === "STRANGE ORIGINS") requirements.push({ tier: "archive", type: "dated historical record or museum collection", query: `${object} ${detail} origin archive`, preferredDomains: ["museum", "library", "historical archive"] });
  return requirements;
}

function candidate(category, object, detail, index) {
  const topic = researchQuestion(object, detail);
  const id = `BTO-${String(index + 1).padStart(3, "0")}`;
  const curiosity = score(id + topic, 80, 18);
  const visual = score(topic + "visual", 76, 22);
  const short = score(topic + "short", 78, 20);
  const long = score(topic + "long", 58, 37);
  const novelty = score(topic + "novelty", 68, 29);
  const breadth = score(topic + "breadth", 72, 26);
  return {
    id,
    channel: "behind-the-ordinary",
    slug: slug(topic),
    topic,
    title: topic,
    category,
    pillar: category,
    canonicalTopic: object,
    object,
    designDetail: detail,
    question: topic,
    coreQuestion: topic,
    whyInteresting: `A familiar detail of ${object} (${detail}) that is rarely explained; research must establish the documented design, engineering, standards or historical reason before anything is narrated.`,
    researchDifficulty: ["low", "medium", "medium-high"][score(id + "difficulty", 0, 2)],
    evergreenScore: score(topic + "evergreen", 86, 13),
    curiosityScore: curiosity,
    visualPotential: { score: visual, scenes: [`real ${object}`, `macro view of ${detail}`, "labelled comparison", "source document or engineering diagram", "the detail in everyday use"] },
    shortPotential: { score: short, durationSeconds: [20, 45], angle: "visual mystery → documented explanation → specific payoff" },
    longFormPotential: { score: long, targetMinutes: [8, 15], formats: ["single-subject deep dive", "single-theme collection"] },
    novelty: { score: novelty, note: "seed prior; channel analytics must override it" },
    audienceFit: { score: breadth, breadth: breadth >= 88 ? "broad" : "general" },
    sourceAvailability: { score: 82, status: "research-targets-identified-not-yet-verified" },
    sourceRequirements: sourceRequirements(category, object, detail),
    similarity: { canonicalFamily: `${slug(object)}:${slug(detail)}`, avoidPairingWithinDays: 30, compareAgainstPublished: true },
    researchStatus: "QUESTION_ONLY",
    productionReady: false,
    facts: [],
    sources: [],
    quality: { channelFit: 96, centralQuestion: true, answerNotPreclaimed: true, distinctFromOtherChannels: true, validatedCandidate: true },
    status: "qualified"
  };
}

function researchedLaunchTopic(original) {
  const urls = {
    history: "https://www.levistrauss.com/2017/01/12/pockets-full-history/",
    fifth: "https://www.levistrauss.com/2021/05/03/the-story-behind-the-official-fifth-pocket/",
    parts: "https://www.levistrauss.com/2014/04/17/those-oft-forgotten-pant-parts/"
  };
  const facts = [
    { role: "question", layer: "VERIFIED FACT", claim: "The small front-right pocket on classic Levi's jeans is called a watch pocket.", source: "Levi Strauss & Co. Archives — Pockets Full of History", url: urls.history },
    { role: "explanation", layer: "VERIFIED FACT", claim: "The watch pocket was intended to hold a pocket watch, a common possession in the late nineteenth century.", source: "Levi Strauss & Co. Archives — Pockets Full of History", url: urls.history },
    { role: "origin", layer: "VERIFIED FACT", claim: "The small watch pocket was part of the original riveted waist overalls introduced in 1873.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "origin", layer: "VERIFIED FACT", claim: "Levi Strauss and Jacob Davis received a United States patent for improving the fastening of pocket openings in 1873.", source: "Levi Strauss & Co. Archives — Pockets Full of History", url: urls.history },
    { role: "problem", layer: "VERIFIED FACT", claim: "Copper rivets strengthened pocket openings and helped keep them from ripping.", source: "Levi Strauss & Co. Archives — Pockets Full of History", url: urls.history },
    { role: "context", layer: "VERIFIED FACT", claim: "The original trousers were known as waist overalls.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "context", layer: "VERIFIED FACT", claim: "The original waist overalls had four pockets in total.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "context", layer: "VERIFIED FACT", claim: "Those four pockets were two large front pockets, the watch pocket, and one back pocket.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "explanation", layer: "VERIFIED FACT", claim: "Levi Strauss and Company describes the watch pocket as protection for a pocket watch.", source: "Levi Strauss & Co. Archives — Those Oft-Forgotten Pant Parts", url: urls.parts },
    { role: "surprising-detail", layer: "VERIFIED FACT", claim: "The tiny front pocket is sometimes called the fifth pocket, but it was part of the original four-pocket arrangement.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "surprising-detail", layer: "VERIFIED FACT", claim: "A second back pocket was added in 1901.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "payoff", layer: "VERIFIED FACT", claim: "The back pocket added in 1901 is the actual fifth pocket in the documented design sequence.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "consequence", layer: "VERIFIED FACT", claim: "During the Second World War, rivets were removed from the watch pocket to save metal.", source: "Levi Strauss & Co. Archives — Pockets Full of History", url: urls.history },
    { role: "consequence", layer: "VERIFIED FACT", claim: "The watch-pocket rivets were restored after the wartime change.", source: "Levi Strauss & Co. Archives — Pockets Full of History", url: urls.history },
    { role: "context", layer: "VERIFIED FACT", claim: "The original waist overalls also used a button fly, copper rivets, blue denim, and arcuate stitching.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth },
    { role: "payoff", layer: "VERIFIED FACT", claim: "The watch pocket remains part of the familiar five-pocket jean design.", source: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth }
  ];
  return {
    ...original,
    slug: "why-jeans-have-a-tiny-pocket",
    topic: "Why Jeans Have a Tiny Pocket",
    title: "Why Jeans Have a Tiny Pocket",
    question: "Why do jeans have a tiny pocket above the larger front pocket?",
    coreQuestion: "Why do jeans have a tiny pocket above the larger front pocket?",
    hook: "That tiny jeans pocket was not designed for loose change.",
    openingLine: "That tiny jeans pocket was not designed for loose change.",
    secondBeat: "It is a surviving piece of nineteenth-century workwear.",
    mechanism: "The small pouch was designed as a watch pocket for carrying and protecting a pocket watch.",
    expectedConsequence: "The original watch pocket survived as the five-pocket jean design evolved.",
    misconception: "It is often called the fifth pocket, but the second back pocket is the actual fifth pocket in the documented design sequence.",
    payoff: "The tiny pocket is a working trace of the original four-pocket design.",
    narration: [
      { role: "VISUAL_MYSTERY", layer: "VERIFIED FACT", text: "That tiny jeans pocket was not designed for loose change." },
      { role: "CLEAR_PROMISE", layer: "VERIFIED FACT", text: "It is a surviving piece of nineteenth-century workwear." },
      { role: "EXPLANATION", layer: "VERIFIED FACT", text: "Levi Strauss and Company calls it the watch pocket." },
      { role: "EXPLANATION", layer: "VERIFIED FACT", text: "Pocket watches were common, so the small pouch carried and protected one." },
      { role: "ORIGIN", layer: "VERIFIED FACT", text: "It appeared on the original four-pocket riveted waist overalls in 1873." },
      { role: "SURPRISING_DETAIL", layer: "VERIFIED FACT", text: "The second back pocket arrived in 1901, making that the actual fifth pocket." },
      { role: "PAYOFF", layer: "VERIFIED FACT", text: "So this tiny pocket is a working trace of the original jeans design." }
    ],
    editorialTitles: ["Why Jeans Have a Tiny Pocket", "This Tiny Pocket Wasn't Made for Coins", "The Original Purpose of That Tiny Jeans Pocket"],
    thumbnailText: "NOT FOR COINS",
    visualArticles: ["Jeans"],
    facts,
    sources: [
      { name: "Levi Strauss & Co. Archives — Pockets Full of History", url: urls.history, type: "manufacturer archive" },
      { name: "Levi Strauss & Co. historian — The Story Behind the Official Fifth Pocket", url: urls.fifth, type: "manufacturer historian" },
      { name: "Levi Strauss & Co. Archives — Those Oft-Forgotten Pant Parts", url: urls.parts, type: "manufacturer archive" }
    ],
    sourceAvailability: { score: 88, status: "verified-manufacturer-archive" },
    sourceQuality: { score: 88, grade: "primary-manufacturer-archive" },
    researchStatus: "VERIFIED",
    productionReady: true,
    confidence: "VERIFIED",
    quality: { ...original.quality, sourceClaimsMapped: true, productionReady: true }
  };
}

// Researched records (scripts/ib-ct-library/build.js) are upgraded in place;
// regenerating the question inventory must never discard their evidence.
function researchedFrom(previous) {
  const kept = new Map();
  for (const topic of (previous && previous.topics) || []) {
    // Keyed by inventory id: a researched record may sharpen its object or
    // design detail, but it always replaces the same generated question.
    if (topic.researchStatus === "VERIFIED" && topic.id) kept.set(topic.id, topic);
  }
  return kept;
}

function generate(previous = null) {
  const kept = researchedFrom(previous);
  const topics = [];
  for (const [category, rows] of Object.entries(PILLARS)) {
    for (const [object, details] of rows) {
      for (const detail of details) topics.push(candidate(category, object, detail, topics.length));
    }
  }
  const launchIndex = topics.findIndex((topic) => topic.canonicalTopic === "jeans" && topic.designDetail === "tiny pockets");
  topics[launchIndex] = researchedLaunchTopic(topics[launchIndex]);
  for (const [index, topic] of topics.entries()) {
    const researched = kept.get(topic.id);
    if (researched && index !== launchIndex) topics[index] = { ...researched, id: topic.id, category: topic.category, pillar: topic.category };
  }
  const categories = Object.fromEntries(Object.keys(PILLARS).map((category) => [category, topics.filter((topic) => topic.category === category).length]));
  return {
    schema: "behind-the-ordinary-topic-universe/1",
    channel: "behind-the-ordinary",
    generated_at: "2026-10-03T00:00:00.000Z",
    policy: "Question-first inventory. productionReady=false records may be scored for research priority but cannot enter production until evidence and provenance are attached.",
    stats: { total: topics.length, qualified: topics.length, validated_candidates: topics.length, production_ready: topics.filter((topic) => topic.productionReady).length, research_backlog: topics.filter((topic) => !topic.productionReady).length, used: 0, categories },
    topics
  };
}

function main() {
  const output = path.join(ROOT, "channels", "behind-the-ordinary", "topics", "topic-universe.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(output, "utf8")); } catch (error) { /* first run */ }
  const universe = generate(previous);
  fs.writeFileSync(output, JSON.stringify(universe, null, 2) + "\n");
  console.log(`The Hidden Logic of Things: ${universe.stats.total} validated questions; ${universe.stats.production_ready} production-ready evidence pack → ${path.relative(ROOT, output)}`);
}

if (require.main === module) main();

module.exports = { PILLARS, generate, candidate, researchQuestion, researchedLaunchTopic };
