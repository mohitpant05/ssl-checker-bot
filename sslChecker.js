const tls = require("tls");
const moment = require("moment");
const axios = require("axios");
const config = require('config')

const GOOGLE_CHAT_WEBHOOKS = config.get('GOOGLE_CHAT_WEBHOOKS')
const api_url = config.get('api_url')
const api_key = config.get('api_key')
async function getWhiteLableDomains() {
  // try {
  //   const response = await axios.post(
  //     `${api_url}/get_whitelabeled_domain`,
  //     { integrationSecret: api_key },
  //     { headers: { "Content-Type": "application/json" } }
  //   );

  //   // Assuming API returns { domains: ["google.com", "github.com", ...] }
  //   const domains = response.data.domains;
  //   console.log("Fetched domains:", domains);
  //   return domains;
  // } catch (err) {
  //   console.error("❌ Failed to fetch domains:", err.message);
  //   return []; // return empty array if API fails
  // }
  return [
    "www.google.com",
  "https://www.github.com",
  "https://www.example.com",
  "https://www.abc.jkl"
  ]
}

let domains = [
    "www.google.com",
  "https://www.github.com",
  "https://www.example.com",
  "https://www.abc.jkl"
  ];
// domains = getWhiteLableDomains();

// SSL Checker
function checkSSL(domain) {
  return new Promise((resolve, reject) => {

    domain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

    const socket = tls.connect(443, domain, { servername: domain }, () => {
      const cert = socket.getPeerCertificate();

      if (!cert || !cert.valid_to) {
        reject({ domain, error: new Error(`❌ No certificate found for ${domain}`) });
        socket.end();
        return;
      }

      const expiryDate = moment(new Date(cert.valid_to));
      const now = moment();
      const daysLeft = expiryDate.diff(now, "days");

      resolve({
        domain,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        expiryDate: expiryDate.format("YYYY-MM-DD HH:mm:ss"),
        daysLeft
      });
      socket.end();
    });

    socket.on("error", (err) => {
      reject({ domain, error: new Error(`❌ Error checking ${domain}: ${err.message}`) });
    });
  });
}

function createBatches(messages, maxSize = 32000) {
  const batches = [];
  let currentBatch = "";
  
  messages.forEach(msg => {
    if ((Buffer.byteLength(currentBatch + msg, "utf8")) > maxSize) {
      batches.push(currentBatch);
      currentBatch = msg;
    } else {
      currentBatch += (currentBatch ? "\n---\n" : "") + msg;
    }
  });
  
  if (currentBatch) {
    batches.push(currentBatch);
  }
  
  return batches;
}

async function main() {
  const results = await Promise.allSettled(domains.map(checkSSL));

  const report = results.map((result) => {
    if (result.status === "fulfilled") {
      const { domain, validFrom, validTo, expiryDate, daysLeft } = result.value;

      if (daysLeft <= 15) {
        return `Domain: ${domain} → ⚠️ Expiring Soon\nCertificate expires in ${daysLeft} days (on ${expiryDate}).\nValid From: ${validFrom}\nValid To: ${validTo}`;
      } else {
        return `Domain: ${domain} → ✅ Healthy\nCertificate valid until ${expiryDate} (${daysLeft} days left).\nValid From: ${validFrom}\nValid To: ${validTo}`;
      }
    } else {
      return `Domain: ${result.reason.domain} → ❌ Error\n${result.reason.error.message}`;
    }
  });

  const batches = createBatches(report);

  console.log(`📦 Prepared ${batches.length} message batch(es)`);

  for (let i = 0; i < batches.length; i++) {
    const chatMessage = {
      text: `*SSL Certificate Report (Batch ${i + 1}/${batches.length})*\n\n${batches[i]}`
    };

    try {
        GOOGLE_CHAT_WEBHOOKS.forEach(async (GOOGLE_CHAT_WEBHOOK) => {
            await axios.post(GOOGLE_CHAT_WEBHOOK, chatMessage, {
        headers: { "Content-Type": "application/json" }
      });})      
      console.log(`✅ Sent batch ${i + 1}/${batches.length} to Google Space.`);
    } catch (err) {
      console.error(`❌ Failed to send batch ${i + 1}:`, err.message);
    }
  }
}

main();
