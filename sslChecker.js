const tls = require("tls");
const moment = require("moment");
const axios = require("axios");
const config = require("config");
const { createLogger, format, transports } = require('winston');
const path = require("path")
require('winston-daily-rotate-file');


const dailyRotateFile = new transports.DailyRotateFile({
    dirname: path.join(__dirname, 'logs'),
    filename: 'ssl-bot-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    maxFiles: '5d',
});

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.printf(
            info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`
        )
    ),
    transports: [
        dailyRotateFile,
        new transports.Console()
    ]
});

const GOOGLE_CHAT_WEBHOOKS = config.get("GOOGLE_CHAT_WEBHOOKS");
const api_url = config.get("api_url");
// const api_key = config.get("api_key");

console.log = (...args) => logger.info(args.join(' '));
console.error = (...args) => logger.error(args.join(' '));

class DomainService {
  static async getWhiteLabelDomains() {
    try {
      const response = await axios.post(
        `${api_url}/getWLDomains`,
        {},
        { headers: { "Content-Type": "application/json" }, timeout:  60000}
      );
      return response.data.data || [];
    } catch (err) {
      console.error("❌ Failed to fetch domains:", err);
      return [];
    }
  }
}

class SSLChecker {
  static check(domain) {
    return new Promise((resolve, reject) => {
      const user_id = domain.user_id;
      const email = domain.email
      domain = domain.domain.trim();
      domain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

      const socket = tls.connect(443, domain, { servername: domain }, () => {
        const cert = socket.getPeerCertificate();

        if (!cert || !cert.valid_to) {
          reject({
            domain,
            error: new Error(`❌ No certificate found for ${domain}`)
          });
          socket.end();
          return;
        }

        const expiryDate = moment(new Date(cert.valid_to));
        const now = moment();
        const daysLeft = expiryDate.diff(now, "days");
        console.log(`✅✅ Domain: ${domain} checked ✅✅`)
        resolve({
          user_id,
          email,
          domain,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          expiryDate: expiryDate.format("YYYY-MM-DD HH:mm:ss"),
          daysLeft
        });
        socket.end();
      });

      socket.on("error", (err) => {
        reject({
          domain,
          error: new Error(`❌ Error checking ${domain}: ${err.message}`)
        });
      });
    });
  }
}

class MessageBatcher {
  static create(messages, maxSize = 32000) {
    const batches = [];
    let currentBatch = "";

    messages.forEach((msg) => {
      if(!msg) return;
      if (Buffer.byteLength(currentBatch + msg, "utf8") > maxSize) {
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
}

class ChatNotifier {
  static async sendBatch(batch, batchIndex, totalBatches) {
    const chatMessage = {
      text: `*SSL Certificate Report (Batch ${batchIndex + 1}/${totalBatches})*\n\n${batch}`
    };

    for (let i = 0; i < GOOGLE_CHAT_WEBHOOKS.length; i++) {
      const webhook = GOOGLE_CHAT_WEBHOOKS[i];
      try {
        await axios.post(webhook, chatMessage, {
          headers: { "Content-Type": "application/json" }
        });
        console.log(
          `✅ Sent batch ${batchIndex + 1}/${totalBatches} using webhook #${i + 1}`
        );
        return;
      } catch (err) {
        if (err.response && err.response.status === 429) {
          console.warn(
            `⚠️ Webhook #${i + 1} rate-limited. Trying next webhook...`
          );
          continue;
        } else {
          console.error(
            `❌ Failed on webhook #${i + 1} (non-rate-limit error):`,
            err.message
          );
          continue;
        }
      }
    }

    console.error(
      `❌ All webhooks failed for batch ${batchIndex + 1}/${totalBatches}.`
    );
  }
}


(async function main() {
  console.log("🚀 Starting SSL Checker...");

  const domains = await DomainService.getWhiteLabelDomains();
  console.log('Number of domains are : ', domains.length)
  if (!domains.length) {
    console.warn("⚠️ No domains found, exiting...");
    return;
  }

  // Promise.allSettled polyfill for Node 10.9.0 compatibility
  const promiseAllSettled = (promises) => {
    return Promise.all(
      promises.map(promise =>
        Promise.resolve(promise)
          .then(value => ({ status: 'fulfilled', value }))
          .catch(reason => ({ status: 'rejected', reason }))
      )
    );
  };

  const results = await promiseAllSettled(domains.map(SSLChecker.check));

  let report = results.map((result) => {
    if (result.status === "fulfilled") {
      const { domain, validFrom, validTo, expiryDate, daysLeft, user_id, email } = result.value;

      if(daysLeft <= 15){
        return `Domain: ${domain} → ⚠️ Expiring Soon\nCertificate expires in ${daysLeft} days (on ${expiryDate}).\nValid From: ${validFrom}\nValid To: ${validTo}\nUser Id: ${user_id}\nEmail: ${email}`;
      }
      else{
        return;
      }
      // else{
      //   return `Domain: ${domain} → ✅ Healthy\nCertificate valid until ${expiryDate} (${daysLeft} days left).\nValid From: ${validFrom}\nValid To: ${validTo}`;
      // }
    }
    //  else {
      // return `Domain: ${result.reason.domain} → ❌ Error\n${result.reason.error.message}`;
    // }
  });

  const batches = MessageBatcher.create(report);
  console.log(`📦 Prepared ${batches.length} message batch(es)`);

  for (let i = 0; i < batches.length; i++) {
    await ChatNotifier.sendBatch(batches[i], i, batches.length);
  }

  console.log("✅ SSL Checker completed.");
})();
