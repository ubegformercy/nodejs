# 🔐 Environment Variables & Secrets Security Guide

## Critical: NEVER Expose Your Secrets! ⚠️

### What Are Secrets?
- `DISCORD_TOKEN` - Your bot's authentication token
- `DISCORD_CLIENT_SECRET` - OAuth secret key
- `DATABASE_URL` - Contains database password
- `API_KEYS` - Any authentication credentials

### What Could Happen If Exposed?
- ❌ Attacker controls your bot
- ❌ Attacker accesses your database
- ❌ Your bot spams servers
- ❌ Your database is deleted/modified
- ❌ Your server data is compromised
- ❌ Legal liability

---

## The Right Way: By Environment

### Local Development ✅

**On Your Computer (Safe):**

```bash
# Create .env in your project
cat > /workspaces/nodejs/.env << 'EOF'
DISCORD_TOKEN=your_real_token_here
DISCORD_CLIENT_ID=your_real_id_here
DISCORD_CLIENT_SECRET=your_real_secret_here
DATABASE_URL=your_real_db_url_here
NODE_ENV=development
EOF
```

**Why it's safe:**
- File is listed in `.gitignore`
- Only on your local machine
- Never uploaded to GitHub
- Node.js loads it automatically with `require('dotenv')`

**Verify it's protected:**
```bash
# Should output: .env
grep "^\.env$" .gitignore

# Verify git won't commit it
git status | grep .env
# Should show NOTHING (it's ignored)
```

---

### Production on Railway ✅

**Use Railway's Variables Tab (Most Secure):**

1. Go to Railway dashboard
2. Select **BoostMon** service
3. Click **Variables** tab
4. Add your secrets here:

```
DISCORD_TOKEN = [paste your token]
DISCORD_CLIENT_ID = [paste your ID]
DISCORD_CLIENT_SECRET = [paste your secret]
DATABASE_URL = [PostgreSQL URL from Railway]
NODE_ENV = production
```

**Why it's safe:**
- Secrets are encrypted at rest
- Not visible in your code
- Not in version control
- Not in logs
- Only accessible to your service
- Easy to rotate without code changes

**To update a secret:**
1. Click on the variable
2. Change the value
3. Click **Deploy** to restart bot with new value

---

### GitHub Actions CI/CD ✅

**If you use automated workflows:**

1. Go to GitHub repo → **Settings**
2. Click **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add secrets:

```
DISCORD_CLIENT_SECRET = [your secret]
DATABASE_URL = [your db url]
```

**Usage in workflow (.github/workflows/deploy.yml):**
```yaml
env:
  DISCORD_CLIENT_SECRET: ${{ secrets.DISCORD_CLIENT_SECRET }}
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

---

## The Wrong Way: DON'T DO THIS ❌

### ❌ Never Hardcode Secrets
```javascript
// WRONG! DANGEROUS!
const token = "NzI4MjQwNzQ1NDkyODMyMzUy";
const secret = "abc123xyz789";
```

### ❌ Never Commit .env
```bash
# WRONG!
git add .env
git commit -m "Add env file"
git push
# Now everyone can see your secrets!
```

### ❌ Never Put Secrets in Comments
```javascript
// WRONG!
// My Discord token: NzI4MjQwNzQ1NDkyODMyMzUy
// Client secret: abc123xyz789
const botToken = process.env.DISCORD_TOKEN;
```

### ❌ Never Share Secrets in Chat/Email
- Don't share tokens on Discord
- Don't email tokens to yourself
- Don't post in tickets/issues
- Don't screenshot with tokens visible

### ❌ Never Store in Plain Text Files
```bash
# WRONG!
echo "DISCORD_TOKEN=abc123" > token.txt
git add token.txt
```

---

## If Your Secret Was Exposed 🚨

**Immediately:**

1. Regenerate the token on Discord Developer Portal
2. Update Railway variables with new token
3. Restart the bot
4. Check git history (see below)

**Remove from Git History:**

If you accidentally committed a secret:

```bash
# Remove the file from git
git rm --cached .env

# Commit the removal
git commit -m "Remove .env from version control"

# Push to GitHub
git push

# Now rotate your tokens immediately!
# Go to Discord Developer Portal and regenerate
```

**Check if it was ever public:**

```bash
# See all commits that touched .env
git log --full-history -- .env

# If it was committed, the secret is compromised
# ALWAYS rotate tokens after accidental commit
```

---

## Testing Your Setup

### Verify .env is Protected

```bash
# Check that .env is in .gitignore
grep "\.env" .gitignore

# Check that .env won't be committed
git add .env  # Try to add it
git status    # Should not appear!

# Check git won't track it
git check-ignore .env
# Should output: .env matched by pattern in .gitignore
```

### Verify Your Bot Loads Secrets

```bash
# Start bot with verbose logging
NODE_DEBUG=* npm start 2>&1 | grep -i "env\|token"

# Or check in code:
console.log("TOKEN loaded:", !!process.env.DISCORD_TOKEN);
console.log("CLIENT_ID loaded:", !!process.env.DISCORD_CLIENT_ID);
```

### Verify Railway Has Secrets

1. Go to Railway dashboard
2. Select BoostMon service
3. Click Variables tab
4. Secrets should show as `••••••••` (hidden)
5. You can view them by clicking the variable

---

## Best Practices Checklist

- ✅ Use `.env` file locally (protected by `.gitignore`)
- ✅ Use Railway Variables for production
- ✅ Use GitHub Secrets for CI/CD only
- ✅ Never commit `.env` to GitHub
- ✅ Never share secrets in chat/email/calls
- ✅ Rotate tokens if ever exposed
- ✅ Use different tokens for dev and production
- ✅ Review git history before first push

---

## Environment Variables Explained

### What Your Bot Needs

```bash
# Bot Authentication
DISCORD_TOKEN=NzI4MjQwNzQ1NDkyODMyMzUy
# ^ For bot to connect to Discord

# OAuth Configuration  
DISCORD_CLIENT_ID=728240745492832353
# ^ For login page to work

DISCORD_CLIENT_SECRET=abc123xyz789def456
# ^ For OAuth token exchange (VERY SECRET!)

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
# ^ For storing timers and settings

# Environment
NODE_ENV=production
# ^ Tells app whether it's dev or production
```

### Where They Come From

| Variable | Source | How to Get |
|----------|--------|-----------|
| `DISCORD_TOKEN` | Discord Developer Portal | Apps → Your App → Bot → Token |
| `DISCORD_CLIENT_ID` | Discord Developer Portal | Apps → Your App → General Info → CLIENT ID |
| `DISCORD_CLIENT_SECRET` | Discord Developer Portal | Apps → Your App → General Info → CLIENT SECRET |
| `DATABASE_URL` | Railway | PostgreSQL service → Variables tab |

---

## Rotation Schedule

**Rotate tokens:**
- ✅ Every 6 months (preventative)
- ✅ Immediately if exposed
- ✅ When someone leaves your team
- ✅ When you suspect compromise
- ✅ After major security updates

**How to rotate:**
1. Generate new token in Discord Portal
2. Update Railway Variables
3. Restart bot (Railway auto-redeploys)
4. Delete old token (optional, but good practice)

---

## Support & Help

**If you need help with secrets:**
1. Check `.gitignore` has `.env` listed
2. Verify file isn't committed: `git ls-files | grep .env`
3. Check Railway Variables are set
4. Review this guide again

**If your secret was exposed:**
1. Regenerate it immediately
2. Remove from git history (see above)
3. Rotate the token
4. Never reuse old tokens

---

**Remember: Your secrets are your responsibility!**

Keep them safe. Don't commit them. Rotate them regularly.

**Last Updated:** February 1, 2026
