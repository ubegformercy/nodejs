# Railway OAuth2 Setup Guide

## Problem
Your Railway deployment shows `Token exchange failed: Unauthorized` error.

## Root Cause
`DISCORD_CLIENT_SECRET` is not set in Railway's environment variables.

## Solution: Add Variables to Railway

### Step 1: Go to Railway Dashboard
1. Open: https://railway.app
2. Sign in with your account
3. Click your **BoostMon** project

### Step 2: Select the Node.js Service
1. Click on **BoostMon** service (NOT PostgreSQL)
2. You'll see the service details page

### Step 3: Go to Variables Tab
1. Click the **Variables** tab at the top
2. You should see `DATABASE_URL` already set

### Step 4: Add Missing Discord Variables

You need to add these variables to Railway:

| Variable | Where to Find It |
|----------|------------------|
| `DISCORD_TOKEN` | Discord Dev Portal → Bot → TOKEN (copy button) |
| `DISCORD_CLIENT_ID` | Discord Dev Portal → General Info → CLIENT ID |
| `DISCORD_CLIENT_SECRET` | Discord Dev Portal → General Info → Reset Secret |

**Steps to add each:**

1. Click **New Variable** button
2. Enter the variable name (e.g., `DISCORD_CLIENT_SECRET`)
3. Enter the value from Discord Developer Portal
4. Click the checkmark to confirm
5. Repeat for each variable

### Step 5: Deploy
1. After adding all variables, click the **Deploy** button
2. Railway will restart your service with the new variables
3. Wait 30-60 seconds for deployment to complete

### Step 6: Test
Once deployed:
1. Go to: https://nodejs-production-9ae1.up.railway.app/login.html
2. Click "Login with Discord"
3. You should see Discord's authorization page (not an error)

---

## Quick Reference: Finding Values

### DISCORD_TOKEN
- Discord Dev Portal → Applications → BoostMon
- Click **Bot** in sidebar
- Find **TOKEN** section
- Click **Copy** button
- Paste into Railway

### DISCORD_CLIENT_ID
- Discord Dev Portal → Applications → BoostMon  
- Click **General Information** tab
- Find **CLIENT ID**
- Click **Copy** button
- Paste into Railway

### DISCORD_CLIENT_SECRET
- Discord Dev Portal → Applications → BoostMon
- Click **General Information** tab
- Find **CLIENT SECRET**
- Click **Reset Secret** button
- Click **Copy** button  
- Paste into Railway

---

## Troubleshooting

### Still getting error after deploying?
- Wait 60 seconds for deployment to fully complete
- Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
- Check Railway logs for errors

### Variables not showing up?
- Make sure you clicked **Deploy** button
- Check you're on the correct service (BoostMon, not PostgreSQL)

### Not sure which token is which?
- Token = Very long string with dots (contains `.G2nMYi.`)
- Client ID = Numbers only (like `1465195079194116261`)
- Secret = Mix of letters and special characters (like `wkkoHVpi-7vNihCPZvyn`)

---

## After OAuth Works

Your flow will be:
1. User clicks "Login with Discord" on login page
2. Redirects to Discord authorization
3. User authorizes the app
4. Redirects back with server list
5. User selects their server
6. Dashboard shows real data!

---

## Local Development (No Need to Set These)

Local development uses `.env` file (which is NOT committed to GitHub). It's already secure because:
- ✅ `.env` is in `.gitignore`
- ✅ Only exists on your machine
- ✅ Never pushed to GitHub

---

**Last Updated:** February 1, 2026
