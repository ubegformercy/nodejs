# Quick Start: Deploy BoostMon to Railway

## 1. Prerequisites

- GitHub account
- Railway account (free tier available)
- Discord bot token and IDs

## 2. Deploy PostgreSQL Database

### Via Railway Dashboard

1. Go to https://railway.app
2. Create new project or select existing BoostMon project
3. Click "+ Create" → "Database" → "PostgreSQL"
4. Wait for PostgreSQL container to start
5. Click on PostgreSQL service
6. Go to "Variables" tab
7. Copy the `DATABASE_URL` value (save for step 5)

## 3. Configure Environment Variables

In your Railway project:

1. Click on your BoostMon service (or create if doesn't exist)
2. Go to "Variables" tab
3. Add these variables:

```
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id  
DISCORD_GUILD_ID=your_server_id
DATABASE_URL=postgresql://user:pass@host:port/dbname
```

The `DATABASE_URL` should already be set by Railway's PostgreSQL add-on.

## 4. Deploy Code

### Option A: Via GitHub (Recommended)

1. Push code to GitHub:
```bash
git add .
git commit -m "Migrate BoostMon to PostgreSQL"
git push origin main
```

2. In Railway, connect your GitHub repo and set up auto-deploy

### Option B: Via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway up
```

## 5. Verify Deployment

Check logs in Railway dashboard:

```
✓ Database schema initialized
BoostMon logged in as YourBot#1234
Slash commands registered
```

## 6. Test in Discord

```
/settime @user 5 @testrole
/timeleft @user
/cleartime @user
```

## Environment Variables Reference

| Variable | Example | Required |
|----------|---------|----------|
| `DISCORD_TOKEN` | `MTA4NTU...` | ✅ Yes |
| `DISCORD_CLIENT_ID` | `108555...` | ✅ Yes |
| `DISCORD_GUILD_ID` | `123456...` | ✅ Yes |
| `DATABASE_URL` | `postgresql://...` | ✅ Yes (auto-created) |
| `PORT` | `3000` | ❌ Optional (default: 3000) |

## Troubleshooting

### Bot won't start

Check Railway logs for errors:
- Missing environment variables
- Database connection failed
- Discord token invalid

### Commands not working

1. Verify bot is online: `railway logs`
2. Check bot permissions in Discord server
3. Ensure database is running: Check PostgreSQL service in Railway

### Slow responses

Normal after deployment starts. Wait 1-2 minutes for full startup.

## Database Queries (Advanced)

### Access PostgreSQL directly

```bash
railway connect postgresql
```

### View all timers

```sql
SELECT user_id, role_id, expires_at, paused FROM role_timers;
```

### Check recent activity

```sql
SELECT * FROM role_timers ORDER BY updated_at DESC LIMIT 20;
```

## Next Steps

- [ ] Verify all commands work
- [ ] Set up backups (Railway auto-backs up daily)
- [ ] Monitor logs for errors
- [ ] Archive `data.json` after verification
- [ ] Enable webhooks for critical alerts

## Support

- Railway Docs: https://docs.railway.app
- Discord.js Docs: https://discord.js.org
- PostgreSQL Docs: https://www.postgresql.org/docs

---

**Your bot is now running on Railway with PostgreSQL!** 🚀
