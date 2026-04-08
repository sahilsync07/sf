const express = require("express");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const port = 3000;

app.use(
  cors({
    origin: ["http://localhost:5173", "https://sahilsync07.github.io"],
  })
);
app.use(express.json());

const tallyUrl = "http://localhost:9000/";
const stockDataPath = path.resolve(
  __dirname,
  "../../Frontend/public/assets/stock-data.json"
);
const ledgerDataPath = path.resolve(
  __dirname,
  "../../Frontend/public/assets/ledger-data.json"
);
const tallyTimeout = 30000;
const repoRoot = path.resolve(__dirname, "../../");

// ============================================================
//  GIT AUTO-COMMIT & PUSH
// ============================================================

/**
 * Runs git add, commit, and push in the repo root directory.
 * Fire-and-forget — errors are logged but never block the API response.
 * @param {string} commitMessage
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function gitCommitAndPush(commitMessage) {
  return new Promise((resolve) => {
    const cmd = `git add -A && git commit -m "${commitMessage}" && git push`;
    console.log(`🚀 Git: Running in ${repoRoot}`);
    console.log(`   Command: ${cmd}`);

    exec(cmd, {
      cwd: repoRoot,
      timeout: 30000,
      env: {
        ...process.env,
        GIT_EDITOR: 'true',           // Prevent editor from opening
        GIT_TERMINAL_PROMPT: '0',     // Disable all interactive prompts
        GIT_MERGE_AUTOEDIT: 'no',     // Prevent merge edit prompts
      }
    }, (error, stdout, stderr) => {
      if (error) {
        if (stderr?.includes("nothing to commit") || stdout?.includes("nothing to commit")) {
          console.log("✅ Git: Nothing to commit (data unchanged)");
          resolve({ success: true, message: "Nothing to commit" });
          return;
        }
        console.error("❌ Git commit/push failed:", error.message);
        console.error("   stderr:", stderr);
        resolve({ success: false, message: error.message });
        return;
      }
      console.log("✅ Git: Committed and pushed successfully");
      if (stdout) console.log("   stdout:", stdout.trim());
      resolve({ success: true, message: "Committed and pushed" });
    });
  });
}

/**
 * Formats current date/time into a readable commit timestamp.
 * Example: "08-Apr-2026 08:35 AM"
 */
function getCommitTimestamp() {
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(now.getDate()).padStart(2, '0');
  const mmm = months[now.getMonth()];
  const yyyy = now.getFullYear();
  let hh = now.getHours();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${dd}-${mmm}-${yyyy} ${String(hh).padStart(2, '0')}:${mm} ${ampm}`;
}

const tallyRequestXML = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Stock Summary</REPORTNAME>
        <STATICVARIABLES>
          <EXPLODEFLAG>Yes</EXPLODEFLAG>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVZEROQTY>Yes</SVZEROQTY>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

// Fetch all ledgers with their parent group and balances
const ledgerListXML = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllLedgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllLedgers">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Server-side aggregation: GROUP BY (LedgerName, VoucherType, Date, VoucherNo) SUM(Amount)
const voucherSummaryXML = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerSummary</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>20250401</SVFROMDATE>
        <SVTODATE>20260331</SVTODATE>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllVch" ISINITIALIZE="Yes">
            <TYPE>Voucher</TYPE>
            <FETCH>VoucherTypeName, Date, VoucherNumber</FETCH>
          </COLLECTION>
          <COLLECTION NAME="LedgerSummary">
            <SOURCECOLLECTION>AllVch</SOURCECOLLECTION>
            <WALK>Ledger Entries</WALK>
            <BY>LdgName : $LedgerName</BY>
            <BY>VchType : $..VoucherTypeName</BY>
            <BY>VchDate : $..Date</BY>
            <BY>VchNo : $..VoucherNumber</BY>
            <AGGRCOMPUTE>TotalAmt : Sum : $Amount</AGGRCOMPUTE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

async function fetchTallyData() {
  try {
    console.log("Fetching data from Tally:", tallyUrl);
    const response = await axios.post(tallyUrl, tallyRequestXML, {
      headers: { "Content-Type": "text/xml" },
      timeout: tallyTimeout,
    });
    console.log(
      "Tally response status:",
      response.status,
      "Data length:",
      response.data.length
    );
    if (!response.data.trim()) {
      throw new Error("Empty Tally response");
    }

    const parsedData = parser.parse(response.data);
    const envelope = parsedData.ENVELOPE;
    if (!envelope || !envelope.DSPACCNAME || !envelope.DSPSTKINFO) {
      throw new Error("Invalid or empty Tally response");
    }

    const dspAccNames = Array.isArray(envelope.DSPACCNAME)
      ? envelope.DSPACCNAME
      : [envelope.DSPACCNAME].filter(Boolean);
    const dspStkInfos = Array.isArray(envelope.DSPSTKINFO)
      ? envelope.DSPSTKINFO
      : [envelope.DSPSTKINFO].filter(Boolean);

    if (dspAccNames.length !== dspStkInfos.length) {
      throw new Error("Mismatched DSPACCNAME and DSPSTKINFO counts");
    }

    require("dotenv").config({ path: path.resolve(__dirname, "../../Frontend/.env") });

    // Load Company Config
    const configFileName = process.env.VITE_CONFIG_FILE || 'sf.json';
    const configPath = path.resolve(__dirname, `../../Frontend/public/config/${configFileName}`);
    let companyConfig = {};
    try {
      const configFileContent = await fs.readFile(configPath, 'utf-8');
      companyConfig = JSON.parse(configFileContent);
      console.log(`Loaded company config: ${configFileName}`);
    } catch (err) {
      console.error(`Failed to load config file: ${configPath}`, err.message);
      throw new Error(`Critical: Cannot load config file ${configFileName}`);
    }

    const stockGroups = {};
    let currentGroup = "Stock";

    // Use groups from config (case-insensitive comparison)
    const groupNames = companyConfig.tallyGroups || [];

    dspAccNames.forEach((acc, index) => {
      const name = acc.DSPDISPNAME || `Unknown ${index}`;
      const stkCl = dspStkInfos[index]?.DSPSTKCL || {};
      const quantity = stkCl.DSPCLQTY || "";
      const rate = parseFloat(stkCl.DSPCLRATE || "0");
      const amount = parseFloat(stkCl.DSPCLAMTA || "0");

      const isGroup =
        !quantity.trim() ||
        groupNames.some((group) => name.toLowerCase() === group.toLowerCase());

      if (isGroup) {
        currentGroup = name;
        if (!stockGroups[currentGroup]) {
          stockGroups[currentGroup] = { products: [], totalAmount: 0 };
        }
        stockGroups[currentGroup].totalAmount += amount;
      } else {
        const qtyValue = parseFloat(quantity.replace(/[^0-9.-]/g, "") || "0");
        if (!stockGroups[currentGroup]) {
          stockGroups[currentGroup] = { products: [], totalAmount: 0 };
        }
        stockGroups[currentGroup].products.push({
          productName: name,
          quantity: qtyValue,
          imageUrl: null,
        });
        stockGroups[currentGroup].totalAmount += amount;
      }
    });

    const stockData = Object.entries(stockGroups).map(([groupName, value]) => ({
      groupName,
      products: value.products,
    }));

    if (!stockData.length) {
      throw new Error("No valid stock data processed from Tally");
    }

    return stockData;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to Tally at ${tallyUrl}`);
      throw new Error("Tally connection refused. Ensure Tally is running.");
    } else {
      console.error("Error fetching Tally data:", error.message);
      throw error;
    }
  }
}

async function fetchLedgerData() {
  try {
    console.log("📒 Fetching ledger data from Tally...");
    const ledgerResponse = await axios.post(tallyUrl, ledgerListXML, {
      headers: { "Content-Type": "text/xml" },
      timeout: tallyTimeout,
    });

    if (!ledgerResponse.data || !ledgerResponse.data.toString().trim()) {
      throw new Error("Empty ledger list response from Tally");
    }

    const ledgerParsed = parser.parse(ledgerResponse.data);
    const ledgerCollection =
      ledgerParsed?.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER ||
      ledgerParsed?.ENVELOPE?.COLLECTION?.LEDGER ||
      ledgerParsed?.ENVELOPE?.LEDGER;

    if (!ledgerCollection) {
      throw new Error("No ledger data found in Tally response");
    }

    const ledgers = Array.isArray(ledgerCollection) ? ledgerCollection : [ledgerCollection];
    console.log(`  ✅ Found ${ledgers.length} ledgers`);

    const groupMap = {};
    ledgers.forEach((ledger) => {
      const name = ledger["@_NAME"] || ledger.NAME || "Unknown";
      const parent = typeof ledger.PARENT === "object" ? (ledger.PARENT["#text"] || "Ungrouped") : (ledger.PARENT || "Ungrouped");
      const openingBalRaw = typeof ledger.OPENINGBALANCE === "object" ? (ledger.OPENINGBALANCE["#text"] || "0") : (ledger.OPENINGBALANCE || "0");
      const closingBalRaw = typeof ledger.CLOSINGBALANCE === "object" ? (ledger.CLOSINGBALANCE["#text"] || "0") : (ledger.CLOSINGBALANCE || "0");

      if (!groupMap[parent]) groupMap[parent] = [];
      groupMap[parent].push({
        ledgerName: name,
        openingBalance: parseFloat(openingBalRaw),
        closingBalance: parseFloat(closingBalRaw),
        entries: [],
      });
    });

    try {
      console.log("  → Fetching voucher summaries...");
      const voucherResponse = await axios.post(tallyUrl, voucherSummaryXML, {
        headers: { "Content-Type": "text/xml" },
        timeout: tallyTimeout * 2,
      });

      if (voucherResponse.data && voucherResponse.data.toString().trim()) {
        const voucherParsed = parser.parse(voucherResponse.data);
        const summaryCollection =
          voucherParsed?.ENVELOPE?.BODY?.DATA?.COLLECTION?.OBJECT ||
          voucherParsed?.ENVELOPE?.COLLECTION?.OBJECT ||
          voucherParsed?.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGERSUMMARY;

        if (summaryCollection) {
          const entries = Array.isArray(summaryCollection) ? summaryCollection : [summaryCollection];
          const getVal = (obj) => {
            if (obj === null || obj === undefined) return "";
            if (typeof obj === "object") return obj["#text"] || "";
            return obj.toString();
          };

          const ledgerEntriesMap = {};
          entries.forEach((entry) => {
            const ledgerName = getVal(entry.LDGNAME) || "Unknown";
            const totalAmt = parseFloat(getVal(entry.TOTALAMT) || "0");
            const drCr = totalAmt < 0 ? "Dr" : "Cr";
            const amount = Math.round(Math.abs(totalAmt) * 100) / 100;

            if (!ledgerEntriesMap[ledgerName]) ledgerEntriesMap[ledgerName] = [];
            ledgerEntriesMap[ledgerName].push({
              date: getVal(entry.VCHDATE),
              voucherNo: getVal(entry.VCHNO),
              type: getVal(entry.VCHTYPE),
              amount,
              drCr,
            });
          });

          Object.values(groupMap).forEach((list) => {
            list.forEach((l) => {
              if (ledgerEntriesMap[l.ledgerName]) l.entries = ledgerEntriesMap[l.ledgerName];
            });
          });
        }
      }
    } catch (vErr) { console.warn("Voucher fetch failed", vErr.message); }

    const ledgerData = Object.entries(groupMap).map(([groupName, ledgers]) => ({ groupName, ledgers }));
    ledgerData.sort((a, b) => a.groupName.localeCompare(b.groupName));
    return ledgerData;
  } catch (error) {
    console.error("Error fetching ledger data:", error.message);
    throw error;
  }
}

async function syncLedgerToFile() {
  console.log("📒 Syncing ledger data to file...");
  let data;
  try {
    data = await fetchLedgerData();
  } catch (err) {
    try {
      const existing = await fs.readFile(ledgerDataPath, "utf-8");
      if (existing.trim()) return { success: false, fallback: true, error: err.message };
    } catch (_) {}
    return { success: false, fallback: false, error: err.message };
  }

  const lastSyncTime = new Date().toISOString();
  data.unshift({ groupName: "_META_DATA_", lastSync: lastSyncTime, ledgers: [] });

  try {
    await fs.writeFile(ledgerDataPath, JSON.stringify(data, null, 2));
    return { success: true, groups: data.length - 1, lastSync: lastSyncTime };
  } catch (err) {
    throw new Error(`Cannot write ledger-data.json: ${err.message}`);
  }
}

app.get("/api/stock", async (req, res) => {
  try { res.json(await fetchTallyData()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/ledger", async (req, res) => {
  try { res.json(await fetchLedgerData()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/updateLedgerData", async (req, res) => {
  try { res.json(await syncLedgerToFile()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/updateStockData", async (req, res) => {
  try {
    let existingData = [];
    try { existingData = JSON.parse(await fs.readFile(stockDataPath, "utf-8")); }
    catch (_) { existingData = []; }

    const productMeta = {};
    const zeroStockProducts = {};

    existingData.forEach((group) => {
      (group.products || []).forEach((product) => {
        productMeta[product.productName] = {
          imageUrl: product.imageUrl || null,
          imageUploadedAt: product.imageUploadedAt || null,
          firstSeenAt: product.firstSeenAt || null
        };
        if (product.quantity === 0 && product.imageUrl) {
          (zeroStockProducts[group.groupName] ??= []).push(product);
        }
      });
    });

    let stockData;
    try { stockData = await fetchTallyData(); }
    catch (tallyError) {
      if (existingData.length === 0) return res.status(503).json({ error: "Tally unavailable" });
      return res.json({ message: "Using existing data", data: existingData });
    }

    stockData.forEach((group) => {
      group.products.forEach((p) => {
        const saved = productMeta[p.productName];
        if (saved) {
          p.imageUrl = saved.imageUrl;
          p.imageUploadedAt = saved.imageUploadedAt;
          p.firstSeenAt = saved.firstSeenAt;
        } else {
          p.imageUrl = null;
          p.firstSeenAt = new Date().toISOString();
        }
      });
      if (zeroStockProducts[group.groupName]) group.products.push(...zeroStockProducts[group.groupName]);
      const seen = new Set();
      group.products = group.products.filter((p) => {
        if (seen.has(p.productName)) return false;
        seen.add(p.productName);
        return true;
      });
    });

    const lastSyncTime = new Date().toISOString();
    stockData.unshift({ groupName: "_META_DATA_", lastSync: lastSyncTime, products: [] });

    await fs.writeFile(stockDataPath, JSON.stringify(stockData, null, 2));
    const ledgerSync = await syncLedgerToFile();

    // ---- Git commit & push (fire-and-forget) ----
    const timestamp = getCommitTimestamp();
    const commitMsg = `Stock Data Update ${timestamp}`;
    gitCommitAndPush(commitMsg).then((gitResult) => {
      if (!gitResult.success) {
        console.warn(`⚠️ Git push failed (non-fatal): ${gitResult.message}`);
      }
    });

    res.json({ message: "Stock updated successfully", data: stockData, ledgerSync });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post("/api/updateImage", async (req, res) => {
  try {
    const { productName, imageUrl } = req.body;
    let stockData = JSON.parse(await fs.readFile(stockDataPath, "utf-8"));
    let updated = false;
    stockData.forEach(g => g.products.forEach(p => {
      if (p.productName === productName) {
        p.imageUrl = imageUrl;
        p.imageUploadedAt = new Date().toISOString();
        updated = true;
      }
    }));
    if (!updated) throw new Error("Product not found");
    await fs.writeFile(stockDataPath, JSON.stringify(stockData, null, 2));
    res.json({ message: "Image updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/removeImage", async (req, res) => {
  try {
    const { productName } = req.body;
    let stockData = JSON.parse(await fs.readFile(stockDataPath, "utf-8"));
    let updated = false;
    stockData.forEach(g => g.products.forEach(p => {
      if (p.productName === productName && p.imageUrl) {
        p.imageUrl = null;
        updated = true;
      }
    }));
    if (!updated) throw new Error("Product not found or image missing");
    await fs.writeFile(stockDataPath, JSON.stringify(stockData, null, 2));
    res.json({ message: "Image removed" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));