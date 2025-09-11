# SSL Expiry Tracker

This project checks SSL certificate expiry for configured domains and can send alerts if a certificate is about to expire.  

---

## 📦 Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/mohitpant05/ssl-expiry-tracker.git
cd ssl-expiry-tracker
npm install


crontab -e
0 9 * * 1 /usr/bin/node /path/to/your/project/ssl-checker.js >> /path/to/your/project/logs/ssl-check.log 2>&1
