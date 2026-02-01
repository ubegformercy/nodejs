# Environment Variables Setup Guide

## 1. DISCORD_TOKEN - Where to Get It

This is your **Bot Token** - it lets the bot connect to Discord.

### How to Get It:

1. Go to: https://discord.com/developers/applications
2. Click on your **BoostMon** application
3. Click **Bot** in the left sidebar
4. Under the **TOKEN** section, you'll see your token
5. Click the **Copy** button (📋) to copy it
6. Paste it into `.env`:
   ```
   DISCORD_TOKEN=your_copied_token_here
   ```

⚠️ **SECURITY:** This token controls your bot! Never share it!

Example (NOT real):
```
DISCORD_TOKEN=MjM4NDk1NzU0ODk3MDI2NTI4.CwX5_Q.dQw4w9WgXcQ1234567890
```

---

## 2. DISCORD_GUILD_ID - NOT Needed Anymore ✅

You're **absolutely correct!** 

Since your bot is now **GLOBAL** (works on 100s of servers), you **DO NOT** need `DISCORD_GUILD_ID`.

The `DISCORD_GUILD_ID` was only used when:
- Bot was restricted to ONE specific server
- Testing on a single guild

Now that it's global:
- ✅ Leave `DISCORD_GUILD_ID=` empty (blank)
- ✅ Bot works on ALL servers automatically
- ✅ Each server manages their own settings via the dashboard
- ✅ Users log in and select their server

So in your `.env`:
```
DISCORD_GUILD_ID=
# Leave this empty!
```

---

## 3. DATABASE_URL - PostgreSQL Connection String

**NOT quite.** That's just the server address. You need the **full connection string**.

### What You Found:
```
yamabiko.proxy.rlwy.net:35107
```

This is just:
- **Host:** `yamabiko.proxy.rlwy.net`
- **Port:** `35107`

### You Need the FULL Connection String

It should look like:
```
postgresql://username:password@yamabiko.proxy.rlwy.net:35107/database_name
```

Or if using Railway:
```
postgresql://postgres:password@yamabiko.proxy.rlwy.net:35107/railway
```

### How to Find It on Railway:

1. Go to your Railway project dashboard
2. Click on your **PostgreSQL** service (not BoostMon)
3. Click the **Connect** tab
4. Look for **Connection String** 
5. You should see something like:
   ```
   postgresql://postgres:xyz123@yamabiko.proxy.rlwy.net:35107/railway
   ```
6. Copy the ENTIRE string
7. Paste it into `.env`:
   ```
   DATABASE_URL=postgresql://postgres:xyz123@yamabiko.proxy.rlwy.net:35107/railway
   ```

### Alternative: Railway Quickstart

If you don't see a connection string:

1. Click **PostgreSQL** service
2. Click **Variables** tab
3. Look for `DATABASE_URL` variable
4. Click it to see the full value
5. Copy and paste into your local `.env`

---

## Complete .env Template

Here's what your `.env` should look like:

```properties
# Discord Bot Configuration
DISCORD_TOKEN=MjM4NDk1NzU0ODk3MDI2NTI4.CwX5_Q.dQw4w9WgXcQ1234567890
DISCORD_CLIENT_ID=238495754897026528
DISCORD_CLIENT_SECRET=fgsdgsdfgsdfgsdgsdgsdgsdfgsdg
DISCORD_GUILD_ID=
# ^ LEAVE EMPTY - Bot is now GLOBAL!

# Database
DATABASE_URL=postgresql://postgres:your_password@yamabiko.proxy.rlwy.net:35107/railway

# Environment
NODE_ENV=development
```

---

## Step-by-Step: Get All Values

### Step 1: Get Discord Token
1. Discord Developer Portal
2. Applications → BoostMon
3. Bot → TOKEN → Copy
4. Paste into `DISCORD_TOKEN=`

### Step 2: Get Discord Client ID
1. Same application
2. General Information tab
3. Copy CLIENT ID
4. Paste into `DISCORD_CLIENT_ID=`

### Step 3: Get Discord Client Secret
1. Same application
2. General Information tab
3. Reset Secret (or copy existing)
4. Paste into `DISCORD_CLIENT_SECRET=`

### Step 4: Get Database URL
1. Railway dashboard
2. Click PostgreSQL service
3. Click Connect tab
4. Copy full connection string
5. Paste into `DATABASE_URL=`

### Step 5: Leave Guild ID Empty
```
DISCORD_GUILD_ID=
# Empty!
```

---

## Verify Your Values

```bash
cd /workspaces/nodejs

# Show your .env values (without secrets)
cat .env | grep -v "^#" | grep -v "^$"

# Test that node can read it
node -e "require('dotenv').config(); console.log('Loaded', Object.keys(process.env).filter(k => k.startsWith('DISCORD')).length, 'Discord vars')"
```

---

## Security Reminders

✅ **DO:**
- Keep `.env` on your local machine only
- Never commit it to GitHub
- Regenerate tokens if exposed

❌ **DON'T:**
- Share these values
- Put them in code
- Commit `.env` to GitHub

---

**Next Step:** Fill in your `.env` file with these 5 values, then test with:
```bash
npm start
```

**Last Updated:** February 1, 2026
