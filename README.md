# Mail Track (Reverse-Engineered Mailsuite / Mailtrack Clone)

A lightweight, real-time email tracking engine with Google Chrome extension integration, double checkmarks (`✓✓`), web beacon tracking, link click redirects, and live WebSocket dashboard.

---

## 🛠️ Architecture (Mailsuite Mechanics)

Through reverse engineering `mailsuite.crx` (v12.99.1) with REA:
1. **Pixel Beacon**: Outgoing emails contain a hidden 1×1 image (`/trace/mail/[id].png`). When recipient renders the email, the beacon logs the timestamp, IP address, and User-Agent.
2. **Link Redirection**: Links in email bodies route via `/trace/link/[id]?url=[dest]` to count clicks and issue HTTP 302 redirects.
3. **Double Checkmark State**:
   - `✓` (Grey): Sent, tracking beacon embedded.
   - `✓✓` (Bright Green): Opened by recipient with count & time tooltip.
4. **Real-time Push**: Node.js WebSocket broadcasts events to all active dashboard and Chrome extension clients.

---

## 🚀 Quick Start

### 1. Tracking Server & Dashboard
The server runs on port `4000`:
```bash
cd server
npm start
```
- **Web Dashboard**: [http://localhost:4000](http://localhost:4000)
- **Tracking Endpoints**:
  - `GET /trace/mail/:id.png` (1x1 Transparent PNG Beacon)
  - `GET /trace/link/:id?url=...` (Click Tracking 302 Redirect)
  - `POST /api/emails` (Register Tracked Email)
  - `GET /api/emails` (List Tracked Emails)
  - `WS ws://localhost:4000` (Real-Time Notification Feed)

---

### 2. Loading the Chrome Extension in Gmail

1. Open Google Chrome and navigate to `chrome://extensions/`
2. Toggle on **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the folder:
   ```
   /Users/naveen/Mail Track/extension
   ```
5. Open [Gmail](https://mail.google.com/):
   - You will see the **Mail Track: Tracking Active** toggle button in the compose window.
   - When you send an email, a unique tracking pixel is automatically attached.
   - When the recipient opens the email, you'll receive a desktop notification and double checkmarks (`✓✓`) appear in your Sent folder!

---

### 3. 📱 Mobile Double Checkmarks (Official Gmail Mobile App)

Browser extensions cannot natively run inside mobile apps like Gmail on iOS or Android. Following the official reverse-engineered Mailsuite/Mailtrack architecture:

1. **Gmail Labels Sync**:
   - Sent tracked emails are automatically tagged in Gmail with a subtle grey label: `✓`
   - The moment your recipient opens the email, the tracking server swaps the label in real time to a vibrant green label: `✓✓`
2. **Native Mobile App Visibility**:
   - The official Gmail app on iPhone and Android displays conversation labels directly on your email threads in the Sent folder and Inbox.
3. **Setup**:
   - In the Web Dashboard (`http://localhost:4000`), navigate to **Settings** > **Mobile Features**.
   - Click **Connect Gmail for Mobile Checkmarks** (grants Gmail label/modify permissions).
   - Ensure **Conversation view** is turned **ON** in your Gmail settings (`Settings` > `See all settings` > `General` > `Conversation view on`).
